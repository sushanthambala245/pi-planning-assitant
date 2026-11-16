"""A run as the UI's Analysis payload (contract: frontend/src/types.ts, frontend/DATA_FORMAT.md).

Built on demand from the run's state and its event stream, so the UI can poll it while the
run is in progress: agents report wait / active / done from the node lifecycle events,
findings and sources appear as their events arrive, and the graph, risks and sequence fill
in once the state has them. This is a view only: every number and flag comes from the agents;
the change classification of each dependency comes from tools/dep_classify.py.
"""

from __future__ import annotations

import math
import re
from collections import Counter, defaultdict

from agents.sequencing import team_capacity
from agents.state import AgentState, EvidenceRef, Initiative, Risk
from agents.visualisation import link_in_jira, links, rank_risks
from context.snapshot import ContextSnapshot
from context.sources import SOURCES
from tools.dep_classify import CHANGE_LABELS, CHANGE_RANK, access, classify, corroboration, owner_team
from tools.dri_rules import DRI_CODES
from tools.graph_tools import orders
from tools.planning import (VELOCITY_TIERS, Calendar, is_quarter, is_ready, parse_dependency_text, scale_of,
                            velocity_tier)
from tools.wording import plural, strip_dep_refs

# The UI's agents in pipeline order, and the graph nodes each one covers (agents/graph.py).
# human_gate and export are not shown: the run is complete for the UI once it awaits review.
AGENTS = [
    {"id": "analyser", "name": "Initiative analyser", "icon": "ti-file-search", "nodes": ("load_context", "analyser"),
     "sources": ("S1", "S7"),
     "summary": "Reads each initiative that is Ready for PI Planning (In Discovery and Proposed are left out): its "
                "description, its declared upstream and downstream systems, its T-shirt size and target quarter, "
                "and looks up which team owns each system."},
    {"id": "discovery", "name": "Dependency discovery", "icon": "ti-search",
     "nodes": ("declared_deps", "explicit_deps", "code_deps", "ownership_deps"), "sources": ("S1", "S4", "S6", "S7"),
     "summary": "Four tools run in parallel: the declared dependency lists, dependencies stated in descriptions and "
                "planner notes, GitHub code and shared-library links, and systems two initiatives share."},
    {"id": "verifier", "name": "Evidence verifier", "icon": "ti-shield-check", "nodes": ("merge", "verify", "requery"),
     "sources": (),
     "summary": "Merges the candidates, applies the planner's keep / dismiss decisions, rejects any without citable "
                "evidence and marks weak ones as low confidence."},
    {"id": "sequencing", "name": "Sequencing", "icon": "ti-list-numbers", "nodes": ("sequencing",), "sources": ("S1", "S5"),
     "summary": "Orders the work by its dependencies, places each initiative in a quarter by its T-shirt size against "
                "its team's capacity per quarter (velocity), and checks the target quarters as written for conflicts."},
    {"id": "risk", "name": "Risk", "icon": "ti-alert-triangle", "nodes": ("risk",), "sources": ("S4", "S5", "S6", "S7"),
     "summary": "Applies the Dependency Risk Index rules: plan conflicts, systems with no owner, deprecated "
                "repositories and systems, missing interface contracts, team capacity and dependency cycles."},
    {"id": "visualisation", "name": "Visualisation", "icon": "ti-chart-dots", "nodes": ("visualisation",),
     "sources": (),
     "summary": "Builds the dependency graph and the summary numbers."},
]
_AGENT_OF = {n: a["id"] for a in AGENTS for n in a["nodes"]}

SOURCE_ICONS = {"S1": "ti-file-description", "S2": "ti-ticket", "S3": "ti-message-dots", "S4": "ti-brand-github",
                "S5": "ti-gauge", "S6": "ti-users", "S7": "ti-sitemap", "S8": "ti-history", "S9": "ti-chart-bar",
                "S10": "ti-link", "M1": "ti-book", "M2": "ti-shield-lock", "M3": "ti-brand-slack", "M4": "ti-table"}
_SEVERITY = {"blocker": "High", "warning": "Medium", "info": "Low"}
_FINDING = {"systems": ("sys", "Systems found"), "explicit": ("dep", "Stated dependency"),
            "inferred": ("dep", "Inferred dependency"), "rejected": ("dep", "Rejected"),
            "sequence": ("dep", "Sequence"), "risk": ("dep", "Risk")}
_STRUCTURAL = ("S4", "S5", "S6", "S7", "S8", "S10")  # tables read as records, not retrieved as text
_DONE = ("awaiting_review", "approved")
_MAX_NOTES = 12
_W, _H = 420, 240  # the UI graph's viewBox
_RISK_FINDING = re.compile(r"\[(blocker|warning|info)\]\s*(.*)", re.S)
_SKIPPED = re.compile(r"skipped: (.+?) not loaded")
# S7 service_type values onto the UI's system types; anything else is a service.
_SYSTEM_TYPES = {"api": "api", "service": "service", "dataset": "dataset", "ledger_capability": "capability",
                 "capability": "capability"}


def _cut(text: str, n: int) -> str:
    text = " ".join(str(text).split())
    return text if len(text) <= n else text[: n - 1] + "…"


def _source_label(sid: str) -> str:
    return f"{SOURCES[sid].title} ({sid})" if sid in SOURCES else sid


class _Names:
    """Display names and ARTs (the graph's colour domains) for initiatives, teams and services."""

    def __init__(self, snap: ContextSnapshot, state: AgentState | None):
        self.snap = snap
        self.inis: dict[str, Initiative] = {i.id: i for i in snap.initiatives()}
        if state:
            self.inis.update({i.id: i for i in state.initiatives})

    def team(self, team: str) -> str:
        return (self.snap.team_row(team) or {}).get("team_name") or team

    def art(self, team: str | None) -> str:
        return ((self.snap.team_row(team) or {}).get("art") if team else None) or "Other"

    def initiative(self, iid: str) -> str:
        return self.inis[iid].title if iid in self.inis else iid

    def node(self, node_id: str) -> tuple[str, str]:
        """(label, domain) for a graph node id: an initiative id, team:<name>, service:<name> or
        library:<name>."""
        kind, _, name = node_id.partition(":")
        if kind == "team":
            return self.team(name), self.art(name)
        if kind == "service":
            return name, self.art((self.snap.service_row(name) or {}).get("owner_team"))
        if kind == "library":
            return name, "Other"
        ini = self.inis.get(node_id)
        return (ini.title, ini.art or self.art(ini.owning_team)) if ini else (node_id, "Other")

    def label(self, node_id: str) -> str:
        """Display text for any node id, including repo:<name> hops."""
        kind, _, name = node_id.partition(":")
        return name if kind == "repo" else self.node(node_id)[0]


def _progress(events: list[dict], status: str) -> tuple[list[str], dict[str, float]]:
    """Per agent: done once its nodes have all completed and a later agent has started (or the
    run is complete), active once any of its nodes has started, else wait."""
    started, completed = Counter(), Counter()
    ms: dict[str, float] = defaultdict(float)
    for ev in events:
        agent = _AGENT_OF.get(ev.get("node") or "")
        if agent is None:
            continue
        if ev["type"] == "node_started":
            started[agent] += 1
        elif ev["type"] == "node_completed":
            completed[agent] += 1
            ms[agent] += ev["data"].get("duration_ms") or 0
    states = []
    for i, a in enumerate(AGENTS):
        s, c = started[a["id"]], completed[a["id"]]
        later = any(started[b["id"]] for b in AGENTS[i + 1:])
        states.append("done" if s and c >= s and (later or status in _DONE) else "active" if s else "wait")
    return states, ms


def _load_line(c) -> str:
    if c.committed_points is None:  # S5 has no committed points: only the selected work is counted
        return f"{c.team}: the initiatives targeted at {c.pi} fill {c.load_pct:g}% of its capacity there"
    return f"{c.team} loaded to {c.load_pct:g}% in {c.pi}"


def _outputs(agent: str, state: AgentState) -> list[str]:
    live = [d for d in state.deps if d.status in ("verified", "low_confidence")]
    if agent == "analyser":
        return [f"{plural(len(state.systems), 'system touch', 'system touches')} on "
                f"{plural(len({s.system for s in state.systems}), 'shared system')}"]
    if agent == "discovery":
        kinds = Counter(d.kind for d in state.candidate_deps)
        return [plural(len(state.candidate_deps), "candidate dependency", "candidate dependencies"),
                f"{kinds['explicit']} from text · {kinds['code']} from code · {kinds['ownership']} from ownership"]
    if agent == "verifier":
        pairs = links(live)
        low = sum(d.status == "low_confidence" for d in live)
        out = [f"{plural(len(live), 'grounded dependency', 'grounded dependencies')} ({low} low confidence), "
               f"shown as {plural(len(pairs), 'link')} in the results (one per initiative and target)",
               f"{len(state.rejected_deps)} rejected for lack of citable evidence"]
        jira = [link_in_jira(m) for m in pairs.values()]
        if any(v is not None for v in jira):
            out.append(f"{plural(sum(v is True for v in jira), 'link')} already in Jira, "
                       f"{sum(v is False for v in jira)} not")
        return out
    if agent == "sequencing":
        loads = sorted((c for c in state.capacity if c.load_pct is not None), key=lambda c: -c.load_pct)
        return [f"{plural(len(state.sequence), 'step')}, {plural(len(state.cycles), 'cycle')}"] + [
            _load_line(c) for c in loads[:5]]
    if agent == "risk":
        sev = Counter(_SEVERITY[r.severity] for r in state.risks)
        return [f"{plural(len(state.risks), 'risk flag')}: {sev['High']} high · {sev['Medium']} medium · "
                f"{sev['Low']} low"]
    if agent == "visualisation" and state.ui:
        return ["Dependency graph and the summary numbers (counted from the run; no text is generated)"]
    return []


def _agents(state: AgentState | None, events: list[dict], snap: ContextSnapshot, states: list[str],
            ms: dict[str, float]) -> list[dict]:
    used: dict[str, Counter] = defaultdict(Counter)
    units: dict[str, str] = {}
    notes: dict[str, list[str]] = defaultdict(list)
    for ev in events:
        agent, d = _AGENT_OF.get(ev.get("node") or ""), ev["data"]
        if agent is None:
            continue
        if ev["type"] == "source_used":
            used[agent][d["source"]] += d.get("count") or 0
            units[d["source"]] = d.get("unit") or "read"
        elif ev["type"] in ("note", "warning"):
            text = d.get("text") or d.get("message") or ""
            if text and text not in notes[agent]:
                notes[agent].append(text)
    if state:
        notes["risk"] += [f"{code}: {v}" for code, v in sorted(state.rule_coverage.items()) if v.startswith("skipped")]

    out = []
    for a, st in zip(AGENTS, states):
        inputs = [f"{plural(len(state.initiatives), 'initiative')} selected"] if a["id"] == "analyser" and state else []
        for sid in a["sources"]:
            if used[a["id"]][sid]:
                inputs.append(f"{_source_label(sid)}: {used[a['id']][sid]} {units[sid]}")
            elif snap.has(sid):
                inputs.append(f"{_source_label(sid)}: {len(snap.table(sid))} records")
            else:
                inputs.append(f"{_source_label(sid)}: {'loaded' if snap.has_text(sid) else 'not loaded'}")
        n = notes[a["id"]]
        shown = n[:_MAX_NOTES] + ([f"…and {len(n) - _MAX_NOTES} more"] if len(n) > _MAX_NOTES else [])
        out.append({"id": a["id"], "name": a["name"], "icon": a["icon"], "summary": a["summary"],
                    "durationMs": round(ms[a["id"]]) if st == "done" else None, "inputs": inputs,
                    "outputs": _outputs(a["id"], state) if state and st == "done" else [], "notes": shown})
    return out


def _system_type(snap: ContextSnapshot, name: str) -> str:
    raw = str((snap.service_row(name) or {}).get("service_type") or "").strip().lower()
    if raw in _SYSTEM_TYPES:
        return _SYSTEM_TYPES[raw]
    return "api" if re.search(r"\bapi\b", name, re.I) else "service"


def _systems(state: AgentState, snap: ContextSnapshot, names: _Names, iid: str) -> list[dict]:
    """The systems one initiative touches, typed (service / API / dataset) with their owning team."""
    out = []
    for t in state.systems:
        if t.initiative_id != iid:
            continue
        quote = next((e.quote for e in t.evidence if e.quote), "")
        out.append({"name": t.system, "type": _system_type(snap, t.system), "team": t.owner_team or "",
                    "teamName": names.team(t.owner_team) if t.owner_team else "",
                    "access": access(state, iid, t.system), "method": t.method, "quote": _cut(quote, 200)})
    return out


def _mentioned(text: str, inis: list[Initiative]) -> list[str]:
    """Initiatives a finding names, for events written before findings carried their ids."""
    return [i.id for i in inis if re.search(rf"\b{re.escape(i.id)}\b", text) or i.title in text]


def _findings(events: list[dict], state: AgentState | None, snap: ContextSnapshot, names: _Names,
              deps: dict[str, dict]) -> list[dict]:
    inis = state.initiatives if state else []
    out, seen = [], set()
    for ev in events:
        if ev["type"] != "finding" or ev["data"].get("text") in seen:
            continue
        d = ev["data"]
        seen.add(d["text"])
        tag, label = _FINDING.get(d.get("tag", ""), ("dep", str(d.get("tag", "Finding")).title()))
        # An empty list is deliberate (the finding spans the run); only older events lack the key.
        ids = d["initiative_ids"] if "initiative_ids" in d else _mentioned(d["text"], inis)
        text = d["text"]
        m = _RISK_FINDING.match(text) if d.get("tag") == "risk" else None
        if m:  # "[warning] Missing owner — X": the UI's severity words, not the rule engine's
            label, text = f"{_SEVERITY[m.group(1)]} risk", m.group(2)
        f = {"tag": tag, "tagLabel": label, "kind": d.get("tag") or "", "text": text,
             "note": d.get("sub") or None, "highlight": d.get("tag") == "risk",
             "agentId": _AGENT_OF.get(ev.get("node") or ""), "initiativeIds": ids}
        key = d.get("dep_key")
        if key:
            f["depKey"] = key
            if key in deps:
                f["changeType"] = deps[key]["changeType"]
        if d.get("tag") == "systems" and state and len(ids) == 1:
            f["systems"] = _systems(state, snap, names, ids[0])
        out.append(f)
    return out


def _initiatives(state: AgentState, names: _Names) -> list[dict]:
    return [{"id": i.id, "title": i.title, "team": i.owning_team,
             "teamName": names.team(i.owning_team) if i.owning_team else "",
             "art": i.art or names.art(i.owning_team), "pi": i.target_pi or "", "priority": i.priority,
             "status": i.status, "size": i.size_override or i.tshirt_size} for i in state.initiatives]


_KIND_RANK = {"declared": 5, "explicit": 4, "constraint": 3, "ownership": 2, "code": 1, "library": 0}


def _provenance(members) -> str:
    """declared: in the initiative's own dependency list. planner: in a planner note or confirmed
    by a planner. stated: written in the description but not declared. inferred: found in GitHub,
    the ownership lookup or shared systems. The last two are the hidden dependencies."""
    if any(m.kind == "declared" for m in members):
        return "declared"
    if any(m.declared for m in members):
        return "planner"
    if any(m.kind == "explicit" for m in members):
        return "stated"
    return "inferred"


def _impact(members, change: str) -> str:
    """What the link does to the plan: orders it (the target must land first), should go first
    (a code interface change: soft), needs coordination, needs re-testing, or nothing."""
    if any(orders(m) for m in members):
        return "orders"
    if any(m.kind == "code" and m.directed for m in members):
        return "soft"
    return {"code": "coordinate", "flow": "coordinate", "regression": "retest"}.get(change, "aware")


def _dependencies(state: AgentState, snap: ContextSnapshot, names: _Names) -> list[dict]:
    """One row per (dependent, target) pair, as drawn in the graph: the change it needs (the
    strongest of its parts), the hops that explain it, and whether stated and inferred agree."""
    live = [d for d in state.deps if d.status in ("verified", "low_confidence")]
    corr = corroboration(live, state, snap)
    by_id = {d.id: d for d in live}
    pairs: dict[tuple[str, str], list] = defaultdict(list)
    for d in live:
        pairs[(d.from_id, d.to_id)].append(d)
    rows = []
    for (a, b), members in pairs.items():
        parts = [(m, classify(m, state, snap, names.label)) for m in members]
        # The biggest change; on a tie, the link that orders the work, then the declared or stated one.
        top_dep, top = max(parts, key=lambda p: (CHANGE_RANK[p[1].change], orders(p[0]), _KIND_RANK.get(p[0].kind, 0)))
        own = {m.id for m in members}
        also = sorted({f"{by_id[r].from_id}->{by_id[r].to_id}" for m in members for r in corr[m.id]["related"]
                       if r not in own})
        team = owner_team(top_dep, state, snap)
        in_jira = [m.in_jira for m in members]
        evidence = list({e["text"]: e for e in (_evidence(e) for m in members for e in m.evidence)}.values())
        prov = _provenance(members)
        rows.append({
            "key": f"{a}->{b}", "from": a, "fromLabel": names.label(a), "to": b, "toLabel": names.label(b),
            "level": top.level, "toTeam": "" if team.startswith("service:") or team == b else names.team(team),
            "changeType": top.change, "changeLabel": CHANGE_LABELS[top.change], "reason": top.reason,
            "why": [{"method": m.kind, "changeType": c.change, "text": c.reason} for m, c in parts],
            "methods": sorted({m.kind for m in members}), "inferred": prov == "inferred",
            "verdict": corr[members[0].id]["verdict"], "alsoFoundAs": also, "path": top.path,
            "evidence": evidence[:6], "evidenceCount": sum(len(m.evidence) for m in members),
            "confidence": round(max(m.confidence for m in members), 2),
            "status": "verified" if any(m.status == "verified" for m in members) else "low_confidence",
            "inJira": True if True in in_jira else False if in_jira and all(x is False for x in in_jira) else None,
            "dependencyIds": [m.id for m in members],
            "provenance": prov, "declared": prov in ("declared", "planner"),
            "impact": _impact(members, top.change), "depTypes": sorted({m.dep_type for m in members}),
            "note": next((m.note for m in members if m.note), ""),
            "decision": next((m.decision for m in members if m.decision), "")})
    rows.sort(key=lambda r: (-CHANGE_RANK[r["changeType"]], r["from"], r["to"]))
    return rows


def _sources_used(events: list[dict], snap: ContextSnapshot) -> list[dict]:
    read: Counter = Counter()
    units: dict[str, str] = {}
    for ev in events:
        if ev["type"] == "source_used":
            read[ev["data"]["source"]] += ev["data"].get("count") or 0
            units[ev["data"]["source"]] = ev["data"].get("unit") or "read"
    out = [{"icon": SOURCE_ICONS.get(sid, "ti-file-text"), "text": f"{_source_label(sid)} — {n} {units[sid]}"}
           for sid, n in sorted(read.items())]
    if read:  # the structural tables are consulted once the run is under way
        out += [{"icon": SOURCE_ICONS[sid], "text": f"{_source_label(sid)} — {len(snap.table(sid))} records checked"}
                for sid in _STRUCTURAL if snap.has(sid)]
    return out


def _ring(ids: list[str], rx: float, ry: float, offset: float = 0.0) -> dict[str, tuple[float, float]]:
    cx, cy = _W / 2, 114  # a little above centre: labels sit under the nodes
    n = len(ids)
    return {nid: (round(cx + (rx if n > 1 else 0) * math.cos(2 * math.pi * (k + offset) / n - math.pi / 2), 1),
                  round(cy + (ry if n > 1 else 0) * math.sin(2 * math.pi * (k + offset) / n - math.pi / 2), 1))
            for k, nid in enumerate(ids)}


_KIND_OF = {"initiative": "initiative", "team": "team", "service": "system"}


def _graph(state: AgentState, names: _Names, deps: list[dict]) -> dict:
    """Initiatives in this run on an inner ring, the teams, services and other initiatives
    they depend on around them. One edge per dependency row, with the row's provenance flags:
    declared (on the initiative's list or kept by a planner) and inferred (found only in GitHub or
    through a shared system, not written anywhere)."""
    inner = [i.id for i in state.initiatives]
    outer = sorted({r["to"] for r in deps} - set(inner))
    pos = {**_ring(inner, 70, 34), **_ring(outer, 180, 86, offset=0.5)}
    nodes = []
    for nid in inner + outer:
        label, domain = names.node(nid)
        kind = nid.partition(":")[0] if ":" in nid else "initiative"
        nodes.append({"id": nid, "label": label, "domain": domain, "kind": _KIND_OF.get(kind, "initiative"),
                      "x": pos[nid][0], "y": pos[nid][1]})
    return {"nodes": nodes, "edges": [{"from": r["from"], "to": r["to"], "inferred": r["inferred"],
                                       "changeType": r["changeType"], "key": r["key"], "declared": r["declared"],
                                       "impact": r["impact"]} for r in deps]}


def _evidence(e: EvidenceRef) -> dict:
    body = f"“{_cut(e.quote, 160)}”" if e.quote else _cut(e.detail, 160)
    return {"icon": SOURCE_ICONS.get(e.source, "ti-file-text"),
            "text": f"{SOURCES[e.source].title if e.source in SOURCES else e.source} · {e.ref}: {body}"}


def _risk(r: Risk, names: _Names, node_ids: set[str]) -> dict:
    reasoning = [r.description]
    if r.rationale_method == "llm" and r.rationale.strip():
        reasoning.append(r.rationale.strip())
    reasoning.append(f"Flagged by rule {r.dri_code} ({DRI_CODES.get(r.dri_code, r.dri_code)}). The rule decides the "
                     "flag and its severity; a model only explains it.")
    if r.history_note:
        reasoning.append(f"History (S8): {r.history_note}.")
    affected = []
    for iid in r.initiative_ids:
        ini = names.inis.get(iid)
        team = names.team(ini.owning_team) if ini and ini.owning_team else ""
        affected.append({"domain": names.node(iid)[1],
                         "text": f"{names.initiative(iid)} ({iid})" + (f" — {team}" if team else "")})
    sources = list({s["text"]: s for s in map(_evidence, r.sources)}.values())[:8]
    highlight = [i for i in r.initiative_ids if i in node_ids] + [
        n for e in r.entities for n in (f"team:{e}", f"service:{e}") if n in node_ids]
    return {"id": r.id, "title": r.title, "description": r.description, "severity": _SEVERITY[r.severity],
            "rule": DRI_CODES.get(r.dri_code, r.dri_code), "ruleCode": r.dri_code,
            "reasoning": reasoning, "affected": affected, "sources": sources, "suggestedPrompts": [],
            "highlightNodes": highlight, "initiativeIds": r.initiative_ids}


def _not_checked(coverage: dict[str, str], snap: ContextSnapshot) -> list[dict]:
    """Risk checks that did not run (a source is missing or switched off) or ran on partial data, in words."""
    out = []
    for code, v in sorted(coverage.items()):
        name = DRI_CODES.get(code, "Severity calibration against past PIs" if code == "history" else code)
        if v.startswith("skipped"):
            m = _SKIPPED.match(v)
            if m:
                ids = [x.strip() for s in m.group(1).split(",") for x in s.split("|")]
                off = all((snap.reports.get(x) and snap.reports[x].status == "off") for x in ids)
                reason = (f"Needs {', '.join(_source_label(s) for s in ids)}, which "
                          f"{'is' if len(ids) == 1 else 'are'} "
                          + ("not part of the knowledge base" if off else "not loaded"))
            else:
                reason = v.removeprefix("skipped:").strip()
            out.append({"code": code, "name": name, "reason": reason, "partial": False})
        elif "; partial: " in v:
            reason = v.split("; partial: ", 1)[1]
            out.append({"code": code, "name": name, "reason": reason[:1].upper() + reason[1:], "partial": True})
    return out


def _review(state: AgentState) -> dict:
    return {"approvals": [a.model_dump(mode="json", include={"action", "reviewer", "role", "at", "note"})
                          for a in state.approvals],
            "constraints": [c.model_dump(mode="json", include={"first", "then", "note"}) for c in state.constraints],
            "exports": list(state.exports)}


def _calendar(state: AgentState) -> Calendar:
    return Calendar(sprints=[c["sprint"] for c in state.calendar],
                    pis=list(dict.fromkeys(c["pi"] for c in state.calendar)),
                    pi_of=[c["pi"] for c in state.calendar], assumed=[bool(c["assumed"]) for c in state.calendar])


def _readiness(snap: ContextSnapshot, state: AgentState, ready_statuses: tuple[str, ...]) -> dict:
    """Which roadmap initiatives were ready for PI planning, and which were left out and why."""
    pool = snap.initiatives()
    in_run = {i.id for i in state.initiatives}
    ready = [i for i in pool if is_ready(i.status, i.origin, ready_statuses)]
    return {"total": len(pool), "ready": len(ready), "analysed": len(state.initiatives),
            "readyStatuses": list(ready_statuses),
            "byStatus": dict(Counter(i.status or "(no status)" for i in pool)),
            "excluded": [{"id": i.id, "title": i.title, "status": i.status or "(no status)", "team": i.owning_team,
                          "teamName": snap.team_name(i.owning_team), "pi": i.target_pi or ""}
                         for i in pool if not is_ready(i.status, i.origin, ready_statuses)],
            "readyNotAnalysed": [i.id for i in ready if i.id not in in_run]}


def _plan(state: AgentState, snap: ContextSnapshot, names: _Names, rows: list[dict], settings=None) -> dict:
    """The three use cases in one payload: what was declared (and the plan as written), what was
    hidden, and the recommended quarter plan with its reasons, team velocity and load. `links` are
    the ordering links between initiatives, so the decision dashboard can check a placement."""
    cal = _calendar(state)
    by_id = {i.id: i for i in state.initiatives}
    sched = {s.initiative_id: s for s in state.schedule}
    scale = scale_of(settings.tshirt_points if settings else None)
    tiers = settings.velocity_tiers if settings else VELOCITY_TIERS
    real = [k for k, a in enumerate(cal.assumed) if not a]
    sprints = [{"index": k, "name": cal.sprints[k], "short": cal.short(k), "pi": cal.pi_of[k],
                "assumed": cal.assumed[k]} for k in range(len(cal.sprints))]
    pis = [{"id": p, "assumed": all(cal.assumed[k] for k, q in enumerate(cal.pi_of) if q == p),
            "sprints": [k for k, q in enumerate(cal.pi_of) if q == p], "quarter": is_quarter(p)} for p in cal.pis]

    def pi_at(k: int | None) -> str:
        return cal.pi_of[k] if k is not None and k < len(cal.pi_of) else ""

    touching: dict[str, Counter] = defaultdict(Counter)
    for r in rows:
        for end in (r["from"], r["to"]):
            if end in by_id:
                touching[end]["declared" if r["declared"] else "hidden"] += 1

    items = []
    for i in state.initiatives:
        s = sched.get(i.id)
        if s is None:
            continue
        up, down = parse_dependency_text(i.dependency_text)
        target = pi_at(s.planned_index) if s.target_source != "none" else ""
        items.append({
            "id": i.id, "title": i.title, "team": i.owning_team, "teamName": names.team(i.owning_team),
            "art": i.art or names.art(i.owning_team), "priority": i.priority, "type": i.initiative_type,
            "outcome": i.business_outcome, "status": i.status, "description": i.description,
            "size": s.size, "points": s.points, "sizeSource": s.size_source, "sizeOverride": i.size_override,
            "dataSize": i.tshirt_size, "plannedSprint": i.planned_sprint, "plannedIndex": s.planned_index,
            "plannedFinish": s.planned_finish,
            "plannedLabel": cal.short(s.planned_index) if s.planned_index is not None else "",
            "plannedPi": i.target_pi or target, "targetQuarter": target, "targetSource": s.target_source,
            "quarterOverride": i.quarter_override,
            "deadline": s.deadline, "spills": s.deadline is not None and s.finish > s.deadline,
            "start": s.start, "finish": s.finish, "startLabel": cal.short(s.start), "finishLabel": cal.short(s.finish),
            "pi": pi_at(s.start), "finishPi": pi_at(s.finish),
            "movedBy": (s.start - s.planned_index) if s.planned_index is not None else None,
            "reasons": s.reasons, "waitsFor": s.waits_for, "inCycle": s.in_cycle, "capacityKnown": s.capacity_known,
            "allocation": {str(k): v for k, v in s.allocation.items()},
            "declaredUpstream": up, "declaredDownstream": down, "note": i.note,
            "declaredLinks": touching[i.id]["declared"], "hiddenLinks": touching[i.id]["hidden"]})

    caps = team_capacity(snap, cal, {i.owning_team for i in state.initiatives})
    asks: dict[str, Counter] = defaultdict(Counter)
    for r in rows:
        team = r["toTeam"] or (by_id[r["to"]].owning_team if r["to"] in by_id else "")
        if team and r["changeType"] != "none":
            asks[team][r["changeType"]] += 1
    teams = []
    for team, cap in sorted(caps.items(), key=lambda kv: names.team(kv[0])):
        ids = [i.id for i in state.initiatives if i.owning_team == team]
        by_pi_cap = {p["id"]: round(sum(cap.at(k, cal) for k in p["sprints"]), 1) for p in pis}
        planned = defaultdict(float)
        scheduled = defaultdict(float)
        for x in ids:
            s = sched.get(x)
            if not s:
                continue
            if s.planned_index is not None and s.target_source != "none":
                planned[pi_at(s.planned_index)] += s.points
            for k, v in s.allocation.items():
                scheduled[pi_at(int(k))] += v
        quarter = cap.per_quarter(cal)
        teams.append({"id": team, "name": names.team(team), "art": names.art(team), "average": cap.average,
                      "median": cap.median, "quarterCapacity": quarter, "tier": velocity_tier(quarter, tiers),
                      "known": cap.average > 0, "perSprint": [cap.at(k, cal) for k in range(len(cal.sprints))],
                      "capacityByPi": by_pi_cap, "plannedByPi": {k: round(v, 1) for k, v in planned.items()},
                      "scheduledByPi": {k: round(v, 1) for k, v in scheduled.items()},
                      "initiativeIds": ids, "asks": dict(asks.get(team, {}))})

    conflicts = []
    for c in state.conflicts:
        rec = sched.get(c.consumer)
        conflicts.append({"provider": c.provider, "consumer": c.consumer, "kind": c.kind,
                          "providerLabel": names.initiative(c.provider), "consumerLabel": names.initiative(c.consumer),
                          "providerFinish": c.provider_finish, "consumerStart": c.consumer_start,
                          "providerFinishLabel": cal.short(c.provider_finish),
                          "consumerStartLabel": cal.short(c.consumer_start),
                          "consumerFinishLabel": cal.short(c.consumer_finish) if c.consumer_finish is not None else "",
                          "providerQuarter": pi_at(sched[c.provider].planned_index) if c.provider in sched else "",
                          "consumerQuarter": pi_at(c.consumer_start), "declared": c.declared,
                          "depKey": f"{c.consumer}->{c.provider}",
                          "recommendedStart": cal.short(rec.start) if rec else ""})

    # Ordering links between initiatives (provider first), as the dashboard checks them.
    links_out: dict[tuple[str, str], dict] = {}
    for r in rows:
        if r["from"] in by_id and r["to"] in by_id and r["impact"] in ("orders", "soft"):
            k = (r["to"], r["from"])
            cur = links_out.setdefault(k, {"provider": r["to"], "consumer": r["from"], "strength": r["impact"],
                                           "declared": r["declared"], "depKeys": [], "reason": r["reason"]})
            cur["depKeys"].append(r["key"])
            if r["impact"] == "orders":
                cur["strength"] = "orders"
            cur["declared"] = cur["declared"] or r["declared"]
    for c in state.constraints:
        if c.first in by_id and c.then in by_id:
            links_out.setdefault((c.first, c.then), {"provider": c.first, "consumer": c.then, "strength": "orders",
                                                     "declared": True, "depKeys": [],
                                                     "reason": f"Reviewer constraint{': ' + c.note if c.note else ''}"})

    hidden = [r for r in rows if not r["declared"]]
    declared = [r for r in rows if r["declared"]]
    moved = [x for x in items if x["movedBy"]]
    later_q = [x for x in items if x["targetQuarter"] and x["pi"] and x["pi"] != x["targetQuarter"]]
    soft_late = sum(1 for r in rows if r["impact"] == "soft" and r["from"] in sched and r["to"] in sched
                    and sched[r["to"]].finish >= sched[r["from"]].start)
    over = [(t["id"], p) for t in teams for p, v in t["plannedByPi"].items()
            if t["capacityByPi"].get(p) and v > t["capacityByPi"][p]]
    counts = {
        "declared": len(declared),
        "declaredByRole": dict(Counter(t for r in declared for t in r["depTypes"] if t in ("upstream", "downstream"))),
        "hidden": len(hidden),
        "hiddenShare": round(100 * len(hidden) / len(rows)) if rows else 0,
        "hiddenByProvenance": dict(Counter(r["provenance"] for r in hidden)),
        "hiddenByMethod": dict(Counter(m for r in hidden for m in r["methods"])),
        "hiddenByImpact": dict(Counter(r["impact"] for r in hidden)),
        "hiddenByLevel": dict(Counter(r["level"] for r in hidden)),
        "hiddenNeedChange": sum(r["changeType"] != "none" for r in hidden),
        "ordering": sum(r["impact"] == "orders" for r in rows),
        "orderingHidden": sum(r["impact"] == "orders" for r in hidden),
        "softLate": soft_late,
        "conflicts": len(conflicts),
        "conflictsHidden": sum(not c["declared"] for c in conflicts),
        "conflictsLaterQuarter": sum(c["kind"] == "later_quarter" for c in conflicts),
        "conflictsTight": sum(c["kind"] == "too_tight" for c in conflicts),
        "moved": len(moved),
        "laterQuarter": len(later_q),
        "spill": sum(1 for x in items if x["spills"]),
        "teamsOver": len({t for t, _ in over}),
        "teamQuartersOver": len(over),
        "noSize": sum(1 for x in items if x["sizeSource"] in ("assumed", "none")),
        "steps": len(state.sequence),
        "cycles": len(state.cycles),
    }
    return {"sprints": sprints, "pis": pis, "items": items, "teams": teams, "conflicts": conflicts,
            "links": list(links_out.values()), "counts": counts, "realSprints": len(real),
            "sprintsPerPi": cal.sprints_per_pi(),
            "horizon": [p for p in cal.pis_real][: (settings.plan_quarters if settings else 4)],
            "tshirt": [{"size": k, "points": v} for k, v in sorted(scale.items(), key=lambda kv: kv[1])],
            "defaultSize": settings.default_size if settings else "M",
            "velocityTiers": [{"tier": t, "upTo": x} for t, x in tiers] + [{"tier": "XL", "upTo": None}],
            "planner": {"initiativeNotes": len(state.planner.initiative_notes), "sizes": len(state.planner.sizes),
                        "quarters": len(state.planner.quarters),
                        "dependencyNotes": len(state.planner.dependency_notes),
                        "decisions": dict(Counter(state.planner.dependency_decisions.values()))}}


def build_analysis(run_id: str, status: str, error: str | None, state: AgentState | None, events: list[dict],
                   snap: ContextSnapshot, flags: list[str] | None = None,
                   ready_statuses: tuple[str, ...] = ("Ready for PI Planning",), settings=None) -> dict:
    states, ms = _progress(events, status)
    names = _Names(snap, state)
    deps = _dependencies(state, snap, names) if state else []
    analysis = {"agents": _agents(state, events, snap, states, ms),
                "findings": _findings(events, state, snap, names, {r["key"]: r for r in deps}),
                "sourcesUsed": _sources_used(events, snap), "graph": {"nodes": [], "edges": []}, "risks": [],
                "sequence": [], "initiatives": _initiatives(state, names) if state else [], "dependencies": deps,
                "steps": [], "notChecked": []}
    if state:
        if state.ui:  # the graph is drawn from verified dependencies, so wait for the visualisation step
            analysis["graph"] = _graph(state, names, deps)
            summary = state.ui.get("summary") or {}
            if summary.get("summary"):
                analysis["summary"] = {"text": summary["summary"], "method": summary.get("method", "template")}
        node_ids = {n["id"] for n in analysis["graph"]["nodes"]}
        analysis["risks"] = [_risk(r, names, node_ids) for r in rank_risks(state.risks)]
        analysis["sequence"] = [" + ".join(names.initiative(i) for i in s.initiative_ids)
                                + (" (cycle)" if s.in_cycle else "") for s in state.sequence]
        analysis["steps"] = [{"step": s.step, "initiativeIds": s.initiative_ids, "label": text,
                              "why": strip_dep_refs(s.why), "inCycle": s.in_cycle}
                             for s, text in zip(state.sequence, analysis["sequence"])]
        analysis["notChecked"] = _not_checked(state.rule_coverage, snap)
        analysis["readiness"] = _readiness(snap, state, ready_statuses)
        if state.schedule:
            analysis["plan"] = _plan(state, snap, names, deps, settings)
        key = (state.ui.get("summary") or {}).get("key_risk") if state.ui else None
        if key or state.risks:
            analysis["keyRisk"] = key or rank_risks(state.risks)[0].title
    current = next((k for k, st in enumerate(states) if st != "done"), len(states))
    return {"run_id": run_id, "status": status, "error": error, "current": current,
            "initiative_ids": [i.id for i in state.initiatives] if state else [], "analysis": analysis,
            "review": _review(state) if state else {"approvals": [], "constraints": [], "exports": []},
            "flags": list(flags or [])}
