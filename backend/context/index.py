"""Retrieval index over the free-text sources (S1 S2 S3 M1 M3).

Baseline from considerations §4.3: structure-aware chunks (headings, then paragraphs,
then sentences; 800 chars with 120 overlap), stable chunk ids, results returned with
their ids. The first rung is BM25 (exact terms: epic keys, service names, team names).
A dense rung can be added behind the same `search` signature and fused with RRF
(`rrf` below) once the retrieval eval shows BM25 missing paraphrases.

Source filtering happens inside the query, before scoring, never after ranking.
"""

from __future__ import annotations

import math
import re
from collections import Counter, defaultdict
from dataclasses import dataclass, field

from context.loader import Doc

_TOKEN = re.compile(r"[a-z0-9]+")
_STOP = frozenset(
    "a an and are as at be by for from has have in is it its of on or that the this to was were will with "
    "we our you your they their be been can not no".split()
)
_SENTENCE = re.compile(r"(?<=[.!?])\s+(?=[A-Z0-9\"'(\[])")
_HEADING = re.compile(r"^(#{1,6})\s+(.+)$", re.M)

RETRIEVER_VERSION = "bm25-v1(k1=1.5,b=0.75)"


def tokenize(text: str) -> list[str]:
    return [t for t in _TOKEN.findall(text.lower()) if len(t) > 1 and t not in _STOP]


@dataclass
class Chunk:
    chunk_id: str
    doc_id: str
    source: str
    record_id: str
    title: str
    text: str
    section: str = ""
    meta: dict = field(default_factory=dict)


@dataclass
class Hit:
    chunk: Chunk
    score: float
    rank: int
    retriever: str


def _pieces(text: str) -> list[str]:
    """Paragraphs, with over-long paragraphs split into sentences."""
    out = []
    for para in re.split(r"\n\s*\n", text):
        para = para.strip()
        if not para:
            continue
        out.extend(_SENTENCE.split(para) if len(para) > 800 else [para])
    return out


def _pack(pieces: list[str], size: int, overlap: int) -> list[str]:
    chunks, cur = [], ""
    for piece in pieces:
        while len(piece) > size:  # a single unbreakable run: hard split
            head, piece = piece[:size], piece[size - overlap :]
            if cur:
                chunks.append(cur)
                cur = ""
            chunks.append(head)
        candidate = f"{cur}\n\n{piece}" if cur else piece
        if len(candidate) <= size:
            cur = candidate
        else:
            chunks.append(cur)
            tail = cur[-overlap:] if overlap else ""
            cur = f"{tail} {piece}".strip() if tail else piece
    if cur:
        chunks.append(cur)
    return chunks


def _sections(doc: Doc) -> list[tuple[str, str]]:
    if doc.source != "M1":
        return [("", doc.text)]
    marks = list(_HEADING.finditer(doc.text))
    if not marks:
        return [("", doc.text)]
    out = []
    if doc.text[: marks[0].start()].strip():
        out.append(("", doc.text[: marks[0].start()]))
    for i, m in enumerate(marks):
        end = marks[i + 1].start() if i + 1 < len(marks) else len(doc.text)
        out.append((m.group(2).strip(), doc.text[m.start() : end]))
    return out


def chunk_docs(docs: list[Doc], size: int, overlap: int) -> list[Chunk]:
    chunks = []
    for doc in docs:
        n = 0
        for section, body in _sections(doc):
            for text in _pack(_pieces(body), size, overlap):
                chunks.append(
                    Chunk(f"{doc.doc_id}#{n}", doc.doc_id, doc.source, doc.record_id, doc.title, text, section, doc.meta)
                )
                n += 1
    return chunks


class TextIndex:
    def __init__(self, chunks: list[Chunk], k1: float = 1.5, b: float = 0.75):
        self.chunks = chunks
        self.by_id = {c.chunk_id: c for c in chunks}
        self.by_doc: dict[str, list[Chunk]] = defaultdict(list)
        for c in chunks:
            self.by_doc[c.doc_id].append(c)
        self.k1, self.b = k1, b
        self._len: list[int] = []
        self._postings: dict[str, list[tuple[int, int]]] = defaultdict(list)
        for i, c in enumerate(chunks):
            toks = tokenize(f"{c.title} {c.section} {c.text}")
            self._len.append(len(toks))
            for tok, tf in Counter(toks).items():
                self._postings[tok].append((i, tf))
        n = len(chunks)
        self._avgdl = (sum(self._len) / n) if n else 0.0
        self._idf = {t: math.log(1 + (n - len(p) + 0.5) / (len(p) + 0.5)) for t, p in self._postings.items()}

    def __len__(self) -> int:
        return len(self.chunks)

    def search(self, query: str, k: int = 6, sources: tuple[str, ...] | None = None,
               exclude_docs: set[str] | None = None) -> list[Hit]:
        allowed = set(sources) if sources else None
        scores: dict[int, float] = defaultdict(float)
        for tok in set(tokenize(query)):
            idf = self._idf.get(tok)
            if idf is None:
                continue
            for i, tf in self._postings[tok]:
                c = self.chunks[i]
                if allowed is not None and c.source not in allowed:
                    continue  # filter inside the query, before scoring
                if exclude_docs and c.doc_id in exclude_docs:
                    continue
                dl = self._len[i] or 1
                scores[i] += idf * tf * (self.k1 + 1) / (tf + self.k1 * (1 - self.b + self.b * dl / (self._avgdl or 1)))
        ranked = sorted(scores.items(), key=lambda kv: (-kv[1], kv[0]))[:k]
        return [Hit(self.chunks[i], round(s, 4), r, RETRIEVER_VERSION) for r, (i, s) in enumerate(ranked, 1)]

    def doc_chunks(self, doc_id: str) -> list[Chunk]:
        return list(self.by_doc.get(doc_id, []))


def rrf(rankings: list[list[str]], k: int = 60) -> list[str]:
    """Reciprocal rank fusion: sum 1/(k+rank) per list, no score normalisation."""
    scores: dict[str, float] = {}
    for ranking in rankings:
        for rank, doc_id in enumerate(ranking, 1):
            scores[doc_id] = scores.get(doc_id, 0.0) + 1 / (k + rank)
    return sorted(scores, key=scores.get, reverse=True)
