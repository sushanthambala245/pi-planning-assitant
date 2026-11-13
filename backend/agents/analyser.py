"""Initiative analyser: which systems each initiative touches, and in what role.

Deterministic, from the initiative's own text (S1) and the planner's note:

- declared: the initiative's dependency list (S1 `dependency`, "Upstream: A, B; Downstream: C").
  Upstream systems are ones it consumes (access "reads"); downstream systems consume its output
  (access "writes"). A declared system its own team owns is one it changes ("changes").
- mentioned: catalogue system names (S7) in its title, description or planner note that the list
  does not declare. Its own team's system counts as changed; another team's as "unclear".

The owning team of each system comes from the ownership map (S7), used as a lookup only. These
touches are evidence for the discovery tools: nothing here is a dependency yet.
"""

from __future__ import annotations

from collections import Counter

from agents.runtime import RunContext, node
from agents.state import AgentState, EvidenceRef, Initiative, SystemTouch
from tools.planning import parse_dependency_text
from tools.rule_extractor import sentences
from tools.text_tools import is_note, own_chunks
from tools.wording import plural


def clamp(x: float) -> float:
    return max(0.0, min(1.0, float(x)))


def _owner(ctx: RunContext, service: str) -> str | None:
    return (ctx.snapshot.service_row(service) or {}).get("owner_team") or None


def _analyse_one(ctx: RunContext, ini: Initiative) -> tuple[list[SystemTouch], list[str]]:
    resolver = ctx.snapshot.resolver
    chunks = own_chunks(ctx, ini)
    text_chunk = next((c for c in chunks if not is_note(c)), None)
    touches: dict[str, SystemTouch] = {}
    notes: list[str] = []

    up, down = parse_dependency_text(ini.dependency_text)
    for role, names in (("upstream", up), ("downstream", down)):
        for raw in names:
            service = resolver.service(raw).canonical
            if not service:
                notes.append(f"{ini.id}: declared {role} system {raw!r} is not in the ownership map, so its owner "
                             "is unknown")
                service = raw
            owner = _owner(ctx, service)
            access = "changes" if owner and owner == ini.owning_team else "reads" if role == "upstream" else "writes"
            quote = ini.dependency_text.strip()
            ev = EvidenceRef(ref=text_chunk.chunk_id if text_chunk else f"S1:{ini.id}",
                             source=text_chunk.source if text_chunk else "S1",
                             quote=quote if text_chunk and quote in text_chunk.text else "",
                             detail=f"access: {access}")
            if service not in touches:
                touches[service] = SystemTouch(initiative_id=ini.id, system=service, owner_team=owner, role=role,
                                               confidence=0.9, method="human", evidence=[ev])

    # Systems the text names but the list does not declare.
    for c in chunks:
        for sent in sentences(c.text):
            if sent.strip() == ini.dependency_text.strip():
                continue
            for service, _form in resolver.services.mentions(sent):
                if service in touches:
                    continue
                owner = _owner(ctx, service)
                access = "changes" if owner and owner == ini.owning_team else "unclear"
                touches[service] = SystemTouch(
                    initiative_id=ini.id, system=service, owner_team=owner, role="mentioned", confidence=0.6,
                    method="human" if is_note(c) else "rule",
                    evidence=[EvidenceRef(ref=c.chunk_id, source=c.source, quote=sent[:300], detail=f"access: {access}")])
    return sorted(touches.values(), key=lambda t: (t.role != "upstream", t.role != "downstream", t.system)), notes


@node("analyser", "Initiative analyser")
def analyse(state: AgentState, ctx: RunContext) -> dict:
    if not ctx.snapshot.has("S7"):
        ctx.warn("analyser", "S7 ownership lookup not loaded: the owners of declared systems are unknown")
    systems: list[SystemTouch] = []
    warnings: list[str] = []
    for ini in state.initiatives:
        touches, notes = _analyse_one(ctx, ini)
        systems.extend(touches)
        warnings.extend(notes)
        roles = Counter(t.role for t in touches)
        names = ", ".join(t.system for t in touches) or "no catalogue systems found"
        ctx.emit("finding", "analyser", tag="systems", initiative_ids=[ini.id],
                 text=f"{ini.title} touches {plural(len(touches), 'system')}: {names}",
                 sub=f"{roles['upstream']} declared upstream · {roles['downstream']} declared downstream · "
                     f"{roles['mentioned']} named in the text but not declared")
    for note in warnings:
        ctx.emit("warning", "analyser", message=note)
    ctx.emit("source_used", "analyser", source="S1", title="Roadmap initiatives", count=len(state.initiatives),
             unit="initiatives read (description and dependency list)")
    if ctx.snapshot.has("S7"):
        ctx.emit("source_used", "analyser", source="S7", title="Service ownership map",
                 count=len({t.system for t in systems}), unit="system owners looked up")
    return {"systems": systems, "warnings": warnings}
