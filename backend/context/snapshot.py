"""ContextSnapshot: the validated, entity-resolved view of all sources that agents read.

Built once per load. Team, service and repo names in every table are resolved onto
canonical names (S6 for teams, S7 for services, S4 for repos); the original value is
kept in a `<column>_raw` column, and every fuzzy or failed match is listed in
`resolution_issues`, so nothing is silently renamed.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path

import networkx as nx
import pandas as pd

from agents.state import Initiative
from app.config import Settings
from context.index import TextIndex, chunk_docs
from context.loader import RawData, load_raw
from context.resolver import EntityResolver, norm
from context.store import TabularStore

_TEAM_COLUMNS = {"S1": "owning_team", "S2": "team", "S4": "owner_team", "S5": "team", "S7": "owner_team", "S8": "team"}


@dataclass
class ContextSnapshot:
    raw: RawData
    index: TextIndex
    resolver: EntityResolver
    kg: nx.MultiDiGraph
    store: TabularStore
    records: set[str]
    doc_owner: dict[str, str] = field(default_factory=dict)  # doc id -> initiative id it belongs to
    resolution_issues: list[str] = field(default_factory=list)

    # -- basic accessors -------------------------------------------------------------------------

    @property
    def fingerprint(self) -> str:
        return self.raw.fingerprint

    @property
    def reports(self):
        return self.raw.reports

    def has(self, sid: str) -> bool:
        return sid in self.raw.tables and not self.raw.tables[sid].empty

    def table(self, sid: str) -> pd.DataFrame:
        return self.raw.tables.get(sid, pd.DataFrame())

    def has_text(self, source: str) -> bool:
        return any(c.source == source for c in self.index.chunks)

    def owner_of(self, chunk) -> str | None:
        """The initiative a chunk belongs to (its S1 row, one of its epics, a statement on one
        of its epics), or None for shared documents such as Confluence pages and Slack."""
        if chunk.doc_id.startswith("INIT:"):
            return chunk.record_id
        return self.doc_owner.get(chunk.doc_id)

    # -- domain lookups --------------------------------------------------------------------------

    def initiatives(self) -> list[Initiative]:
        if not self.has("S1"):
            return []
        out = []
        for _, r in self.table("S1").iterrows():
            est = r.get("estimate_points")
            out.append(
                Initiative(
                    id=r["initiative_id"],
                    title=r["title"],
                    description=r.get("description", "") or "",
                    owning_team=r.get("owning_team", "") or "",
                    target_pi=(r.get("target_pi") or None),
                    art=(r.get("art") or None),
                    estimate_points=None if pd.isna(est) else float(est),
                    size=(r.get("size") or None),
                    targeted_sprint=(r.get("targeted_sprint") or None),
                    status=(r.get("status") or None),
                    priority=(r.get("priority") or None),
                    origin="S1",
                )
            )
        return out

    def epics_for(self, initiative_id: str) -> pd.DataFrame:
        df = self.table("S2")
        if df.empty or "initiative_id" not in df.columns:
            return df.iloc[0:0]
        return df[df["initiative_id"].map(norm) == norm(initiative_id)]

    def _row(self, sid: str, col: str, value: str) -> dict | None:
        df = self.table(sid)
        if df.empty or col not in df.columns:
            return None
        hit = df[df[col].map(norm) == norm(value)]
        return hit.iloc[0].to_dict() if not hit.empty else None

    def service_row(self, name: str) -> dict | None:
        return self._row("S7", "service", name)

    def repo_row(self, name: str) -> dict | None:
        return self._row("S4", "repo", name)

    def team_row(self, name: str) -> dict | None:
        return self._row("S6", "team", name)

    def repos_for_service(self, service: str) -> list[str]:
        repos = set()
        row = self.service_row(service)
        if row:
            repos.update(row.get("repo") or [])
        s4 = self.table("S4")
        if not s4.empty and "service" in s4.columns:
            repos.update(s4.loc[s4["service"].map(norm) == norm(service), "repo"])
        return sorted(r for r in repos if r)

    def services_for_repo(self, repo: str) -> list[str]:
        out = set()
        s7 = self.table("S7")
        if not s7.empty and "repo" in s7.columns:
            out.update(s7.loc[s7["repo"].map(lambda rs: norm(repo) in {norm(r) for r in rs}), "service"])
        row = self.repo_row(repo)
        if row and row.get("service"):
            out.add(row["service"])
        return sorted(s for s in out if s)

    def capacity_rows(self, team: str) -> pd.DataFrame:
        df = self.table("S5")
        if df.empty:
            return df
        return df[df["team"].map(norm) == norm(team)]

    def history_rows(self, team: str) -> pd.DataFrame:
        df = self.table("S8")
        if df.empty:
            return df
        return df[df["team"].map(norm) == norm(team)]

    def epic_keys_for(self, initiative_id: str) -> set[str]:
        e = self.epics_for(initiative_id)
        return set(e["epic_key"]) if not e.empty else set()

    def epic_keys_for_team(self, team: str) -> set[str]:
        df = self.table("S2")
        if df.empty or "team" not in df.columns:
            return set()
        return set(df.loc[df["team"].map(norm) == norm(team), "epic_key"])

    def summary(self) -> dict:
        return {
            "fingerprint": self.fingerprint,
            "loaded_at": self.raw.loaded_at,
            "data_dir": str(self.raw.data_dir),
            "chunks": len(self.index),
            "kg_nodes": self.kg.number_of_nodes(),
            "kg_edges": self.kg.number_of_edges(),
            "resolution_issues": self.resolution_issues[:50],
            "resolution_issue_count": len(self.resolution_issues),
        }


# -- building --------------------------------------------------------------------------------------


def _canonicalise(raw: RawData, resolver: EntityResolver, issues: list[str]) -> None:
    def apply(sid: str, col: str, resolve, kind: str):
        df = raw.tables.get(sid)
        if df is None or col not in df.columns:
            return

        def one(v: str) -> str:
            if not v:
                return v
            r = resolve(v)
            if r.canonical is None:
                issues.append(f"{sid}.{col}: {kind} {v!r} not found in the catalogue (kept as written)")
                return v
            if r.method == "fuzzy":
                issues.append(f"{sid}.{col}: {kind} {v!r} matched to {r.canonical!r} (score {r.score})")
            return r.canonical

        df[f"{col}_raw"] = df[col]
        df[col] = [[one(x) for x in v] if isinstance(v, list) else one(v) for v in df[col]]

    if resolver.teams.names:
        for sid, col in _TEAM_COLUMNS.items():
            if sid != "S6":
                apply(sid, col, resolver.team, "team")
    if resolver.repos.names:
        apply("S7", "repo", resolver.repo, "repo")
        apply("S4", "internal_dependencies", resolver.repo, "repo")
    if resolver.services.names:
        apply("S4", "service", resolver.service, "service")


def _build_kg(raw: RawData) -> nx.MultiDiGraph:
    g = nx.MultiDiGraph()
    t = raw.tables

    def node(kind: str, name: str, **attrs):
        nid = f"{kind}:{name}"
        if nid not in g:
            g.add_node(nid, kind=kind, name=name, **attrs)
        return nid

    def edge(a, b, rel, source, ref):
        g.add_edge(a, b, rel=rel, source=source, ref=ref, confidence=1.0)

    for _, r in t.get("S6", pd.DataFrame()).iterrows():
        tn = node("team", r["team"])
        if r.get("art"):
            edge(tn, node("art", r["art"]), "in_art", "S6", f"S6:{r['team']}")
    for _, r in t.get("S1", pd.DataFrame()).iterrows():
        i = node("initiative", r["initiative_id"], title=r["title"])
        if r.get("owning_team"):
            edge(i, node("team", r["owning_team"]), "owned_by", "S1", f"S1:{r['initiative_id']}")
    for _, r in t.get("S2", pd.DataFrame()).iterrows():
        e = node("epic", r["epic_key"], title=r["summary"])
        if r.get("initiative_id"):
            edge(e, node("initiative", r["initiative_id"]), "part_of", "S2", f"S2:{r['epic_key']}")
        if r.get("team"):
            edge(e, node("team", r["team"]), "owned_by", "S2", f"S2:{r['epic_key']}")
    for _, r in t.get("S4", pd.DataFrame()).iterrows():
        rp = node("repo", r["repo"])
        edge(rp, node("team", r["owner_team"]), "owned_by", "S4", f"S4:{r['repo']}")
        for d in r.get("internal_dependencies") or []:
            edge(rp, node("repo", d), "depends_on", "S4", f"S4:{r['repo']}")
        if r.get("service"):
            edge(rp, node("service", r["service"]), "implements", "S4", f"S4:{r['repo']}")
    for _, r in t.get("S7", pd.DataFrame()).iterrows():
        s = node("service", r["service"], status=r.get("status", ""))
        if r.get("owner_team"):
            edge(s, node("team", r["owner_team"]), "owned_by", "S7", f"S7:{r['service']}")
        for repo in r.get("repo") or []:
            edge(s, node("repo", repo), "in_repo", "S7", f"S7:{r['service']}")
    for _, r in t.get("M2", pd.DataFrame()).iterrows():
        c = node("control", r["control_id"], control_type=r.get("control_type", ""))
        edge(node("initiative", r["initiative_id"]), c, "requires_control", "M2", f"M2:{r['control_id']}")
    for _, r in t.get("S10", pd.DataFrame()).iterrows():
        edge(node("epic", r["from_key"]), node("epic", r["to_key"]), r.get("link_type") or "blocked_by", "S10",
             f"S10:{r['from_key']}->{r['to_key']}")
    return g


def _records(raw: RawData) -> set[str]:
    """Stable handles for structural evidence, e.g. S4:<repo>, S7:<service>."""
    keys = {"S1": "initiative_id", "S2": "epic_key", "S4": "repo", "S6": "team", "S7": "service", "M2": "control_id"}
    out: set[str] = set()
    for sid, col in keys.items():
        df = raw.tables.get(sid)
        if df is not None and col in df.columns:
            out.update(f"{sid}:{v}" for v in df[col])
    for sid in ("S5", "S8"):
        df = raw.tables.get(sid)
        if df is not None:
            out.update(f"{sid}:{r['team']}@{r['pi']}" for _, r in df.iterrows())
    df = raw.tables.get("S10")
    if df is not None:
        out.update(f"S10:{r['from_key']}->{r['to_key']}" for _, r in df.iterrows())
    return out


def _doc_owners(raw: RawData) -> dict[str, str]:
    t = raw.tables
    owners: dict[str, str] = {}
    ids = set(t["S1"]["initiative_id"]) if "S1" in t else set()
    owners.update({f"S1:{i}": i for i in ids})
    epic_owner: dict[str, str] = {}
    s2 = t.get("S2")
    if s2 is not None and "initiative_id" in s2.columns:
        for key, iid in zip(s2["epic_key"], s2["initiative_id"]):
            if iid:
                owners[f"S2:{key}"] = epic_owner[key] = iid
    s3 = t.get("S3")
    if s3 is not None and "source_ref" in s3.columns:
        for sid, ref in zip(s3["statement_id"], s3["source_ref"]):
            owner = epic_owner.get(ref) or (ref if ref in ids else None)
            if owner:
                owners[f"S3:{sid}"] = owner
    return owners


def build_snapshot(settings: Settings, data_dir: Path | None = None) -> ContextSnapshot:
    raw = load_raw(data_dir or settings.data_dir)
    t = raw.tables

    def col(sid: str, c: str) -> list[str]:
        df = t.get(sid)
        return [v for v in df[c] if v] if df is not None and c in df.columns else []

    teams = col("S6", "team")
    initiatives = dict(zip(col("S1", "initiative_id"), col("S1", "title"))) if "S1" in t else {}
    s4 = t.get("S4")
    repo_ids = dict(zip(s4["repo_id"], s4["repo"])) if s4 is not None and "repo_id" in s4.columns else {}
    resolver = EntityResolver(teams, col("S7", "service"), col("S4", "repo"), initiatives, settings.fuzzy_threshold,
                              repo_ids=repo_ids)
    issues: list[str] = []
    if not teams:
        issues.append("S6 team directory not loaded: team names are used as written, without resolution")
    _canonicalise(raw, resolver, issues)
    # After canonicalisation, teams seen anywhere become resolvable too.
    all_teams = sorted({*teams, *(v for sid, c in _TEAM_COLUMNS.items() for v in col(sid, c))})
    resolver = EntityResolver(all_teams, col("S7", "service"), col("S4", "repo"), initiatives, settings.fuzzy_threshold,
                              repo_ids=repo_ids)

    index = TextIndex(chunk_docs(raw.docs, settings.chunk_chars, settings.chunk_overlap))
    return ContextSnapshot(
        raw=raw,
        index=index,
        resolver=resolver,
        kg=_build_kg(raw),
        store=TabularStore(t),
        records=_records(raw),
        doc_owner=_doc_owners(raw),
        resolution_issues=issues,
    )
