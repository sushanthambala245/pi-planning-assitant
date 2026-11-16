"""Deterministic planning: T-shirt sizes, the quarter calendar, and a capacity-aware schedule.

Nothing here calls a model. Every number the UI shows about sizes, quarters and load comes
from these functions, and each scheduling decision carries its reason in words.

- T-shirt size: an initiative's size (S1 `T-Shirt Sizing`, or a planner's size) is worth story
  points on the TSHIRT_POINTS scale (default XS 3, S 5, M 8, L 13, XL 21, XXL 34: settings). An
  older export with story points instead is sized from them. An initiative with no size is
  scheduled at DEFAULT_SIZE and flagged as assumed.
- Team capacity: a team's available story points (S5) per quarter. One row per team applies to
  every quarter; a row with a PI applies to that quarter; a row with a sprint to that sprint. A
  quarter is split into SPRINTS_PER_PI sprints so a provider can land early in a quarter and its
  consumer later in the same one. A team's velocity tier names its quarterly capacity in T-shirt
  terms (VELOCITY_TIERS: up to 24 points is S, 32 M, 40 L, more XL), so different velocities show.
- Calendar: the quarters named in S1 / S5 (Q1, Q2 ...), ordered, and extended to PLAN_QUARTERS
  quarters (Q3, Q4); past that, quarters are added as needed and marked as assumed.
- Schedule: list scheduling over the ordering graph (provider before consumer). An initiative
  starts no earlier than its target quarter (the team's own plan, or a planner's placement) and
  no earlier than the sprint after every provider finishes; its points then fill the owning
  team's remaining capacity sprint by sprint, higher priority first. Cycles are scheduled as one
  group and flagged.
"""

from __future__ import annotations

import heapq
import math
import re
import statistics
from collections import defaultdict
from dataclasses import dataclass, field

TSHIRT_POINTS: dict[str, float] = {"XS": 3, "S": 5, "M": 8, "L": 13, "XL": 21, "XXL": 34}
VELOCITY_TIERS: tuple[tuple[str, float], ...] = (("S", 24), ("M", 32), ("L", 40))  # above the last: XL
PRIORITY_RANK = {"critical": 0, "high": 1, "medium": 2, "low": 3}
_SPRINT = re.compile(r"^(?P<pi>.+?)[-_ ]+sprint[-_ ]*(?P<n>\d+)$", re.I)
_UP = re.compile(r"\bup(?:stream)?\b", re.I)
_DOWN = re.compile(r"\bdown(?:stream)?\b", re.I)
_Q = re.compile(r"^Q(?P<q>[1-4])(?: Y\+(?P<y>\d+))?$", re.I)
_YQ = re.compile(r"^(?P<year>\d{4})[- ]?Q(?P<q>[1-4])$|^Q(?P<q2>[1-4])[- ](?P<year2>\d{4})$", re.I)


INTERFACE = re.compile(r"\b(apis?|contracts?|schemas?|events?|endpoints?|interfaces?|versioned|versions?|v\d+|"
                       r"migrat\w*|deprecat\w*|upgrad\w*|webhooks?|feeds?|messages?|formats?)\b", re.I)


def interface_word(title: str, description: str, resolver=None) -> str | None:
    """The first interface word ("API", "schema", "migrate" ...) in an initiative's own words, with
    the catalogue systems and initiative titles it names removed first: a consumer that writes
    "blocked on the Ledger Posting API" does not change an interface by saying so."""
    text = f" {re.sub(r'[^a-z0-9]+', ' ', f'{title}. {description}'.lower())} "
    if resolver is not None:
        names = [form for _, form in resolver.services.mentions(text)]
        names += [form for _, form in resolver.initiative_titles.mentions(text) if f" {form} " != f" {text.strip()} "]
        own = re.sub(r"[^a-z0-9]+", " ", title.lower()).strip()
        for form in sorted(set(names), key=len, reverse=True):
            if form and form != own:
                text = text.replace(f" {form} ", " ")
    m = INTERFACE.search(text)
    return m.group(0) if m else None


def is_ready(status: str, origin: str, ready_statuses: tuple[str, ...]) -> bool:
    """Only initiatives ready for PI planning are analysed: one still in discovery or only proposed
    is not yet known to be an initiative. A manual or uploaded one without a status counts as
    ready, since the planner added it to plan it."""
    if not (status or "").strip():
        return origin != "S1"
    return status.strip().lower() in {s.lower() for s in ready_statuses}


def scale_of(pairs) -> dict[str, float]:
    """The T-shirt scale from settings (pairs or a dict); the default when it is empty."""
    d = dict(pairs or {})
    return {k.upper(): float(v) for k, v in d.items()} if d else dict(TSHIRT_POINTS)


def tshirt(points: float | None, scale: dict[str, float] | None = None) -> str | None:
    """The smallest size whose points cover the estimate; None without an estimate."""
    if points is None or points != points:
        return None
    sc = scale or TSHIRT_POINTS
    for size, pts in sorted(sc.items(), key=lambda kv: kv[1]):
        if points <= pts:
            return size
    return max(sc, key=sc.get)


def size_points(size: str | None, scale: dict[str, float] | None = None) -> float | None:
    return (scale or TSHIRT_POINTS).get((size or "").strip().upper())


def velocity_tier(per_quarter: float | None, tiers=VELOCITY_TIERS) -> str | None:
    """A team's quarterly capacity named as a T-shirt size: up to the first limit is the first tier."""
    if not per_quarter:
        return None
    for tier, limit in tiers:
        if per_quarter <= limit:
            return tier
    return "XL"


def parse_dependency_text(text: str) -> tuple[list[str], list[str]]:
    """S1 `dependency`: "Upstream: A, B; Downstream: C" -> (["A", "B"], ["C"]).

    Upstream systems are ones the initiative consumes; downstream systems consume its output
    (S1 data dictionary). A part without a recognisable label counts as upstream."""
    up: list[str] = []
    down: list[str] = []
    for part in re.split(r"[;\n]", text or ""):
        label, sep, names = part.partition(":")
        if not sep:
            label, names = "", part
        target = down if _DOWN.search(label) and not _UP.search(label) else up
        for name in re.split(r",|\|", names):
            n = name.strip().strip(".")
            if n and n not in target:
                target.append(n)
    return up, down


# -- calendar ------------------------------------------------------------------------------------

def pi_key(pi: str) -> tuple:
    """Sort key for a quarter or PI label: Q1 < Q2 < ... < Q4 < Q1 Y+1; 2027-Q1 < 2027-Q2;
    PI-2026-06 < PI-2027-01. Labels without a number sort last."""
    label = (pi or "").strip()
    m = _Q.match(label)
    if m:
        return (0, int(m.group("y") or 0), int(m.group("q")))
    m = _YQ.match(label)
    if m:
        return (0, int(m.group("year") or m.group("year2")), int(m.group("q") or m.group("q2")))
    nums = tuple(int(n) for n in re.findall(r"\d+", label))
    return (1, *nums) if nums else (2, label)


def is_quarter(pi: str) -> bool:
    return bool(_Q.match((pi or "").strip()) or _YQ.match((pi or "").strip()))


def next_pi(pi: str, k: int = 1) -> str:
    """The quarter after a quarter label (Q4 -> Q1 Y+1, 2027-Q4 -> 2028-Q1); for any other PI label,
    '<label> +k' (an assumed next PI)."""
    label = (pi or "").strip()
    m = _Q.match(label)
    if m:
        n = (int(m.group("y") or 0)) * 4 + int(m.group("q")) - 1 + 1
        y, q = divmod(n, 4)
        return f"Q{q + 1}" + (f" Y+{y}" if y else "")
    m = _YQ.match(label)
    if m:
        year, q = int(m.group("year") or m.group("year2")), int(m.group("q") or m.group("q2"))
        n = year * 4 + q - 1 + 1
        return f"{n // 4}-Q{n % 4 + 1}"
    base = re.sub(r" \+\d+$", "", label) or "PI"
    return f"{base} +{k}"


def split_sprint(sprint: str) -> tuple[str, int] | None:
    m = _SPRINT.match((sprint or "").strip())
    return (m.group("pi"), int(m.group("n"))) if m else None


@dataclass
class Calendar:
    """Ordered sprints, grouped into quarters (PIs); index 0 is the first sprint."""

    sprints: list[str]
    pis: list[str]
    pi_of: list[str]
    assumed: list[bool]
    per_pi: int = 5  # sprints a quarter gets when it is added

    @classmethod
    def build(cls, sprint_names: list[str]) -> "Calendar":
        """From sprint names in the data (``PI-2026-06-Sprint-1``)."""
        parsed = {s: split_sprint(s) for s in sprint_names if s}
        ok = sorted({s for s, p in parsed.items() if p}, key=lambda s: (pi_key(parsed[s][0]), parsed[s][1]))
        pis = list(dict.fromkeys(parsed[s][0] for s in ok))
        counts = defaultdict(int)
        for s in ok:
            counts[parsed[s][0]] += 1
        return cls(sprints=ok, pis=pis, pi_of=[parsed[s][0] for s in ok], assumed=[False] * len(ok),
                   per_pi=max(counts.values()) if counts else 5)

    @classmethod
    def quarters(cls, pis: list[str], per_pi: int, min_pis: int = 0) -> "Calendar":
        """From quarter / PI labels alone (Q1, Q2): `per_pi` sprints each, extended with the next
        quarters until there are `min_pis` (the planning horizon, not assumed)."""
        ordered = sorted(dict.fromkeys(p for p in pis if p), key=pi_key)
        if not ordered and min_pis:
            ordered = ["Q1"]
        while ordered and len(ordered) < min_pis:
            ordered.append(next_pi(ordered[-1], 1))
        cal = cls(sprints=[], pis=[], pi_of=[], assumed=[], per_pi=max(1, per_pi))
        for p in ordered:
            cal._add_pi(p, assumed=False)
        return cal

    def _add_pi(self, pi: str, assumed: bool) -> None:
        self.pis.append(pi)
        for n in range(1, self.per_pi + 1):
            self.sprints.append(f"{pi}-Sprint-{n}")
            self.pi_of.append(pi)
            self.assumed.append(assumed)

    def add_pi(self, pi: str) -> None:
        """A quarter the plan names (a planner's placement) that is not on the calendar yet."""
        if pi and pi not in self.pis:
            self._add_pi(pi, assumed=False)
            order = sorted(range(len(self.sprints)), key=lambda i: (pi_key(self.pi_of[i]), i))
            self.sprints = [self.sprints[i] for i in order]
            self.pi_of = [self.pi_of[i] for i in order]
            self.assumed = [self.assumed[i] for i in order]
            self.pis = sorted(self.pis, key=pi_key)

    def index(self, sprint: str | None) -> int | None:
        try:
            return self.sprints.index(sprint) if sprint else None
        except ValueError:
            return None

    def first_of_pi(self, pi: str | None) -> int | None:
        return next((i for i, p in enumerate(self.pi_of) if p == pi), None)

    def last_of_pi(self, pi: str | None) -> int | None:
        idx = [i for i, p in enumerate(self.pi_of) if p == pi]
        return idx[-1] if idx else None

    def sprints_per_pi(self) -> int:
        counts = defaultdict(int)
        for p, assumed in zip(self.pi_of, self.assumed):
            if not assumed:
                counts[p] += 1
        return max(counts.values()) if counts else self.per_pi

    def extend_to(self, n: int) -> None:
        """Add quarters (marked assumed) until sprint index n exists."""
        per = self.sprints_per_pi()
        while len(self.sprints) <= n:
            last = self.pis[-1] if self.pis else "Q0"
            k = sum(1 for p in self.pis if p not in self.pis_real) + 1
            pi = next_pi(last, k) if self.pis else "Q1"
            self.pis.append(pi)
            for num in range(1, per + 1):
                self.sprints.append(f"{pi}-Sprint-{num}")
                self.pi_of.append(pi)
                self.assumed.append(True)

    @property
    def pis_real(self) -> list[str]:
        return [p for p in self.pis if not all(a for q, a in zip(self.pi_of, self.assumed) if q == p)]

    def label(self, i: int | None) -> str:
        if i is None:
            return "unscheduled"
        if i >= len(self.sprints):
            self.extend_to(i)
        return self.sprints[i]

    def short(self, i: int | None) -> str:
        """'Q1 S3' style label."""
        if i is None:
            return "—"
        if i >= len(self.sprints):
            self.extend_to(i)
        p = split_sprint(self.sprints[i])
        if p:
            return f"{p[0]} S{p[1]}"
        return self.sprints[i]

    def pi_at(self, i: int | None) -> str:
        if i is None:
            return ""
        if i >= len(self.sprints):
            self.extend_to(i)
        return self.pi_of[i]


# -- team capacity -------------------------------------------------------------------------------

@dataclass
class TeamCapacity:
    team: str
    per_sprint: dict[int, float]  # calendar index -> available points
    # Points per sprint in any sprint without a row of its own (an S5 row with no PI or sprint).
    default: float | None = None

    @property
    def average(self) -> float:
        """Average points per sprint."""
        vals = [v for v in self.per_sprint.values() if v > 0]
        if not vals and self.default:
            return round(self.default, 2)
        return round(sum(vals) / len(vals), 2) if vals else 0.0

    @property
    def median(self) -> float:
        vals = [v for v in self.per_sprint.values() if v > 0]
        if not vals and self.default:
            return float(self.default)
        return float(statistics.median(vals)) if vals else 0.0

    def per_quarter(self, cal: "Calendar") -> float:
        """The team's capacity in a typical quarter: points per sprint times sprints per quarter."""
        return round(self.average * cal.sprints_per_pi(), 1)

    def at(self, i: int, cal: Calendar) -> float:
        """Available points in sprint i: its S5 value, the team's per-quarter row spread over the
        quarter, its average in an assumed sprint, and 0 for a sprint in the data with no row."""
        if i in self.per_sprint:
            return self.per_sprint[i]
        if self.default is not None:
            return self.default
        if i < len(cal.assumed) and cal.assumed[i]:
            return self.average
        return 0.0


# -- schedule ------------------------------------------------------------------------------------

@dataclass
class Item:
    id: str
    title: str
    team: str
    points: float
    planned: int | None  # calendar index of the earliest start: the target quarter's first sprint
    priority: str = ""
    deadline: int | None = None  # last sprint of the target quarter
    explicit: bool = False  # planned from a sprint in the data (not only a quarter)


@dataclass
class Edge:
    provider: str
    consumer: str
    dep_ids: list[str] = field(default_factory=list)
    label: str = ""


@dataclass
class Slot:
    id: str
    start: int
    finish: int
    allocation: dict[int, float]
    reasons: list[str]
    waits_for: list[dict]
    in_cycle: bool = False
    capacity_known: bool = True


def _components(ids: list[str], edges: list[Edge]) -> tuple[dict[str, int], list[set[str]]]:
    """Strongly connected components (Tarjan, iterative) so a cycle is one scheduling group."""
    adj: dict[str, list[str]] = defaultdict(list)
    for e in edges:
        adj[e.provider].append(e.consumer)
    index: dict[str, int] = {}
    low: dict[str, int] = {}
    on: set[str] = set()
    stack: list[str] = []
    comps: list[set[str]] = []
    counter = 0
    for root in ids:
        if root in index:
            continue
        work = [(root, iter(adj[root]))]
        index[root] = low[root] = counter
        counter += 1
        stack.append(root)
        on.add(root)
        while work:
            v, it = work[-1]
            advanced = False
            for w in it:
                if w not in index:
                    index[w] = low[w] = counter
                    counter += 1
                    stack.append(w)
                    on.add(w)
                    work.append((w, iter(adj[w])))
                    advanced = True
                    break
                if w in on:
                    low[v] = min(low[v], index[w])
            if advanced:
                continue
            work.pop()
            if work:
                low[work[-1][0]] = min(low[work[-1][0]], low[v])
            if low[v] == index[v]:
                comp = set()
                while True:
                    w = stack.pop()
                    on.discard(w)
                    comp.add(w)
                    if w == v:
                        break
                comps.append(comp)
    comp_of = {m: k for k, c in enumerate(comps) for m in c}
    return comp_of, comps


def schedule(items: list[Item], edges: list[Edge], capacity: dict[str, TeamCapacity], cal: Calendar,
             label=lambda x: x, team_label=lambda t: t) -> dict[str, Slot]:
    """Place every item on the calendar. See the module docstring for the rules."""
    by_id = {i.id: i for i in items}
    edges = [e for e in edges if e.provider in by_id and e.consumer in by_id and e.provider != e.consumer]
    comp_of, comps = _components(list(by_id), edges)
    providers: dict[str, list[Edge]] = defaultdict(list)
    for e in edges:
        providers[e.consumer].append(e)

    # The condensation's in-degrees, for Kahn's algorithm over groups.
    succ: dict[int, set[int]] = defaultdict(set)
    indeg: dict[int, int] = {k: 0 for k in range(len(comps))}
    for e in edges:
        a, b = comp_of[e.provider], comp_of[e.consumer]
        if a != b and b not in succ[a]:
            succ[a].add(b)
            indeg[b] += 1

    def rank(k: int) -> tuple:
        members = [by_id[m] for m in comps[k]]
        best = min(PRIORITY_RANK.get(m.priority.lower(), 4) for m in members)
        planned = min((m.planned for m in members if m.planned is not None), default=10**6)
        return (best, planned, -max(m.points for m in members), min(m.id for m in members))

    used: dict[str, dict[int, float]] = defaultdict(lambda: defaultdict(float))
    slots: dict[str, Slot] = {}
    heap = [(rank(k), k) for k, d in indeg.items() if d == 0]
    heapq.heapify(heap)
    while heap:
        _, k = heapq.heappop(heap)
        members = sorted(comps[k], key=lambda m: (PRIORITY_RANK.get(by_id[m].priority.lower(), 4), m))
        in_cycle = len(members) > 1
        # Earliest start for the group: after every outside provider finishes.
        outside = [e for m in members for e in providers[m] if comp_of[e.provider] != k]
        for m in members:
            it = by_id[m]
            team = team_label(it.team)
            reasons: list[str] = []
            waits: list[dict] = []
            earliest = it.planned if it.planned is not None else 0
            if it.planned is None:
                reasons.append("No target quarter in the data, so it takes the earliest free slot.")
            for e in outside:
                if e.consumer != m and not in_cycle:
                    continue
                p = slots.get(e.provider)
                if p is None:
                    continue
                waits.append({"id": e.provider, "finish": p.finish, "depIds": e.dep_ids})
                if p.finish + 1 > earliest:
                    earliest = p.finish + 1
            if waits:
                last = max(waits, key=lambda w: w["finish"])
                if it.planned is None or earliest > it.planned:
                    reasons.append(f"Waits for {label(last['id'])}, which finishes in {cal.short(last['finish'])}, "
                                   f"so it can start in {cal.short(earliest)} at the earliest.")
            if in_cycle:
                reasons.append("Part of a dependency cycle: scheduled together with "
                               + ", ".join(label(x) for x in members if x != m) + "; break the cycle to order them.")
            cap = capacity.get(it.team)
            known = bool(cap and cap.average > 0)
            remaining = max(it.points or 0.0, 0.0)
            alloc: dict[int, float] = {}
            s = earliest
            full_notes: list[str] = []
            if not known or remaining <= 0:
                cal.label(s)
                alloc[s] = remaining
                reasons.append(f"No capacity data for {team}: assumed it fits in one sprint." if not known
                               else "No size: assumed it fits in one sprint.")
            else:
                guard = 0
                while remaining > 1e-9 and guard < 400:
                    cal.label(s)
                    free = cap.at(s, cal) - used[it.team][s]
                    if free > 1e-9:
                        take = min(free, remaining)
                        alloc[s] = take
                        used[it.team][s] += take
                        remaining -= take
                    elif not alloc:
                        total = cap.at(s, cal)
                        full_notes.append(f"{cal.short(s)} ({used[it.team][s]:g} of {total:g} points already taken)"
                                          if total else f"{cal.short(s)} (no capacity)")
                    if remaining > 1e-9:
                        s += 1
                    guard += 1
            start = min(alloc) if alloc else earliest
            finish = max(alloc) if alloc else earliest
            if full_notes:
                reasons.append(f"{team} has no room in " + ", ".join(full_notes[:3])
                               + (f" and {len(full_notes) - 3} more" if len(full_notes) > 3 else "")
                               + f": its higher-priority work comes first, so this starts in {cal.short(start)}.")
            if finish > start and known:
                reasons.append(f"{it.points:g} points take {finish - start + 1} sprints at {team}'s velocity "
                               f"({cap.at(start, cal):g} points a sprint, {cap.per_quarter(cal):g} a quarter).")
            if it.deadline is not None and finish > it.deadline:
                reasons.append(f"Finishes in {cal.short(finish)}, after its target quarter "
                               f"{cal.pi_at(it.deadline)} ends: it spills into {cal.pi_at(finish)}.")
            if not reasons or (len(reasons) == 1 and finish > start and known):
                reasons.insert(0, "Starts in its target quarter: nothing it waits for lands later and its team "
                                  "has room.")
            slots[m] = Slot(m, start, finish, alloc, reasons, waits, in_cycle, known)
        for nxt in succ[k]:
            indeg[nxt] -= 1
            if indeg[nxt] == 0:
                heapq.heappush(heap, (rank(nxt), nxt))
    return slots


def duration(item: Item, capacity: dict[str, TeamCapacity], cal: Calendar) -> int:
    """Sprints the item takes at its team's velocity with nothing else on (at least one)."""
    cap = capacity.get(item.team)
    per = (cap.at(item.planned or 0, cal) or cap.average) if cap else 0
    if not per:
        return 1
    return max(1, math.ceil((item.points or 0) / per - 1e-9))


def planned_finish(item: Item, capacity: dict[str, TeamCapacity], cal: Calendar | None = None) -> int | None:
    """Finish sprint of the plan as written: planned start plus the sprints its points take at the
    team's velocity (ignoring other work)."""
    if item.planned is None:
        return None
    if cal is None:
        cap = capacity.get(item.team)
        per = cap.average if cap and cap.average else item.points or 1
        return item.planned + max(1, math.ceil((item.points or 0) / per)) - 1
    return item.planned + duration(item, capacity, cal) - 1


def plan_conflicts(items: list[Item], edges: list[Edge], capacity: dict[str, TeamCapacity],
                   cal: Calendar | None = None) -> list[dict]:
    """Ordering links the plan as written breaks.

    - With planned sprints (older exports): the consumer is planned to start before its provider
      is planned to finish ("sprint").
    - With target quarters: the provider is targeted at a later quarter than its consumer
      ("later_quarter"), or, at the provider team's velocity, the provider is still running when the
      consumer's quarter starts (both target it, or the provider spills into it) and the consumer,
      starting after it, cannot finish inside its quarter ("too_tight"). A provider that is done
      before its consumer's quarter starts is no conflict, even if the consumer is too big for it."""
    by_id = {i.id: i for i in items}
    out = []
    for e in edges:
        p, c = by_id.get(e.provider), by_id.get(e.consumer)
        if not p or not c or p.planned is None or c.planned is None:
            continue
        pf = planned_finish(p, capacity, cal)
        base = {"provider": p.id, "consumer": c.id, "providerStart": p.planned, "providerFinish": pf,
                "consumerStart": c.planned, "depIds": e.dep_ids}
        if p.explicit and c.explicit:
            if pf is not None and c.planned <= pf:
                out.append({**base, "kind": "sprint", "consumerFinish": None})
            continue
        if cal is None:
            continue
        if cal.pi_at(p.planned) != cal.pi_at(c.planned) and pi_key(cal.pi_at(p.planned)) > pi_key(cal.pi_at(c.planned)):
            out.append({**base, "kind": "later_quarter", "consumerFinish": None})
            continue
        if pf is None or pf < c.planned:
            continue  # done before the consumer's quarter starts: the wait costs it nothing
        cf = pf + duration(c, capacity, cal)
        if c.deadline is not None and cf > c.deadline:
            out.append({**base, "kind": "too_tight", "consumerFinish": cf})
    return out
