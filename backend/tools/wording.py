"""Small helpers for text people read: plurals, and dependency ids inside model-written text.

Model rationales cite dependency ids in square brackets so a code check can verify them
([dep-1a2b3c4d5e]). The UI shows the text without the ids, so a rationale is only usable if
it still reads as a sentence once they are removed.
"""

from __future__ import annotations

import re

import pandas as pd

DEP_ID = re.compile(r"\bdep-[0-9a-f]{10}\b")
# One bracket holding one or more ids: [dep-…], [dep-…, dep-…], [dep-… and dep-…].
_REF_GROUP = re.compile(r"\s*\[\s*dep-[0-9a-f]{10}(?:\s*(?:,|;|&|\band\b)\s*dep-[0-9a-f]{10})*\s*\]")
# What is left behind when ids were used as words: "via and", "via,, and", "for .", "()".
_DANGLING = re.compile(
    r"\b(?:via|through|by|for|on|of|from|with|and|or)\s*(?:[,;:.)]|$|\b(?:and|or)\b)|[,;]\s*[,;.]|\(\s*\)", re.I)


def plural(n: int, one: str, many: str | None = None) -> str:
    """'1 initiative', '3 initiatives'; pass `many` for irregular forms."""
    return f"{n} {one if n == 1 else many or one + 's'}"


def strip_dep_refs(text: str) -> str:
    """The text with every bracketed dependency id removed and the spacing tidied."""
    out = _REF_GROUP.sub("", text)
    out = re.sub(r"\s+([,;:.)])", r"\1", out)
    return re.sub(r"\s{2,}", " ", out).strip()


def reads_without_refs(text: str) -> bool:
    """True if the text still reads as sentences once the ids are removed: no stray id is
    left, and no connective is left without the words it joined."""
    stripped = strip_dep_refs(text)
    return bool(stripped) and not DEP_ID.search(stripped) and not _DANGLING.search(stripped)


def has_values(df: pd.DataFrame, column: str) -> bool:
    """The loader adds every optional column, so a column only counts if it holds a value."""
    if column not in df.columns:
        return False
    return bool(df[column].map(lambda v: v == v and v is not None and str(v).strip() != "").any())
