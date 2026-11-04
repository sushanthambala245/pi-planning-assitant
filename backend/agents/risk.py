"""Risk agent: DRI rules decide every flag and severity; the LLM explains them.

An LLM rationale is accepted per risk id it was given; any risk it skips keeps the
template rationale, and ids it invents are ignored.
"""

from __future__ import annotations

import json

from pydantic import BaseModel

from agents.runtime import RunContext, node
from agents.state import AgentState, Risk
from tools.dri_rules import DRI_CODES, Facts, run_rules

MAX_RISKS_FOR_LLM = 30


class RiskWhy(BaseModel):
    risk_id: str
    rationale: str


class RiskOut(BaseModel):
    risks: list[RiskWhy]


def _template(r: Risk) -> str:
    text = f"{r.description} Flagged by rule {r.dri_code} ({DRI_CODES.get(r.dri_code, r.dri_code)})."
    if r.history_note:
        text += f" History: {r.history_note}."
    return text


def _people(ctx: RunContext, state: AgentState, r: Risk) -> list[dict]:
    teams = {i.owning_team for i in state.initiatives if i.id in r.initiative_ids} | set(r.entities)
    out = []
    for t in sorted(teams):
        row = ctx.snapshot.team_row(t)
        if row:
            out.append({k: row.get(k, "") for k in ("team", "art", "em", "po", "rte")})
    return out


@node("risk", "Risk agent")
def risk(state: AgentState, ctx: RunContext) -> dict:
    facts = Facts(ctx.snapshot, ctx.settings, state.initiatives, state.systems, state.deps, state.cycles, state.capacity)
    risks, coverage = run_rules(facts)
    for r in risks:
        r.rationale = _template(r)

    if risks:
        titles = {i.id: i.title for i in state.initiatives}
        payload = [{"risk_id": r.id, "rule": f"{r.dri_code} {DRI_CODES.get(r.dri_code, '')}", "severity": r.severity,
                    "title": r.title, "finding": r.description,
                    "initiatives": [titles.get(i, i) for i in r.initiative_ids], "entities": r.entities,
                    "evidence": [s.quote or s.detail for s in r.sources][:3], "history": r.history_note,
                    "people": _people(ctx, state, r)} for r in risks[:MAX_RISKS_FOR_LLM]]
        out = ctx.structured(task="risk_rationale", prompt="risk_rationale", stable_context="",
                             user=json.dumps({"risks": payload}, indent=1), schema=RiskOut, node="risk")
        if out is not None:
            by_id = {w.risk_id: w.rationale.strip() for w in out.risks if w.rationale.strip()}
            for r in risks:
                if r.id in by_id:
                    r.rationale, r.rationale_method = by_id[r.id], "llm"

    for r in risks[:8]:
        ctx.emit("finding", "risk", tag="risk", text=f"[{r.severity}] {r.title}", sub=r.dri_code,
                 initiative_ids=r.initiative_ids)
    skipped = [f"{k}: {v}" for k, v in coverage.items() if v.startswith("skipped")]
    if skipped:
        ctx.emit("note", "risk", text="Not checked — " + "; ".join(skipped))
    return {"risks": risks, "rule_coverage": coverage}
