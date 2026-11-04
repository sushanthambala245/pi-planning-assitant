"""Tabular store: every loaded CSV as a SQLite table (in memory, read-only after load).

Lookups are parameterised; the model never writes SQL (considerations §4.2: a narrow
tool with a schema, not code mode).
"""

from __future__ import annotations

import sqlite3
import threading

import pandas as pd

from context.sources import SOURCES


def table_name(source_id: str) -> str:
    return f"{source_id.lower()}_{SOURCES[source_id].filename.split('.')[0].lower()}"


class TabularStore:
    def __init__(self, tables: dict[str, pd.DataFrame]):
        self._conn = sqlite3.connect(":memory:", check_same_thread=False)
        self._lock = threading.Lock()
        self.tables: dict[str, list[str]] = {}
        for sid, df in tables.items():
            flat = df.copy()
            for col in flat.columns:
                flat[col] = flat[col].map(lambda v: "; ".join(map(str, v)) if isinstance(v, list) else v)
            flat.to_sql(table_name(sid), self._conn, index=False)
            self.tables[sid] = list(flat.columns)

    def lookup(self, source_id: str, value: str, limit: int = 10) -> list[dict]:
        """Rows of one table where any text column equals (case-insensitive) or contains `value`."""
        if source_id not in self.tables:
            return []
        cols = self.tables[source_id]
        where = " OR ".join(f'LOWER(CAST("{c}" AS TEXT)) LIKE ?' for c in cols)
        params = [f"%{value.lower()}%"] * len(cols)
        sql = f'SELECT * FROM "{table_name(source_id)}" WHERE {where} LIMIT ?'
        with self._lock:
            cur = self._conn.execute(sql, [*params, limit])
            names = [d[0] for d in cur.description]
            return [dict(zip(names, row)) for row in cur.fetchall()]

    def count(self, source_id: str) -> int:
        if source_id not in self.tables:
            return 0
        with self._lock:
            return self._conn.execute(f'SELECT COUNT(*) FROM "{table_name(source_id)}"').fetchone()[0]
