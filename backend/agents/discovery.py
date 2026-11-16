"""Dependency Discovery: four evidence tools that run as a parallel fan-out.

1. declared  - the initiative's own dependency list (S1): one link per declared system. These are
               the user-defined dependencies; everything the other tools add is a hidden one.
2. explicit  - dependencies stated in the description or a planner note: "blocked on / requires",
               or another team named in the text. LLM extraction (which also catches "X will need
               this"), with a rule-based extractor when the LLM is unavailable (labelled).
3. code      - GitHub (S4): a repo of the initiative's team declares an internal dependency on a repo
               of another team that has its own initiative in the run, and something ties it to these
               two initiatives: the other one announces an interface change and the repo called is
               an api / contracts repo, or this one names a system the other team owns. A repo link
               with neither is only team-level (every initiative of one team against every initiative
               of the other): it is reported, not counted as a dependency. And shared libraries an
               initiative changes, which ripple to every team whose repos use them.
4. ownership - a system two initiatives in the run touch: the one whose team owns it goes first;
               and a system named in the text (not declared) that another team owns.

All four only propose candidates. The Evidence Verifier decides what survives.
"""

from __future__ import annotations

import contextvars
import re
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor
from itertools import combinations
from typing import Literal

from pydantic import BaseModel

from agents.analyser import clamp
from agents.runtime import RunContext, node
from agents.state import AgentState, Dependency, EvidenceRef, Initiative, SystemTouch
from tools.planning import INTERFACE, interface_word
from tools.rule_extractor import explicit_dependencies, sentences
from tools.text_tools import attributable, is_note, own_chunks, render_documents
from tools.wording import plural

RULE_CONFIDENCE = 0.55
MENTION_CONFIDENCE = 0.6
_INTERFACE_REPOS = {"api", "contracts", "contract", "shared_library", "library", "sdk"}
_LIB_PREFIX = re.compile(r"^[a-z]{2,4}-")
# Generic words in a library name, dropped before matching it in an initiative's text.
_LIB_GENERIC = {"client", "sdk", "kit", "utils", "util", "lib", "library", "models", "model", "testing", "common",
                "api"}


class ExplicitDep(BaseModel):
    target_kind: Literal["initiative", "team", "service"]
    target: str
    # depends_on: the focus initiative waits for the target. needed_by: the target waits for it.
    direction: Literal["depends_on", "needed_by"] = "depends_on"
    dep_type: Literal["blocked_on", "waiting_for", "requires", "sequenced_after", "other"]
    evidence_ref: str
    quote: str
    confidence: float


class ExplicitOut(BaseModel):
    dependencies: list[ExplicitDep]


def _target_id(kind: str, name: str) -> str:
    return name if kind == "initiative" else f"{kind}:{name}"




# -- 1. declared ---------------------------------------------------------------------------------

@node("declared_deps", "Declared dependencies")
def declared_deps(state: AgentState, ctx: RunContext) -> dict:
    deps = []
    for t in state.systems:
        if t.role not in ("upstream", "downstream"):
            continue
        to_id = f"service:{t.system}"
        deps.append(Dependency(id=Dependency.make_id(t.initiative_id, to_id, "declared"), from_id=t.initiative_id,
                               to_id=to_id, to_kind="service", kind="declared", dep_type=t.role, method="human",
                               confidence=0.9, declared=True, evidence=list(t.evidence)))
    ups = sum(d.dep_type == "upstream" for d in deps)
    ctx.emit("note", "declared_deps", text=f"{plural(len(deps), 'declared dependency', 'declared dependencies')} "
                                           f"from the initiatives' own lists ({ups} upstream, {len(deps) - ups} "
                                           "downstream)")
    return {"candidate_deps": deps}


# -- 2. explicit (text) ----------------------------------------------------------------------------

def _lists(ctx: RunContext, state: AgentState) -> str:
    """Stable across every call in the run, so it sits in the cached system prefix."""
    known = {i.id: i for i in ctx.snapshot.initiatives()}
    known.update({i.id: i for i in state.initiatives})
    inis = "\n".join(f"- {i.id} | {i.title} | team: {i.owning_team}" for i in known.values())
    teams = "\n".join(f"- {t} ({ctx.snapshot.team_name(t)})" for t in ctx.snapshot.resolver.teams.names)
    services = "\n".join(f"- {s}" for s in ctx.snapshot.resolver.services.names)
    return (f"<initiatives>\n{inis}\n</initiatives>\n<teams>\n{teams}\n</teams>\n"
            f"<services>\n{services}\n</services>")


def _resolve(ctx: RunContext, kind: str, raw: str) -> str | None:
    r = ctx.snapshot.resolver
    raw = re.sub(r"\s*\(.*\)$", "", raw.strip())  # "CBL-Posting-Engine (Posting Engine)" as listed
    return {"initiative": r.initiative, "team": r.team, "service": r.service}[kind](raw).canonical


def _team_mentions(ctx: RunContext, ini: Initiative, chunks) -> list[Dependency]:
    """Other teams named in the initiative's own text. One-word names ("Settlement") count only
    when written as a proper noun inside a sentence, so "payment settlement" does not match."""
    s6 = ctx.snapshot.table("S6")
    if s6.empty:
        return []
    names = {str(r.get("team_name") or ""): r["team"] for _, r in s6.iterrows() if r.get("team_name")}
    out: dict[str, Dependency] = {}
    for c in chunks:
        for sent in sentences(c.text):
            if sent.strip() == ini.dependency_text.strip():
                continue
            for name, team in names.items():
                if team == ini.owning_team or team in out:
                    continue
                for m in re.finditer(rf"(?<![A-Za-z]){re.escape(name)}(?![A-Za-z])", sent):
                    if len(name.split()) == 1 and not sent[:m.start()].strip():
                        continue  # a one-word name at the start of a sentence is just a capital letter
                    to_id = f"team:{team}"
                    out[team] = Dependency(
                        id=Dependency.make_id(ini.id, to_id, "explicit"), from_id=ini.id, to_id=to_id, to_kind="team",
                        kind="explicit", dep_type="mentioned", method="human" if is_note(c) else "rule",
                        confidence=MENTION_CONFIDENCE, declared=is_note(c), directed=False,
                        evidence=[EvidenceRef(ref=c.chunk_id, source=c.source, quote=sent[:400])])
                    break
    return list(out.values())


def _explicit_one(ctx: RunContext, state: AgentState, ini: Initiative, lists: str) -> tuple[list[Dependency], list[str]]:
    chunks = own_chunks(ctx, ini)
    deps: list[Dependency] = _team_mentions(ctx, ini, chunks)
    notes: list[str] = []
    run_ids = {i.id for i in state.initiatives}

    user = (f"<focus_initiative id=\"{ini.id}\" owning_team=\"{ini.owning_team}\">\n{ini.title}\n"
            f"</focus_initiative>\n\n{render_documents(chunks, ctx.snapshot.owner_of)}")
    out = ctx.structured(task="extract_dependencies", prompt="explicit_deps", stable_context=lists, user=user,
                         schema=ExplicitOut, node="explicit_deps")
    if out is not None:
        for e in out.dependencies:
            target = _resolve(ctx, e.target_kind, e.target)
            if not target:
                notes.append(f"{ini.id}: dependency on unknown {e.target_kind} {e.target!r} dropped")
                continue
            if not attributable(ctx, e.evidence_ref, ini.id):
                notes.append(f"{ini.id}: dependency on {target} dropped: its evidence {e.evidence_ref} belongs to "
                             "another initiative")
                continue
            if target == ini.id or (e.target_kind == "team" and target == ini.owning_team):
                continue
            chunk = ctx.chunk(e.evidence_ref)
            ev = EvidenceRef(ref=e.evidence_ref, source=chunk.source if chunk else "unknown", quote=e.quote)
            from_note = is_note(chunk)
            if e.direction == "needed_by" and e.target_kind == "initiative" and target in run_ids:
                frm, to_id, to_kind, dep_type = target, ini.id, "initiative", e.dep_type
            elif e.direction == "needed_by":
                frm, to_id, to_kind, dep_type = ini.id, _target_id(e.target_kind, target), e.target_kind, "needed_by"
            else:
                frm, to_id, to_kind, dep_type = ini.id, _target_id(e.target_kind, target), e.target_kind, e.dep_type
            deps.append(Dependency(
                id=Dependency.make_id(frm, to_id, "explicit"), from_id=frm, to_id=to_id, to_kind=to_kind,
                kind="explicit", dep_type=dep_type, method="human" if from_note else "llm",
                confidence=clamp(e.confidence), declared=from_note, directed=dep_type != "needed_by", evidence=[ev]))
        return deps, notes

    # Rule-based baseline (LLM disabled, over budget, or failed): labelled by method="rule".
    focus_names = [ini.id, ini.title, ini.owning_team]
    for r in explicit_dependencies(ctx.snapshot.resolver, chunks, ini.id, ini.owning_team, ctx.snapshot.owner_of,
                                   focus_names):
        to_id = _target_id(r.target_kind, r.target)
        from_note = is_note(r.chunk)
        deps.append(Dependency(
            id=Dependency.make_id(ini.id, to_id, "explicit"), from_id=ini.id, to_id=to_id, to_kind=r.target_kind,
            kind="explicit", dep_type=r.dep_type, method="human" if from_note else "rule",
            confidence=0.8 if from_note else RULE_CONFIDENCE, declared=from_note,
            evidence=[EvidenceRef(ref=r.chunk.chunk_id, source=r.chunk.source, quote=r.quote[:400])]))
    return deps, notes


@node("explicit_deps", "Dependencies stated in text")
def explicit_deps(state: AgentState, ctx: RunContext) -> dict:
    lists = _lists(ctx, state)
    with ThreadPoolExecutor(max_workers=ctx.settings.llm_max_concurrency) as pool:
        futures = [pool.submit(contextvars.copy_context().run, _explicit_one, ctx, state, ini, lists)
                   for ini in state.initiatives]
        results = [f.result() for f in futures]
    deps = [d for ds, _ in results for d in ds]
    notes = [n for _, ns in results for n in ns]
    for n in notes:
        ctx.emit("warning", "explicit_deps", message=n)
    by = defaultdict(int)
    for d in deps:
        by[d.method] += 1
    ctx.emit("note", "explicit_deps", text=f"{len(deps)} candidate(s) from descriptions and notes ({by['llm']} by "
                                           f"LLM extraction, {by['rule']} by rules, {by['human']} from planner notes)")
    return {"candidate_deps": deps, "warnings": notes}


# -- 3. code (GitHub) ----------------------------------------------------------------------------

def _lib_core(lib: str) -> list[str]:
    """The words that name a library (hfg-event-schema -> event, schema), generic ones dropped. If
    all that is left is one interface word, every word counts: hfg-api-contract-testing needs "API
    contract testing", so an initiative that only says "the new API contract" does not change it."""
    words = [w for w in _LIB_PREFIX.sub("", lib.lower()).split("-") if w]
    core = [w for w in words if w not in _LIB_GENERIC]
    if len(core) == 1 and INTERFACE.fullmatch(core[0]):
        return words
    return core or words


def _stem(w: str) -> str:
    w = w.lower()
    if w.endswith("ies") and len(w) > 4:
        return w[:-3] + "y"
    if w.endswith("s") and not w.endswith("ss") and len(w) > 3:
        return w[:-1]
    return w


def library_change(ini: Initiative, lib: str) -> str | None:
    """The phrase in the initiative's text that says it changes a shared library, or None.

    The library's core words (hfg-event-schema -> "event schema") must all appear within a short
    window, and the text must also use an interface word (upgrade, version, schema ...). A one-word
    core counts only if it is distinctive (eight letters or more, e.g. "idempotency")."""
    core = [_stem(w) for w in _lib_core(lib)]
    if not core or (len(core) == 1 and len(core[0]) < 8):
        return None
    text = f"{ini.title}. {ini.description}"
    if not INTERFACE.search(text) and len(core) > 1:
        return None
    words = re.findall(r"[A-Za-z0-9]+", text)
    stems = [_stem(w) for w in words]
    window = len(core) + 2
    for i, st in enumerate(stems):
        if st not in core:
            continue
        span = stems[i:i + window]
        if all(c in span for c in core):
            last = max(i + span.index(c) for c in core)
            return " ".join(words[i:last + 1])
    return None


@node("code_deps", "Code-inferred dependencies")
def code_deps(state: AgentState, ctx: RunContext) -> dict:
    snap = ctx.snapshot
    if not snap.has("S4"):
        ctx.emit("note", "code_deps", text="GitHub repositories (S4) not loaded: code dependencies skipped")
        return {"warnings": ["S4 not loaded: code-inferred dependencies were not evaluated"]}
    by_team: dict[str, list[Initiative]] = defaultdict(list)
    for i in state.initiatives:
        by_team[i.owning_team].append(i)
    # The other teams' systems each initiative builds on (declared upstream or named in its text).
    builds_on: dict[str, dict[str, str]] = defaultdict(dict)  # initiative -> {owner team: one such system}
    for t in state.systems:
        owner = t.owner_team or (snap.service_row(t.system) or {}).get("owner_team")
        if owner and t.role in ("upstream", "mentioned"):
            builds_on[t.initiative_id].setdefault(owner, t.system)
    team_only: dict[tuple[str, str], set[tuple[str, str]]] = defaultdict(set)  # (team, other team) -> pairs
    deps: dict[str, Dependency] = {}
    for a in state.initiatives:
        for repo in snap.repos_of_team(a.owning_team):
            for dep_repo in repo.get("internal_dependencies") or []:
                row = snap.repo_row(dep_repo) or {}
                owner = row.get("owner_team")
                if not owner or owner == a.owning_team:
                    continue
                kind_of = str(row.get("repo_type") or "").lower()
                status = str(row.get("status") or "")
                system = builds_on[a.id].get(owner)
                for b in by_team.get(owner, []):
                    if b.id == a.id:
                        continue
                    word = interface_word(b.title, b.description, snap.resolver)
                    interface = kind_of in _INTERFACE_REPOS and word is not None
                    if not interface and not system:
                        # The teams' code is coupled, but nothing ties it to these two initiatives.
                        team_only[(a.owning_team, owner)].add((a.id, b.id))
                        continue
                    did = Dependency.make_id(a.id, b.id, "code")
                    ev = EvidenceRef(
                        ref=f"S4:{repo['repo']}", source="S4",
                        detail=(f"{repo['repo']} ({a.owning_team}) declares an internal dependency on {dep_repo} "
                                f"({kind_of or 'repo'}{', ' + status if status and status.lower() != 'active' else ''}"
                                f"), owned by {owner}"
                                + (f"; {b.id}'s text mentions an interface change (“{word}”)" if interface
                                   else "")))
                    d = deps.get(did)
                    if d is None:
                        deps[did] = Dependency(
                            id=did, from_id=a.id, to_id=b.id, to_kind="initiative", kind="code",
                            dep_type="interface_change" if interface else "code_coupling", directed=interface,
                            method="structural", confidence=0.7 if interface else 0.6, evidence=[ev])
                    else:
                        if ev not in d.evidence:
                            d.evidence.append(ev)
                        if interface and d.dep_type != "interface_change":
                            d.dep_type, d.directed, d.confidence = "interface_change", True, 0.7
                    uses = EvidenceRef(ref=f"S7:{system}", source="S7",
                                       detail=f"{a.title} builds on {system}, which {owner} owns")
                    if system and uses not in deps[did].evidence:
                        deps[did].evidence.append(uses)

    # Shared libraries an initiative changes: every other team whose repos use the library re-tests.
    users: dict[str, dict[str, str]] = defaultdict(dict)  # library -> {team: one repo of it that uses it}
    s4 = snap.table("S4")
    if "shared_libraries" in s4.columns:
        for _, r in s4.iterrows():
            for lib in r.get("shared_libraries") or []:
                users[lib].setdefault(r["owner_team"], r["repo"])
    libs = 0
    for a in state.initiatives:
        for lib, teams in sorted(users.items()):
            phrase = library_change(a, lib)
            others = sorted(t for t in teams if t and t != a.owning_team)
            if not phrase or not others:
                continue
            in_run = sorted({i.id for t in others for i in by_team.get(t, []) if i.id != a.id})
            to_id = f"library:{lib}"
            libs += 1
            deps[Dependency.make_id(a.id, to_id, "library")] = Dependency(
                id=Dependency.make_id(a.id, to_id, "library"), from_id=a.id, to_id=to_id, to_kind="library",
                kind="library", dep_type="shared_library_change", directed=False, method="structural",
                confidence=0.6,
                evidence=[EvidenceRef(ref=f"S1:{a.id}", source="S1",
                                      detail=f"{a.title} changes {lib} (its text says “{phrase}”); "
                                             f"{plural(len(others), 'other team')} use it: "
                                             f"{', '.join(snap.team_name(t) for t in others)}"
                                             + (f", with {plural(len(in_run), 'initiative')} in this run "
                                                f"({', '.join(in_run)})" if in_run else ""))]
                + [EvidenceRef(ref=f"S4:{users[lib][t]}", source="S4",
                               detail=f"{users[lib][t]} ({snap.team_name(t)}) declares {lib}") for t in others])
    n_code = sum(d.kind == "code" for d in deps.values())
    ctx.emit("note", "code_deps", text=f"{n_code} code link(s) between initiatives from repo manifests, "
                                       f"{plural(libs, 'shared-library change')}")
    kept = {(d.from_id, d.to_id) for d in deps.values() if d.kind == "code"}
    loose = {k: v - kept for k, v in team_only.items() if v - kept}
    if loose:
        n_pairs = sum(len(v) for v in loose.values())
        ctx.emit("note", "code_deps", text=(
            f"{plural(len(loose), 'team pair')} linked by code only ({plural(n_pairs, 'initiative pair')}): one team's "
            "repos call the other's, but neither initiative names the other team's systems or an interface change, "
            "so they are not counted as dependencies. Those teams re-test when the other ships."))
    titles = {i.id: i.title for i in state.initiatives}
    for d in deps.values():
        if d.kind == "code":
            ctx.emit("finding", "code_deps", tag="inferred", initiative_ids=[d.from_id, d.to_id],
                     dep_key=f"{d.from_id}->{d.to_id}",
                     text=f"{titles.get(d.from_id, d.from_id)} depends on {titles.get(d.to_id, d.to_id)} through code",
                     sub=d.evidence[0].detail)
    ctx.emit("source_used", "code_deps", source="S4", title="GitHub repositories", count=len(s4),
             unit="repositories checked")
    return {"candidate_deps": list(deps.values())}


# -- 4. ownership (shared systems) ---------------------------------------------------------------

@node("ownership_deps", "Shared-system dependencies")
def ownership_deps(state: AgentState, ctx: RunContext) -> dict:
    snap = ctx.snapshot
    if not snap.has("S7"):
        ctx.emit("note", "ownership_deps", text="Ownership lookup (S7) not loaded: shared-system dependencies skipped")
        return {"warnings": ["S7 not loaded: shared-system dependencies were not evaluated"]}
    by_id = {i.id: i for i in state.initiatives}
    users: dict[str, list[SystemTouch]] = defaultdict(list)
    for s in state.systems:
        users[s.system].append(s)
    deps: list[Dependency] = []

    for service, touches in sorted(users.items()):
        owner = (snap.service_row(service) or {}).get("owner_team") or ""
        record = EvidenceRef(ref=f"S7:{service}", source="S7", detail=f"{service} owned by {owner or '(no owner)'}")
        role = {t.initiative_id: t.role for t in touches}
        quotes = {t.initiative_id: t.evidence[:1] for t in touches}
        inis = sorted(role)
        owning = [i for i in inis if owner and by_id[i].owning_team == owner]
        others = [i for i in inis if i not in owning]
        pairs: list[tuple[str, str, str, bool]] = []
        for c in others:
            for p in owning:
                # A consumer waits for the owner's change; a producer into the system agrees the contract.
                directed = role[c] in ("upstream", "mentioned")
                pairs.append((c, p, "provider_changes" if directed else "shared_service", directed))
        if not owning:  # nobody in the run owns it: teams that share it coordinate (a team does so internally)
            pairs += [(a, b, "shared_service", False) for a, b in combinations(inis, 2)
                      if by_id[a].owning_team != by_id[b].owning_team]
        for a, b, dep_type, directed in pairs:
            if dep_type == "provider_changes":
                detail = (f"{by_id[b].title} changes {service} (its team, {owner}, owns it) and {by_id[a].title} "
                          f"{'consumes' if role[a] == 'upstream' else 'uses'} it, so {by_id[b].title} lands first")
            else:
                detail = (f"{by_id[a].title} and {by_id[b].title} both touch {service}"
                          + (f", which {owner} owns" if owner else " and nobody owns it")
                          + ": their changes must be coordinated")
            deps.append(Dependency(
                id=Dependency.make_id(a, b, "ownership"), from_id=a, to_id=b, to_kind="initiative", kind="ownership",
                dep_type=dep_type, directed=directed, method="structural",
                confidence=0.7 if directed else 0.65,
                evidence=[EvidenceRef(ref=record.ref, source="S7", detail=detail), *quotes[a], *quotes[b]]))
            ctx.emit("finding", "ownership_deps", tag="inferred", text=detail, initiative_ids=[a, b],
                     dep_key=f"{a}->{b}", sub="Not declared by either initiative: found through the systems they share")

        # A system the text names (not declared) that another team owns: the initiative depends on that team.
        for t in touches:
            ini = by_id[t.initiative_id]
            if t.role == "mentioned" and owner and owner != ini.owning_team:
                to_id = f"service:{service}"
                deps.append(Dependency(
                    id=Dependency.make_id(ini.id, to_id, "ownership"), from_id=ini.id, to_id=to_id, to_kind="service",
                    kind="ownership", dep_type="owned_by_other_team", method="structural",
                    confidence=MENTION_CONFIDENCE, declared=t.method == "human",
                    evidence=[EvidenceRef(ref=record.ref, source="S7",
                                          detail=f"{ini.title} names {service}, owned by {owner}, without declaring it"),
                              *t.evidence[:1]]))

    merged: dict[str, Dependency] = {}
    for d in deps:
        if d.id in merged:
            m = merged[d.id]
            m.evidence.extend(e for e in d.evidence if e not in m.evidence)
            if d.directed and not m.directed:
                m.directed, m.dep_type, m.confidence = True, d.dep_type, d.confidence
        else:
            merged[d.id] = d
    ctx.emit("note", "ownership_deps", text=f"{len(merged)} shared-system candidate(s)")
    return {"candidate_deps": list(merged.values())}
