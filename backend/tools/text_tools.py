"""Evidence assembly: which documents an agent reads for an initiative.

Every chunk handed to a model, or used as rule-based evidence, is registered as observed
in the run, so later citations can be checked against what was actually retrieved.
"""

from __future__ import annotations

from agents.runtime import RunContext
from agents.state import Initiative
from context.index import Chunk

MAX_EVIDENCE_CHARS = 14000


def initiative_chunks(ctx: RunContext, ini: Initiative) -> list[Chunk]:
    """The initiative's own text: S1 row chunks, or a run-local chunk for uploads/manual entries."""
    chunks = ctx.snapshot.index.doc_chunks(f"S1:{ini.id}")
    if chunks:
        return chunks
    text = "\n\n".join(t for t in (ini.title, ini.description) if t)
    c = Chunk(f"INIT:{ini.id}#0", f"INIT:{ini.id}", ini.origin, ini.id, ini.title, text)
    ctx.add_chunk(c)
    return [c]


def epic_chunks(ctx: RunContext, ini: Initiative) -> list[Chunk]:
    out = []
    for key in sorted(ctx.snapshot.epic_keys_for(ini.id)):
        out.extend(ctx.snapshot.index.doc_chunks(f"S2:{key}"))
    return out


def statement_chunks(ctx: RunContext, ini: Initiative) -> list[Chunk]:
    """S3 statements whose source_ref points at one of the initiative's epics."""
    s3 = ctx.snapshot.table("S3")
    keys = ctx.snapshot.epic_keys_for(ini.id) | {ini.id}
    if s3.empty or "source_ref" not in s3.columns:
        return []
    out = []
    for sid in s3.loc[s3["source_ref"].isin(keys), "statement_id"]:
        out.extend(ctx.snapshot.index.doc_chunks(f"S3:{sid}"))
    return out


def gather(ctx: RunContext, ini: Initiative, query_terms: list[str], sources: tuple[str, ...],
           k: int | None = None, include_direct: bool = True) -> list[Chunk]:
    """Direct evidence first (initiative, epics, statements), then retrieval hits, deduped
    and capped so prompts stay bounded."""
    picked: dict[str, Chunk] = {}
    if include_direct:
        for c in initiative_chunks(ctx, ini) + epic_chunks(ctx, ini) + statement_chunks(ctx, ini):
            picked.setdefault(c.chunk_id, c)
    query = " ".join([ini.title, ini.description[:400], *query_terms])
    for hit in ctx.snapshot.index.search(query, k=k or ctx.settings.retrieval_k, sources=sources):
        picked.setdefault(hit.chunk.chunk_id, hit.chunk)
    out, total = [], 0
    for c in picked.values():
        if total + len(c.text) > MAX_EVIDENCE_CHARS and out:
            break
        out.append(c)
        total += len(c.text)
    ctx.observe(c.chunk_id for c in out)
    return out


def _safe(text: str) -> str:
    # A document cannot close its own wrapper and smuggle text outside it.
    return text.replace("</document", "</ document").replace("<document", "< document")


def render_documents(chunks: list[Chunk], owner_of=None) -> str:
    """Wrap chunks in <document> tags. `initiative=` names the initiative a document belongs
    to, so a model can tell another initiative's epic from the focus initiative's."""
    parts = []
    for c in chunks:
        title = _safe(c.title).replace('"', "'")
        section = f' section="{_safe(c.section)}"' if c.section else ""
        owner = owner_of(c) if owner_of else None
        belongs = f' initiative="{owner}"' if owner else ""
        parts.append(f'<document id="{c.chunk_id}" source="{c.source}"{belongs} title="{title}"{section}>\n'
                     f"{_safe(c.text)}\n</document>")
    return "\n\n".join(parts)


def owned_by(ctx: RunContext, chunk: Chunk, initiative_id: str) -> bool:
    return ctx.snapshot.owner_of(chunk) == initiative_id


def attributable(ctx: RunContext, ref: str, initiative_id: str) -> bool:
    """Attribution guard: evidence about an initiative may come from its own documents or
    from shared ones (Confluence, Slack), never from another initiative's epic or statement."""
    chunk = ctx.chunk(ref)
    owner = ctx.snapshot.owner_of(chunk) if chunk else None
    return owner is None or owner == initiative_id
