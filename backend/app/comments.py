"""Per-run, per-initiative comments: live feedback captured during PI planning.

Comments sit next to the run in `comments.json`, so they survive a server restart and work
on past runs. `rev` goes up on every change; a client that sends the `rev` it last saw gets
a cheap "unchanged" answer, which is what makes polling every few seconds inexpensive.
Author and role come from the server-side identity, never from the request body.
"""

from __future__ import annotations

import csv
import io
import json
import os
import threading
import uuid
from pathlib import Path
from typing import Literal

from pydantic import BaseModel, Field

from agents.runtime import now_iso

CommentType = Literal["concern", "question", "decision", "action"]
MAX_TEXT = 1000
MAX_COMMENTS = 500


class CommentIn(BaseModel):
    initiative_id: str = Field(min_length=1, max_length=120)
    type: CommentType = "concern"
    text: str = Field(min_length=1, max_length=MAX_TEXT)


class ResolveIn(BaseModel):
    resolved: bool = True


class CommentLimitReached(Exception):
    pass


def _csv_cell(value: object) -> str:
    """Spreadsheet formulas start with = + - @ (or a tab/CR): neutralise them in the export."""
    s = str(value)
    return "'" + s if s[:1] in ("=", "+", "-", "@", "\t", "\r") else s


class CommentStore:
    def __init__(self, runs_dir: Path):
        self.runs_dir = runs_dir
        self._lock = threading.Lock()

    def _path(self, run_id: str) -> Path:
        if Path(run_id).name != run_id:
            raise ValueError("bad run id")
        return self.runs_dir / run_id / "comments.json"

    def _load(self, run_id: str) -> dict:
        path = self._path(run_id)
        if path.is_file():
            try:
                data = json.loads(path.read_text(encoding="utf-8"))
                if isinstance(data.get("comments"), list):
                    return {"rev": int(data.get("rev", 0)), "comments": data["comments"]}
            except (OSError, ValueError):
                pass
        return {"rev": 0, "comments": []}

    def _save(self, run_id: str, data: dict) -> None:
        path = self._path(run_id)
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp = path.with_suffix(".tmp")
        tmp.write_text(json.dumps(data, indent=1), encoding="utf-8")
        os.replace(tmp, path)  # a reader never sees a half-written file

    def get(self, run_id: str, since_rev: int | None = None) -> dict:
        with self._lock:
            data = self._load(run_id)
        if since_rev is not None and since_rev == data["rev"]:
            return {"rev": data["rev"], "unchanged": True, "comments": []}
        return {"rev": data["rev"], "unchanged": False, "comments": data["comments"]}

    def add(self, run_id: str, initiative_id: str, ctype: str, text: str, author_id: str, author: str,
            role: str) -> dict:
        with self._lock:
            data = self._load(run_id)
            if len(data["comments"]) >= MAX_COMMENTS:
                raise CommentLimitReached()
            comment = {"id": f"c-{uuid.uuid4().hex[:10]}", "initiativeId": initiative_id, "type": ctype,
                       "text": text.strip(), "author": author, "authorId": author_id, "role": role,
                       "createdAt": now_iso(), "resolved": False, "resolvedBy": None, "resolvedAt": None}
            data["comments"].append(comment)
            data["rev"] += 1
            self._save(run_id, data)
        return comment

    def find(self, run_id: str, comment_id: str) -> dict | None:
        with self._lock:
            return next((c for c in self._load(run_id)["comments"] if c["id"] == comment_id), None)

    def resolve(self, run_id: str, comment_id: str, resolved: bool, by: str) -> dict | None:
        with self._lock:
            data = self._load(run_id)
            comment = next((c for c in data["comments"] if c["id"] == comment_id), None)
            if comment is None:
                return None
            comment["resolved"] = resolved
            comment["resolvedBy"] = by if resolved else None
            comment["resolvedAt"] = now_iso() if resolved else None
            data["rev"] += 1
            self._save(run_id, data)
        return comment

    def to_csv(self, run_id: str, titles: dict[str, str]) -> str:
        with self._lock:
            comments = self._load(run_id)["comments"]
        out = io.StringIO()
        w = csv.writer(out)
        w.writerow(["initiative_id", "initiative", "type", "status", "author", "role", "created_at", "text"])
        for c in comments:
            w.writerow([_csv_cell(x) for x in (c["initiativeId"], titles.get(c["initiativeId"], ""), c["type"],
                                              "resolved" if c["resolved"] else "open", c["author"], c["role"],
                                              c["createdAt"], c["text"])])
        return out.getvalue()
