"""Dependency Risk Index (DRI) rules, as policy-as-code.

Each rule is a plain function over the run's facts and returns Risk records with their
sources. The rules decide the flag and the severity; the LLM only explains them.
A rule that cannot run because its source is missing reports "skipped", so the UI can
say which checks were not made (considerations §5.6 rule 11).

DRI-X-008 (control sign-off unscheduled, from M2) is an addition to the X-001..007 set in
the architecture; confirm the code with the project owner.
"""

from __future__ import annotations

import re
from collections import defaultdict
from dataclasses import dataclass

from agents.state import CapacityLine, Dependency, EvidenceRef, Initiative, Risk, SystemTouch, stable_id
from app.config import Settings
from context.resolver import norm
from context.snapshot import ContextSnapshot
from tools.wording import has_values, plural

DRI_CODES = {
    "DRI-X-001": "Dependency cycle",
    "DRI-X-002": "No owner for a shared service",
    "DRI-X-003": "Team capacity over 100%",
    "DRI-X-004": "Depends on a deprecated system",
    "DRI-X-005": "No API contract documented",
    "DRI-X-006": "Provider scheduled later than consumer",
    "DRI-X-007": "Dependency only in an informal channel",
    "DRI-X-008": "Control sign-off required but not scheduled",
}
_DEPRECATED = {"deprecated", "sunset", "retiring", "retired", "decommissioned", "end of life", "eol", "archived"}
_SEV_ORDER = {"blocker": 0, "warning": 1, "info": 2}


@dataclass
class Facts:
    snapshot: ContextSnapshot
    settings: Settings
    initiatives: list[Initiative]
    systems: list[SystemTouch]
    deps: list[Dependency]
    cycles: list[list[str]]
    capacity: list[CapacityLine]

    @property
    def by_id(self) -> dict[str, Initiative]:
        return {i.id: i for i in self.initiatives}

    @property
    def live_deps(self) -> list[Dependency]:
        return [d for d in self.deps if d.status in ("verified", "low_confidence")]


def _risk(code: str, severity: str, title: str, description: str, *, initiatives=(), entities=(), deps=(),
          sources=()) -> Risk:
    ents = sorted(set(entities))
    inis = sorted(set(initiatives))
    return Risk(id=stable_id("risk", code, *inis, *ents), dri_code=code, severity=severity, title=title,
                description=description, initiative_ids=inis, entities=ents,
                dependency_ids=sorted({d.id for d in deps}),
                sources=list({(s.ref, s.quote): s for d in deps for s in d.evidence}.values()) + list(sources))


def x001_cycles(f: Facts) -> list[Risk]:
    out = []
    for cyc in f.cycles:
        members = set(cyc)
        deps = [d for d in f.live_deps if d.from_id in members and d.to_id in members]
        names = " ↔ ".join(f.by_id[i].title if i in f.by_id else i for i in cyc)
        out.append(_risk("DRI-X-001", "blocker", f"Dependency cycle — {names}",
                         f"{len(cyc)} initiatives depend on each other, so no order satisfies every dependency. "
                         "The cycle has to be broken (split scope or re-plan an interface) before PI planning.",
                         initiatives=cyc, deps=deps))
    return out


def x002_no_owner(f: Facts) -> list[Risk]:
    s7 = f.snapshot.table("S7")
    directory = {norm(t) for t in f.snapshot.table("S6").get("team", [])} if f.snapshot.has("S6") else None
    users: dict[str, set[str]] = defaultdict(set)
    for s in f.systems:
        users[s.system].add(s.initiative_id)
    dep_by_service: dict[str, list[Dependency]] = defaultdict(list)
    for d in f.live_deps:
        if d.to_kind == "service":
            name = d.to_id.removeprefix("service:")
            users[name].add(d.from_id)
            dep_by_service[name].append(d)
    out = []
    for service, inis in sorted(users.items()):
        row = f.snapshot.service_row(service)
        if row is None:
            continue
        owner = (row.get("owner_team") or "").strip()
        unknown_owner = bool(owner) and directory is not None and norm(owner) not in directory
        if owner and not unknown_owner:
            continue
        reason = "has no owning team in the ownership map" if not owner else f"is owned by {owner!r}, which is not in the team directory"
        sev = "blocker" if len(inis) >= 2 else "warning"
        out.append(_risk("DRI-X-002", sev, f"Missing owner — {service}",
                         f"{service} {reason}, and {plural(len(inis), 'initiative')} in this run "
                         f"{'depends' if len(inis) == 1 else 'depend'} on it.",
                         initiatives=inis, entities=[service], deps=dep_by_service[service],
                         sources=[EvidenceRef(ref=f"S7:{service}", source="S7", detail=f"owner_team={owner or '(blank)'}")]))
    return out if not s7.empty else []


def x003_capacity(f: Facts) -> list[Risk]:
    out = []
    warn, block = f.settings.capacity_warn_pct, f.settings.capacity_blocker_pct
    for line in f.capacity:
        if line.load_pct is None or line.load_pct <= warn:
            continue
        sev = "blocker" if line.load_pct > block else "warning"
        out.append(_risk("DRI-X-003", sev, f"Capacity — {line.team} at {line.load_pct:g}%",
                         f"{line.team} is loaded to {line.load_pct:g}% in {line.pi or 'the target PI'}: {line.formula}.",
                         initiatives=line.initiative_ids, entities=[line.team],
                         sources=[EvidenceRef(ref=f"S5:{line.team}@{line.pi}", source="S5", detail=line.formula)]))
    # Provider teams: teams other initiatives wait on, loaded over capacity in the consumer's PI.
    owning = {line.team for line in f.capacity}
    by_team: dict[str, list[Dependency]] = defaultdict(list)
    for d in f.live_deps:
        if d.to_kind == "team":
            by_team[d.to_id.removeprefix("team:")].append(d)
    for team, deps in sorted(by_team.items()):
        if team in owning:
            continue
        pis = {f.by_id[d.from_id].target_pi for d in deps if d.from_id in f.by_id}
        rows = f.snapshot.capacity_rows(team)
        for pi in sorted(p for p in pis if p):
            r = rows[rows["pi"].map(norm) == norm(pi)] if not rows.empty else rows
            if r.empty or "committed_points" not in r.columns:
                continue
            cap = float(r["capacity_points"].fillna(0).sum())
            if not cap:
                continue
            load = round(100 * float(r["committed_points"].fillna(0).sum()) / cap, 1)
            if load > warn:
                sev = "blocker" if load > block else "warning"
                out.append(_risk("DRI-X-003", sev, f"Capacity — provider {team} at {load:g}%",
                                 f"{plural(len(deps), 'dependency', 'dependencies')} in this run "
                                 f"{'waits' if len(deps) == 1 else 'wait'} on {team}, which is already "
                                 f"committed to {load:g}% of capacity in {pi}.",
                                 initiatives=[d.from_id for d in deps], entities=[team], deps=deps,
                                 sources=[EvidenceRef(ref=f"S5:{team}@{pi}", source="S5", detail=f"load {load:g}%")]))
    return out


def x004_deprecated(f: Facts) -> list[Risk]:
    out = []
    users: dict[str, set[str]] = defaultdict(set)
    for s in f.systems:
        users[s.system].add(s.initiative_id)
    for d in f.live_deps:
        if d.to_kind == "service":
            users[d.to_id.removeprefix("service:")].add(d.from_id)
    for service, inis in sorted(users.items()):
        row = f.snapshot.service_row(service) or {}
        status = norm(row.get("status", ""))
        if status in _DEPRECATED:
            out.append(_risk("DRI-X-004", "warning", f"Deprecated system — {service}",
                             f"{service} is marked {row.get('status')!r} in the ownership map but "
                             f"{plural(len(inis), 'initiative')} {'plans' if len(inis) == 1 else 'plan'} "
                             "to build on it.",
                             initiatives=inis, entities=[service],
                             sources=[EvidenceRef(ref=f"S7:{service}", source="S7", detail=f"status={row.get('status')}")]))
    return out


def x005_no_contract(f: Facts) -> list[Risk]:
    contract_chunks = [c for c in f.snapshot.index.chunks if c.source == "M1" and re.search(
        r"contract|api|integration|interface", f"{c.meta.get('path', '')} {c.title} {c.section}", re.I)]
    documented: set[str] = set()
    for c in contract_chunks:
        documented.update(s for s, _ in f.snapshot.resolver.services.mentions(c.text + " " + c.title))
    out = []
    by_service: dict[str, list[Dependency]] = defaultdict(list)
    for d in f.live_deps:
        if d.to_kind == "service":
            by_service[d.to_id.removeprefix("service:")].append(d)
    for s in f.systems:
        row = f.snapshot.service_row(s.system) or {}
        if row.get("owner_team") and row["owner_team"] != f.by_id.get(s.initiative_id, Initiative(id="", title="")).owning_team:
            by_service.setdefault(s.system, [])
    for service, deps in sorted(by_service.items()):
        if service in documented:
            continue
        inis = {d.from_id for d in deps} | {s.initiative_id for s in f.systems if s.system == service}
        out.append(_risk("DRI-X-005", "warning", f"No API contract — {service}",
                         f"Initiatives depend on {service}, owned by another team, but no Confluence API or "
                         "integration page mentions it.", initiatives=inis, entities=[service], deps=deps))
    return out


def _pi_key(pi: str | None) -> tuple[int, ...] | None:
    nums = re.findall(r"\d+", pi or "")
    return tuple(int(n) for n in nums) if nums else None


def x006_late(f: Facts) -> list[Risk]:
    out = []
    for d in f.live_deps:
        if d.to_kind != "initiative" or not d.directed:
            continue
        consumer, provider = f.by_id.get(d.from_id), f.by_id.get(d.to_id)
        if not consumer or not provider:
            continue
        ck, pk = _pi_key(consumer.target_pi), _pi_key(provider.target_pi)
        if ck is None or pk is None or pk <= ck:
            continue
        out.append(_risk("DRI-X-006", "blocker", f"Late provider — {provider.title}",
                         f"{consumer.title} ({consumer.target_pi}) depends on {provider.title}, which is targeted "
                         f"for a later PI ({provider.target_pi}).", initiatives=[consumer.id, provider.id], deps=[d]))
    return out


def x007_informal(f: Facts) -> list[Risk]:
    out = []
    for d in f.live_deps:
        sources = {e.source for e in d.evidence}
        if sources and sources <= {"M3"} and d.in_jira is not True:
            out.append(_risk("DRI-X-007", "warning", f"Informal only — {d.from_id} → {d.to_id.split(':')[-1]}",
                             "This dependency appears only in Slack: it is not linked in Jira and no ticket or "
                             "document records it, so it can be missed at PI planning.",
                             initiatives=[d.from_id] + ([d.to_id] if d.to_kind == "initiative" else []),
                             entities=[d.to_id], deps=[d]))
    return out


def x008_controls(f: Facts) -> list[Risk]:
    m2 = f.snapshot.table("M2")
    out = []
    for ini in f.initiatives:
        rows = m2[m2["initiative_id"].map(norm) == norm(ini.id)] if not m2.empty else m2
        for _, r in rows.iterrows():
            required = r.get("signoff_required")
            if required is False:
                continue
            if (r.get("signoff_date") or "").strip():
                continue
            ctype = r.get("control_type") or "control"
            out.append(_risk("DRI-X-008", "blocker", f"Sign-off unscheduled — {ini.title}",
                             f"{ini.title} needs {ctype} sign-off ({r['control_id']}) and no sign-off date is scheduled.",
                             initiatives=[ini.id], entities=[r["control_id"]],
                             sources=[EvidenceRef(ref=f"M2:{r['control_id']}", source="M2",
                                                  detail=f"{ctype}; owner={r.get('owner') or '(none)'}")]))
    return out


RULES = [
    ("DRI-X-001", x001_cycles, ()),
    ("DRI-X-002", x002_no_owner, ("S7",)),
    ("DRI-X-003", x003_capacity, ("S5",)),
    ("DRI-X-004", x004_deprecated, ("S7",)),
    ("DRI-X-005", x005_no_contract, ("M1",)),
    ("DRI-X-006", x006_late, ()),
    ("DRI-X-007", x007_informal, ("M3",)),
    ("DRI-X-008", x008_controls, ("M2",)),
]


def has_blockers(value) -> bool:
    """S8 blockers: free text counts when non-empty; a count (e.g. mid_pi_blockers) only when > 0."""
    v = str(value if value == value and value is not None else "").strip()  # NaN-safe
    try:
        return float(v) > 0
    except ValueError:
        return bool(v)


def _history(f: Facts, risk: Risk) -> Risk:
    """Calibrate against S8: escalate a warning when the teams involved missed commitments
    (delivered < HISTORY_MISS_RATIO x committed, or blockers recorded) in at least
    HISTORY_ESCALATE_SHARE of past PIs. The teams judged are the ones the risk is about
    (team entities, e.g. an overloaded provider), else the owning teams of its initiatives.

    The note says what was counted. When S8 has no `blockers` values (the Haverstone package
    leaves mid_pi_blockers unmapped on purpose), it must not read as "never blocked": it
    reports delivery shortfalls only, and shows mid-PI blockers as context when the raw
    column is there."""
    teams = {e for e in risk.entities if f.snapshot.team_row(e)} or {
        f.by_id[i].owning_team for i in risk.initiative_ids if i in f.by_id}
    s8 = f.snapshot.table("S8")
    blockers_known = has_values(s8, "blockers")
    raw_blockers = not blockers_known and has_values(s8, "mid_pi_blockers")
    notes = []
    escalate = False
    for team in sorted(t for t in teams if t):
        rows = f.snapshot.history_rows(team)
        if rows.empty:
            continue
        missed = context_blocked = 0
        for _, r in rows.iterrows():
            c, d = r.get("committed_points"), r.get("delivered_points")
            short = c == c and d == d and c and d < f.settings.history_miss_ratio * c  # NaN-safe
            if short or has_blockers(r.get("blockers")):
                missed += 1
            if raw_blockers and has_blockers(r.get("mid_pi_blockers")):
                context_blocked += 1
        n = len(rows)
        if blockers_known:
            note = f"{team} missed or was blocked in {missed} of {n} past PIs"
        else:
            note = (f"{team} delivered under {f.settings.history_miss_ratio:.0%} of its commitment in {missed} "
                    f"of {n} past PIs")
            note += (f"; mid-PI blockers were recorded in {context_blocked} of {n} (context only, not used for "
                     "severity)" if raw_blockers else " (blockers are not in the data)")
        notes.append(note)
        escalate |= missed / n >= f.settings.history_escalate_share
    if notes:
        risk.history_note = "; ".join(notes)
    if escalate and risk.severity == "warning":
        risk.severity = "blocker"
        risk.description += " Escalated from warning: history shows repeated misses (S8)."
    return risk


def run_rules(f: Facts) -> tuple[list[Risk], dict[str, str]]:
    risks: dict[str, Risk] = {}
    coverage: dict[str, str] = {}
    for code, fn, needs in RULES:
        missing = [s for s in needs if not (f.snapshot.has(s) or f.snapshot.has_text(s))]
        if missing:
            coverage[code] = f"skipped: {', '.join(missing)} not loaded"
            continue
        found = fn(f)
        coverage[code] = f"evaluated: {plural(len(found), 'flag')}"
        if code == "DRI-X-003" and not has_values(f.snapshot.table("S5"), "committed_points"):
            coverage[code] += ("; partial: S5 has no committed points, so only the selected work is counted "
                               "against capacity")
        for r in found:
            risks.setdefault(r.id, r)
    calibrated = [_history(f, r) for r in risks.values()] if f.snapshot.has("S8") else list(risks.values())
    if not f.snapshot.has("S8"):
        coverage["history"] = "skipped: S8 not loaded, severities are not calibrated"
    return sorted(calibrated, key=lambda r: (_SEV_ORDER[r.severity], r.dri_code, r.title)), coverage
