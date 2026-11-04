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

from agents.state import AgentState, EvidenceRef, Initiative, Risk
from agents.visualisation import link_in_jira, links, rank_risks
from context.snapshot import ContextSnapshot
from context.sources import SOURCES
from tools.dep_classify import CHANGE_LABELS, CHANGE_RANK, access, classify, corroboration, owner_team
from tools.dri_rules import DRI_CODES
from tools.wording import plural, strip_dep_refs

# The UI's agents in pipeline order, and the graph nodes each one covers (agents/graph.py).
# human_gate and export are not shown: the run is complete for the UI once it awaits review.
AGENTS = [
    {"id": "analyser", "name": "Initiative analyser", "icon": "ti-file-search", "nodes": ("load_context", "analyser"),
     "sources": ("S1", "S2", "S3", "M1", "S7"),
     "summary": "Finds the shared systems each initiative touches, from its own text, its epics and retrieved "
                "documents, matched against the service catalogue."},
    {"id": "discovery", "name": "Dependency discovery", "icon": "ti-search",
     "nodes": ("explicit_deps", "code_deps", "ownership_deps"), "sources": ("S2", "S3", "M1", "M3", "S4", "S7"),
     "summary": "Three evidence tools run in parallel: dependency statements in text, repo-to-repo declarations in "
                "code manifests, and services that are shared or owned by another team."},
    {"id": "verifier", "name": "Evidence verifier", "icon": "ti-shield-check", "nodes": ("merge", "verify", "requery"),
     "sources": ("S10",),
     "summary": "Merges the candidates, rejects any without citable evidence, marks weak ones as low confidence, "
                "and checks which are already linked in Jira."},
    {"id": "sequencing", "name": "Sequencing", "icon": "ti-list-numbers", "nodes": ("sequencing",), "sources": ("S5",),
     "summary": "Orders the initiatives by a topological sort of the verified dependencies (a cycle becomes one "
                "flagged step) and checks each team's load against its capacity."},
    {"id": "risk", "name": "Risk", "icon": "ti-alert-triangle", "nodes": ("risk",),
     "sources": ("S5", "S7", "S8", "M1", "M2", "M3"),
     "summary": "Applies the Dependency Risk Index rules (DRI-X-001 to 008) and calibrates their severity against "
                "past PI outcomes."},
    {"id": "visualisation", "name": "Visualisation", "icon": "ti-chart-dots", "nodes": ("visualisation",),
     "sources": ("S9", "S10"),
     "summary": "Builds the dependency graph, the summary numbers and the executive summary."},
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
        """(label, domain) for a graph node id: an initiative id, team:<name> or service:<name>."""
        kind, _, name = node_id.partition(":")
        if kind == "team":
            return self.team(name), self.art(name)
        if kind == "service":
            return name, self.art((self.snap.service_row(name) or {}).get("owner_team"))
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
        return (f"{c.team}: the selected work alone fills {c.load_pct:g}% of its {c.pi} capacity (existing "
                "commitments are not in the data, so the real load is higher)")
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
        how = "written by the LLM" if state.ui["summary"]["method"] == "llm" else "template text"
        return [f"Dependency graph, summary numbers and executive summary ({how})"]
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
             "art": i.art or names.art(i.owning_team), "pi": i.target_pi or ""} for i in state.initiatives]


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
        top_dep, top = max(parts, key=lambda p: CHANGE_RANK[p[1].change])
        own = {m.id for m in members}
        also = sorted({f"{by_id[r].from_id}->{by_id[r].to_id}" for m in members for r in corr[m.id]["related"]
                       if r not in own})
        team = owner_team(top_dep, state, snap)
        in_jira = [m.in_jira for m in members]
        evidence = list({e["text"]: e for e in (_evidence(e) for m in members for e in m.evidence)}.values())
        rows.append({
            "key": f"{a}->{b}", "from": a, "fromLabel": names.label(a), "to": b, "toLabel": names.label(b),
            "level": top.level, "toTeam": "" if team.startswith("service:") or team == b else names.team(team),
            "changeType": top.change, "changeLabel": CHANGE_LABELS[top.change], "reason": top.reason,
            "why": [{"method": m.kind, "changeType": c.change, "text": c.reason} for m, c in parts],
            "methods": sorted({m.kind for m in members}), "inferred": all(m.kind != "explicit" for m in members),
            "verdict": corr[members[0].id]["verdict"], "alsoFoundAs": also, "path": top.path,
            "evidence": evidence[:6], "evidenceCount": sum(len(m.evidence) for m in members),
            "confidence": round(max(m.confidence for m in members), 2),
            "status": "verified" if any(m.status == "verified" for m in members) else "low_confidence",
            "inJira": True if True in in_jira else False if in_jira and all(x is False for x in in_jira) else None,
            "dependencyIds": [m.id for m in members]})
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
    they depend on around them. One edge per dependency row; it counts as explicit if any of
    its dependencies was stated in text, inferred if all came from code or ownership."""
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
                                       "changeType": r["changeType"], "key": r["key"]} for r in deps]}


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


def _not_checked(coverage: dict[str, str]) -> list[dict]:
    """Risk checks that did not run (a source is missing) or ran on partial data, in words."""
    out = []
    for code, v in sorted(coverage.items()):
        name = DRI_CODES.get(code, "Severity calibration against past PIs" if code == "history" else code)
        if v.startswith("skipped"):
            m = _SKIPPED.match(v)
            if m:
                ids = [s.strip() for s in m.group(1).split(",")]
                reason = (f"Needs {', '.join(_source_label(s) for s in ids)}, which "
                          f"{'is' if len(ids) == 1 else 'are'} not loaded")
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


def build_analysis(run_id: str, status: str, error: str | None, state: AgentState | None, events: list[dict],
                   snap: ContextSnapshot, flags: list[str] | None = None) -> dict:
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
        analysis["notChecked"] = _not_checked(state.rule_coverage)
        key = (state.ui.get("summary") or {}).get("key_risk") if state.ui else None
        if key or state.risks:
            analysis["keyRisk"] = key or rank_risks(state.risks)[0].title
    current = next((k for k, st in enumerate(states) if st != "done"), len(states))
    return {"run_id": run_id, "status": status, "error": error, "current": current,
            "initiative_ids": [i.id for i in state.initiatives] if state else [], "analysis": analysis,
            "review": _review(state) if state else {"approvals": [], "constraints": [], "exports": []},
            "flags": list(flags or [])}
