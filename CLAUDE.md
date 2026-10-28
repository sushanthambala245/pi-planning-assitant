# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository layout

PI (Program Increment) planning assistant, built for a hackathon (banking case study).

- `frontend/` — the only code: a React 18 + TypeScript + Vite 8 UI. No backend exists yet.
- `Architecture/`, `Wireframe/` — standalone HTML design artifacts (target architecture, wireframe). Reference only.
- `docs/` — the case-study brief (.docx).
- `.claude/launch.json` — dev-server config (`pi-ui`, port 5173).

## Commands (run from `frontend/`)

- `npm install`
- `npm run dev` — Vite dev server on http://localhost:5173
- `npm run build` — `tsc -b && vite build` (the type check is the only static check)
- `npm run preview`

There is no test runner and no linter configured.

## Frontend architecture

The UI ships **empty**: all content comes from files uploaded on the Intake screen (or, later, from a backend). Three screens (`src/screens/`) driven by a `Screen` state in `src/App.tsx`: `intake` → `pipeline` ("Analysis") → `results`. `App.tsx` owns all state (initiatives, knowledge sources, analysis, run, notices) with no router or state library; navigation tabs are gated by the `enabled` map.

Key flow:
- `src/lib/ingest.ts` takes uploaded files (`.csv`, `.json`, `.xlsx`, `.zip` via `fflate`) and classifies each as initiatives, a knowledge source, or an analysis. `csv.ts` parses CSV; `classify()` picks icons/kind from filename keywords.
- `src/lib/analysis.ts` normalizes loosely-shaped JSON into the strict `Analysis` type (`src/types.ts`) — every field is optional on input, and it throws if nothing recognizable is present.
- Since no analysis backend exists, the "pipeline" is a **replay**: `App.tsx` steps through `analysis.agents` one per `STEP_MS` and then marks the run `done`, which enables Results.
- Graph node colours come from `src/data/domains.ts`; theming is in `src/lib/theme.ts` + `src/styles.css` (Tabler icon webfont for icons).

The accepted input formats and the full analysis JSON schema are documented in `frontend/DATA_FORMAT.md` — update it when changing `types.ts` or the normalizers.
