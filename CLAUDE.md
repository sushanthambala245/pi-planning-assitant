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

On load the UI calls `/api/health` (Vite proxies `/api` to `localhost:8000`). **Connected:** initiatives and the loaded sources come from the backend, *Analyse* starts a backend run with the initiatives ticked on Intake (only ready ones can be ticked, at most `limits.max_initiatives_per_run` from `/api/health`; selection lives in `App.tsx`) and `App.tsx` polls `GET /api/runs/{id}/analysis`, which returns the `Analysis` contract (built in `backend/app/analysis_view.py`). **Offline:** the UI ships empty and all content comes from files uploaded on the Intake screen. Four screens (`src/screens/`) driven by a `Screen` state in `src/App.tsx`: `intake` → `pipeline` ("Analysis") → `results` → `dashboard` ("Decisions"). `App.tsx` owns all state (initiatives, knowledge sources, analysis, run, notices, planner input) with no router or state library; navigation (top-bar stepper and the left `SideNav`) is gated by the `enabled` map.

The knowledge base is four backend sources (initiatives, GitHub repos, team directory, team capacity) plus the ownership map as a lookup; only initiatives with status *Ready for PI Planning* are analysed (`src/lib/readiness.ts` mirrors `backend/tools/planning.py`). A run answers three use cases: declared dependencies and whether their target quarters hold, hidden dependencies nobody declared, and the sequence by quarter at each initiative's T-shirt size against its team's capacity.

Key flow:
- `src/lib/ingest.ts` takes uploaded files (`.csv`, `.json`, `.xlsx`, `.zip` via `fflate`) and classifies each as initiatives, a knowledge source, or an analysis. `csv.ts` parses CSV; `classify()` picks icons/kind from filename keywords.
- `src/lib/analysis.ts` normalizes loosely-shaped JSON into the strict `Analysis` type (`src/types.ts`) — every field is optional on input, and it throws if nothing recognizable is present.
- `src/api/client.ts` is the backend client. An uploaded analysis JSON is still a **replay**: `App.tsx` steps through `analysis.agents` one per `STEP_MS` and then marks the run `done`, which enables Results and Decisions.
- Each dependency row carries a provenance (declared / planner / stated / inferred: the last two are the hidden ones), an impact (orders / soft / coordinate / retest / aware), a change class (code / flow / regression / none), a level, the hop path and a verdict, all computed in `backend/tools/dep_classify.py`. `src/lib/deps.ts` and `src/lib/plan.ts` hold their labels, icons and the in-depth tooltip texts.
- Screens are built from collapsible `Section`s (`src/components/Section.tsx`) that register in `src/lib/sections.tsx`, so `SideNav` can list and jump to them. Explanations use `Tip` / `InfoTip` (`src/components/Tip.tsx`, a portal tooltip), not `title`; `src/lib/sources.ts` describes each knowledge source's columns for Intake.
- Results opens with `AtAGlance` (the three use cases as tiles, then a short "before PI planning" list) built from `analysis.plan.counts`, then 1 · Declared and 2 · Hidden (`DependencyList`), then 3 · Delivery timeline: `StatusChips` (each chip opens its detail: moved / spilled, teams over capacity, unsized, risks, open comments, checks not run, left out, "Why this order?", "Review and approve") over a Timeline / Graph / Risks view switcher with a full-screen toggle. `TimelineView` draws `plan.items` across `plan.sprints` (`criticalChain` and `planStatus` in `src/lib/plan.ts`); clicking a bar opens `InitiativeDrawer` (Details with the planner's size and note, and Comments). The status chips, timeline, drawer and comments were ported from the `results-timeline-comments` branch (`frontendV2`), with the timeline driven by the quarter plan instead of a second scheduler. For a backend run, `ReviewPanel` approves or challenges (`POST /api/runs/{id}/review` with `X-Demo-User`, the server looks up the role) and `App.tsx` polls again; flags go to `POST /api/runs/{id}/flags`; exports download from `/api/runs/{id}/export/{name}`.
- Comments (`src/hooks/useComments.ts`, `CommentsPanel`) poll `GET /api/runs/{id}/comments?rev=` every 5 s while Results is open (`backend/app/comments.py`); a rerun sends `previous_run_id` so the backend copies them, and a replayed file keeps them in `localStorage`. Comments are for people; only planner notes reach the agents.
- Planner input (notes, T-shirt sizes, quarter placements, keep / dismiss decisions) lives in `src/lib/planner.ts` (saved to `localStorage`) and is sent with every run as `planner` on `POST /api/runs`. `RerunBar` starts a rerun of the same initiatives; `App.tsx` keeps the current results until it finishes and reports what changed.
- The Decisions screen (`DashboardScreen.tsx`) places `plan.items` into quarter buckets; `checkPlacement()` in `src/lib/plan.ts` re-checks dependencies and team capacity on every move, client-side.
- Graph node colours come from `src/data/domains.ts` (`--art-1..8` CSS variables); theming is in `src/lib/theme.ts` + `src/styles.css` (Accenture is the default theme; Tabler icon webfont for icons).

The accepted input formats and the full analysis JSON schema are documented in `frontend/DATA_FORMAT.md` — update it when changing `types.ts` or the normalizers.
