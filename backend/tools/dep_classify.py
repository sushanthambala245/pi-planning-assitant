"""What a verified dependency asks of people: the change it needs, the level it sits at, the
hops that put it there, and whether stated and inferred evidence agree on it.

- change: code (someone must change code), flow (an integration, data flow or contract must
  be agreed), regression (nothing to build, but something must be re-tested), or none
  (awareness only). Decided by rules over the dependency kind, the analyser's recorded access
  (changes / writes / reads) and the statement text, and always returned with its reason.
- level: what the dependency is on: another initiative, a team, or a system.
- path: the hops from the initiative to the target (initiative -> system -> repo -> team),
  so a user can see why a far-away team was pulled in.
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
from tools.wording import plural

ChangeType = Literal["code", "flow", "regression", "none"]
Level = Literal["initiative", "team", "system"]

CHANGE_RANK: dict[str, int] = {"none": 0, "regression": 1, "flow": 2, "code": 3}
CHANGE_LABELS = {"code": "Code change", "flow": "Flow / integration change", "regression": "Regression testing",
                 "none": "No change needed"}
LEVEL_OF = {"initiative": "initiative", "team": "team", "service": "system"}

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
# The detail code_deps writes for each repo hop (agents/discovery.py).
_CODE_HOP = re.compile(r"^(?P<repo>\S+) \(behind (?P<service>.+?)\) declares an internal dependency on "
                       r"(?P<dep>\S+), owned by (?P<owner>.+)$")
_WEAK_CONTRACT = {"missing", "draft"}
_VERB = {"blocked_on": "is blocked on", "waiting_for": "is waiting for", "requires": "requires",
         "sequenced_after": "is sequenced after"}

Label = Callable[[str], str]  # node id ("INIT-1", "team:X", "service:S", "repo:R") -> display text


@dataclass
class DepClass:
    change: ChangeType
    reason: str
    level: Level
    path: list[dict] = field(default_factory=list)  # [{"level": ..., "id": ..., "label": ...}]


def access(state: AgentState, initiative_id: str, service: str) -> str:
    """How an initiative touches a service, from the analyser's evidence: changes, writes,
    reads, or unclear (no access was recorded, e.g. a rule-based name match)."""
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
    return list(dict.fromkeys(e.ref.removeprefix("S7:") for e in d.evidence if e.source == "S7"))


def _contract(snap: ContextSnapshot, service: str) -> str:
    return str((snap.service_row(service) or {}).get("contract_status") or "")


def _explicit(d: Dependency, label: Label) -> tuple[ChangeType, str]:
    quote = next((e.quote for e in d.evidence if e.quote), "")
    verb = _VERB.get(d.dep_type, "depends on")
    for change, pattern in _KEYWORDS:
        m = pattern.search(quote)
        if m:
            return change, (f"Stated: {label(d.from_id)} {verb} {label(d.to_id)}. The statement mentions "
                            f"“{m.group(0)}”, so this needs {CHANGE_LABELS[change].lower()}.")
    change = _DEFAULT_BY_TYPE.get(d.dep_type, "flow")
    what = ("must deliver a change first" if change == "code" else "must be sequenced or coordinated with it")
    return change, f"Stated: {label(d.from_id)} {verb} {label(d.to_id)}, so {label(d.to_id)} {what}."


def _owned_by_other(d: Dependency, state: AgentState, snap: ContextSnapshot, label: Label) -> tuple[ChangeType, str]:
    team, ini = f"the {label(d.to_id)} team", label(d.from_id)
    options: list[tuple[ChangeType, str]] = []
    for service in _services(d) or ["(a system)"]:
        how = access(state, d.from_id, service)
        if how == "changes":
            options.append(("code", f"{ini} changes {service}, which {team} owns: {team} must make or review "
                                    "the code change."))
        elif how == "writes":
            options.append(("flow", f"{ini} writes to {service}, which {team} owns: agree the data flow and "
                                    f"interface with {team}."))
        elif how == "reads":
            status = _contract(snap, service)
            if status.lower() in _WEAK_CONTRACT:
                options.append(("flow", f"{ini} reads {service}, whose interface contract is {status}: agree "
                                        f"the contract with {team}."))
            else:
                options.append(("none", f"{ini} only reads {service}; {team} does not need to change anything "
                                        "unless the interface changes."))
        else:
            options.append(("flow", f"{ini} touches {service}, owned by {team}, but how it uses it is not "
                                    f"stated: confirm with {team} whether they need to change anything."))
    best = max(options, key=lambda o: CHANGE_RANK[o[0]])
    extra = len(options) - 1
    more = (f" ({plural(extra, 'more system', 'more systems')} owned by {team} {'is' if extra == 1 else 'are'} "
            "involved.)" if extra else "")
    return best[0], best[1] + more


def _shared(d: Dependency, state: AgentState, label: Label) -> tuple[ChangeType, str]:
    service = (_services(d) or ["a shared system"])[0]
    a, b = label(d.from_id), label(d.to_id)
    ha, hb = access(state, d.from_id, service), access(state, d.to_id, service)
    order = (f" Its owner's change ({b}) lands first." if d.directed else "")
    if ha == "reads" and hb == "reads":
        return "none", f"{a} and {b} both only read {service}: nothing to coordinate."
    if "reads" in (ha, hb):
        reader, writer = (a, b) if ha == "reads" else (b, a)
        return "regression", (f"{reader} only reads {service}, which {writer} changes: regression-test {reader} "
                              "after that change.")
    if "changes" in (ha, hb) or "unclear" in (ha, hb):
        return "code", (f"{a} and {b} both change {service}: plan the code changes together (merge order, "
                        f"shared contract).{order}")
    return "flow", f"{a} and {b} both write to {service}: agree the data flow between them.{order}"


def _code_hops(d: Dependency) -> list[dict]:
    return [m.groupdict() for m in (_CODE_HOP.match(e.detail) for e in d.evidence if e.source == "S4") if m]


def _code(d: Dependency, state: AgentState, label: Label) -> tuple[ChangeType, str]:
    hops = _code_hops(d)
    h = hops[0] if hops else {"repo": "a repository", "service": "a system", "dep": "another repository",
                              "owner": label(d.to_id)}
    ini, target = label(d.from_id), label(d.to_id)
    more = (f" ({plural(len(hops) - 1, 'more repo link', 'more repo links')} of the same kind.)"
            if len(hops) > 1 else "")
    if d.to_kind == "initiative":
        return "regression", (f"{target} changes {h['dep']}, which {ini}'s {h['repo']} calls: regression-test "
                              f"{ini} against that change.{more}")
    team = f"the {target} team"
    if access(state, d.from_id, h["service"]) == "reads":
        return "none", (f"{ini} only reads {h['service']}, so its build link from {h['repo']} to {h['dep']} "
                        f"({team}) is unchanged.{more}")
    return "none", (f"{h['repo']} (behind {h['service']}) calls {h['dep']}, owned by {team}. No initiative in "
                    f"this run changes {h['dep']}, so {team} has nothing to change: a build link to be aware "
                    f"of.{more}")


def _path(d: Dependency, label: Label) -> list[dict]:
    start = _hop("initiative", d.from_id, label)
    end = _hop(LEVEL_OF[d.to_kind], d.to_id, label)
    if d.kind == "code":
        hops = _code_hops(d)
        if hops:
            h = hops[0]
            return [start, _hop("system", f"service:{h['service']}", label), _hop("repo", f"repo:{h['repo']}", label),
                    _hop("repo", f"repo:{h['dep']}", label), end]
    if d.kind == "ownership":
        services = _services(d)
        if services:
            return [start, _hop("system", f"service:{services[0]}", label), end]
    return [start, end]


def classify(d: Dependency, state: AgentState, snap: ContextSnapshot, label: Label) -> DepClass:
    if d.kind == "explicit":
        change, reason = _explicit(d, label)
    elif d.kind == "code":
        change, reason = _code(d, state, label)
    elif d.kind == "ownership" and d.dep_type == "shared_service":
        change, reason = _shared(d, state, label)
    elif d.kind == "ownership":
        change, reason = _owned_by_other(d, state, snap, label)
    else:  # a reviewer's sequencing constraint
        change, reason = "flow", f"A reviewer placed {label(d.to_id)} before {label(d.from_id)}."
    return DepClass(change=change, reason=reason, level=LEVEL_OF[d.to_kind], path=_path(d, label))


def owner_team(d: Dependency, state: AgentState, snap: ContextSnapshot) -> str:
    """The team a dependency ultimately lands on: the target team, the owner of the target
    service, or the owning team of the target initiative."""
    kind, _, name = d.to_id.partition(":")
    if kind == "team":
        return name
    if kind == "service":
        return str((snap.service_row(name) or {}).get("owner_team") or f"service:{name}")
    ini = next((i for i in state.initiatives if i.id == d.to_id), None)
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
        stated = "explicit" in methods
        inferred = bool({"code", "ownership"} & set(methods))
        verdict = "confirmed" if stated and inferred else "stated_only" if stated else "inferred_only"
        for d in members:
            out[d.id] = {"team": team, "methods": methods, "verdict": verdict,
                         "evidence": sum(len(m.evidence) for m in members),
                         "related": [m.id for m in members if m.id != d.id]}
    return out
