"""Evidence assembly: which documents an agent reads for an initiative.

Every chunk handed to a model, or used as rule-based evidence, is registered as observed
in the run, so later citations can be checked against what was actually retrieved.
"""

from __future__ import annotations

from agents.runtime import RunContext
from agents.state import Initiative
from context.index import Chunk

def initiative_chunks(ctx: RunContext, ini: Initiative) -> list[Chunk]:
    """The initiative's own text: S1 row chunks, or a run-local chunk for uploads/manual entries."""
    chunks = ctx.snapshot.index.doc_chunks(f"S1:{ini.id}")
    if chunks:
        return chunks
    text = "\n\n".join(t for t in (ini.title, ini.description, ini.dependency_text) if t)
    c = Chunk(f"INIT:{ini.id}#0", f"INIT:{ini.id}", ini.origin, ini.id, ini.title, text)
    ctx.add_chunk(c)
    return [c]


def note_chunks(ctx: RunContext, ini: Initiative) -> list[Chunk]:
    """A planner's note on the initiative, as a run-local document the initiative owns."""
    if not ini.note.strip():
        return []
    c = Chunk(f"INIT:{ini.id}:note#0", f"INIT:{ini.id}:note", "NOTE", ini.id, f"Planner note on {ini.id}",
              ini.note.strip())
    ctx.add_chunk(c)
    return [c]


def own_chunks(ctx: RunContext, ini: Initiative) -> list[Chunk]:
    """The initiative's own text and its planner note, registered as observed."""
    out = initiative_chunks(ctx, ini) + note_chunks(ctx, ini)
    ctx.observe(c.chunk_id for c in out)
    return out


def is_note(chunk: Chunk | None) -> bool:
    return bool(chunk) and chunk.doc_id.endswith(":note")


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
