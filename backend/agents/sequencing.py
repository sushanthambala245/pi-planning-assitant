"""Sequencing agent: graph algorithms order the work and place it on the quarter calendar; the LLM
only writes the reason per step.

1. Order: a topological sort of the verified dependency graph plus reviewer constraints; cycles
   collapse into one flagged step. Shared-change links (both change one system) do not order the
   work, so both can land in one step; each step's reason names them.
2. Schedule (tools/planning.py): each initiative's T-shirt size (S1, or a planner's size) in story
   points against its team's capacity (S5, points per quarter, split over the quarter's sprints),
   starting no earlier than its target quarter (S1, or a planner's placement on the decision
   dashboard) and no earlier than the sprint after everything it waits for. The plan as written is
   checked for conflicts: a provider targeted at a later quarter than its consumer, or a quarter too
   tight for both at the provider team's velocity.
3. Load: per team and quarter, the points targeted at that quarter against the team's capacity in it.

An LLM rationale replaces the step template only if it covers every step, cites no dependency id
outside that step's chain (or its coordination links), and still reads as sentences without the ids.
"""

from __future__ import annotations

import json
from collections import defaultdict

from pydantic import BaseModel

from agents.runtime import RunContext, node
from agents.state import AgentState, CapacityLine, Dependency, PlanConflict, ScheduleItem, SequenceStep
from context.resolver import norm
from context.snapshot import ContextSnapshot
from tools.dep_classify import classify
from tools.graph_tools import ORDERING_STATUSES, build_initiative_graph, find_cycles, orders, sequence_steps
from tools.planning import (VELOCITY_TIERS, Calendar, Edge, Item, TeamCapacity, is_quarter, plan_conflicts,
                            planned_finish, scale_of, schedule, size_points, tshirt, velocity_tier)
from tools.wording import DEP_ID, plural, reads_without_refs


class StepWhy(BaseModel):
    step: int
    why: str


class SequencingOut(BaseModel):
    steps: list[StepWhy]


def coordination(initiative_ids: list[str], state: AgentState, snap: ContextSnapshot,
                 titles: dict[str, str]) -> list[tuple[Dependency, str]]:
    """Links between initiatives of one step that do not order the work but still need something
    agreed or re-tested (shared systems, code and library links): the teams must coordinate. One per
    pair, with the classifier's reason (which says what to coordinate)."""
    ids, seen, out = set(initiative_ids), set(), []
    for d in state.deps:
        pair = frozenset((d.from_id, d.to_id))
        if (d.to_kind != "initiative" or orders(d) or d.status not in ORDERING_STATUSES
                or not pair <= ids or len(pair) != 2 or pair in seen):
            continue
        c = classify(d, state, snap, lambda x: titles.get(x, x))
        if c.change != "none":
            seen.add(pair)
            out.append((d, c.reason.rstrip(".")))
    return out


def _coordination_text(links: list[tuple[Dependency, str]]) -> str:
    parts = [f"{reason} [{d.id}]" for d, reason in links[:4]]
    more = f"; and {len(links) - 4} more" if len(links) > 4 else ""
    return (" They can run in parallel but must coordinate: " + "; ".join(parts) + more + ".") if parts else ""


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
            how = "declared" if d.declared else "hidden"
            parts.append(f"{titles.get(d.from_id, d.from_id)} waits for {titles.get(d.to_id, d.to_id)} "
                         f"({how}, {d.kind}{conf}) [{d.id}]")
    if raw.get("constrained"):
        parts.append("placed here by a reviewer constraint")
    coordinate = _coordination_text(coordination(raw["initiative_ids"], state, snap, titles))
    if parts:
        return "; ".join(parts) + "." + coordinate
    return ("Waits on no other initiative in this run: can start immediately." if raw["step"] == 1
            else "No dependency between these: they can run in parallel with earlier steps.") + coordinate


LATER = "later"


def target_pi(ini) -> str:
    """The quarter an initiative is planned for: a planner's placement, else its S1 target. "later"
    (the dashboard's Later bucket) is resolved against the calendar in plan()."""
    override = (ini.quarter_override or "").strip()
    if override.lower() == LATER:
        return LATER
    return (override or ini.target_pi or "").strip()


def build_calendar(snap: ContextSnapshot, state: AgentState, settings=None) -> Calendar:
    """Sprint-level data (older exports) gives the calendar as written; otherwise the quarters
    named in S1, S5 and the planner's placements, SPRINTS_PER_PI sprints each, extended to the
    PLAN_QUARTERS planning horizon."""
    per = settings.sprints_per_pi if settings else 5
    horizon = settings.plan_quarters if settings else 4
    names = snap.sprint_names() + [i.planned_sprint for i in state.initiatives if i.planned_sprint]
    cal = Calendar.build(names)
    pis = snap.pi_names() + [target_pi(i) for i in state.initiatives if target_pi(i) not in ("", LATER)]
    if not cal.sprints:
        return Calendar.quarters(pis, per, horizon if all(is_quarter(p) for p in pis) or not pis else 0)
    for p in pis:  # a quarter named outside the sprint data
        cal.add_pi(p)
    return cal


def team_capacity(snap: ContextSnapshot, cal: Calendar, teams: set[str]) -> dict[str, TeamCapacity]:
    """Available points per team and calendar sprint (S5). A row with a sprint fills that sprint; a
    row with a PI is spread evenly over that PI's sprints; a row with neither is the team's capacity
    in every quarter, spread over a quarter's sprints."""
    out = {t: TeamCapacity(t, {}) for t in teams if t}
    df = snap.table("S5")
    if df.empty:
        return out
    has_sprint = "sprint" in df.columns
    has_pi = "pi" in df.columns
    per_pi = cal.sprints_per_pi() or 1
    for _, r in df.iterrows():
        team = next((t for t in out if norm(t) == norm(r["team"])), None)
        if team is None:
            continue
        pts = float(r["capacity_points"] or 0) if r["capacity_points"] == r["capacity_points"] else 0.0
        sprint = str(r.get("sprint") or "") if has_sprint else ""
        pi = str(r.get("pi") or "") if has_pi else ""
        idx = cal.index(sprint) if sprint else None
        if idx is not None:
            out[team].per_sprint[idx] = out[team].per_sprint.get(idx, 0.0) + pts
            continue
        if not pi:
            out[team].default = (out[team].default or 0.0) + pts / per_pi
            continue
        sprints = [i for i, p in enumerate(cal.pi_of) if p == pi]
        for i in sprints:
            out[team].per_sprint[i] = out[team].per_sprint.get(i, 0.0) + pts / len(sprints)
    return out


def ordering_edges(state: AgentState) -> list[Edge]:
    """Provider -> consumer for every link that orders the work (tools/graph_tools.orders) between
    two initiatives in the run, and every reviewer constraint."""
    ids = {i.id for i in state.initiatives}
    by_pair: dict[tuple[str, str], Edge] = {}
    for d in state.deps:
        if not orders(d) or d.from_id not in ids or d.to_id not in ids or d.from_id == d.to_id:
            continue
        e = by_pair.setdefault((d.to_id, d.from_id), Edge(d.to_id, d.from_id))
        e.dep_ids.append(d.id)
    for c in state.constraints:
        if c.first in ids and c.then in ids and c.first != c.then:
            by_pair.setdefault((c.first, c.then), Edge(c.first, c.then, label="reviewer constraint"))
    return list(by_pair.values())


def sizing(ini, scale: dict[str, float], default_size: str) -> tuple[float, str | None, str]:
    """(points, size, source) for an initiative: a planner's size, its T-shirt size, its story points
    (older exports), else the default size, flagged as assumed."""
    for size, source in ((ini.size_override, "planner"), (ini.tshirt_size, "tshirt")):
        pts = size_points(size, scale)
        if pts is not None:
            return float(pts), size.strip().upper(), source
    if ini.estimate_points:
        return float(ini.estimate_points), tshirt(ini.estimate_points, scale), "estimate"
    pts = size_points(default_size, scale)
    return float(pts or 0.0), default_size if pts is not None else None, "assumed" if pts is not None else "none"


def plan(state: AgentState, snap: ContextSnapshot, settings=None) -> dict:
    """The schedule, the conflicts in the plan as written, and the load per team and quarter."""
    cal = build_calendar(snap, state, settings)
    scale = scale_of(settings.tshirt_points if settings else None)
    default_size = settings.default_size if settings else "M"
    titles = {i.id: i.title for i in state.initiatives}
    caps = team_capacity(snap, cal, {i.owning_team for i in state.initiatives})
    items, sizes, sources = [], {}, {}
    for i in state.initiatives:
        pts, size, source = sizing(i, scale, default_size)
        sizes[i.id] = (source, size)
        planned = cal.index(i.planned_sprint) if i.planned_sprint and not i.quarter_override else None
        explicit = planned is not None
        pi = target_pi(i)
        if pi == LATER:  # deferred past the planning horizon: it takes no capacity inside it
            horizon_end = cal.last_of_pi(cal.pis_real[-1]) if cal.pis_real else len(cal.sprints) - 1
            planned, deadline, pi = horizon_end + 1, None, ""
            cal.label(planned)
        else:
            if planned is None and pi:
                planned = cal.first_of_pi(pi)
            deadline = cal.last_of_pi(pi) if pi else None
        sources[i.id] = ("planner" if i.quarter_override else "sprint" if explicit else "data" if pi else "none")
        items.append(Item(i.id, i.title, i.owning_team, pts, planned, i.priority, deadline, explicit))
    edges = ordering_edges(state)
    slots = schedule(items, edges, caps, cal, label=lambda x: titles.get(x, x), team_label=snap.team_name)
    deps = {d.id: d for d in state.deps}
    conflicts = [PlanConflict(provider=c["provider"], consumer=c["consumer"], provider_start=c.get("providerStart"),
                              provider_finish=c["providerFinish"],
                              consumer_start=c["consumerStart"], dependency_ids=c["depIds"],
                              declared=any(deps[x].declared for x in c["depIds"] if x in deps),
                              kind=c["kind"], consumer_finish=c.get("consumerFinish"))
                 for c in plan_conflicts(items, [e for e in edges if e.dep_ids], caps, cal)]
    by_item = {it.id: it for it in items}
    sched = []
    for i in state.initiatives:
        s, it = slots[i.id], by_item[i.id]
        source, size = sizes[i.id]
        if source == "assumed":
            s.reasons.insert(0, f"No T-shirt size in the data: sized as {size} ({it.points:g} points) until a "
                                "planner sets one.")
        sched.append(ScheduleItem(
            initiative_id=i.id, team=i.owning_team, size=size, points=it.points, size_source=source,
            planned_index=it.planned, planned_finish=planned_finish(it, caps, cal), deadline=it.deadline,
            target_source=sources[i.id], start=s.start, finish=s.finish,
            allocation={k: round(v, 2) for k, v in s.allocation.items()}, reasons=s.reasons,
            waits_for=[w["id"] for w in s.waits_for], in_cycle=s.in_cycle, capacity_known=s.capacity_known))

    # Load per team and quarter: the points planned in that quarter (as written) against its capacity.
    planned_pts: dict[tuple[str, str], list[str]] = defaultdict(list)
    for it in items:
        pi = cal.pi_at(it.planned) if it.planned is not None else None
        if pi:
            planned_pts[(it.team, pi)].append(it.id)
    lines = []
    for team, cap in sorted(caps.items()):
        for pi in cal.pis_real:
            idx = [k for k, p in enumerate(cal.pi_of) if p == pi]
            total = round(sum(cap.at(k, cal) for k in idx), 1)
            ids = planned_pts.get((team, pi), [])
            demand = sum(by_item[x].points for x in ids)
            if not ids:
                continue
            load = round(100 * demand / total, 1) if total else None
            sized = ", ".join(f"{titles.get(x, x)} {sizes[x][1] or '?'} ({by_item[x].points:g})" for x in ids)
            lines.append(CapacityLine(team=team, pi=pi, capacity_points=total or None, committed_points=None,
                                      selected_demand_points=demand, load_pct=load, initiative_ids=ids,
                                      formula=(f"{demand:g} points targeted at {pi} ({sized}) against "
                                               f"{total:g} available" if total
                                               else "no capacity row in S5 for this team")))
    calendar = [{"sprint": s, "pi": p, "assumed": a} for s, p, a in zip(cal.sprints, cal.pi_of, cal.assumed)]
    tiers = settings.velocity_tiers if settings else VELOCITY_TIERS
    return {"schedule": sched, "conflicts": conflicts, "capacity": lines, "calendar": calendar,
            "velocity": {t: {"average": c.average, "quarter": c.per_quarter(cal),
                             "tier": velocity_tier(c.per_quarter(cal), tiers)} for t, c in caps.items()}}


@node("sequencing", "Sequencing agent")
def sequencing(state: AgentState, ctx: RunContext) -> dict:
    g = build_initiative_graph(state.initiatives, state.deps, state.constraints)
    cycles = find_cycles(g)
    raw_steps = sequence_steps(g)
    titles = {i.id: i.title for i in state.initiatives}
    snap = ctx.snapshot
    steps = [SequenceStep(step=s["step"], initiative_ids=s["initiative_ids"], chain=s["chain"], in_cycle=s["in_cycle"],
                          why=_template_why(s, state, titles, snap)) for s in raw_steps]
    p = plan(state, snap, ctx.settings)

    deps = {d.id: d for d in state.deps}
    coordinate = {s.step: coordination(s.initiative_ids, state, snap, titles) for s in steps}
    facts = [{"step": s.step, "initiatives": [titles.get(i, i) for i in s.initiative_ids], "cycle": s.in_cycle,
              "dependencies": [{"id": d.id, "dependent": titles.get(d.from_id, d.from_id),
                                "waits_for": titles.get(d.to_id, d.to_id), "kind": d.kind, "status": d.status,
                                "declared": d.declared, "evidence": [e.quote or e.detail for e in d.evidence][:2]}
                               for d in (deps[x] for x in s.chain if x in deps)],
              "coordinate": [{"id": d.id, "initiatives": [titles.get(d.from_id, d.from_id), titles.get(d.to_id, d.to_id)],
                              "what": reason} for d, reason in coordinate[s.step][:4]]}
             for s in steps]
    out = ctx.structured(task="sequencing_rationale", prompt="sequencing_rationale", stable_context="",
                         user=json.dumps({"steps": facts, "constraints": [c.model_dump() for c in state.constraints]},
                                         indent=1),
                         schema=SequencingOut, node="sequencing") if steps else None
    warnings = []
    if out is not None:
        whys = {w.step: w.why.strip() for w in out.steps}
        allowed = {s.step: set(s.chain) | {d.id for d, _ in coordinate[s.step][:4]} for s in steps}
        valid = all(s.step in whys and whys[s.step] and set(DEP_ID.findall(whys[s.step])) <= allowed[s.step]
                    and reads_without_refs(whys[s.step]) for s in steps)
        if valid:
            for s in steps:
                s.why, s.rationale_method = whys[s.step], "llm"
        else:
            warnings.append(ctx.warn("sequencing", "LLM rationale missed a step, cited a dependency outside the "
                                                   "step, or did not read as a sentence without its dependency "
                                                   "ids; template kept"))

    cal_pis = {c["sprint"]: c["pi"] for c in p["calendar"]}
    pi_at = [c["pi"] for c in p["calendar"]]
    moved = [s for s in p["schedule"] if s.planned_index is not None and s.start > s.planned_index]
    spill = [s for s in p["schedule"] if s.deadline is not None and s.finish > s.deadline]
    later_q = [s for s in moved if s.start < len(pi_at) and s.planned_index < len(pi_at)
               and pi_at[s.start] != pi_at[s.planned_index]]
    ctx.emit("finding", "sequencing", tag="sequence", initiative_ids=[],
             text=f"{plural(len(steps), 'step')} in dependency order; {plural(len(later_q), 'initiative')} move to a "
                  f"later quarter than targeted; {plural(len(spill), 'initiative')} finish after their target "
                  f"quarter; {plural(len(p['conflicts']), 'conflict')} in the plan as written",
             sub=f"{plural(len(cycles), 'cycle')} · {plural(len(state.constraints), 'reviewer constraint')} · "
                 f"{len(cal_pis) and len(set(cal_pis.values()))} quarters on the calendar")
    over = [c for c in p["capacity"] if c.load_pct and c.load_pct > ctx.settings.capacity_warn_pct]
    if over:
        ctx.emit("note", "sequencing", text="Over capacity as targeted: "
                                            + ", ".join(f"{snap.team_name(c.team)} {c.load_pct:g}% in {c.pi}"
                                                        for c in over))
    assumed = [s for s in p["schedule"] if s.size_source == "assumed"]
    if assumed:
        ctx.emit("note", "sequencing", text=f"{plural(len(assumed), 'initiative')} without a T-shirt size, sized as "
                                            f"{ctx.settings.default_size} until a planner sets one: "
                                            + ", ".join(s.initiative_id for s in assumed))
    if snap.has("S5"):
        ctx.emit("source_used", "sequencing", source="S5", title="Team capacity", count=len(snap.table("S5")),
                 unit="team capacity rows (story points per quarter)")
    ctx.emit("source_used", "sequencing", source="S1", title="Roadmap initiatives", count=len(state.initiatives),
             unit="target quarters, T-shirt sizes and priorities")
    return {"sequence": steps, "cycles": cycles, "capacity": p["capacity"], "schedule": p["schedule"],
            "conflicts": p["conflicts"], "calendar": p["calendar"], "warnings": warnings}
