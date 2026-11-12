"""Sequencing agent: graph algorithms order the work; the LLM writes the reason per step.

The order comes from a topological sort of the verified dependency graph plus reviewer
constraints; cycles collapse into one flagged step. An LLM rationale replaces the
template only if it covers every step, cites no dependency id outside that step's chain
(or its coordination links), and still reads as sentences once the ids are removed.

Shared-change links between two initiatives (both change the same system) do not order
the work, so both can land in the same step. Each step's reason names them, so the
sequence does not read as "no dependencies" next to a dependency list that shows them.
"""

from __future__ import annotations

import json

from pydantic import BaseModel

from agents.runtime import RunContext, node
from agents.state import AgentState, Dependency, SequenceStep
from context.snapshot import ContextSnapshot
from tools.dep_classify import classify
from tools.graph_tools import (ORDERING_STATUSES, build_initiative_graph, capacity_check, find_cycles,
                               sequence_steps)
from tools.schedule import build_schedule, parse_size_sprints
from tools.wording import DEP_ID, plural, reads_without_refs


class StepWhy(BaseModel):
    step: int
    why: str


class SequencingOut(BaseModel):
    steps: list[StepWhy]


def coordination(initiative_ids: list[str], state: AgentState, snap: ContextSnapshot,
                 titles: dict[str, str]) -> list[tuple[Dependency, str]]:
    """Shared-system links between initiatives of one step that still need something agreed or
    re-tested: they do not order the work, but the teams must coordinate. One per pair, with
    the classifier's reason (which says what to coordinate)."""
    ids, seen, out = set(initiative_ids), set(), []
    for d in state.deps:
        pair = frozenset((d.from_id, d.to_id))
        if (d.to_kind != "initiative" or d.directed or d.status not in ORDERING_STATUSES
                or not pair <= ids or len(pair) != 2 or pair in seen):
            continue
        c = classify(d, state, snap, lambda x: titles.get(x, x))
        if c.change != "none":
            seen.add(pair)
            out.append((d, c.reason.rstrip(".")))
    return out


def _coordination_text(links: list[tuple[Dependency, str]]) -> str:
    parts = [f"{reason} [{d.id}]" for d, reason in links]
    return (" They can run in parallel but must coordinate: " + "; ".join(parts) + ".") if parts else ""


def _template_why(raw: dict, state: AgentState, titles: dict[str, str], snap: ContextSnapshot) -> str:
    deps = {d.id: d for d in state.deps}
    if raw["in_cycle"]:
        return ("These initiatives depend on each other (a cycle), so no order satisfies every dependency. "
                "Break the cycle before PI planning.")
    parts = []
    for dep_id in raw["chain"]:
        d = deps.get(dep_id)
        if d:
            conf = "" if d.status == "verified" else ", low confidence"
            parts.append(f"{titles.get(d.from_id, d.from_id)} waits for {titles.get(d.to_id, d.to_id)} "
                         f"({d.kind}{conf}) [{d.id}]")
    if raw.get("constrained"):
        parts.append("placed here by a reviewer constraint")
    coordinate = _coordination_text(coordination(raw["initiative_ids"], state, snap, titles))
    if parts:
        return "; ".join(parts) + "." + coordinate
    return ("Waits on no other initiative in this run: can start immediately." if raw["step"] == 1
            else "No dependency between these: they can run in parallel with earlier steps.") + coordinate


@node("sequencing", "Sequencing agent")
def sequencing(state: AgentState, ctx: RunContext) -> dict:
    g = build_initiative_graph(state.initiatives, state.deps, state.constraints)
    cycles = find_cycles(g)
    raw_steps = sequence_steps(g)
    capacity = capacity_check(ctx.snapshot, state.initiatives)
    titles = {i.id: i.title for i in state.initiatives}
    snap = ctx.snapshot
    steps = [SequenceStep(step=s["step"], initiative_ids=s["initiative_ids"], chain=s["chain"], in_cycle=s["in_cycle"],
                          why=_template_why(s, state, titles, snap)) for s in raw_steps]

    deps = {d.id: d for d in state.deps}
    coordinate = {s.step: coordination(s.initiative_ids, state, snap, titles) for s in steps}
    facts = [{"step": s.step, "initiatives": [titles.get(i, i) for i in s.initiative_ids], "cycle": s.in_cycle,
              "dependencies": [{"id": d.id, "dependent": titles.get(d.from_id, d.from_id),
                                "waits_for": titles.get(d.to_id, d.to_id), "kind": d.kind, "status": d.status,
                                "evidence": [e.quote or e.detail for e in d.evidence][:2]}
                               for d in (deps[x] for x in s.chain if x in deps)],
              "coordinate": [{"id": d.id, "initiatives": [titles.get(d.from_id, d.from_id), titles.get(d.to_id, d.to_id)],
                              "what": reason} for d, reason in coordinate[s.step]]}
             for s in steps]
    out = ctx.structured(task="sequencing_rationale", prompt="sequencing_rationale", stable_context="",
                         user=json.dumps({"steps": facts, "constraints": [c.model_dump() for c in state.constraints]},
                                         indent=1),
                         schema=SequencingOut, node="sequencing") if steps else None
    warnings = []
    if out is not None:
        whys = {w.step: w.why.strip() for w in out.steps}
        allowed = {s.step: set(s.chain) | {d.id for d, _ in coordinate[s.step]} for s in steps}
        valid = all(s.step in whys and whys[s.step] and set(DEP_ID.findall(whys[s.step])) <= allowed[s.step]
                    and reads_without_refs(whys[s.step]) for s in steps)
        if valid:
            for s in steps:
                s.why, s.rationale_method = whys[s.step], "llm"
        else:
            warnings.append(ctx.warn("sequencing", "LLM rationale missed a step, cited a dependency outside the "
                                                   "step, or did not read as a sentence without its dependency "
                                                   "ids; template kept"))

    schedule = build_schedule(state.initiatives, g, ctx.settings.pi_sprints, parse_size_sprints(ctx.settings.size_sprints))

    order = " → ".join(" + ".join(titles.get(i, i) for i in s.initiative_ids) for s in steps)
    ctx.emit("finding", "sequencing", tag="sequence", text=f"Recommended order: {order}", initiative_ids=[],
             sub=f"{plural(len(cycles), 'cycle')} · {plural(len(state.constraints), 'reviewer constraint')}")
    over = [c for c in capacity if c.load_pct and c.load_pct > ctx.settings.capacity_warn_pct]
    if over:
        ctx.emit("note", "sequencing", text="Over capacity: " + ", ".join(f"{c.team} {c.load_pct:g}%" for c in over))
    return {"sequence": steps, "cycles": cycles, "capacity": capacity, "schedule": schedule, "warnings": warnings}
