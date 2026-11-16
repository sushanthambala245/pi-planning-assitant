"""What a verified dependency asks of people: the change it needs, the level it sits at, the
hops that put it there, and whether it was declared or found.

- change: code (someone must change code), flow (an integration, data flow or contract must
  be agreed), regression (nothing to build, but something must be re-tested), or none
  (awareness only). Decided by rules over the dependency kind and type, the role the
  initiative declared for a system (upstream / downstream), how it touches it (changes /
  writes / reads) and the statement text, and always returned with its reason.
- level: what the dependency is on: another initiative, a team, or a system (a library counts
  as a system).
- path: the hops from the initiative to the target (initiative -> system -> team, or
  initiative -> repo -> repo -> initiative), so a user can see why a far-away team was pulled in.
- corroboration: dependencies of one initiative that land on the same owning team, grouped,
  so a stated dependency and an inferred one confirm each other.

A view over the verifier's output: nothing here adds, drops or re-scores a dependency.
"""

from __future__ import annotations

import re
from collections import defaultdict
from dataclasses import dataclass, field
from typing import Callable, Literal

from agents.state import AgentState, Dependency
from context.snapshot import ContextSnapshot
from tools.planning import interface_word
from tools.wording import plural

ChangeType = Literal["code", "flow", "regression", "none"]
Level = Literal["initiative", "team", "system"]

CHANGE_RANK: dict[str, int] = {"none": 0, "regression": 1, "flow": 2, "code": 3}
CHANGE_LABELS = {"code": "Code change", "flow": "Flow / integration change", "regression": "Regression testing",
                 "none": "No change needed"}
LEVEL_OF = {"initiative": "initiative", "team": "team", "service": "system", "library": "system"}
STATED = {"declared", "explicit"}
INFERRED = {"code", "ownership", "library"}

# Statement keywords, checked in this order: a stated "validation" is a test, not a build.
_KEYWORDS: list[tuple[ChangeType, re.Pattern]] = [
    ("regression", re.compile(r"\b(validat\w*|regression|re-?test\w*|test(?:s|ing)?|certif\w*|uat|sign[- ]?off|"
                              r"verif\w*)\b", re.I)),
    ("code", re.compile(r"\b(build\w*|implement\w*|develop\w*|code|expos\w*|upgrad\w*|endpoints?|new version|"
                        r"releas\w*|deploy\w*|enhanc\w*|modif\w*|refactor\w*)\b", re.I)),
    ("flow", re.compile(r"\b(contracts?|schemas?|events?|interfaces?|integrat\w*|onboard\w*|cut-?over|migrat\w*|"
                        r"flows?|process\w*|sequenc\w*|coordinat\w*|hand-?offs?|approv\w*|feeds?|mapping)\b", re.I)),
]
_DEFAULT_BY_TYPE: dict[str, ChangeType] = {"blocked_on": "code", "requires": "code", "waiting_for": "code",
                                           "sequenced_after": "flow"}
# The detail code_deps writes for each repo link (agents/discovery.py).
_CODE_HOP = re.compile(r"^(?P<repo>\S+) \((?P<team>[^)]+)\) declares an internal dependency on (?P<dep>\S+) "
                       r"\((?P<type>[^),]+)[^)]*\), owned by (?P<owner>[^;]+)")
_VERB = {"blocked_on": "is blocked on", "waiting_for": "is waiting for", "requires": "requires",
         "sequenced_after": "is sequenced after", "needed_by": "is needed by", "mentioned": "names"}

Label = Callable[[str], str]  # node id ("INIT-1", "team:X", "service:S", "repo:R", "library:L") -> display text


@dataclass
class DepClass:
    change: ChangeType
    reason: str
    level: Level
    path: list[dict] = field(default_factory=list)  # [{"level": ..., "id": ..., "label": ...}]


def access(state: AgentState, initiative_id: str, service: str) -> str:
    """How an initiative touches a service, from the analyser's evidence: changes, writes,
    reads, or unclear (no access was recorded)."""
    found = {e.detail.removeprefix("access: ") for t in state.systems
             if t.initiative_id == initiative_id and t.system == service
             for e in t.evidence if e.detail.startswith("access: ")}
    for a in ("changes", "writes", "reads"):
        if a in found:
            return a
    return "unclear"


def _hop(level: str, node_id: str, label: Label) -> dict:
    return {"level": level, "id": node_id, "label": label(node_id)}


def _services(d: Dependency) -> list[str]:
    out = [e.ref.removeprefix("S7:") for e in d.evidence if e.source == "S7"]
    if d.to_kind == "service":
        out.insert(0, d.to_id.removeprefix("service:"))
    return list(dict.fromkeys(out))


def _owner(snap: ContextSnapshot, service: str) -> str:
    return str((snap.service_row(service) or {}).get("owner_team") or "")


def _initiative(state: AgentState, iid: str):
    return next((i for i in state.initiatives if i.id == iid), None)


def _explicit(d: Dependency, label: Label) -> tuple[ChangeType, str]:
    quote = next((e.quote for e in d.evidence if e.quote), "")
    a, b = label(d.from_id), label(d.to_id)
    if d.dep_type == "mentioned":
        return "flow", (f"{a}'s text names {b} (“{quote[:120]}”) but does not declare a dependency: confirm with "
                        f"{b} what, if anything, they need to do.")
    if d.dep_type == "needed_by":
        return "flow", f"The text says {b} will need {a}'s change: agree scope and timing with {b}."
    verb = _VERB.get(d.dep_type, "depends on")
    for change, pattern in _KEYWORDS:
        m = pattern.search(quote)
        if m:
            return change, (f"Stated: {a} {verb} {b}. The statement mentions “{m.group(0)}”, so this needs "
                            f"{CHANGE_LABELS[change].lower()}.")
    change = _DEFAULT_BY_TYPE.get(d.dep_type, "flow")
    what = "must deliver a change first" if change == "code" else "must be sequenced or coordinated with it"
    return change, f"Stated: {a} {verb} {b}, so {b} {what}."


def _declared(d: Dependency, state: AgentState, snap: ContextSnapshot, label: Label) -> tuple[ChangeType, str]:
    service = d.to_id.removeprefix("service:")
    owner = _owner(snap, service)
    ini = _initiative(state, d.from_id)
    a = label(d.from_id)
    own = bool(ini and owner and owner == ini.owning_team)
    team = f"the {label('team:' + owner)} team" if owner else ""
    if d.dep_type == "downstream":
        if own:
            return "none", f"Declared downstream: {service} consumes {a}'s output, and {a}'s own team owns it."
        if not owner:
            return "flow", (f"Declared downstream: {service} consumes {a}'s output, but nobody owns {service} in the "
                            "ownership map: find who must re-test it.")
        word = interface_word(ini.title, ini.description, snap.resolver) if ini else None
        if word:
            return "flow", (f"Declared downstream: {service} ({team}) consumes {a}'s output, and {a}'s text mentions "
                            f"an interface change (“{word}”): agree the contract with {team} before it lands.")
        return "regression", (f"Declared downstream: {service} ({team}) consumes {a}'s output: {team} re-tests "
                              f"after {a} lands.")
    if own:
        return "none", f"Declared upstream: {a} uses {service}, which its own team owns: no other team is involved."
    if not owner:
        return "flow", (f"Declared upstream: {a} consumes {service}, which has no owner in the ownership map: find an "
                        "owner before relying on it.")
    return "flow", (f"Declared upstream: {a} consumes {service}, owned by {team}: agree the interface and timing with "
                    f"{team}.")


def _owned_by_other(d: Dependency, state: AgentState, snap: ContextSnapshot, label: Label) -> tuple[ChangeType, str]:
    service = d.to_id.removeprefix("service:") if d.to_kind == "service" else (_services(d) or ["a system"])[0]
    owner = _owner(snap, service)
    team = f"the {label('team:' + owner)} team" if owner else "its owner"
    ini = label(d.from_id)
    how = access(state, d.from_id, service)
    if how == "changes":
        return "code", f"{ini} changes {service}, which {team} owns: {team} must make or review the code change."
    if how == "writes":
        return "flow", f"{ini} writes to {service}, which {team} owns: agree the data flow and interface with {team}."
    if how == "reads":
        return "none", (f"{ini} only reads {service}; {team} does not need to change anything unless the interface "
                        "changes.")
    return "flow", (f"{ini} names {service}, owned by {team}, without declaring it: confirm with {team} whether they "
                    "need to change anything.")


def _shared(d: Dependency, state: AgentState, label: Label) -> tuple[ChangeType, str]:
    service = (_services(d) or ["a shared system"])[0]
    a, b = label(d.from_id), label(d.to_id)
    ha, hb = access(state, d.from_id, service), access(state, d.to_id, service)
    if ha == "reads" and hb == "reads":
        return "none", f"{a} and {b} both only read {service}: nothing to coordinate."
    if "reads" in (ha, hb):
        reader, writer = (a, b) if ha == "reads" else (b, a)
        other = hb if ha == "reads" else ha
        verb = "changes" if other == "changes" else "writes to" if other == "writes" else "touches"
        return "regression", (f"{reader} only reads {service}, which {writer} {verb}: regression-test {reader} "
                              "after that change.")
    if ha == "changes" and hb == "changes":
        return "code", f"{a} and {b} both change {service}: plan the code changes together (merge order, shared contract)."
    if "changes" in (ha, hb):
        changer, other = (a, b) if ha == "changes" else (b, a)
        how = hb if ha == "changes" else ha
        if how == "writes":
            return "flow", (f"{changer} changes {service}, which {other} feeds: agree the interface both sides use "
                            "before either lands.")
        return "code", (f"{changer} changes {service}, which {other} also names: confirm whether {other} must adapt, "
                        "and agree the merge order.")
    if ha == "writes" and hb == "writes":
        return "flow", f"{a} and {b} both write to {service}: agree the data flow between them."
    return "flow", (f"{a} and {b} both name {service} in their plans: confirm whether either changes it, and agree "
                    "the interface if so.")


def _provider(d: Dependency, state: AgentState, label: Label) -> tuple[ChangeType, str]:
    service = (_services(d) or ["a shared system"])[0]
    a, b = label(d.from_id), label(d.to_id)
    if access(state, d.from_id, service) == "reads":
        return "regression", (f"{b} changes {service}, which its team owns, and {a} consumes it: {b} lands first, "
                              f"then {a} is regression-tested against it.")
    return "code", (f"{b} changes {service}, which its team owns, and {a} builds on it: {b}'s change lands first and "
                    f"{a} adapts to it.")


def _code_hops(d: Dependency) -> list[dict]:
    return [m.groupdict() for m in (_CODE_HOP.match(e.detail) for e in d.evidence if e.source == "S4") if m]


def _code(d: Dependency, label: Label) -> tuple[ChangeType, str]:
    hops = _code_hops(d)
    h = hops[0] if hops else {"repo": "a repository", "dep": "another repository", "type": "repo",
                              "owner": label(d.to_id)}
    a, b = label(d.from_id), label(d.to_id)
    more = (f" ({plural(len(hops) - 1, 'more repo link', 'more repo links')} of the same kind.)"
            if len(hops) > 1 else "")
    if d.dep_type == "interface_change":
        article = "an" if h["type"][:1].lower() in "aeiou" else "a"
        return "code", (f"{h['repo']} ({a}'s team) calls {h['dep']}, {article} {h['type']} repo of {b}'s team, and "
                        f"{b}'s text mentions an interface change: {b} should land first and {a} adapts its code."
                        f"{more}")
    systems = _services(d)
    if systems:
        return "regression", (f"{a} builds on {systems[0]}, which {b}'s team owns, and {h['repo']} ({a}'s team) "
                              f"calls {h['dep']}, owned by that team: regression-test {a} after {b} lands.{more}")
    return "regression", (f"{h['repo']} ({a}'s team) calls {h['dep']}, owned by {b}'s team, which changes code this "
                          f"plan: regression-test {a} after {b} lands.{more}")


def _library(d: Dependency) -> tuple[ChangeType, str]:
    lib = d.to_id.removeprefix("library:")
    said = next((e.detail for e in d.evidence if e.source == "S1"), f"{lib} changes")
    return "regression", f"{said}: they re-test after it lands, and pin or upgrade the version together."


def _path(d: Dependency, snap: ContextSnapshot, label: Label) -> list[dict]:
    start = _hop("initiative", d.from_id, label)
    end = _hop(LEVEL_OF[d.to_kind], d.to_id, label)
    if d.kind == "code":
        hops = _code_hops(d)
        if hops:
            h = hops[0]
            return [start, _hop("repo", f"repo:{h['repo']}", label), _hop("repo", f"repo:{h['dep']}", label), end]
    if d.kind in ("declared", "ownership") and d.to_kind == "service":
        owner = _owner(snap, d.to_id.removeprefix("service:"))
        return [start, end] + ([_hop("team", f"team:{owner}", label)] if owner else [])
    if d.kind == "ownership":
        services = _services(d)
        if services:
            return [start, _hop("system", f"service:{services[0]}", label), end]
    return [start, end]


def classify(d: Dependency, state: AgentState, snap: ContextSnapshot, label: Label) -> DepClass:
    if d.kind == "declared":
        change, reason = _declared(d, state, snap, label)
    elif d.kind == "explicit":
        change, reason = _explicit(d, label)
    elif d.kind == "code":
        change, reason = _code(d, label)
    elif d.kind == "library":
        change, reason = _library(d)
    elif d.kind == "ownership" and d.dep_type == "provider_changes":
        change, reason = _provider(d, state, label)
    elif d.kind == "ownership" and d.dep_type == "shared_service":
        change, reason = _shared(d, state, label)
    elif d.kind == "ownership":
        change, reason = _owned_by_other(d, state, snap, label)
    else:  # a reviewer's sequencing constraint
        change, reason = "flow", f"A reviewer placed {label(d.to_id)} before {label(d.from_id)}."
    return DepClass(change=change, reason=reason, level=LEVEL_OF[d.to_kind], path=_path(d, snap, label))


def owner_team(d: Dependency, state: AgentState, snap: ContextSnapshot) -> str:
    """The team a dependency ultimately lands on: the target team, the owner of the target
    service, or the owning team of the target initiative. A library stays itself."""
    kind, _, name = d.to_id.partition(":")
    if kind == "team":
        return name
    if kind == "service":
        return _owner(snap, name) or f"service:{name}"
    if kind == "library":
        return d.to_id
    ini = _initiative(state, d.to_id)
    return ini.owning_team if ini and ini.owning_team else d.to_id


def corroboration(deps: list[Dependency], state: AgentState, snap: ContextSnapshot) -> dict[str, dict]:
    """Per dependency id: which methods reached the same owning team from the same initiative.
    `verdict` is confirmed (stated and inferred agree), stated_only or inferred_only."""
    groups: dict[tuple[str, str], list[Dependency]] = defaultdict(list)
    for d in deps:
        groups[(d.from_id, owner_team(d, state, snap))].append(d)
    out = {}
    for (_, team), members in groups.items():
        methods = sorted({m.kind for m in members})
        stated = bool(STATED & set(methods))
        inferred = bool(INFERRED & set(methods))
        verdict = "confirmed" if stated and inferred else "stated_only" if stated else "inferred_only"
        for d in members:
            out[d.id] = {"team": team, "methods": methods, "verdict": verdict,
                         "evidence": sum(len(m.evidence) for m in members),
                         "related": [m.id for m in members if m.id != d.id]}
    return out
