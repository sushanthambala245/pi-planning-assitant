"""Context loading, the human-in-the-loop gate, and export.

The gate pauses the graph with a LangGraph interrupt. The API checks the reviewer's
role in code (app/identity.py) before resuming; the graph never approves anything on
its own, and nothing is written to Jira.
"""

from __future__ import annotations

from langgraph.types import interrupt

from agents.runtime import RunContext, get_ctx, node
from agents.state import AgentState, Approval
from llm.prompts import all_prompt_versions
from tools.guardrails import GUARDRAIL_VERSION
from tools.jira import write_exports


@node("load_context", "Load context")
def load_context(state: AgentState, ctx: RunContext) -> dict:
    warnings = []
    for rep in ctx.snapshot.reports.values():
        if rep.status in ("ready", "partial"):
            ctx.emit("source_used", "load_context", source=rep.id, title=rep.title, count=rep.rows, unit="records loaded")
        elif rep.status == "invalid":
            warnings.append(ctx.warn("load_context", f"{rep.id} {rep.filename} is invalid and was not used: "
                                                     f"{'; '.join(rep.errors[:2])}"))
    missing = [r.id for r in ctx.snapshot.reports.values() if r.status == "missing"]
    if missing:
        warnings.append(ctx.warn("load_context", f"Not loaded: {', '.join(missing)}. Steps that need them are skipped."))
    ctx.emit("note", "load_context", text=f"Analysing {len(state.initiatives)} initiative(s) against data "
                                          f"fingerprint {ctx.snapshot.fingerprint}")
    return {"warnings": warnings}


def human_gate(state: AgentState) -> dict:
    """Pause for review. Resumed by POST /api/runs/{id}/review with an Approval payload."""
    decision = interrupt({"run_id": state.run_id, "awaiting": "review"})
    approval = Approval.model_validate(decision)
    update: dict = {"approvals": [*state.approvals, approval]}
    if approval.action == "challenge" and approval.constraint:
        update["constraints"] = [*state.constraints, approval.constraint]
    get_ctx(state.run_id).emit("review_received", "human_gate", action=approval.action, reviewer=approval.reviewer,
                               role=approval.role,
                               constraint=approval.constraint.model_dump() if approval.constraint else None)
    return update


def route_after_review(state: AgentState) -> str:
    return "export" if state.approvals and state.approvals[-1].action == "approve" else "sequencing"


def build_audit(state: AgentState, ctx: RunContext, flags: list[str]) -> dict:
    return {
        "run_id": state.run_id,
        "data": ctx.snapshot.summary(),
        "sources": {k: v.as_dict() for k, v in ctx.snapshot.reports.items()},
        "model": {"provider": ctx.llm.provider, "model": ctx.llm.model, "enabled": ctx.llm.enabled},
        "llm_outcomes": dict(ctx.llm_outcomes),
        "budget": ctx.budget.as_dict(),
        "prompt_versions": all_prompt_versions(),
        "guardrail_version": GUARDRAIL_VERSION,
        "settings": ctx.settings.public(),
        "flags": flags,
        "state": state.model_dump(mode="json", exclude={"candidate_deps"}),
        "trace_file": "../trace.jsonl",  # relative to this export folder; spans for every step and LLM call
    }


@node("export", "Export")
def export(state: AgentState, ctx: RunContext) -> dict:
    files = write_exports(ctx.run_dir, state, ctx.snapshot, build_audit(state, ctx, ctx.flags)) if ctx.run_dir else []
    ctx.emit("note", "export", text=f"Exported {', '.join(files)} (proposals only; nothing written to Jira)")
    return {"exports": files}
