"""Delivery timeline: T-shirt sizes become sprint durations, and the verified dependency
order places each initiative. Deterministic; no model is involved.

An initiative starts the sprint after the last initiative it waits for ends. Members of a
dependency cycle start together (no order satisfies them). Team capacity is not modelled:
the timeline shows size and dependency order only, and says so in `assumptions`.
"""

from __future__ import annotations

import re
from collections import Counter

import networkx as nx

from agents.state import Initiative, Schedule, ScheduleRow

SIZES = ("S", "M", "L", "XL")
DEFAULT_SPRINTS = {"S": 1, "M": 2, "L": 3, "XL": 4}
_NAMES = {"XS": "S", "S": "S", "SMALL": "S", "M": "M", "MEDIUM": "M", "L": "L", "LARGE": "L", "XL": "XL",
          "XXL": "XL", "EXTRALARGE": "XL"}
# Story points are only a fallback when a size is missing: <=2 S, <=5 M, <=8 L, else XL.
_POINTS_TO_SIZE = ((2, "S"), (5, "M"), (8, "L"))


def parse_size_sprints(raw: str) -> dict[str, int]:
    """'S=1,M=2,L=3,XL=4' -> {'S': 1, ...}; unknown sizes and bad numbers are ignored."""
    out = dict(DEFAULT_SPRINTS)
    for part in (raw or "").split(","):
        key, _, value = part.partition("=")
        key, value = key.strip().upper(), value.strip()
        if key in SIZES and value.isdigit() and int(value) >= 1:
            out[key] = int(value)
    return out


def canonical_size(raw: str | None) -> str | None:
    if not raw:
        return None
    return _NAMES.get(re.sub(r"[\s_\-]+", "", str(raw).strip().upper()))


def size_of(ini: Initiative) -> tuple[str, str]:
    """(canonical size, source) where source is 'size', 'points' or 'default'."""
    size = canonical_size(ini.size)
    if size:
        return size, "size"
    if ini.estimate_points is not None:
        for limit, name in _POINTS_TO_SIZE:
            if ini.estimate_points <= limit:
                return name, "points"
        return "XL", "points"
    return "S", "default"


def _sprint_number(value: str | None) -> int | None:
    m = re.search(r"(\d+)\s*$", value or "")
    return int(m.group(1)) if m else None


def _ids(ids: list[str]) -> str:
    return ", ".join(ids[:6]) + (f" and {len(ids) - 6} more" if len(ids) > 6 else "")


def build_schedule(initiatives: list[Initiative], g: nx.DiGraph, pi_sprints: int = 5,
                   size_sprints: dict[str, int] | None = None) -> Schedule:
    """`g` is the initiative graph from `graph_tools.build_initiative_graph` (provider -> consumer)."""
    sprints_of = size_sprints or DEFAULT_SPRINTS
    sized = {i.id: size_of(i) for i in initiatives}
    dur = {i.id: sprints_of[sized[i.id][0]] for i in initiatives}

    cond = nx.condensation(g)
    comp_of = cond.graph["mapping"]
    start: dict[str, int] = {}
    end: dict[str, int] = {}
    comp_end: dict[int, int] = {}
    for comp in nx.topological_sort(cond):
        members = cond.nodes[comp]["members"]
        first = max((comp_end[p] for p in cond.predecessors(comp)), default=0) + 1
        for m in members:
            start[m], end[m] = first, first + dur[m] - 1
        comp_end[comp] = max(end[m] for m in members)

    def waits(m: str) -> list[str]:
        return sorted(p for p in g.predecessors(m) if comp_of[p] != comp_of[m])

    # Critical path: the chain that ends last, walked back through whichever predecessor ended latest.
    critical: list[str] = []
    if end:
        cur = min((m for m in end if end[m] == max(end.values())))
        while True:
            critical.append(cur)
            preds = waits(cur)
            if not preds:
                break
            cur = min(p for p in preds if end[p] == max(end[q] for q in preds))
        critical.reverse()
    if len(critical) < 2:
        critical = []

    by_id = {i.id: i for i in initiatives}
    cycles = {m for comp in cond.nodes for m in cond.nodes[comp]["members"] if len(cond.nodes[comp]["members"]) > 1}
    rows = [ScheduleRow(initiative_id=i.id, team=i.owning_team, size=sized[i.id][0], size_source=sized[i.id][1],
                        sprints=dur[i.id], start=start[i.id], end=end[i.id], spills_past_pi=end[i.id] > pi_sprints,
                        waits_for=waits(i.id), critical=i.id in critical, in_cycle=i.id in cycles,
                        targeted_sprint=_sprint_number(i.targeted_sprint)) for i in initiatives]

    assumptions = ["Team capacity is not modelled: bars show size and dependency order only."]
    from_points = [i.id for i in initiatives if sized[i.id][1] == "points"]
    default = [i.id for i in initiatives if sized[i.id][1] == "default"]
    if from_points:
        assumptions.append(f"No T-shirt size for {_ids(from_points)}: sized from story points "
                           "(2 or fewer S, 5 or fewer M, 8 or fewer L, otherwise XL).")
    if default:
        assumptions.append(f"No size or estimate for {_ids(default)}: scheduled as one sprint (S).")
    pis = Counter(by_id[m].target_pi for m in by_id if by_id[m].target_pi)
    if len(pis) > 1:
        assumptions.append("Initiatives target several PIs (" + ", ".join(sorted(pis)) + "); they share one timeline "
                           "that starts in sprint 1.")
    if cycles:
        assumptions.append(f"{_ids(sorted(cycles))} depend on each other, so they start together; break the cycle "
                           "before PI planning.")
    if any(r.spills_past_pi for r in rows):
        late = [r.initiative_id for r in rows if r.spills_past_pi]
        assumptions.append(f"{_ids(late)} would finish after sprint {pi_sprints}, the end of the PI.")

    return Schedule(pi=pis.most_common(1)[0][0] if pis else "", pi_sprints=pi_sprints, size_sprints=dict(sprints_of),
                    rows=rows, critical_path=critical, assumptions=assumptions)
