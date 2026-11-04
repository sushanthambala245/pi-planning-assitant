"""Entity resolution: map free-text names onto the canonical teams, services, repos and
initiatives in the catalogue, keeping the raw name and the match score.

Exact (normalised) matches first, then a fuzzy match above FUZZY_THRESHOLD. Below the
threshold the resolver returns None: a name that does not resolve is reported, never
guessed (considerations §4.1, "weak evidence is signalled").
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from difflib import SequenceMatcher

_SUFFIXES = re.compile(r"\b(team|squad|service|svc|api|platform|system)\b")


def norm(name: str) -> str:
    s = re.sub(r"[^a-z0-9]+", " ", str(name).lower()).strip()
    return re.sub(r"\s+", " ", s)


def norm_loose(name: str) -> str:
    """Normalised form without generic suffixes ("Payments Team" -> "payments")."""
    s = _SUFFIXES.sub(" ", norm(name))
    return re.sub(r"\s+", " ", s).strip() or norm(name)


@dataclass(frozen=True)
class Resolution:
    raw: str
    canonical: str | None
    kind: str
    score: float
    method: str  # exact | loose | fuzzy | none


class Catalogue:
    def __init__(self, kind: str, names: list[str], threshold: float, ids: dict[str, str] | None = None):
        """`ids` maps alternative identifiers (e.g. REPO-001) onto canonical names. They resolve
        exactly but are never looked for in free text."""
        self.kind = kind
        self.threshold = threshold
        self.names = sorted({n for n in names if n})
        self._exact = {norm(i): n for i, n in (ids or {}).items() if i and n in self.names}
        self._exact.update({norm(n): n for n in self.names})
        self._loose: dict[str, str] = {}
        for n in self.names:
            self._loose.setdefault(norm_loose(n), n)

    def resolve(self, raw: str) -> Resolution:
        if not raw or not self.names:
            return Resolution(raw, None, self.kind, 0.0, "none")
        n = norm(raw)
        if n in self._exact:
            return Resolution(raw, self._exact[n], self.kind, 1.0, "exact")
        loose = norm_loose(raw)
        if loose in self._loose:
            return Resolution(raw, self._loose[loose], self.kind, 0.95, "loose")
        best, score = None, 0.0
        for key, name in self._loose.items():
            s = SequenceMatcher(None, loose, key).ratio()
            if s > score:
                best, score = name, s
        if best and score >= self.threshold:
            return Resolution(raw, best, self.kind, round(score, 3), "fuzzy")
        return Resolution(raw, None, self.kind, round(score, 3), "none")

    def mentions(self, text: str) -> list[tuple[str, str]]:
        """Whole-word mentions of catalogue names in text -> [(canonical, matched form)].

        The suffix-free form counts only when it keeps two or more words: "Customer Profile
        Service" may match "customer profile", but "Data Team" never matches a bare "data"."""
        hay = f" {norm(text)} "
        found: dict[str, str] = {}
        for name in self.names:
            loose = norm_loose(name)
            forms = [norm(name)] + ([loose] if len(loose.split()) >= 2 else [])
            for form in forms:
                if len(form) < 4:  # too short to match safely as a bare word
                    continue
                if f" {form} " in hay:
                    found.setdefault(name, form)
                    break
        return list(found.items())


class EntityResolver:
    def __init__(
        self,
        teams: list[str],
        services: list[str],
        repos: list[str],
        initiatives: dict[str, str],
        threshold: float,
        repo_ids: dict[str, str] | None = None,
    ):
        self.teams = Catalogue("team", teams, threshold)
        self.services = Catalogue("service", services, threshold)
        self.repos = Catalogue("repo", repos, threshold, ids=repo_ids)
        self.initiative_titles = Catalogue("initiative", list(initiatives.values()), threshold)
        self._initiative_by_title = {title: iid for iid, title in initiatives.items()}
        self._initiative_ids = {norm(i): i for i in initiatives}

    def team(self, raw: str) -> Resolution:
        return self.teams.resolve(raw)

    def service(self, raw: str) -> Resolution:
        return self.services.resolve(raw)

    def repo(self, raw: str) -> Resolution:
        return self.repos.resolve(raw)

    def initiative(self, raw: str) -> Resolution:
        """Resolve an initiative by id or by title."""
        if norm(raw) in self._initiative_ids:
            return Resolution(raw, self._initiative_ids[norm(raw)], "initiative", 1.0, "exact")
        r = self.initiative_titles.resolve(raw)
        if r.canonical:
            return Resolution(raw, self._initiative_by_title[r.canonical], "initiative", r.score, r.method)
        return r

    def add_initiative(self, iid: str, title: str) -> None:
        """Register an uploaded or manual initiative so text can refer to it."""
        self._initiative_ids[norm(iid)] = iid
        self._initiative_by_title[title] = iid
        self.initiative_titles = Catalogue(
            "initiative", list(self._initiative_by_title), self.initiative_titles.threshold
        )

    def any(self, raw: str, kinds: tuple[str, ...] = ("initiative", "service", "team")) -> Resolution:
        """Best resolution across kinds, preferring exact matches, then the listed order."""
        results = [getattr(self, k)(raw) for k in kinds]
        hits = [r for r in results if r.canonical]
        if not hits:
            return Resolution(raw, None, "unknown", 0.0, "none")
        return max(hits, key=lambda r: (r.score, -kinds.index(r.kind)))
