"""Offline evaluations. Each writes evals/results/<name>.json with its case-set fingerprint,
data fingerprint, model and prompt versions, per-case rows, and an interval per metric.

    python -m evals.run extraction [--mode rule|llm] [--plant-regression]
    python -m evals.run retrieval  [--cases evals/cases/retrieval_cases.jsonl] [--k 6] [--plant-regression]
    python -m evals.run backtest   [--plant-regression]
    python -m evals.run links      [--mode rule|llm] [--plant-regression]
    python -m evals.run all        [--mode rule|llm]
    python -m evals.gate

--plant-regression replaces the component under test with a broken one (an extractor that
finds nothing, a retriever that returns the same chunk for every query, a rule that never
fires). The metric must drop and the gate must fail; if not, the harness measures nothing.
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from dataclasses import replace
from datetime import datetime, timezone
from pathlib import Path

from agents.discovery import ExplicitOut, _lists, _resolve
from agents.graph import build_graph
from agents.runtime import Budget, EventSink, RunContext, Tracer, register
from agents.state import AgentState, Initiative
from app.config import BACKEND_DIR, Settings, get_settings
from context.index import RETRIEVER_VERSION
from context.resolver import norm
from context.snapshot import ContextSnapshot, build_snapshot
from evals.stats import bootstrap_ci, fingerprint, ratio_ci
from llm.adapter import BaseLLM, DisabledLLM, build_llm
from llm.prompts import load_prompt
from tools.dri_rules import has_blockers
from tools.rule_extractor import explicit_dependencies
from tools.text_tools import render_documents

RESULTS = BACKEND_DIR / "evals" / "results"
CASES = BACKEND_DIR / "evals" / "cases"


def _ctx(name: str, settings: Settings, snap: ContextSnapshot, llm: BaseLLM) -> RunContext:
    RESULTS.mkdir(parents=True, exist_ok=True)
    run_id = f"eval-{name}-{datetime.now():%Y%m%d-%H%M%S}"
    ctx = RunContext(run_id, settings, snap, llm, Tracer(RESULTS / f"{name}.trace.jsonl", run_id),
                     EventSink(run_id, None), Budget(10_000))
    register(ctx)
    return ctx


def _metric(value, lo=None, hi=None) -> dict:
    return {"value": None if value is None else round(value, 4),
            "ci95": None if lo is None else [round(lo, 4), round(hi, 4)]}


def _save(name: str, result: dict) -> dict:
    result = {"eval": name, "created_at": datetime.now(timezone.utc).isoformat(timespec="seconds"), **result}
    RESULTS.mkdir(parents=True, exist_ok=True)
    (RESULTS / f"{name}.json").write_text(json.dumps(result, indent=1, default=str), encoding="utf-8")
    with (RESULTS / "history.jsonl").open("a", encoding="utf-8") as f:
        f.write(json.dumps({k: v for k, v in result.items() if k != "cases"}, default=str) + "\n")
    metrics = ", ".join(f"{k}={v['value']}" for k, v in result["metrics"].items())
    print(f"[{name}] n={result.get('n_cases')} {metrics} {'(PLANTED REGRESSION)' if result.get('planted_regression') else ''}")
    for note in result.get("notes", []):
        print(f"  note: {note}")
    return result


def _context(snap: ContextSnapshot, llm: BaseLLM, mode: str) -> dict:
    return {"data_fingerprint": snap.fingerprint, "mode": mode,
            "model": llm.model if mode == "llm" else None,
            "prompt_version": load_prompt("explicit_deps").version if mode == "llm" else None,
            "retriever": RETRIEVER_VERSION}


# -- 1. explicit extraction vs S3 labels --------------------------------------------------------------

def eval_extraction(settings: Settings, snap: ContextSnapshot, llm: BaseLLM, mode: str, plant: bool) -> dict:
    s3 = snap.table("S3")
    notes = []
    if s3.empty or "is_dependency" not in s3.columns or s3["is_dependency"].isna().all():
        return _save("extraction", {"n_cases": 0, "metrics": {"precision": _metric(None), "recall": _metric(None)},
                                    "notes": ["S3 not loaded or unlabelled: extraction not measured"],
                                    **_context(snap, llm, mode)})
    if mode == "llm" and not llm.enabled:
        sys.exit(f"--mode llm needs an LLM: {llm.status().reason}")
    ctx = _ctx("extraction", settings, snap, llm)
    by_id = {i.id: i for i in snap.initiatives()}
    rows = []
    for _, r in s3[s3["is_dependency"].notna()].iterrows():
        chunks = snap.index.doc_chunks(f"S3:{r['statement_id']}")
        if not chunks:
            continue
        fr = snap.resolver.initiative(r.get("from_entity", "")).canonical
        focus = by_id.get(fr) or Initiative(id=r.get("from_entity") or "UNKNOWN", title=r.get("from_entity") or "")
        gold_raw = r.get("to_entity", "")
        gold = snap.resolver.any(gold_raw).canonical or gold_raw
        preds: list[str] = []
        if not plant:
            if mode == "rule":
                deps = explicit_dependencies(snap.resolver, chunks, focus.id, focus.owning_team,
                                             owner_of=lambda c: focus.id, focus_names=[focus.id, focus.title])
                preds = [d.target for d in deps]
            else:
                ctx.observe(c.chunk_id for c in chunks)
                user = (f"<focus_initiative id=\"{focus.id}\" owning_team=\"{focus.owning_team}\">\n{focus.title}\n"
                        f"</focus_initiative>\n\n{render_documents(chunks)}")
                out = ctx.structured(task="extract_dependencies", prompt="explicit_deps",
                                     stable_context=_lists(ctx, AgentState(run_id=ctx.run_id, initiatives=[focus])),
                                     user=user, schema=ExplicitOut, node="eval")
                if out is None:
                    notes.append(f"{r['statement_id']}: LLM call failed; counted as no prediction")
                preds = [t for e in (out.dependencies if out else []) if (t := _resolve(ctx, e.target_kind, e.target))]
        pset = {norm(p) for p in preds}
        if r["is_dependency"]:
            tp = int(norm(gold) in pset)
            fn, fp = 1 - tp, len(pset - {norm(gold)})
        else:
            tp, fn, fp = 0, 0, len(pset)
        rows.append({"id": r["statement_id"], "text": r["text"], "label": bool(r["is_dependency"]), "gold": gold,
                     "predicted": sorted(set(preds)), "tp": tp, "fp": fp, "fn": fn})
    p, plo, phi = ratio_ci([c["tp"] for c in rows], [c["tp"] + c["fp"] for c in rows])
    rc, rlo, rhi = ratio_ci([c["tp"] for c in rows], [c["tp"] + c["fn"] for c in rows])
    if len(rows) < 30:
        notes.append(f"only {len(rows)} labelled cases: intervals are wide, size claims accordingly")
    return _save("extraction", {"n_cases": len(rows), "fingerprint": fingerprint([c["id"] for c in rows]),
                                "metrics": {"precision": _metric(p, plo, phi), "recall": _metric(rc, rlo, rhi)},
                                "planted_regression": plant, "notes": notes, "cases": rows,
                                "llm_outcomes": dict(ctx.llm_outcomes), **_context(snap, llm, mode)})


# -- 2. retrieval: hit rate and MRR over labelled cases --------------------------------------------------

def eval_retrieval(settings: Settings, snap: ContextSnapshot, cases_path: Path, k: int, plant: bool) -> dict:
    base = {"retriever": RETRIEVER_VERSION, "data_fingerprint": snap.fingerprint, "k": k}
    if not cases_path.exists():
        return _save("retrieval", {"n_cases": 0, "metrics": {"hit_rate": _metric(None), "mrr": _metric(None)},
                                   "notes": [f"no labelled cases at {cases_path}: retrieval not measured"], **base})
    cases = [json.loads(line) for line in cases_path.read_text(encoding="utf-8").splitlines() if line.strip()]
    notes = []
    stale = {c.get("corpus_fingerprint") for c in cases} - {None, snap.fingerprint}
    if stale:
        notes.append(f"labels were written against corpus {sorted(stale)}, current is {snap.fingerprint}: re-validate them")
    rows = []
    fixed = snap.index.chunks[:1]
    for c in cases:
        labelled = set(c.get("evidence_docs") or [])
        if not labelled:
            continue  # out-of-scope cases have no evidence and are skipped by retrieval metrics
        t0 = time.perf_counter()
        if plant:
            ranked = fixed  # planted regression: the same chunk for every query
        else:
            sources = tuple(c.get("sources") or ()) or None
            ranked = [h.chunk for h in snap.index.search(c["question"], k=k, sources=sources)]
        ms = (time.perf_counter() - t0) * 1000
        docs = list(dict.fromkeys(ch.doc_id for ch in ranked))
        hit = rr = 0.0
        for rank, d in enumerate(docs, 1):
            if d in labelled:
                hit, rr = 1.0, 1.0 / rank
                break
        rows.append({"id": c["id"], "question": c["question"], "labelled": sorted(labelled), "ranked": docs,
                     "hit": hit, "rr": rr, "latency_ms": round(ms, 2)})
    hr, hlo, hhi = bootstrap_ci([r["hit"] for r in rows])
    mrr, mlo, mhi = bootstrap_ci([r["rr"] for r in rows])
    return _save("retrieval", {"n_cases": len(rows), "fingerprint": fingerprint([r["id"] for r in rows]),
                               "metrics": {"hit_rate": _metric(hr if rows else None, hlo, hhi),
                                           "mrr": _metric(mrr if rows else None, mlo, mhi)},
                               "planted_regression": plant, "notes": notes, "cases": rows, **base})


# -- 3. DRI back-test: would the capacity rule have flagged past misses? ---------------------------------

def eval_backtest(settings: Settings, snap: ContextSnapshot, plant: bool) -> dict:
    s5, s8 = snap.table("S5"), snap.table("S8")
    base = {"data_fingerprint": snap.fingerprint, "rule": "DRI-X-003", "warn_pct": settings.capacity_warn_pct}
    if s5.empty or s8.empty or "committed_points" not in s5.columns:
        return _save("dri_backtest", {"n_cases": 0, "metrics": {"recall": _metric(None), "precision": _metric(None)},
                                      "notes": ["S5 (with committed_points) and S8 are both needed"], **base})
    rows = []
    for _, h in s8.iterrows():
        cap = s5[(s5["team"].map(norm) == norm(h["team"])) & (s5["pi"].map(norm) == norm(h["pi"]))]
        if cap.empty or not cap["capacity_points"].fillna(0).sum():
            continue
        load = 100 * cap["committed_points"].fillna(0).sum() / cap["capacity_points"].fillna(0).sum()
        c, d = h.get("committed_points"), h.get("delivered_points")
        missed = bool((c == c and d == d and c and d < settings.history_miss_ratio * c) or has_blockers(h.get("blockers")))
        flagged = (load > settings.capacity_warn_pct) and not plant
        rows.append({"id": f"{h['team']}@{h['pi']}", "load_pct": round(float(load), 1), "flagged": flagged,
                     "missed": missed})
    tp = [int(r["flagged"] and r["missed"]) for r in rows]
    rec = ratio_ci(tp, [int(r["missed"]) for r in rows])
    prec = ratio_ci(tp, [int(r["flagged"]) for r in rows])
    return _save("dri_backtest", {"n_cases": len(rows), "fingerprint": fingerprint([r["id"] for r in rows]),
                                  "metrics": {"recall": _metric(*rec), "precision": _metric(*prec)},
                                  "planted_regression": plant, "cases": rows,
                                  "notes": [] if rows else ["no S8 row has a matching S5 capacity row"], **base})


# -- 4. known links: does the pipeline find the dependencies Jira already records? ----------------------

def eval_links(settings: Settings, snap: ContextSnapshot, llm: BaseLLM, mode: str, plant: bool) -> dict:
    base = _context(snap, llm, mode)
    s2, s10 = snap.table("S2"), snap.table("S10")
    if s10.empty or s2.empty or "initiative_id" not in s2.columns:
        return _save("known_links", {"n_cases": 0, "metrics": {"recall": _metric(None)},
                                     "notes": ["S2 (with initiative_id) and S10 are both needed"], **base})
    owner = dict(zip(s2["epic_key"], s2["initiative_id"]))
    pairs = {frozenset((owner[a], owner[b])) for a, b in zip(s10["from_key"], s10["to_key"])
             if a in owner and b in owner and owner[a] and owner[b] and owner[a] != owner[b]}
    involved = sorted({i for p in pairs for i in p})[: settings.max_initiatives_per_run]
    pairs = {p for p in pairs if p <= set(involved)}
    if not pairs:
        return _save("known_links", {"n_cases": 0, "metrics": {"recall": _metric(None)},
                                     "notes": ["no S10 link joins two initiatives through S2 epics"], **base})
    model = llm if mode == "llm" else DisabledLLM("rule mode")
    ctx = _ctx("known_links", settings, snap, model)
    graph = build_graph()
    config = {"configurable": {"thread_id": ctx.run_id}, "recursion_limit": 80}
    inis = [i for i in snap.initiatives() if i.id in involved]
    graph.invoke(AgentState(run_id=ctx.run_id, initiatives=inis), config)
    v = graph.get_state(config).values
    state = v if isinstance(v, AgentState) else AgentState.model_validate(v)
    found = set() if plant else {frozenset((d.from_id, d.to_id)) for d in state.deps
                                 if d.to_kind == "initiative" and d.status in ("verified", "low_confidence")}
    rows = [{"id": "|".join(sorted(p)), "found": int(p in found)} for p in sorted(pairs, key=sorted)]
    rec = bootstrap_ci([r["found"] for r in rows])
    return _save("known_links", {"n_cases": len(rows), "fingerprint": fingerprint([r["id"] for r in rows]),
                                 "metrics": {"recall": _metric(*rec)},
                                 "new_initiative_pairs_not_in_jira": len(found - pairs), "planted_regression": plant,
                                 "cases": rows, "llm_outcomes": dict(ctx.llm_outcomes), **base})


def main(argv: list[str] | None = None) -> None:
    ap = argparse.ArgumentParser(prog="python -m evals.run")
    ap.add_argument("eval", choices=["extraction", "retrieval", "backtest", "links", "all"])
    ap.add_argument("--mode", choices=["rule", "llm"], default="rule")
    ap.add_argument("--cases", type=Path, default=CASES / "retrieval_cases.jsonl")
    ap.add_argument("--k", type=int, default=None)
    ap.add_argument("--plant-regression", action="store_true")
    ap.add_argument("--data-dir", type=Path, default=None)
    a = ap.parse_args(argv)

    settings = get_settings()
    if a.data_dir:
        settings = replace(settings, data_dir=a.data_dir.resolve())
    snap = build_snapshot(settings)
    llm = build_llm(settings) if a.mode == "llm" else DisabledLLM("rule mode")
    k = a.k or settings.retrieval_k
    if a.eval in ("extraction", "all"):
        eval_extraction(settings, snap, llm, a.mode, a.plant_regression)
    if a.eval in ("retrieval", "all"):
        eval_retrieval(settings, snap, a.cases, k, a.plant_regression)
    if a.eval in ("backtest", "all"):
        eval_backtest(settings, snap, a.plant_regression)
    if a.eval in ("links", "all"):
        eval_links(settings, snap, llm, a.mode, a.plant_regression)


if __name__ == "__main__":
    main()
