"""Run manager: starts graph runs on background threads, resumes them after review, and
persists events, trace, and state under RUNS_DIR/<run_id>/.

The LangGraph checkpointer is in memory, so a run can be resumed only by the server
process that started it; after a restart, past runs are readable from state.json.
"""

from __future__ import annotations

import json
import logging
import threading
import uuid
from datetime import datetime
from pathlib import Path

from langgraph.types import Command

from agents.graph import build_graph
from agents.runtime import Budget, EventSink, RunContext, Tracer, now_iso, register
from agents.state import AgentState, Approval, Initiative
from app.config import Settings
from context.snapshot import ContextSnapshot
from llm.adapter import BaseLLM

log = logging.getLogger(__name__)
TERMINAL = ("approved", "failed")


class RunHandle:
    def __init__(self, run_id: str, ctx: RunContext):
        self.run_id = run_id
        self.ctx = ctx
        self.status = "running"
        self.error: str | None = None
        self.created_at = now_iso()
        self.lock = threading.Lock()  # one graph step at a time per run

    @property
    def config(self) -> dict:
        return {"configurable": {"thread_id": self.run_id}, "recursion_limit": 80}


class RunManager:
    def __init__(self, settings: Settings):
        self.settings = settings
        self.graph = build_graph()
        self.runs: dict[str, RunHandle] = {}

    def start(self, initiatives: list[Initiative], snapshot: ContextSnapshot, llm: BaseLLM) -> RunHandle:
        run_id = f"run-{datetime.now():%Y%m%d-%H%M%S}-{uuid.uuid4().hex[:6]}"
        run_dir = self.settings.runs_dir / run_id
        run_dir.mkdir(parents=True, exist_ok=True)
        ctx = RunContext(
            run_id=run_id, settings=self.settings, snapshot=snapshot, llm=llm,
            tracer=Tracer(run_dir / "trace.jsonl", run_id), events=EventSink(run_id, run_dir / "events.jsonl"),
            budget=Budget(self.settings.pipeline_max_model_calls), run_dir=run_dir)
        register(ctx)
        handle = RunHandle(run_id, ctx)
        self.runs[run_id] = handle
        ctx.emit("run_started", None, initiatives=[{"id": i.id, "title": i.title} for i in initiatives],
                 llm=llm.status().__dict__, data_fingerprint=snapshot.fingerprint)
        self._launch(handle, AgentState(run_id=run_id, initiatives=initiatives))
        return handle

    def review(self, handle: RunHandle, approval: Approval) -> None:
        handle.status = "running"
        self._launch(handle, Command(resume=approval.model_dump(mode="json")))

    def _launch(self, handle: RunHandle, payload) -> None:
        threading.Thread(target=self._drive, args=(handle, payload), daemon=True, name=handle.run_id).start()

    def _drive(self, handle: RunHandle, payload) -> None:
        ctx = handle.ctx
        with handle.lock:
            try:
                self.graph.invoke(payload, handle.config)
                snap = self.graph.get_state(handle.config)
                if snap.next:
                    handle.status = "awaiting_review"
                    self._persist(handle)
                    ctx.emit("awaiting_review", "human_gate")
                else:
                    handle.status = "approved"
                    self._persist(handle)
                    ctx.emit("run_completed", None, status=handle.status, exports=self.state(handle).exports)
            except Exception as exc:  # the run fails closed; the error is recorded and streamed
                log.exception("run %s failed", handle.run_id)
                handle.status = "failed"
                handle.error = f"{type(exc).__name__}: {exc}"
                self._persist(handle)
                ctx.emit("run_failed", None, error=handle.error)

    def state(self, handle: RunHandle) -> AgentState | None:
        values = self.graph.get_state(handle.config).values
        if not values:
            return None
        return values if isinstance(values, AgentState) else AgentState.model_validate(values)

    def _persist(self, handle: RunHandle) -> None:
        state = self.state(handle)
        view = {"run_id": handle.run_id, "status": handle.status, "created_at": handle.created_at,
                "error": handle.error, "flags": handle.ctx.flags,
                "state": state.model_dump(mode="json", exclude={"candidate_deps"}) if state else None,
                "events_count": len(handle.ctx.events.events)}
        (handle.ctx.run_dir / "state.json").write_text(json.dumps(view, indent=1, default=str), encoding="utf-8")

    def persist_flags(self, handle: RunHandle) -> None:
        self._persist(handle)

    def view(self, handle: RunHandle) -> dict:
        state = self.state(handle)
        return {"run_id": handle.run_id, "status": handle.status, "created_at": handle.created_at,
                "error": handle.error, "flags": handle.ctx.flags,
                "state": state.model_dump(mode="json", exclude={"candidate_deps"}) if state else None,
                "events_count": len(handle.ctx.events.events)}

    def saved_view(self, run_id: str) -> dict | None:
        path = self.settings.runs_dir / run_id / "state.json"
        if not path.is_file() or Path(run_id).name != run_id:
            return None
        return json.loads(path.read_text(encoding="utf-8"))

    def list_runs(self) -> list[dict]:
        out = {h.run_id: {"run_id": h.run_id, "status": h.status, "created_at": h.created_at,
                          "initiative_count": len(self.state(h).initiatives) if self.state(h) else 0}
               for h in self.runs.values()}
        if self.settings.runs_dir.exists():
            for p in sorted(self.settings.runs_dir.glob("run-*/state.json"), reverse=True)[:30]:
                if p.parent.name in out:
                    continue
                try:
                    v = json.loads(p.read_text(encoding="utf-8"))
                    out[v["run_id"]] = {"run_id": v["run_id"], "status": v["status"], "created_at": v["created_at"],
                                        "initiative_count": len((v.get("state") or {}).get("initiatives", []))}
                except (OSError, ValueError, KeyError):
                    continue
        return sorted(out.values(), key=lambda r: r["created_at"], reverse=True)
