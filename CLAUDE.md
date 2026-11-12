# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository layout

PI (Program Increment) planning assistant, built for a hackathon (banking case study).

- `frontend/` — React 18 + TypeScript + Vite 8 UI.
- `backend/` — FastAPI + LangGraph agents (Python 3.11+); see `backend/README.md`. Tests: `python -m pytest` from `backend/`.
- `data/` — the Haverstone case-study sources the backend reads (`data/README.md` has the column contract).
- `Architecture/`, `Wireframe/` — standalone HTML design artifacts (target architecture, wireframe). Reference only.
- `docs/` — the case-study brief (.docx).
- `.claude/launch.json` — dev-server config (`pi-ui`, port 5173).

## Commands

Backend (from `backend/`): `.\.venv\Scripts\python.exe -m uvicorn app.main:app --reload --port 8000`.

Frontend (from `frontend/`; Vite 8 needs Node 20.19+ or 22.12+):

- `npm install`
- `npm run dev` — Vite dev server on http://localhost:5173
- `npm run build` — `tsc -b && vite build` (the type check is the only static check)
- `npm run preview`

The frontend has no test runner or linter.

## Frontend architecture

On load the UI calls `/api/health` (Vite proxies `/api` to `localhost:8000`). **Connected:** initiatives and the loaded sources come from the backend, *Analyse* starts a backend run with the initiatives ticked on Intake (at most `limits.max_initiatives_per_run` from `/api/health`; selection lives in `App.tsx`) and `App.tsx` polls `GET /api/runs/{id}/analysis`, which returns the `Analysis` contract (built in `backend/app/analysis_view.py`). **Offline:** the UI ships empty and all content comes from files uploaded on the Intake screen. Three screens (`src/screens/`) driven by a `Screen` state in `src/App.tsx`: `intake` → `pipeline` ("Analysis") → `results`. `App.tsx` owns all state (initiatives, knowledge sources, analysis, run, notices) with no router or state library; navigation tabs are gated by the `enabled` map.

Key flow:
- `src/lib/ingest.ts` takes uploaded files (`.csv`, `.json`, `.xlsx`, `.zip` via `fflate`) and classifies each as initiatives, a knowledge source, or an analysis. `csv.ts` parses CSV; `classify()` picks icons/kind from filename keywords.
- `src/lib/analysis.ts` normalizes loosely-shaped JSON into the strict `Analysis` type (`src/types.ts`) — every field is optional on input, and it throws if nothing recognizable is present.
- `src/api/client.ts` is the backend client. An uploaded analysis JSON is still a **replay**: `App.tsx` steps through `analysis.agents` one per `STEP_MS` and then marks the run `done`, which enables Results.
- Each dependency row carries a change class (code / flow / regression / none), a level (initiative / team / system), the hop path and a stated-vs-inferred verdict, all computed in `backend/tools/dep_classify.py`. `src/lib/deps.ts` holds their labels, icons and hints; the Analysis and Results screens filter on them.
- Results opens with `DecisionSummary` (order, summary paragraph, what to do before PI planning, checks that did not run) fed by the view's `summary` and `notChecked`. For a backend run, `ReviewPanel` approves or challenges (`POST /api/runs/{id}/review` with `X-Demo-User`, the server looks up the role) and `App.tsx` polls again; flags go to `POST /api/runs/{id}/flags`; exports download from `/api/runs/{id}/export/{name}`.
- The V2 Results screen (`frontendV2/src/screens/ResultsScreen.tsx`) is a `Headline` (one sentence plus status chips) over a view switcher: Timeline, Graph, Dependencies, Risks. The timeline (`TimelineView.tsx`) draws `analysis.schedule`, built in `backend/tools/schedule.py` from T-shirt sizes and the verified dependency order (no capacity model); without a schedule it shows one column per step. Per-initiative comments are stored in the run folder (`backend/app/comments.py`, `GET|POST /api/runs/{id}/comments`) and `hooks/useComments.ts` polls them every 5 s; a replayed file keeps them in `localStorage`. Change `types.ts` and `analysis_view.py` together.
- Graph node colours come from `src/data/domains.ts`; theming is in `src/lib/theme.ts` + `src/styles.css` (Tabler icon webfont for icons).

The accepted input formats and the full analysis JSON schema are documented in `frontend/DATA_FORMAT.md` — update it when changing `types.ts` or the normalizers.
