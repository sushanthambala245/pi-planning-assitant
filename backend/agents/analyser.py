"""Initiative Analyser: which shared systems does each initiative touch?

Rule baseline: catalogue service names mentioned in the initiative's own text, epics and
retrieved docs. LLM pass (structured extraction + RAG) adds systems the text implies,
each with a document id and a verbatim quote. An LLM pick is kept only if the system is
in the S7 catalogue and its quote is verified in a document returned in this run.
"""

from __future__ import annotations

import contextvars
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from typing import Literal

from pydantic import BaseModel

from agents.runtime import RunContext, node
from agents.state import AgentState, EvidenceRef, Initiative, SystemTouch
from context.sources import SOURCES
from tools.wording import plural
from tools.citations import check_evidence
from tools.rule_extractor import system_mentions
from tools.text_tools import attributable, gather, owned_by, render_documents


class SystemPick(BaseModel):
    system: str
    access: Literal["writes", "reads", "changes", "unclear"]
    evidence_ref: str
    quote: str
    confidence: float


class AnalyserOut(BaseModel):
    systems: list[SystemPick]


def clamp(x: float) -> float:
    return max(0.0, min(1.0, float(x)))


def service_catalogue(ctx: RunContext) -> str:
    s7 = ctx.snapshot.table("S7")
    if s7.empty:
        return ""
    lines = []
    for _, r in s7.iterrows():
        bits = [r["service"]]
        for col in ("capability", "api", "dataset", "owner_team", "status"):
            if r.get(col):
                bits.append(f"{col}: {r[col]}")
        lines.append("- " + " | ".join(bits))
    return "<service_catalogue>\n" + "\n".join(lines) + "\n</service_catalogue>"


def _analyse_one(ctx: RunContext, ini: Initiative, catalogue: str) -> tuple[list[SystemTouch], list[str], Counter]:
    chunks = gather(ctx, ini, [], sources=("M1", "S2", "S3"))
    used = Counter(c.source for c in chunks)
    touches: dict[str, SystemTouch] = {}
    notes: list[str] = []

    def owner(service: str) -> str | None:
        return (ctx.snapshot.service_row(service) or {}).get("owner_team") or None

    # Rule baseline reads only the initiative's own text (its row, epics, statements).
    own = [c for c in chunks if owned_by(ctx, c, ini.id)]
    for service, chunk, sentence in system_mentions(ctx.snapshot.resolver, own):
        touches[service] = SystemTouch(
            initiative_id=ini.id, system=service, owner_team=owner(service), confidence=0.6, method="rule",
            evidence=[EvidenceRef(ref=chunk.chunk_id, source=chunk.source, quote=sentence[:300])])

    if catalogue:
        user = (f"<initiative id=\"{ini.id}\" owning_team=\"{ini.owning_team}\" target_pi=\"{ini.target_pi or ''}\">\n"
                f"{ini.title}\n</initiative>\n\n{render_documents(chunks, ctx.snapshot.owner_of)}")
        out = ctx.structured(task="analyse_initiative", prompt="analyser", stable_context=catalogue, user=user,
                             schema=AnalyserOut, node="analyser")
        for pick in out.systems if out else []:
            service = ctx.snapshot.resolver.service(pick.system).canonical
            if not service:
                notes.append(f"{ini.id}: LLM named {pick.system!r}, which is not in the service catalogue (dropped)")
                continue
            chunk = ctx.chunk(pick.evidence_ref)
            ev = EvidenceRef(ref=pick.evidence_ref, source=chunk.source if chunk else "unknown", quote=pick.quote,
                             detail=f"access: {pick.access}")
            ok, why = check_evidence(ev, ctx)
            if ok and not attributable(ctx, ev.ref, ini.id):
                ok, why = False, f"{ev.ref} belongs to another initiative"
            if not ok:
                notes.append(f"{ini.id}: LLM claim that it touches {service} dropped ({why})")
                continue
            t = touches.get(service)
            if t is None:
                touches[service] = SystemTouch(initiative_id=ini.id, system=service, owner_team=owner(service),
                                               confidence=clamp(pick.confidence), method="llm", evidence=[ev])
            else:
                t.method, t.confidence = "llm", max(t.confidence, clamp(pick.confidence))
                t.evidence.append(ev)
    return sorted(touches.values(), key=lambda t: t.system), notes, used


@node("analyser", "Initiative analyser")
def analyse(state: AgentState, ctx: RunContext) -> dict:
    catalogue = service_catalogue(ctx)
    if not catalogue:
        ctx.warn("analyser", "S7 service ownership map not loaded: systems cannot be identified")
    with ThreadPoolExecutor(max_workers=ctx.settings.llm_max_concurrency) as pool:
        futures = [pool.submit(contextvars.copy_context().run, _analyse_one, ctx, ini, catalogue)
                   for ini in state.initiatives]
        results = [f.result() for f in futures]

    systems: list[SystemTouch] = []
    used: Counter = Counter()
    warnings: list[str] = []
    for ini, (touches, notes, src) in zip(state.initiatives, results):
        systems.extend(touches)
        used.update(src)
        warnings.extend(notes)
        names = ", ".join(t.system for t in touches) or "no catalogue systems found"
        ctx.emit("finding", "analyser", tag="systems", initiative_ids=[ini.id],
                 text=f"{ini.title} touches {plural(len(touches), 'shared system')}: {names}",
                 sub=f"{sum(t.method == 'llm' for t in touches)} found by the LLM, "
                     f"{sum(t.method == 'rule' for t in touches)} by name match")
    for note in warnings:
        ctx.emit("warning", "analyser", message=note)
    for sid, n in sorted(used.items()):
        title = SOURCES[sid].title if sid in SOURCES else sid
        ctx.emit("source_used", "analyser", source=sid, title=title, count=n, unit="chunks read")
    return {"systems": systems, "warnings": warnings}
