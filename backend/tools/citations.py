"""Grounding checks, all plain code (considerations §4.5, §1.3).

- check_evidence: a quoted claim is grounded only if its chunk was returned by a tool in
  this run and the quote appears verbatim (after whitespace/case normalisation). A
  structural claim is grounded only if its record id exists in the snapshot.
- audit_answer: the Ask agent's citations must all be ids observed in this run.
"""

from __future__ import annotations

import re
import unicodedata

from agents.runtime import RunContext
from agents.state import EvidenceRef

_WS = re.compile(r"\s+")
_QUOTES = str.maketrans({"‘": "'", "’": "'", "“": '"', "”": '"', "–": "-", "—": "-"})
MIN_QUOTE_CHARS = 8


def normalise(text: str) -> str:
    t = unicodedata.normalize("NFKC", text).translate(_QUOTES)
    return _WS.sub(" ", t).strip().lower()


def quote_in(quote: str, text: str) -> bool:
    q = normalise(quote).strip(" .\"'…")
    if len(q) < MIN_QUOTE_CHARS:
        return False
    return q in normalise(text)


def check_evidence(ev: EvidenceRef, ctx: RunContext) -> tuple[bool, str]:
    if ev.quote:
        if ev.ref not in ctx.observed:
            return False, f"{ev.ref}: cited document was not returned by a tool in this run"
        chunk = ctx.chunk(ev.ref)
        if chunk is None:
            return False, f"{ev.ref}: unknown document id"
        if not quote_in(ev.quote, chunk.text):
            return False, f"{ev.ref}: quote not found verbatim in the cited document"
        return True, f"{ev.ref}: quote verified"
    if ev.ref in ctx.snapshot.records or ev.ref in ctx.observed:
        return True, f"{ev.ref}: record exists"
    return False, f"{ev.ref}: unknown record"


def grounded(evidence: list[EvidenceRef], ctx: RunContext) -> tuple[list[EvidenceRef], list[str]]:
    kept, notes = [], []
    for ev in evidence:
        ok, note = check_evidence(ev, ctx)
        notes.append(note)
        if ok:
            kept.append(ev)
    return kept, notes


# A citation is a bracketed source handle: S1..S10 / M1..M4 / INIT record or chunk ids (which
# may contain spaces, e.g. [S7:Customer Profile]) or a run id such as [dep-0123456789].
_CITE = re.compile(r"\[((?:S(?:10|[1-9])|M[1-4]|INIT):[^\[\]\n]{1,120}|(?:dep|risk)-[0-9a-f]{10})\]")


def audit_answer(answer: str, observed: set[str]) -> dict:
    cited = list(dict.fromkeys(_CITE.findall(answer or "")))
    unknown = [c for c in cited if c not in observed]
    return {"cited": cited, "unknown": unknown, "has_citations": bool(cited) and len(unknown) < len(cited)}


def strip_unknown_citations(answer: str, unknown: list[str]) -> str:
    for ref in unknown:
        answer = answer.replace(f"[{ref}]", "[citation removed: not from this run]")
    return answer
