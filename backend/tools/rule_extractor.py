"""Rule-based extractors: the weak baseline that every LLM step is measured against
(considerations §1.2), and the labelled fallback when the LLM is unavailable.

- system mentions: whole-word matches of catalogue service names in the text
- explicit dependencies: a dependency cue ("blocked on", "waiting for", ...) followed,
  within the same sentence, by a known initiative, service or team name
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Callable

from context.index import Chunk
from context.resolver import EntityResolver, norm

_SENTENCES = re.compile(r"(?<=[.!?\n])\s+")
_CUES: list[tuple[re.Pattern, str]] = [
    (re.compile(r"\bblocked\s+(?:on|by)\b", re.I), "blocked_on"),
    (re.compile(r"\bwaiting\s+(?:for|on)\b", re.I), "waiting_for"),
    (re.compile(r"\bcan(?:no|')t\s+(?:start|ship|proceed|launch|go\s+live|release)\b(?:\s+(?:until|without|before))?", re.I),
     "blocked_on"),
    (re.compile(r"\b(?:depends|depending|dependent|relies|relying)\s+(?:on|upon)\b", re.I), "requires"),
    (re.compile(r"\b(?:requires?|needs?)\b", re.I), "requires"),
    (re.compile(r"\b(?:only\s+)?after\b", re.I), "sequenced_after"),
]
_TAIL = 140


@dataclass
class RuleDep:
    target_kind: str
    target: str
    dep_type: str
    quote: str
    chunk: Chunk


def sentences(text: str) -> list[str]:
    return [s.strip() for s in _SENTENCES.split(text) if s.strip()]


def system_mentions(resolver: EntityResolver, chunks: list[Chunk]) -> list[tuple[str, Chunk, str]]:
    """[(service, chunk, sentence)] for every catalogue service named in the chunks."""
    out, seen = [], set()
    for c in chunks:
        for sent in sentences(c.text):
            for service, _form in resolver.services.mentions(sent):
                if service not in seen:
                    seen.add(service)
                    out.append((service, c, sent))
    return out


def explicit_dependencies(resolver: EntityResolver, chunks: list[Chunk], focus_id: str, focus_team: str,
                          owner_of: Callable[[Chunk], str | None], focus_names: list[str]) -> list[RuleDep]:
    """Attribution: a chunk owned by another initiative is skipped; in a shared chunk (Slack,
    Confluence) only sentences that name the focus initiative, one of its epics, or its team count."""
    out: list[RuleDep] = []
    seen: set[tuple[str, str, str]] = set()  # one hit per target per chunk; merge joins the evidence
    forms = [f" {norm(n)} " for n in focus_names if len(norm(n)) >= 4]
    for c in chunks:
        owner = owner_of(c)
        if owner is not None and owner != focus_id:
            continue
        for sent in sentences(c.text):
            if owner is None and not any(f in f" {norm(sent)} " for f in forms):
                continue
            for cue, dep_type in _CUES:
                m = cue.search(sent)
                if not m:
                    continue
                tail = sent[m.end(): m.end() + _TAIL]
                targets: list[tuple[str, str]] = []
                for title, _ in resolver.initiative_titles.mentions(tail):
                    iid = resolver.initiative(title).canonical
                    if iid and iid != focus_id:
                        targets.append(("initiative", iid))
                for iid in resolver.initiative_id_mentions(tail):  # "blocked on INIT-005" in a planner note
                    if iid != focus_id and ("initiative", iid) not in targets:
                        targets.append(("initiative", iid))
                targets += [("service", s) for s, _ in resolver.services.mentions(tail)]
                targets += [("team", t) for t, _ in resolver.teams.mentions(tail) if t != focus_team]
                for kind, target in targets:
                    if (kind, target, c.chunk_id) not in seen:
                        seen.add((kind, target, c.chunk_id))
                        out.append(RuleDep(kind, target, dep_type, sent, c))
                break  # first cue in the sentence decides its type
    return out
