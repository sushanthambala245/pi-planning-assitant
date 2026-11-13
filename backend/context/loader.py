"""Load and validate every source in DATA_DIR (or any sub-folder) into one read-only ContextSnapshot.

Runs at startup and on POST /api/sources/reload. Each source gets a report: ready,
partial (some rows rejected), invalid (a required column is missing, so nothing is
loaded), or missing (no file). Nothing is guessed: a missing source is reported as
missing, never filled in.
"""

from __future__ import annotations

import hashlib
import logging
import re
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Literal

import pandas as pd

from context.sources import SOURCES, SourceSpec

log = logging.getLogger(__name__)

# off: the file may be there, but the source is not part of the knowledge base (ACTIVE_SOURCES).
Status = Literal["ready", "partial", "invalid", "missing", "off"]
_MAX_ERRORS = 20
_LIST_SPLIT = re.compile(r"\s*[;|,]\s*")
_TRUE = {"true", "yes", "y", "1", "t"}
_FALSE = {"false", "no", "n", "0", "f", ""}


@dataclass
class SourceReport:
    id: str
    filename: str
    title: str
    stands_in_for: str
    used_by: str
    mock: bool
    status: Status = "missing"
    rows: int = 0
    rejected_rows: int = 0
    missing_columns: list[str] = field(default_factory=list)
    unknown_columns: list[str] = field(default_factory=list)
    errors: list[str] = field(default_factory=list)

    def as_dict(self) -> dict:
        return dict(self.__dict__)


@dataclass
class Doc:
    """A unit of text before chunking: one row's text fields, one markdown section, one message."""

    doc_id: str
    source: str
    record_id: str
    title: str
    text: str
    meta: dict = field(default_factory=dict)


@dataclass
class RawData:
    tables: dict[str, pd.DataFrame]
    docs: list[Doc]
    reports: dict[str, SourceReport]
    fingerprint: str
    data_dir: Path
    loaded_at: str


def normalise_header(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "_", str(name).strip().lower()).strip("_")


def _parse_bool(value: str) -> bool | None:
    v = str(value).strip().lower()
    if v in _TRUE:
        return True
    if v in _FALSE:
        return False if v else None
    raise ValueError(f"not a boolean: {value!r}")


def _coerce(df: pd.DataFrame, spec: SourceSpec, report: SourceReport) -> pd.DataFrame:
    """Coerce typed columns; a row with an uncoercible value is rejected, not silently zeroed."""
    bad = pd.Series(False, index=df.index)
    for col, typ in spec.types.items():
        if col not in df.columns:
            continue
        raw = df[col].astype(str).str.strip()
        if typ == "float":
            num = pd.to_numeric(raw.mask(raw.eq("")), errors="coerce")
            invalid = raw.ne("") & num.isna()
            for idx in df.index[invalid][: _MAX_ERRORS]:
                report.errors.append(f"row {idx + 2}: column '{col}' is not a number: {raw[idx]!r}")
            bad |= invalid
            df[col] = num
        elif typ == "bool":
            parsed = []
            for idx, v in raw.items():
                try:
                    parsed.append(_parse_bool(v))
                except ValueError as exc:
                    parsed.append(None)
                    bad[idx] = True
                    if len(report.errors) < _MAX_ERRORS:
                        report.errors.append(f"row {idx + 2}: column '{col}': {exc}")
            df[col] = parsed
        elif typ == "list":
            df[col] = [[x for x in _LIST_SPLIT.split(v) if x] if v else [] for v in raw]
    if bad.any():
        report.rejected_rows += int(bad.sum())
    return df[~bad]


def load_csv(path: Path, spec: SourceSpec, report: SourceReport) -> pd.DataFrame | None:
    try:
        df = pd.read_csv(path, dtype=str, keep_default_na=False, encoding="utf-8-sig")
    except Exception as exc:  # unreadable file: the source is invalid, the error travels with the report
        report.status = "invalid"
        report.errors.append(f"could not read {path.name}: {type(exc).__name__}: {exc}")
        return None

    df.columns = [normalise_header(c) for c in df.columns]
    renames: dict[str, str] = {}
    for alias, canonical in spec.aliases.items():  # first alias present wins, so no column is duplicated
        if alias in df.columns and canonical not in df.columns and canonical not in renames.values():
            renames[alias] = canonical
    for prefix, canonical in spec.alias_prefixes.items():  # e.g. target_pi_explicitly_q1_q2 -> target_pi
        if canonical in df.columns or canonical in renames.values():
            continue
        hit = next((c for c in df.columns if c not in renames and c.startswith(prefix) and c not in spec.columns), None)
        if hit:
            renames[hit] = canonical
    df = df.rename(columns=renames)

    missing = [c for c in spec.required if c not in df.columns]
    report.unknown_columns = [c for c in df.columns if c not in spec.columns]
    if missing:
        report.status = "invalid"
        report.missing_columns = missing
        report.errors.append(
            f"required column(s) missing: {', '.join(missing)}. Found: {', '.join(df.columns)}. "
            "Map them in context/sources.py ALIASES."
        )
        return None

    for col in spec.optional:
        if col not in df.columns:
            df[col] = ""
    for col in df.columns:
        df[col] = df[col].astype(str).str.strip()

    empty_required = df[list(spec.required)].eq("").any(axis=1)
    for idx in df.index[empty_required][: _MAX_ERRORS]:
        cols = [c for c in spec.required if df.at[idx, c] == ""]
        report.errors.append(f"row {idx + 2}: empty required value in {', '.join(cols)}")
    report.rejected_rows += int(empty_required.sum())
    df = df[~empty_required]

    if spec.key:
        dupes = df.duplicated(subset=[spec.key], keep="first")
        for idx in df.index[dupes][: _MAX_ERRORS]:
            report.errors.append(f"row {idx + 2}: duplicate {spec.key} {df.at[idx, spec.key]!r} (first kept)")
        report.rejected_rows += int(dupes.sum())
        df = df[~dupes]

    df = _coerce(df, spec, report).reset_index(drop=True)
    report.rows = len(df)
    report.status = "partial" if report.rejected_rows else "ready"
    return df


def _row_docs(spec: SourceSpec, df: pd.DataFrame) -> list[Doc]:
    docs = []
    for _, row in df.iterrows():
        key = str(row[spec.key]) if spec.key else str(row.name)
        parts = []
        for col in spec.index_columns:
            val = row.get(col, "")
            if isinstance(val, str) and val.strip():
                parts.append(val.strip())
        if not parts:
            continue
        title = str(row.get("title") or row.get("summary") or key)
        meta = {c: row[c] for c in df.columns if c not in spec.label_columns and isinstance(row[c], str)}
        docs.append(Doc(f"{spec.id}:{key}", spec.id, key, title, "\n\n".join(parts), meta))
    return docs


def _markdown_docs(root: Path) -> list[Doc]:
    docs = []
    for path in sorted(root.rglob("*.md")):
        if path.name.lower() == "readme.md":
            continue
        rel = path.relative_to(root).as_posix()
        text = path.read_text(encoding="utf-8", errors="replace")
        doc_type = path.parent.name if path.parent != root else ""
        title_match = re.search(r"^#\s+(.+)$", text, re.M)
        title = title_match.group(1).strip() if title_match else path.stem
        docs.append(Doc(f"M1:{rel}", "M1", rel, title, text, {"path": rel, "doc_type": doc_type}))
    return docs


_SLACK_LINE = re.compile(r"^\s*(?:\[(?P<ts>[^\]]+)\]\s*)?(?:#(?P<channel>[\w-]+)\s*)?(?:(?P<user>[\w.\- ]{1,40}):\s+)?(?P<text>.+)$")


def _slack_docs(path: Path) -> list[Doc]:
    raw = path.read_text(encoding="utf-8", errors="replace").strip()
    blocks = [b.strip() for b in re.split(r"\n\s*\n", raw) if b.strip()]
    if len(blocks) <= 1:
        blocks = [ln.strip() for ln in raw.splitlines() if ln.strip()]
    docs = []
    for n, block in enumerate(blocks, 1):
        m = _SLACK_LINE.match(block.splitlines()[0])
        meta = {k: v for k, v in (m.groupdict() if m else {}).items() if v and k != "text"}
        docs.append(Doc(f"M3:{n}", "M3", str(n), f"Slack message {n}", block, meta))
    return docs


def _fingerprint(data_dir: Path) -> str:
    h = hashlib.sha256()
    if data_dir.exists():
        for p in sorted(data_dir.rglob("*")):
            if p.is_file() and p.name.lower() != "readme.md":
                h.update(p.relative_to(data_dir).as_posix().encode())
                h.update(p.read_bytes())
    return h.hexdigest()[:12]


def locate(data_dir: Path, spec: SourceSpec) -> tuple[Path | None, list[Path]]:
    """A source's file (or folder) anywhere under DATA_DIR: the canonical name before its
    alternatives, the shallowest copy first. An alternative may be a glob pattern
    ("initiatives_updated*.csv"); among its matches the newest file wins, so a re-issued
    export (``_v2``) replaces the one before it. The other copies found are returned so the
    report can name them instead of ignoring them silently."""
    if not data_dir.is_dir():
        return None, []
    found: list[Path] = []
    for name in (spec.filename, *spec.alt_filenames):
        hits = [p for p in data_dir.rglob(name) if p.is_dir() == (spec.kind == "markdown_dir") and p not in found]
        if any(ch in name for ch in "*?["):
            hits.sort(key=lambda p: (-p.stat().st_mtime, len(p.relative_to(data_dir).parts), p.as_posix()))
        else:
            hits.sort(key=lambda p: (len(p.relative_to(data_dir).parts), p.as_posix()))
        found += hits
    return (found[0], found[1:]) if found else (None, [])


def load_raw(data_dir: Path, active: tuple[str, ...] | None = None) -> RawData:
    """Every source in the catalogue; one outside `active` (None = all) is reported as off and
    not read, so no agent can use it."""
    tables: dict[str, pd.DataFrame] = {}
    docs: list[Doc] = []
    reports: dict[str, SourceReport] = {}

    for spec in SOURCES.values():
        rep = SourceReport(spec.id, spec.filename, spec.title, spec.stands_in_for, spec.used_by, spec.mock)
        reports[spec.id] = rep
        path, others = locate(data_dir, spec)
        if active is not None and spec.id not in active:
            rep.status = "off"
            if path is not None:
                rep.filename = path.relative_to(data_dir).as_posix()
            continue
        if path is None:
            continue
        rep.filename = path.relative_to(data_dir).as_posix()
        for other in others:
            rep.errors.append(f"also found {other.relative_to(data_dir).as_posix()} (ignored; using {rep.filename})")
        try:
            if spec.kind == "csv":
                df = load_csv(path, spec, rep)
                if df is not None:
                    tables[spec.id] = df
                    if spec.index_columns:
                        docs.extend(_row_docs(spec, df))
            elif spec.kind == "markdown_dir" and path.is_dir():
                md = _markdown_docs(path)
                rep.rows, rep.status = len(md), ("ready" if md else "missing")
                docs.extend(md)
            elif spec.kind == "text":
                msgs = _slack_docs(path)
                rep.rows, rep.status = len(msgs), ("ready" if msgs else "missing")
                docs.extend(msgs)
            elif spec.kind == "xlsx":
                df = pd.read_excel(path, dtype=str).fillna("")
                df.columns = [normalise_header(c) for c in df.columns]
                tables[spec.id] = df
                rep.rows, rep.status = len(df), "ready"
        except Exception as exc:  # fail closed per source; the rest still loads
            rep.status = "invalid"
            rep.errors.append(f"{type(exc).__name__}: {exc}")
            tables.pop(spec.id, None)
            log.exception("failed to load %s", spec.id)

    return RawData(
        tables=tables,
        docs=docs,
        reports=reports,
        fingerprint=_fingerprint(data_dir),
        data_dir=data_dir,
        loaded_at=datetime.now(timezone.utc).isoformat(timespec="seconds"),
    )
