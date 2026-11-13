"""Visualisation agent: graph JSON, the summary numbers and the one-line summary.

Everything here is counted from the run; no model writes text in this step (the Results screen
shows the numbers as tiles, not a paragraph).

People see dependency *links*: one per (dependent, target) pair, however many methods found
it (app/analysis_view.py merges them the same way). The summary is given link counts so its
numbers match the screen; `dependencies` stays the raw count for the evals and tests.
"""

from __future__ import annotations

from collections import Counter, defaultdict

from agents.runtime import RunContext, node
from agents.state import AgentState, Dependency, Risk
from tools.dri_rules import DRI_CODES
from tools.graph_tools import to_cytoscape
from tools.wording import plural

_SEV_RANK = {"blocker": 0, "warning": 1, "info": 2}
SEVERITY_WORD = {"blocker": "high", "warning": "medium", "info": "low"}  # the UI's words


def links(live: list[Dependency]) -> dict[tuple[str, str], list[Dependency]]:
    out: dict[tuple[str, str], list[Dependency]] = defaultdict(list)
    for d in live:
        out[(d.from_id, d.to_id)].append(d)
    return out


def link_in_jira(members: list[Dependency]) -> bool | None:
    """True if any part is linked in Jira, False if every part is known not to be, else unknown."""
    seen = [m.in_jira for m in members]
    return True if True in seen else False if seen and all(x is False for x in seen) else None


def rank_risks(risks: list[Risk]) -> list[Risk]:
    """Most severe first, then the ones that reach the most initiatives and dependencies."""
    return sorted(risks, key=lambda r: (_SEV_RANK[r.severity], -len(r.initiative_ids), -len(r.dependency_ids),
                                        r.dri_code, r.title))


def _key_risk(ranked: list[Risk]) -> str:
    if not ranked:
        return "No risk flags from the DRI rules evaluated."
    top = ranked[0]
    alike = sum(r.dri_code == top.dri_code and r.severity == top.severity for r in ranked)
    tail = (f" (1 of {alike} {SEVERITY_WORD[top.severity]} '{DRI_CODES.get(top.dri_code, top.dri_code)}' flags)"
            if alike > 1 else "")
    return f"{top.title}: {top.description}{tail}"


@node("visualisation", "Visualisation agent")
def visualise(state: AgentState, ctx: RunContext) -> dict:
    snap = ctx.snapshot
    titles = {i.id: i.title for i in state.initiatives}
    live = [d for d in state.deps if d.status in ("verified", "low_confidence")]
    jira_baseline = snap.has("S10")
    sev = Counter(r.severity for r in state.risks)
    teams = {i.owning_team for i in state.initiatives if i.owning_team} | {
        d.to_id.removeprefix("team:") for d in live if d.to_kind == "team"}
    pairs = links(live)
    pair_jira = [link_in_jira(m) for m in pairs.values()]

    stats = {
        "initiatives": len(state.initiatives),
        "teams": len(teams),
        "dependencies": len(live),
        "links": len(pairs),
        "links_documented": sum(v is True for v in pair_jira),
        "links_declared": sum(any(d.declared for d in m) for m in pairs.values()),
        "links_hidden": sum(not any(d.declared for d in m) for m in pairs.values()),
        "links_not_in_jira": sum(v is False for v in pair_jira),
        "documented": sum(d.in_jira is True for d in live),
        "not_in_jira": sum(d.in_jira is False for d in live),
        "jira_baseline": jira_baseline,
        "by_kind": dict(Counter(d.kind for d in live)),
        "low_confidence": sum(d.status == "low_confidence" for d in live),
        "rejected": len(state.rejected_deps),
        "risks": len(state.risks),
        "risk_by_severity": {k: sev.get(k, 0) for k in ("blocker", "warning", "info")},
        "steps": len(state.sequence),
    }

    sequence_text = " → ".join(" + ".join(titles.get(i, i) for i in s.initiative_ids) for s in state.sequence)
    ranked = rank_risks(state.risks)
    by_sev = {SEVERITY_WORD[k]: v for k, v in stats["risk_by_severity"].items()}
    summary = {
        "sequence_text": sequence_text or "No initiatives to sequence.",
        "key_risk": _key_risk(ranked),
        "summary": (f"{plural(stats['initiatives'], 'initiative')} across {plural(stats['teams'], 'team')}: "
                    f"{plural(stats['links_declared'], 'declared dependency', 'declared dependencies')}, "
                    f"{stats['links_hidden']} hidden ones found; {plural(stats['risks'], 'risk flag')} "
                    f"({by_sev['high']} high, {by_sev['medium']} medium, {by_sev['low']} low)."),
        "method": "template",
    }
    kpis = []
    def num(v):
        return None if v != v else float(v)  # NaN -> None, numpy -> float

    for _, r in snap.table("S9").iterrows():
        kpis.append({"kpi": r["kpi"], "value": num(r["value"]), "target": num(r["target"]), "unit": r.get("unit", ""),
                     "benchmark_type": r.get("benchmark_type", ""), "description": r.get("description", "")})
    pct_new = (f"{100 * stats['links_not_in_jira'] / stats['links']:.0f}%" if jira_baseline and stats["links"]
               else "n/a (no Jira baseline)")
    run_metrics = [
        {"label": "Dependency links not yet linked in Jira", "value": pct_new},
        {"label": "Grounded dependency links", "value": str(stats["links"])},
        {"label": "Rejected by verifier", "value": str(stats["rejected"])},
        {"label": "LLM calls (ok / budget)", "value": f"{ctx.llm_outcomes.get('ok', 0)} / {ctx.budget.model_limit}"},
    ]

    ui = {
        "graph": to_cytoscape(state.initiatives, state.deps, state.systems, state.risks, snap),
        "stats": stats,
        "summary": summary,
        "kpis": kpis,
        "run_metrics": run_metrics,
        "rule_coverage": state.rule_coverage,
        "llm": {"provider": ctx.llm.provider, "model": ctx.llm.model, "enabled": ctx.llm.enabled,
                "outcomes": dict(ctx.llm_outcomes), "budget": ctx.budget.as_dict()},
        "data_fingerprint": snap.fingerprint,
    }
    ctx.emit("note", "visualisation", text="Results ready for review")
    return {"ui": ui}
