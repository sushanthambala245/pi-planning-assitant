"""Per-run runtime: budgets, trace spans, the UI event stream, and the provenance registry.

- Budget: a model-call limit per run; when it is spent, LLM steps continue on their
  rule-based path and say so (the documented exit behaviour, considerations §4.1).
- Tracer: one JSONL span per unit of work, recorded whether or not it succeeded (§4.7).
- EventSink: ordered events for the SSE stream and events.jsonl.
- observed: every chunk or record id a tool returned in this run. The verifier and the
  Ask agent drop any citation whose id is not in it (provenance guard, §4.5).
"""

from __future__ import annotations

import contextvars
import functools
import json
import threading
import time
import uuid
from collections import Counter
from contextlib import contextmanager
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, TypeVar

from pydantic import BaseModel

from app.config import Settings
from context.index import Chunk
from context.snapshot import ContextSnapshot
from llm.adapter import BaseLLM, LLMError
from llm.prompts import load_prompt

T = TypeVar("T", bound=BaseModel)


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds")


class BudgetExceeded(Exception):
    pass


class Budget:
    def __init__(self, model_calls: int, per_tool: int | None = None):
        self.model_limit = model_calls
        self.model_used = 0
        self.per_tool = per_tool
        self.tool_used: Counter[str] = Counter()
        self._lock = threading.Lock()

    def charge_model(self) -> None:
        with self._lock:
            if self.model_used >= self.model_limit:
                raise BudgetExceeded(f"model-call budget of {self.model_limit} spent")
            self.model_used += 1

    def charge_tool(self, name: str) -> None:
        with self._lock:
            if self.per_tool is not None and self.tool_used[name] >= self.per_tool:
                raise BudgetExceeded(f"tool budget for {name} ({self.per_tool} calls) spent")
            self.tool_used[name] += 1

    def as_dict(self) -> dict:
        return {"model_calls": self.model_used, "model_limit": self.model_limit, "tool_calls": dict(self.tool_used),
                "per_tool_limit": self.per_tool}


class Tracer:
    def __init__(self, path: Path | None, trace_id: str):
        self.path = path
        self.trace_id = trace_id
        self.records: list[dict] = []
        self._current: contextvars.ContextVar[str | None] = contextvars.ContextVar(f"span_{trace_id}", default=None)
        self._lock = threading.Lock()

    @contextmanager
    def span(self, name: str, **attributes: Any):
        span_id = uuid.uuid4().hex[:16]
        parent = self._current.get()
        token = self._current.set(span_id)
        start, t0 = now_iso(), time.perf_counter()
        attrs = dict(attributes)
        status, error = "ok", None
        try:
            yield attrs
        except Exception as exc:
            if type(exc).__name__ in ("GraphInterrupt", "GraphBubbleUp"):
                status = "interrupted"
            else:
                status, error = "error", f"{type(exc).__name__}: {exc}"
            raise
        finally:
            self._current.reset(token)
            rec = {"trace_id": self.trace_id, "span_id": span_id, "parent_id": parent, "name": name,
                   "start": start, "duration_ms": round((time.perf_counter() - t0) * 1000, 1),
                   "status": status, "error": error, "attributes": attrs}
            self._write(rec)

    def _write(self, rec: dict) -> None:
        with self._lock:
            self.records.append(rec)
            if self.path:
                with self.path.open("a", encoding="utf-8") as f:
                    f.write(json.dumps(rec, default=str) + "\n")


class EventSink:
    def __init__(self, run_id: str, path: Path | None):
        self.run_id = run_id
        self.path = path
        self.events: list[dict] = []
        self.cond = threading.Condition()

    def emit(self, type_: str, node: str | None = None, **data: Any) -> dict:
        with self.cond:
            ev = {"seq": len(self.events) + 1, "ts": now_iso(), "run_id": self.run_id, "type": type_, "node": node,
                  "data": data}
            self.events.append(ev)
            if self.path:
                with self.path.open("a", encoding="utf-8") as f:
                    f.write(json.dumps(ev, default=str) + "\n")
            self.cond.notify_all()
            return ev

    def since(self, seq: int, timeout: float = 15.0) -> list[dict]:
        with self.cond:
            if len(self.events) <= seq:
                self.cond.wait(timeout)
            return self.events[seq:]


@dataclass
class RunContext:
    run_id: str
    settings: Settings
    snapshot: ContextSnapshot
    llm: BaseLLM
    tracer: Tracer
    events: EventSink
    budget: Budget
    run_dir: Path | None = None
    observed: set[str] = field(default_factory=set)
    extra_chunks: dict[str, Chunk] = field(default_factory=dict)
    llm_outcomes: Counter = field(default_factory=Counter)
    prompt_versions: dict[str, str] = field(default_factory=dict)
    flags: list[str] = field(default_factory=list)  # items a reviewer flagged for PI planning
    _lock: threading.Lock = field(default_factory=threading.Lock)

    def emit(self, type_: str, node: str | None = None, **data: Any) -> dict:
        return self.events.emit(type_, node, **data)

    def warn(self, node: str | None, message: str) -> str:
        self.emit("warning", node, message=message)
        return message

    def observe(self, refs) -> None:
        with self._lock:
            self.observed.update(refs)

    def chunk(self, ref: str) -> Chunk | None:
        return self.snapshot.index.by_id.get(ref) or self.extra_chunks.get(ref)

    def add_chunk(self, chunk: Chunk) -> None:
        with self._lock:
            self.extra_chunks[chunk.chunk_id] = chunk

    def structured(self, *, task: str, prompt: str, stable_context: str, user: str, schema: type[T],
                   effort: str | None = None, node: str | None = None) -> T | None:
        """One LLM call in a span. Returns None when the LLM is unavailable, over budget,
        refused, or produced invalid output; the reason is traced, counted, and emitted,
        and the caller takes its rule-based path. Nothing is invented on failure."""
        if not self.llm.enabled:
            self.llm_outcomes["disabled"] += 1
            return None
        p = load_prompt(prompt)
        self.prompt_versions[p.name] = p.version
        with self.tracer.span(f"llm.{task}", **{"prompt.version": p.version, "llm.task": task}) as attrs:
            try:
                self.budget.charge_model()
            except BudgetExceeded as exc:
                attrs["outcome"] = "budget_exhausted"
                self.llm_outcomes["budget_exhausted"] += 1
                self.warn(node, f"{exc}; continuing with rule-based {task}")
                return None
            try:
                parsed, meta = self.llm.structured(task=task, system=p.text, stable_context=stable_context, user=user,
                                                   schema=schema, effort=effort or self.settings.llm_effort_extract)
            except LLMError as exc:
                attrs["outcome"] = exc.kind
                attrs["error"] = str(exc)[:500]
                self.llm_outcomes[exc.kind] += 1
                self.warn(node, f"LLM {task} failed ({exc.kind}): {str(exc)[:200]}; rule-based fallback used")
                return None
            attrs.update(meta.span_attributes())
            attrs["outcome"] = "ok"
            self.llm_outcomes["ok"] += 1
            return parsed


# -- registry: nodes find their context by run id (contexts are not checkpointed) ----------------

_CONTEXTS: dict[str, RunContext] = {}


def register(ctx: RunContext) -> None:
    _CONTEXTS[ctx.run_id] = ctx


def get_ctx(run_id: str) -> RunContext:
    return _CONTEXTS[run_id]


def node(name: str, label: str) -> Callable:
    """Wrap a node: lifecycle events for the UI, a span, and failure recording."""

    def deco(fn: Callable[[Any, RunContext], dict]) -> Callable:
        @functools.wraps(fn)
        def wrapper(state):
            ctx = get_ctx(state.run_id)
            ctx.emit("node_started", name, label=label)
            t0 = time.perf_counter()
            try:
                with ctx.tracer.span(f"node.{name}"):
                    out = fn(state, ctx)
            except Exception as exc:
                ctx.emit("node_failed", name, label=label, error=f"{type(exc).__name__}: {exc}")
                raise
            ctx.emit("node_completed", name, label=label, duration_ms=round((time.perf_counter() - t0) * 1000))
            return out

        return wrapper

    return deco
