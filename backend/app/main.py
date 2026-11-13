"""FastAPI app: intake, runs with a live SSE event stream, review, Ask, and exports.

Run from backend/:  uvicorn app.main:app --reload --port 8000
"""

from __future__ import annotations

import asyncio
import json
import logging
import tempfile
import threading
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Literal

import anyio
from fastapi import FastAPI, File, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, StreamingResponse
from pydantic import BaseModel, Field

from agents.ask import ask as ask_agent
from agents.runtime import now_iso
from agents.state import Approval, Constraint, Initiative, PlannerInput
from app.analysis_view import build_analysis
from app.config import get_settings
from app.identity import allowed, identity_from_request, roster_view
from app.runs import TERMINAL, RunHandle, RunManager
from context.loader import SourceReport, load_csv
from context.snapshot import ContextSnapshot, build_snapshot, initiative_from_row
from context.sources import SOURCES
from llm.adapter import build_llm
from tools.planning import is_ready as ready_status

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger("pi-copilot")


class AppState:
    def __init__(self):
        self.settings = get_settings()
        self.settings.runs_dir.mkdir(parents=True, exist_ok=True)
        self.llm = build_llm(self.settings)
        self.snapshot: ContextSnapshot = build_snapshot(self.settings)
        self.session_initiatives: dict[str, Initiative] = {}
        self.runs = RunManager(self.settings)
        self.lock = threading.Lock()

    def reload(self) -> None:
        snap = build_snapshot(self.settings)
        for ini in self.session_initiatives.values():
            snap.resolver.add_initiative(ini.id, ini.title)
        self.snapshot = snap  # running runs keep the snapshot they started with

    def initiatives(self) -> dict[str, Initiative]:
        out = {i.id: i for i in self.snapshot.initiatives()}
        out.update(self.session_initiatives)
        return out


S: AppState


@asynccontextmanager
async def lifespan(_: FastAPI):
    global S
    S = AppState()
    llm = S.llm.status()
    log.info("data fingerprint %s, %d chunks; LLM %s (%s)", S.snapshot.fingerprint, len(S.snapshot.index),
             "enabled" if llm.enabled else "DISABLED", llm.reason or llm.model)
    yield


app = FastAPI(title="PI Planning Assistant", version="0.1.0", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=list(get_settings().cors_origins), allow_methods=["*"],
                   allow_headers=["*"])


# -- request models --------------------------------------------------------------------------------

class ManualInitiative(BaseModel):
    title: str = Field(min_length=3, max_length=200)
    description: str = Field(default="", max_length=5000)
    owning_team: str = Field(default="", max_length=120)
    target_pi: str | None = Field(default=None, max_length=40)


class RunRequest(BaseModel):
    initiative_ids: list[str] = Field(min_length=1)
    # Notes, sizes and dependency decisions a planner added after an earlier run.
    planner: PlannerInput | None = None


class ConstraintIn(BaseModel):
    first: str
    then: str
    note: str = Field(default="", max_length=500)


class ReviewRequest(BaseModel):
    action: Literal["approve", "challenge"]
    constraint: ConstraintIn | None = None
    note: str = Field(default="", max_length=1000)


class FlagRequest(BaseModel):
    item_id: str
    flagged: bool = True


class AskFocus(BaseModel):
    type: Literal["risk", "dependency", "node", "step"]
    id: str


class AskRequest(BaseModel):
    question: str
    focus: AskFocus | None = None


# -- helpers ---------------------------------------------------------------------------------------

def _health() -> dict:
    reports = S.snapshot.reports.values()
    warnings = []
    llm = S.llm.status()
    if not llm.enabled:
        warnings.append(f"LLM disabled ({llm.reason}): rule-based extraction and template explanations are used.")
    if not S.snapshot.has("S1"):
        warnings.append(f"No initiatives loaded: add initiatives.csv (or initiatives_updated_v1.csv) and the other "
                        f"files to {S.settings.data_dir} and reload.")
    warnings += [f"{r.id} {r.filename} is invalid: {'; '.join(r.errors[:1])}" for r in reports if r.status == "invalid"]
    return {"status": "ok", "llm": llm.__dict__,
            "data": {**S.snapshot.summary(), "ready_sources": sum(r.status in ("ready", "partial") for r in reports),
                     "total_sources": len(SOURCES)},
            "limits": {"max_initiatives_per_run": S.settings.max_initiatives_per_run,
                       "max_upload_initiatives": S.settings.max_upload_initiatives},
            "ready_statuses": list(S.settings.ready_statuses),
            "planning": {"tshirt_points": dict(S.settings.tshirt_points), "default_size": S.settings.default_size,
                         "sprints_per_pi": S.settings.sprints_per_pi, "plan_quarters": S.settings.plan_quarters,
                         "velocity_tiers": dict(S.settings.velocity_tiers)},
            "warnings": warnings}


def is_ready(ini: Initiative) -> bool:
    return ready_status(ini.status, ini.origin, S.settings.ready_statuses)


def _initiative_view(ini: Initiative) -> dict:
    return {**ini.model_dump(exclude={"note", "size_override", "quarter_override"}), "ready": is_ready(ini),
            "team_name": S.snapshot.team_name(ini.owning_team) if ini.owning_team else ""}


def _sources() -> list[dict]:
    return [r.as_dict() for r in S.snapshot.reports.values()]


def _handle(run_id: str) -> RunHandle:
    h = S.runs.runs.get(run_id)
    if h is None:
        raise HTTPException(404, f"run {run_id} is not active in this server process")
    return h


# -- endpoints -------------------------------------------------------------------------------------

@app.get("/api/health")
def health() -> dict:
    return _health()


@app.get("/api/sources")
def sources() -> dict:
    return {"sources": _sources()}


@app.post("/api/sources/reload")
def reload_sources() -> dict:
    with S.lock:
        S.reload()
    return {"sources": _sources(), "health": _health()}


@app.get("/api/initiatives")
def list_initiatives() -> dict:
    return {"initiatives": [_initiative_view(i) for i in S.initiatives().values()]}


@app.post("/api/initiatives")
def add_initiative(body: ManualInitiative) -> dict:
    with S.lock:
        iid = f"MAN-{len([i for i in S.session_initiatives if i.startswith('MAN-')]) + 1:03d}"
        ini = Initiative(id=iid, title=body.title.strip(), description=body.description.strip(),
                         owning_team=S.snapshot.resolver.team(body.owning_team).canonical or body.owning_team.strip(),
                         target_pi=body.target_pi, origin="manual", status=S.settings.ready_statuses[0])
        S.session_initiatives[iid] = ini
        S.snapshot.resolver.add_initiative(iid, ini.title)
    return _initiative_view(ini)


@app.post("/api/initiatives/upload")
async def upload_initiatives(file: UploadFile = File(...)) -> dict:
    data = await file.read()
    if len(data) > 2_000_000:
        raise HTTPException(413, "file larger than 2 MB")
    spec = SOURCES["S1"]
    report = SourceReport("upload", file.filename or "upload.csv", "Uploaded initiatives", "upload", "intake", False)
    with tempfile.TemporaryDirectory() as tmp:
        path = Path(tmp) / "upload.csv"
        path.write_bytes(data)
        df = load_csv(path, spec, report)
    if df is None:
        raise HTTPException(422, f"Upload rejected: {'; '.join(report.errors[:3]) or 'unreadable file'}")
    limit = S.settings.max_upload_initiatives
    skipped = max(0, len(df) - limit)
    added = []
    with S.lock:
        for _, r in df.head(limit).iterrows():
            row = {**r.to_dict(), "initiative_id": f"UP-{r['initiative_id']}",
                   "owning_team": S.snapshot.resolver.team(r["owning_team"]).canonical or r["owning_team"]}
            ini = initiative_from_row(row, "upload")
            S.session_initiatives[ini.id] = ini
            S.snapshot.resolver.add_initiative(ini.id, ini.title)
            added.append(_initiative_view(ini))
    return {"added": added, "skipped": skipped, "limit": limit, "report": report.as_dict()}


@app.get("/api/reviewers")
def reviewers() -> dict:
    return {"reviewers": roster_view()}


@app.post("/api/runs")
def start_run(body: RunRequest, request: Request) -> dict:
    if not allowed(identity_from_request(request), "run"):
        raise HTTPException(403, "not allowed to start a run")
    ids = list(dict.fromkeys(body.initiative_ids))
    if len(ids) > S.settings.max_initiatives_per_run:
        raise HTTPException(400, f"at most {S.settings.max_initiatives_per_run} initiatives per run")
    pool = S.initiatives()
    unknown = [i for i in ids if i not in pool]
    if unknown:
        raise HTTPException(400, f"unknown initiative id(s): {', '.join(unknown)}")
    not_ready = [f"{i} ({pool[i].status or 'no status'})" for i in ids if not is_ready(pool[i])]
    if not_ready:
        raise HTTPException(400, f"only initiatives with status {', '.join(S.settings.ready_statuses)} can be "
                                 f"analysed; not ready: {', '.join(not_ready[:10])}")
    planner = body.planner or PlannerInput()
    # Only the run's initiatives count; a quarter placement is a short label ("Q2"), "later" means
    # "not in the planning horizon" and is kept as the planner wrote it.
    planner = planner.model_copy(update={k: {i: v for i, v in getattr(planner, k).items() if i in pool}
                                         for k in ("initiative_notes", "sizes", "quarters")})
    chosen = [pool[i].model_copy(update={"note": planner.initiative_notes.get(i, "").strip()[:2000],
                                         "size_override": planner.sizes.get(i, "").strip().upper()[:4],
                                         "quarter_override": planner.quarters.get(i, "").strip()[:20]})
              for i in ids]
    handle = S.runs.start(chosen, S.snapshot, S.llm, planner)
    return {"run_id": handle.run_id}


@app.get("/api/runs")
def list_runs() -> dict:
    return {"runs": S.runs.list_runs()}


@app.get("/api/runs/{run_id}")
def get_run(run_id: str) -> dict:
    h = S.runs.runs.get(run_id)
    if h is not None:
        return S.runs.view(h)
    saved = S.runs.saved_view(run_id)
    if saved is None:
        raise HTTPException(404, f"run {run_id} not found")
    return saved


@app.get("/api/runs/{run_id}/analysis")
def run_analysis(run_id: str) -> dict:
    """The run in the UI's Analysis contract; poll it while the run is in progress."""
    h = _handle(run_id)
    return build_analysis(h.run_id, h.status, h.error, S.runs.state(h), list(h.ctx.events.events), h.ctx.snapshot,
                          h.ctx.flags, S.settings.ready_statuses, S.settings)


@app.get("/api/runs/{run_id}/events")
async def run_events(run_id: str, request: Request, after: int = 0) -> StreamingResponse:
    h = _handle(run_id)
    start = int(request.headers.get("last-event-id") or after)

    async def stream():
        last = start
        while not await request.is_disconnected():
            events = await anyio.to_thread.run_sync(h.ctx.events.since, last, 10.0)
            if not events:
                if h.status in TERMINAL:
                    return
                yield ": keep-alive\n\n"
                continue
            for ev in events:
                last = ev["seq"]
                yield f"id: {ev['seq']}\nevent: {ev['type']}\ndata: {json.dumps(ev, default=str)}\n\n"
            await asyncio.sleep(0)

    return StreamingResponse(stream(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


@app.post("/api/runs/{run_id}/review")
def review_run(run_id: str, body: ReviewRequest, request: Request) -> dict:
    h = _handle(run_id)
    who = identity_from_request(request)
    if not allowed(who, body.action):
        raise HTTPException(403, f"{who.name} ({who.role}) is not allowed to {body.action}; "
                                 "approvals need an RTE, EM or Architect")
    if h.status != "awaiting_review":
        raise HTTPException(409, f"run is {h.status}, not awaiting review")
    constraint = None
    if body.action == "challenge":
        if body.constraint is None:
            raise HTTPException(400, "a challenge needs a constraint: which initiative goes before which")
        ids = {i.id for i in S.runs.state(h).initiatives}
        c = body.constraint
        if c.first not in ids or c.then not in ids or c.first == c.then:
            raise HTTPException(400, "constraint must name two different initiatives from this run")
        constraint = Constraint(first=c.first, then=c.then, note=c.note)
    approval = Approval(action=body.action, reviewer=who.name, role=who.role, at=now_iso(), constraint=constraint,
                        note=body.note)
    S.runs.review(h, approval)
    return S.runs.view(h)


@app.post("/api/runs/{run_id}/flags")
def flag_item(run_id: str, body: FlagRequest, request: Request) -> dict:
    h = _handle(run_id)
    if not allowed(identity_from_request(request), "flag"):
        raise HTTPException(403, "not allowed to flag")
    flags = h.ctx.flags
    if body.flagged and body.item_id not in flags:
        flags.append(body.item_id)
    elif not body.flagged and body.item_id in flags:
        flags.remove(body.item_id)
    S.runs.persist_flags(h)
    return {"flags": flags}


@app.post("/api/runs/{run_id}/ask")
def ask_run(run_id: str, body: AskRequest, request: Request) -> dict:
    h = _handle(run_id)
    if not allowed(identity_from_request(request), "ask"):
        raise HTTPException(403, "not allowed to ask")
    state = S.runs.state(h)
    if state is None:
        raise HTTPException(409, "run has no state yet")
    return ask_agent(h.ctx, state, body.question, body.focus.model_dump() if body.focus else None).as_dict()


@app.get("/api/runs/{run_id}/export/{name}")
def download_export(run_id: str, name: str) -> FileResponse:
    view = get_run(run_id)
    exports = (view.get("state") or {}).get("exports", [])
    if name not in exports:  # allow-list: only files this run exported
        raise HTTPException(404, "no such export")
    path = S.settings.runs_dir / run_id / "export" / name
    if not path.is_file():
        raise HTTPException(404, "export file missing")
    return FileResponse(path, filename=name)
