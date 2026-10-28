# PI Planning Assistant — Front-end Design

| | |
|---|---|
| **Status** | Draft for review |
| **Branch / PR** | `feature` · [PR #1](https://github.com/sushanthambala245/pi-planning-assitant/pull/1) |
| **Location** | `frontend/` |
| **Stack** | React 18 · TypeScript · Vite 8 · plain CSS (variables) · Tabler icons · `fflate` (zip) |
| **Related** | `Wireframe/pi-planner-wireframe.html`, `Architecture/pi-planner-hackathon-architecture.html`, [`DATA_FORMAT.md`](DATA_FORMAT.md) |

---

## 1. Purpose and scope

The PI Planning Assistant helps programme teams prepare for PI (Program Increment) planning. A user loads a set of initiatives and supporting knowledge sources; a chain of AI agents analyses them to find dependencies, recommend a sequence and flag risks; the UI explains *why* each finding was made.

This document describes the **browser front end only**. It implements the four wireframe screens (Intake → Agent pipeline → Results → Results with reasoning drawer) and is built so that the planned FastAPI + SSE backend can be plugged in without reworking the UI.

**In scope now:** intake, analysis workflow viewer, results, reasoning drawer, help, theming.
**Out of scope now:** the analysis engine, authentication, persistence (drafts), real Jira/ADO/Confluence connectors.

## 2. Design principles

1. **Explainability first.** Every AI conclusion is one click from its reasoning, inputs and sources.
2. **No built-in data.** The app starts empty; all content comes from uploaded files or (later) the backend.
3. **Backend-ready.** One typed data contract (`Analysis`) is the only thing the screens render; where it comes from is swappable.
4. **Honest UI.** Features that don't work yet are disabled with a tooltip rather than faked.
5. **Themeable by variables.** No colour is hard-coded in components, so a palette is one CSS block.

## 3. User flow

```
 Intake ──(Analyse)──▶ Analysis ──(View results)──▶ Results ──(click risk / node)──▶ Reasoning drawer
   ▲                      ▲  │                          │
   └──────(New analysis)──┼──┴──(How was this analysed?)┘
                          └── step tabs allow jumping between unlocked screens at any time
```

| Screen | Purpose | Unlocked when |
|---|---|---|
| **Intake** | Load initiatives + knowledge sources (upload or manual) | always |
| **Analysis** | Watch/inspect the agent workflow; click an agent for details | initiatives loaded or analysis loaded |
| **Results** | Stats, dependency graph, risks, sequence, AI summary | run is complete |

The step bar in the header is both progress indicator and navigation; locked steps are greyed with a tooltip explaining how to unlock them.

## 4. Screens

### 4.1 Intake
- **Initiatives panel** — drag/drop or click-to-upload zone, scrollable list (title, description, `id · team · priority · PI`), per-row remove, inline "Add initiative" form.
- **Knowledge base panel** — one row per source (icon by type, name, row/column counts, "Ready" badge, remove), "Add knowledge source" opens the file picker.
- **Notices** — a compact, scrollable list of results from each upload (success/error per file), dismissible.
- **Footer** — live counts; *Save draft* (disabled, not built); *Analyse initiatives* (disabled until ≥ 1 initiative).

### 4.2 Analysis (agent pipeline)
- **Run bar** — status ("Ready", "Analysing…", "Analysis complete"), counts, total time, and actions: *Back to intake*, *Start / Re-run analysis*, *View results* (enabled when done).
- **Pipeline strip** — one clickable circle per agent: waiting (dashed), running (spinner), done (check); progress bar underneath.
- **Findings column** — findings revealed progressively during a run, all findings once complete; plus *Knowledge sources used*.
- **Agent details column** — for the selected agent: state and duration, summary, inputs, outputs, notes, and the findings it contributed. Defaults to the running agent, else the last finished.
- **Empty state** — if no analysis is loaded: explanation, *Upload analysis file*, *File format help*, *Back to intake*.
- The screen stays reachable after a run (via step tab or the *How was this analysed?* link on Results). It does **not** auto-advance, so users can inspect before moving on.

### 4.3 Results
- **Stat row** — initiatives analysed, dependencies (and how many inferred), risk flags by severity, recommended sequence length. All derived from the data, nothing stored.
- **Dependency graph** — SVG; nodes coloured by domain, explicit edges solid grey, AI-inferred edges dashed blue. Click/Enter on a node opens the first risk involving it. Non-involved nodes dim while a risk is open.
- **Side panel** — tabs: *Risks* (severity-coded list), *Sequence*, *Dependencies* (explicit vs inferred).
- **AI summary strip** — recommended sequence and key risk, with a link back to the Analysis screen.
- **Header actions** — *Export* (downloads `{ initiatives, analysis }` as JSON), *New analysis* (clears the run, keeps loaded data).

### 4.4 Reasoning drawer
Slides over the right of the results area. Shows severity badge, **why the AI flagged this**, initiatives affected, knowledge sources used, and suggested follow-ups (disabled until the backend exists). Controls: previous/next risk, close, *Flag for PI planning* (local toggle), *Copy reasoning* (clipboard).

### 4.5 Global chrome
- **Step bar** (Intake · Analysis · Results) — navigation + progress.
- **Theme picker** (palette icon) — five themes, persisted in `localStorage`.
- **Help** (`?` icon) — right-hand drawer with tabs *Screens*, *Buttons* (current screen's buttons listed first), *Data files*.
- **Layout** — fills the browser window; header on top, footer bar pinned to the bottom, lists and graph scale with window size; below ~860px columns stack.

## 5. Architecture

### 5.1 Structure

```
frontend/src
├── App.tsx                 app state, navigation, run simulation, export
├── main.tsx                entry; applies saved theme before first paint
├── types.ts                domain types (Initiative, Analysis, Run, …)
├── styles.css              themes (CSS variables) + all component styles
├── screens/                IntakeScreen · PipelineScreen · ResultsScreen
├── components/
│   ├── TopBar, ThemePicker, HelpDrawer, EmptyState
│   ├── InitiativeList, KnowledgeBaseList                       (intake)
│   ├── AgentPipeline, AgentDetail, FindingCard                 (analysis)
│   └── StatRow, DependencyGraph, SidePanel, ReasoningDrawer    (results)
├── lib/
│   ├── ingest.ts           files → initiatives / sources / analysis
│   ├── csv.ts              RFC-4180 CSV parser
│   ├── analysis.ts         tolerant JSON → Analysis normaliser
│   └── theme.ts            theme list, persistence
└── data/domains.ts         domain → node colour
```

### 5.2 State
State is held in `App` with `useState` (no state library — the app is small and linear):

| State | Type | Notes |
|---|---|---|
| `screen` | `'intake' \| 'pipeline' \| 'results'` | no router; screens are mounted conditionally |
| `initiatives`, `sources` | arrays | merged by `id` on every upload (re-upload updates, never duplicates) |
| `analysis` | `Analysis \| null` | the single contract the Analysis/Results screens render |
| `run` | `{ status: idle \| running \| done, current }` | `current` = index of running agent |
| `notices`, `helpOpen` | UI state | |

Screen-local state (selected agent, open risk, active side tab, add-form) lives in the screen/component that uses it. Navigation availability is computed in `App` (`enabled`) and passed to `TopBar`.

### 5.3 Data flow

```
 files ──▶ ingestFiles() ──▶ { initiatives, sources, analysis?, notices }
                                   │            │            │
                                   ▼            ▼            ▼
                              App state ──▶ screens render from state only
```

`ingestFiles` accepts `.csv`, `.json`, `.xlsx/.xls`, `.zip` (unzipped in-browser with `fflate`):

- **CSV with `initiative_id` + `initiative_name`/`title`/`name`** (and no `statement_id`/`epic_id`) → initiatives. **Any other CSV** → knowledge source (classified for icon/colour by filename keywords).
- **JSON** → array of initiatives, a bundle (`initiatives`, `knowledgeSources`, `analysis`), or a bare analysis object.
- **Excel** → listed as a knowledge source, not parsed.
- Errors are reported per file as notices; one bad file doesn't block the rest.

### 5.4 The `Analysis` contract
The Analysis and Results screens render only this shape (full spec in [`DATA_FORMAT.md`](DATA_FORMAT.md)):

```
Analysis { agents[], findings[], sourcesUsed[], graph{nodes[],edges[]}, risks[], sequence[], keyRisk? }
```

`normalizeAnalysis` fills defaults for missing fields, so partial payloads work. Graph nodes without coordinates are auto-laid-out on an ellipse; with > 6 nodes the graph switches to compact dots with labels underneath.

### 5.5 Run simulation (temporary)
Until a backend exists, **Analyse** replays a loaded `Analysis` one agent at a time (1.2 s per agent, `STEP_MS` in `App.tsx`) so the workflow screen behaves as it will with live streaming. With no analysis loaded, the Analysis screen shows the empty state.

## 6. Theming and visual design

All colours are CSS variables defined per theme in `styles.css` and switched with `<html data-theme="…">`.

| Theme | Character |
|---|---|
| **Slate Blue** (default) | calm, neutral, professional |
| Corporate Purple | bold, brand-forward |
| Emerald Fintech | fresh, finance-friendly |
| Sunset Terracotta | warm |
| Midnight | dark mode |

Token groups: surfaces (`--bg`, `--surface`, `--surface1/2`), borders, text (`--text`, `--muted`, `--hint`), accent (+ bg/border/on-accent), semantic (success / danger / warn + backgrounds), `--shadow`, `--overlay`. Components use only these, so adding a theme = one new block + one entry in `lib/theme.ts`.

- **Typography** — system UI font stack; 12–13px body, 11px minimum for secondary text; 500–600 weights.
- **Domain colours in the graph** are data encodings (Platform blue, Compliance green, Product amber, Data pink, Other grey) and are intentionally the same in every theme.
- **Icons** — Tabler webfont (`ti ti-…`).
- **Motion** — short (≤ 0.2 s) transitions, drawer slide-in, spinner on the running agent.

## 7. Accessibility
- Step tabs, agent circles, risks, graph nodes and theme options are real `<button>`s or have `role="button"` + keyboard handlers (Enter/Space); graph nodes have `aria-label`s.
- Step bar uses `aria-current="step"`; side tabs use `role="tablist"/"tab"` with `aria-selected`; progress bar has `role="progressbar"`.
- Icon-only buttons have `aria-label`s; decorative icons are `aria-hidden`.
- Visible `:focus-visible` outline; Esc closes the help drawer and theme popover.
- Notices use `aria-live="polite"`.
- **Known gaps:** colour contrast has not been audited per theme; the help drawer doesn't trap focus; the SVG graph isn't fully navigable by keyboard beyond tabbing between nodes.

## 8. Backend integration plan
1. Add a small API client (`src/api/`) for `POST /analyses` (start) and `GET /analyses/:id/events` (SSE).
2. Replace the timer in `App.tsx` with SSE events that update `analysis` incrementally (agent state, findings, then graph/risks) — the screens already render partial data (`run.current`, progressive findings).
3. Replace file-based `knowledgeSources` with backend-registered sources; keep upload as a fallback.
4. Wire the disabled controls: *Save draft*, suggested follow-up prompts (chat endpoint), Excel parsing, *Add knowledge source* connectors.
5. Remove the JSON-analysis upload path or keep it as a developer/demo mode.

## 9. Build, run, quality
```bash
cd frontend
npm.cmd install        # (PowerShell: use npm.cmd to avoid script-policy errors)
npm.cmd run dev        # http://localhost:5173
npm.cmd run build      # tsc type-check + production build to dist/
```
- Strict TypeScript, `noUnusedLocals/Parameters`.
- `npm audit`: 0 vulnerabilities (Vite 8, plugin-react 6).
- **No automated tests yet.** Verification so far is type-checking, production builds and manual browser walkthroughs (upload of the provided `data_sources_1.zip` → 90 initiatives / 10 sources; sample analysis → workflow, results, drawer, themes, help).

## 10. Known limitations and open questions
| # | Item | Impact |
|---|---|---|
| 1 | No analysis engine; Analysis/Results need an uploaded analysis JSON | cannot demo end-to-end from CSVs alone |
| 2 | Initiatives are not edited once added (only removed) | minor |
| 3 | No persistence — refresh clears loaded data (theme is remembered) | consider `localStorage`/IndexedDB or backend drafts |
| 4 | Large datasets: initiative list renders all rows (90 is fine; thousands would need virtualisation) | future |
| 5 | Excel files are not parsed | listed only |
| 6 | Graph layout is naive (ellipse) for many nodes; no zoom/pan | needs a layout lib at scale |
| 7 | No unit/e2e tests | add Vitest + Playwright |
| 8 | Contrast/focus-trap accessibility gaps (see §7) | audit before wider release |

**Questions for review**
1. Should the final analysis payload match the `Analysis` contract above, or should the contract change to fit the backend's native output?
2. Is a single-page app without routing acceptable, or do we need shareable URLs per screen / per analysis run?
3. Do we need multi-user concerns (auth, saved drafts, history of runs) in the first release?
4. Which themes should ship — all five, or one brand theme?
