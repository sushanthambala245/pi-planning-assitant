"""Dependency Discovery: three evidence tools that run as a parallel fan-out.

1. explicit  - "blocked on / waiting for" statements in text (S2 S3 M3 M1). LLM extraction,
               or the rule-based extractor when the LLM is unavailable (labelled).
2. code      - repo -> repo declared dependencies (S4) become team/initiative edges.
3. ownership - two initiatives touching one service, or a service owned by another
               team (S7 + the analyser's systems).

All three only propose candidates. The Evidence Verifier decides what survives.
"""

from __future__ import annotations

import contextvars
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor
from itertools import combinations
from typing import Literal

from pydantic import BaseModel

from agents.analyser import clamp
from agents.runtime import RunContext, node
from agents.state import AgentState, Dependency, EvidenceRef, Initiative
from tools.rule_extractor import explicit_dependencies
from tools.text_tools import attributable, gather, render_documents

RULE_CONFIDENCE = 0.55


class ExplicitDep(BaseModel):
    target_kind: Literal["initiative", "team", "service"]
    target: str
    dep_type: Literal["blocked_on", "waiting_for", "requires", "sequenced_after", "other"]
    evidence_ref: str
    quote: str
    confidence: float


class ExplicitOut(BaseModel):
    dependencies: list[ExplicitDep]


def _target_id(kind: str, name: str) -> str:
    return name if kind == "initiative" else f"{kind}:{name}"


def _lists(ctx: RunContext, state: AgentState) -> str:
    """Stable across every call in the run, so it sits in the cached system prefix."""
    known = {i.id: i for i in ctx.snapshot.initiatives()}
    known.update({i.id: i for i in state.initiatives})
    inis = "\n".join(f"- {i.id} | {i.title} | team: {i.owning_team}" for i in known.values())
    teams = "\n".join(f"- {t}" for t in ctx.snapshot.resolver.teams.names)
    services = "\n".join(f"- {s}" for s in ctx.snapshot.resolver.services.names)
    return (f"<initiatives>\n{inis}\n</initiatives>\n<teams>\n{teams}\n</teams>\n"
            f"<services>\n{services}\n</services>")


def _resolve(ctx: RunContext, kind: str, raw: str) -> str | None:
    r = ctx.snapshot.resolver
    return {"initiative": r.initiative, "team": r.team, "service": r.service}[kind](raw).canonical


def _explicit_one(ctx: RunContext, state: AgentState, ini: Initiative, lists: str) -> tuple[list[Dependency], list[str]]:
    systems = [s.system for s in state.systems if s.initiative_id == ini.id]
    chunks = gather(ctx, ini, systems + [ini.owning_team], sources=("S2", "S3", "M3", "M1"),
                    k=ctx.settings.retrieval_k + 2)
    deps: list[Dependency] = []
    notes: list[str] = []

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
            to_id = _target_id(e.target_kind, target)
            chunk = ctx.chunk(e.evidence_ref)
            deps.append(Dependency(
                id=Dependency.make_id(ini.id, to_id, "explicit"), from_id=ini.id, to_id=to_id,
                to_kind=e.target_kind, kind="explicit", dep_type=e.dep_type, method="llm",
                confidence=clamp(e.confidence),
                evidence=[EvidenceRef(ref=e.evidence_ref, source=chunk.source if chunk else "unknown", quote=e.quote)]))
        return deps, notes

    # Rule-based baseline (LLM disabled, over budget, or failed): labelled by method="rule".
    focus_names = [ini.id, ini.title, ini.owning_team, *ctx.snapshot.epic_keys_for(ini.id)]
    for r in explicit_dependencies(ctx.snapshot.resolver, chunks, ini.id, ini.owning_team, ctx.snapshot.owner_of,
                                   focus_names):
        to_id = _target_id(r.target_kind, r.target)
        deps.append(Dependency(
            id=Dependency.make_id(ini.id, to_id, "explicit"), from_id=ini.id, to_id=to_id, to_kind=r.target_kind,
            kind="explicit", dep_type=r.dep_type, method="rule", confidence=RULE_CONFIDENCE,
            evidence=[EvidenceRef(ref=r.chunk.chunk_id, source=r.chunk.source, quote=r.quote[:400])]))
    return deps, notes


@node("explicit_deps", "Explicit dependencies")
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
    n_llm = sum(d.method == "llm" for d in deps)
    ctx.emit("note", "explicit_deps", text=f"{len(deps)} explicit dependency candidate(s) from text "
                                           f"({n_llm} by LLM extraction, {len(deps) - n_llm} by the rule-based extractor)")
    return {"candidate_deps": deps, "warnings": notes}


@node("code_deps", "Code-inferred dependencies")
def code_deps(state: AgentState, ctx: RunContext) -> dict:
    snap = ctx.snapshot
    if not snap.has("S4"):
        ctx.emit("note", "code_deps", text="GitHub repos (S4) not loaded: code-inferred dependencies skipped")
        return {"warnings": ["S4 not loaded: code-inferred dependencies were not evaluated"]}
    touches = defaultdict(set)
    for s in state.systems:
        touches[s.initiative_id].add(s.system)
    deps: dict[str, Dependency] = {}
    for ini in state.initiatives:
        for service in sorted(touches[ini.id]):
            for repo in snap.repos_for_service(service):
                row = snap.repo_row(repo) or {}
                for dep_repo in row.get("internal_dependencies") or []:
                    dep_row = snap.repo_row(dep_repo) or {}
                    owner = dep_row.get("owner_team")
                    if not owner or owner == ini.owning_team:
                        continue
                    # A provider is an initiative in this run whose own team owns dep_repo and that
                    # changes one of its services; otherwise the dependency is on the owning team.
                    provided = set(snap.services_for_repo(dep_repo))
                    providers = [o for o in state.initiatives
                                 if o.id != ini.id and o.owning_team == owner and touches[o.id] & provided]
                    targets = [(o.id, "initiative") for o in providers] or [(f"team:{owner}", "team")]
                    for to_id, kind in targets:
                        did = Dependency.make_id(ini.id, to_id, "code")
                        ev = EvidenceRef(ref=f"S4:{repo}", source="S4",
                                         detail=f"{repo} (behind {service}) declares an internal dependency on "
                                                f"{dep_repo}, owned by {owner}")
                        if did in deps:
                            if ev not in deps[did].evidence:
                                deps[did].evidence.append(ev)
                        else:
                            deps[did] = Dependency(id=did, from_id=ini.id, to_id=to_id, to_kind=kind, kind="code",
                                                   dep_type="code_dependency", method="structural", confidence=0.7,
                                                   evidence=[ev])
    ctx.emit("note", "code_deps", text=f"{len(deps)} code-inferred dependency candidate(s) from repo manifests")
    titles = {i.id: i.title for i in state.initiatives}
    for d in deps.values():
        target = titles.get(d.to_id) or (snap.team_row(d.to_id.removeprefix("team:")) or {}).get("team_name") \
            or d.to_id.removeprefix("team:")
        ctx.emit("finding", "code_deps", tag="inferred",
                 initiative_ids=[d.from_id] + ([d.to_id] if d.to_kind == "initiative" else []),
                 dep_key=f"{d.from_id}->{d.to_id}",
                 text=f"{titles.get(d.from_id, d.from_id)} depends on {target} through code ({d.from_id})",
                 sub=d.evidence[0].detail)
    return {"candidate_deps": list(deps.values())}


@node("ownership_deps", "Ownership-inferred dependencies")
def ownership_deps(state: AgentState, ctx: RunContext) -> dict:
    snap = ctx.snapshot
    if not snap.has("S7"):
        ctx.emit("note", "ownership_deps", text="Ownership map (S7) not loaded: ownership dependencies skipped")
        return {"warnings": ["S7 not loaded: ownership-inferred dependencies were not evaluated"]}
    by_id = {i.id: i for i in state.initiatives}
    users: dict[str, list] = defaultdict(list)
    for s in state.systems:
        users[s.system].append(s)
    deps: list[Dependency] = []

    for service, touches in sorted(users.items()):
        owner = (snap.service_row(service) or {}).get("owner_team") or ""
        record = EvidenceRef(ref=f"S7:{service}", source="S7", detail=f"{service} owned by {owner or '(no owner)'}")
        inis = sorted({t.initiative_id for t in touches})
        quotes = {t.initiative_id: t.evidence[:1] for t in touches}

        # Shared service between initiatives in this run.
        owning = [i for i in inis if by_id[i].owning_team == owner and owner]
        others = [i for i in inis if i not in owning]
        if owning and others:
            pairs = [(o, p, True) for o in others for p in owning]
        else:
            pairs = [(a, b, False) for a, b in combinations(inis, 2)]
        for a, b, directed in pairs:
            detail = (f"{by_id[a].title} and {by_id[b].title} both touch {service}"
                      + (f"; {by_id[b].owning_team} owns it, so its change lands first" if directed
                         else " and neither owns it, so their changes must be coordinated"))
            deps.append(Dependency(
                id=Dependency.make_id(a, b, "ownership"), from_id=a, to_id=b, to_kind="initiative", kind="ownership",
                dep_type="shared_service", directed=directed, method="structural", confidence=0.65,
                evidence=[EvidenceRef(ref=record.ref, source="S7", detail=detail), *quotes[a], *quotes[b]]))
            ctx.emit("finding", "ownership_deps", tag="inferred", text=detail, initiative_ids=[a, b],
                     dep_key=f"{a}->{b}",
                     sub="✦ Not stated in either initiative — inferred from the ownership map")

        # A service owned by another team: the initiative depends on that team.
        for t in touches:
            ini = by_id[t.initiative_id]
            if owner and owner != ini.owning_team:
                to_id = f"team:{owner}"
                deps.append(Dependency(
                    id=Dependency.make_id(ini.id, to_id, "ownership"), from_id=ini.id, to_id=to_id, to_kind="team",
                    kind="ownership", dep_type="owned_by_other_team", method="structural", confidence=0.6,
                    evidence=[EvidenceRef(ref=record.ref, source="S7",
                                          detail=f"{ini.title} touches {service}, owned by {owner}"), *t.evidence[:1]]))

    # Merge duplicates (one initiative can reach the same team through several services).
    merged: dict[str, Dependency] = {}
    for d in deps:
        if d.id in merged:
            merged[d.id].evidence.extend(e for e in d.evidence if e not in merged[d.id].evidence)
        else:
            merged[d.id] = d
    ctx.emit("note", "ownership_deps", text=f"{len(merged)} ownership-inferred dependency candidate(s)")
    return {"candidate_deps": list(merged.values())}
