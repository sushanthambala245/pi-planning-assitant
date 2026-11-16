"""Evidence Verifier (critic loop).

merge   - dedupe candidates by id, merge evidence, tag "documented in Jira?" from S10.
verify  - grounding is a hard gate: a dependency with no evidence that passes the
          citation check is rejected (kept in rejected_deps with the reason). Confidence
          is a soft gate: grounded but below CONFIDENCE_THRESHOLD -> low_confidence.
requery - for low-confidence text dependencies, ask a narrow yes/no question over the
          cited documents plus a targeted search; at most MAX_REQUERY_ROUNDS rounds.
          A re-query raises confidence only with a new verified quote; an explicit
          "not supported" rejects the dependency; a failed call changes nothing.
"""

from __future__ import annotations

import contextvars
from concurrent.futures import ThreadPoolExecutor

from pydantic import BaseModel

from agents.analyser import clamp
from agents.runtime import RunContext, get_ctx, node
from agents.state import AgentState, Dependency, EvidenceRef
from tools.citations import check_evidence, grounded
from tools.jira import in_jira, jira_links
from tools.text_tools import attributable, render_documents

_METHOD_RANK = {"llm": 3, "rule": 2, "structural": 1, "human": 4}


class RequeryOut(BaseModel):
    supported: bool
    evidence_ref: str
    quote: str
    confidence: float
    reason: str


@node("merge", "Merge & dedupe")
def merge(state: AgentState, ctx: RunContext) -> dict:
    links = jira_links(ctx.snapshot)
    merged: dict[str, Dependency] = {}
    for cand in state.candidate_deps:
        d = merged.get(cand.id)
        if d is None:
            merged[cand.id] = cand.model_copy(deep=True)
            continue
        d.evidence.extend(e for e in cand.evidence if e not in d.evidence)
        d.confidence = max(d.confidence, cand.confidence)
        if _METHOD_RANK[cand.method] > _METHOD_RANK[d.method]:
            d.method, d.dep_type = cand.method, cand.dep_type
        d.directed = d.directed or cand.directed
        d.declared = d.declared or cand.declared
    deps = list(merged.values())
    for d in deps:
        d.in_jira = in_jira(ctx.snapshot, d, links)
    decided = _apply_planner(state, ctx, deps)
    known = sum(d.in_jira is True for d in deps)
    baseline = "Jira baseline (S10) not loaded" if links is None else f"{known} already linked in Jira"
    ctx.emit("note", "merge", text=f"{len(state.candidate_deps)} candidates merged into {len(deps)} dependencies; "
                                   f"{baseline}" + (f"; {decided}" if decided else ""))
    return {"deps": deps}


def _apply_planner(state: AgentState, ctx: RunContext, deps: list[Dependency]) -> str:
    """A planner's notes and decisions from the previous run, by link key ("from->to"): a dismissed
    link is rejected (and says so), a confirmed one becomes user-defined and passes the confidence gate."""
    p = state.planner
    confirmed = dismissed = 0
    for d in deps:
        key = f"{d.from_id}->{d.to_id}"
        d.note = p.dependency_notes.get(key, d.note)
        decision = p.dependency_decisions.get(key)
        if decision == "dismissed":
            d.decision, d.status = "dismissed", "rejected"
            d.verification_note = "Dismissed by a planner" + (f": {d.note}" if d.note else "")
            dismissed += 1
        elif decision == "confirmed":
            d.decision, d.declared = "confirmed", True
            d.confidence = max(d.confidence, ctx.settings.confidence_threshold)
            confirmed += 1
    return (f"planner: {confirmed} confirmed, {dismissed} dismissed" if confirmed or dismissed else "")


@node("verify", "Evidence verifier")
def verify(state: AgentState, ctx: RunContext) -> dict:
    threshold = ctx.settings.confidence_threshold
    kept: list[Dependency] = []
    rejected = {d.id: d for d in state.rejected_deps}
    for dep in state.deps:
        d = dep.model_copy(deep=True)
        if d.status == "rejected":
            rejected[d.id] = d
            continue
        good, notes = grounded(d.evidence, ctx)
        if not good:
            d.status = "rejected"
            d.verification_note = "No citable evidence: " + "; ".join(notes)
            rejected[d.id] = d
            continue
        d.evidence = good
        d.status = "verified" if d.confidence >= threshold else "low_confidence"
        if not d.verification_note or d.status == "verified":
            d.verification_note = (f"{len(good)} evidence item(s) verified"
                                   + ("" if d.status == "verified" else f"; confidence {d.confidence:.2f} < {threshold}"))
        kept.append(d)

    newly_rejected = [d for d in rejected.values() if d.id not in {r.id for r in state.rejected_deps}]
    run_ids = {i.id for i in state.initiatives}

    def involved(d: Dependency) -> list[str]:
        return [d.from_id] + ([d.to_id] if d.to_id in run_ids else [])

    for d in newly_rejected:
        ctx.emit("finding", "verify", tag="rejected",
                 text=f"Rejected: {_label(ctx, state, d.from_id)} → {_label(ctx, state, d.to_id)}",
                 initiative_ids=involved(d), sub=d.verification_note[:200])
    for d in kept:
        if d.kind == "explicit" and state.requery_round == 0:
            quote = next((e.quote for e in d.evidence if e.quote), "")
            ctx.emit("finding", "verify", tag="explicit",
                     text=f"{_label(ctx, state, d.from_id)} {d.dep_type.replace('_', ' ')} {_label(ctx, state, d.to_id)}",
                     initiative_ids=involved(d), dep_key=f"{d.from_id}->{d.to_id}",
                     sub=f"“{quote[:160]}”" if quote else d.verification_note)
    low = sum(d.status == "low_confidence" for d in kept)
    ctx.emit("note", "verify", text=f"{len(kept)} grounded ({low} low confidence), {len(newly_rejected)} rejected")
    return {"deps": kept, "rejected_deps": list(rejected.values())}


def _requery_targets(state: AgentState, ctx: RunContext) -> list[Dependency]:
    return [d for d in state.deps
            if d.status == "low_confidence" and d.method in ("llm", "rule")
            and d.requery_attempts < ctx.settings.max_requery_rounds][: ctx.settings.max_requery_deps]


def route_after_verify(state: AgentState) -> str:
    ctx = get_ctx(state.run_id)
    if ctx.llm.enabled and state.requery_round < ctx.settings.max_requery_rounds and _requery_targets(state, ctx):
        return "requery"
    return "sequencing"


def _label(ctx: RunContext, state: AgentState, ident: str) -> str:
    for i in state.initiatives:
        if i.id == ident:
            return f"{i.title} ({i.id})"
    return ident.split(":", 1)[-1]


def _requery_one(ctx: RunContext, state: AgentState, d: Dependency) -> Dependency:
    nd = d.model_copy(deep=True)
    nd.requery_attempts += 1
    chunks = [c for c in (ctx.chunk(e.ref) for e in d.evidence) if c]
    query = f"{_label(ctx, state, d.from_id)} {_label(ctx, state, d.to_id)} blocked waiting depends requires"
    for hit in ctx.snapshot.index.search(query, k=4, sources=("S2", "S3", "M3", "M1")):
        if hit.chunk.chunk_id not in {c.chunk_id for c in chunks}:
            chunks.append(hit.chunk)
    ctx.observe(c.chunk_id for c in chunks)
    user = (f"Claimed dependency: {_label(ctx, state, d.from_id)} depends on {_label(ctx, state, d.to_id)} "
            f"({d.to_kind}).\n\n{render_documents(chunks, ctx.snapshot.owner_of)}")
    out = ctx.structured(task="requery", prompt="requery", stable_context="", user=user, schema=RequeryOut,
                         node="requery")
    if out is None:
        nd.verification_note = "Re-query unavailable; still low confidence"
        return nd
    if not out.supported:
        nd.status = "rejected"
        nd.confidence = min(nd.confidence, clamp(out.confidence))
        nd.verification_note = f"Re-query did not confirm it: {out.reason}"
        return nd
    chunk = ctx.chunk(out.evidence_ref)
    ev = EvidenceRef(ref=out.evidence_ref, source=chunk.source if chunk else "unknown", quote=out.quote)
    ok, why = check_evidence(ev, ctx)
    if ok and not attributable(ctx, ev.ref, d.from_id):
        ok, why = False, f"{ev.ref} belongs to another initiative"
    if not ok:
        nd.verification_note = f"Re-query answered yes but its quote failed the check ({why}); still low confidence"
        return nd
    if ev not in nd.evidence:
        nd.evidence.append(ev)
    nd.confidence = clamp(out.confidence)
    nd.status = "candidate"
    nd.verification_note = f"Confirmed on re-query: {out.reason}"
    return nd


@node("requery", "Evidence verifier — re-query")
def requery(state: AgentState, ctx: RunContext) -> dict:
    targets = _requery_targets(state, ctx)
    with ThreadPoolExecutor(max_workers=ctx.settings.llm_max_concurrency) as pool:
        futures = [pool.submit(contextvars.copy_context().run, _requery_one, ctx, state, d) for d in targets]
        updated = {r.id: r for r in (f.result() for f in futures)}
    ctx.emit("note", "requery", text=f"Re-query round {state.requery_round + 1}: {len(targets)} low-confidence "
                                     f"dependency(ies) checked against narrower evidence")
    return {"deps": [updated.get(d.id, d) for d in state.deps], "requery_round": state.requery_round + 1}
