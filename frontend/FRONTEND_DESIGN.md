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

This document describes the **browser front end only**. It implements the four wireframe screens (Intake → Agent pipeline → Results → Results with reasoning drawer). With the FastAPI backend running it starts and polls real runs and drives the review; without it, it replays an uploaded analysis file.

**In scope now:** intake, analysis workflow viewer, results with a decision summary, reasoning drawer, review and export, help, theming.
**Out of scope now:** authentication (the backend's demo roster stands in), persistence of drafts, the Ask chat, real Jira/ADO/Confluence connectors.

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
- **Initiatives panel** — drag/drop or click-to-upload zone showing the limits (initiatives per file, initiatives per analysis), search box plus team / PI filters, a tick box per row with a `n / limit selected` pill (boxes disable at the limit), *Select shown*, *Clear selection*, *Selected only*, *Remove all*, per-row remove, inline "Add initiative" form. New uploads are ticked while there is room; the rest are reported in a notice.
- **Knowledge base panel** — one row per source (icon by type, name, row counts, status badge). With the backend: every source it knows, with its real status (Ready, Partial, Invalid, Missing), read-only, and *Reload from the data folder*. Without it: uploaded files, each removable, and *Add knowledge source* opens the file picker.
- **Notices** — a compact, scrollable list of results from each upload (success/error per file), dismissible.
- **Footer** — live counts; *Save draft* (disabled, not built); *Analyse initiatives* (disabled until ≥ 1 initiative; shows *Starting…* and ignores further clicks until the backend answers, so one click starts one run).

### 4.2 Analysis (agent pipeline)
- **Run bar** — status ("Ready", "Analysing…", "Analysis complete"), counts, total time, and actions: *Back to intake*, *Run again (new run)* for a backend run (it costs LLM calls again) or *Replay* for an uploaded file, *View results* (enabled when done).
- **Pipeline strip** — one clickable circle per agent: waiting (dashed), running (spinner), done (check); progress bar underneath.
- **Findings column** — two views and an initiative filter. *Summary*: run totals (systems touched, dependencies needing a change, awareness-only, confirmed both ways) and one card per initiative (systems split by type with owning teams, its dependencies needing a change, risks, sequence step). *Findings by initiative*: collapsible groups per initiative plus *Across initiatives*; type chips, *Hide no-change links* (on by default), expand / collapse all. Each finding is one line: hover shows a preview card, double-click / chevron / Enter expands it inline. Findings are revealed progressively during a run; *Knowledge sources used* is collapsed underneath.
- **Agent details column** — for the selected agent: state and duration, summary, inputs, outputs, notes, and the findings it contributed. Defaults to the running agent, else the last finished.
- **Empty state** — if no analysis is loaded: explanation, *Upload analysis file*, *File format help*, *Back to intake*.
- The screen stays reachable after a run (via step tab or the *How was this analysed?* link on Results). It does **not** auto-advance, so users can inspect before moving on.

### 4.3 Results
- **Decision summary** (top) — what to take away before any chart. Left: the *Recommended order* (one line per step) and the summary paragraph, labelled as written by the LLM or a template. Right: *Before PI planning* — links not in Jira yet, risks grouped by the rule that raised them (click opens the first), links that need a change but were only inferred, and the risk checks that did not run or ran on partial data ("no flag there does not mean no risk"). Below it, for a backend run, the **review panel** (§4.5).
- **Stat row** — initiatives analysed, dependencies needing a change (by type, and how many need none), not in Jira yet, risk flags by severity, confirmed. All derived from the data, nothing stored. (Older files without dependency rows get the original four cards.)
- **Filter bar** — initiative, *Only dependencies that need a change* (on by default), level (Initiative / Team / System). One set of filters drives the graph, the lists and the caption.
- **Dependency graph** — SVG in two columns: the selected initiatives on the left in sequence order, what they depend on (other initiatives, teams, systems) on the right, labels beside the nodes, so the graph grows in height instead of crowding (the box scrolls). Nodes coloured by ART and shaped by level (initiative circle, team square, system diamond; team labels end in "team"); stated edges solid grey, edges inferred from code or ownership dashed blue, no-change edges faint; links between two selected initiatives arc beside the left column. Hover an edge for its reason. Click/Enter on a node opens the node drawer. Older files without an initiative list keep the ring layout.
- **Side panel** — tabs: *Dependencies* (grouped by change type; each row expands to its hop path, per-method reasons, verdict and evidence), *Teams* (the same rows grouped by the team they ask something of, busiest team first, with a "no owning team" group), *Risks* (severity-coded list, flagged ones marked), *Sequence* (steps with their reason, plus the shared-system links to coordinate within a step).
- **Node drawer** — "Why is this here?": what pulled the node in, what depends on it and what it depends on (each expandable), the risks involving it, and a key to the change types.
- **Header actions** — *Export* (downloads the analysed initiatives, flagged risks and the analysis as JSON; it can be uploaded again to replay), *New analysis* (clears the run, keeps loaded data).

Words used everywhere: *stated* = written down in Jira, Confluence or Slack; *inferred* = found in code manifests or the ownership map; *confirmed* = both (per initiative and owning team, so a link can be confirmed by a related one, which its detail says).

### 4.4 Reasoning drawer
Slides over the right of the results area. Shows severity badge, title and the rule that raised it, **why the AI flagged this**, initiatives affected, knowledge sources used, and suggested follow-ups (disabled: not available in this version). Controls: previous/next risk, close, *Flag for PI planning* (per risk; saved on the backend for a live run, kept in the page for a replayed file, included in Export), *Copy reasoning* (clipboard).

### 4.5 Review and export (backend runs)
The run pauses for a human before anything is exported. The panel picks a reviewer from `GET /api/reviewers` (the server looks up the role; only RTE, EM and Architect may decide) and offers *Approve and export* or *Challenge the order…* ("A must come before B", with an optional note). The app then polls the run again: a challenge re-sequences and returns for review with the constraint listed; an approval writes the proposals and the panel links to *Jira link proposals (CSV)*, *Sequence note (Markdown)* and *Audit trail (JSON)*. Nothing is written to Jira. Errors (e.g. a view-only reviewer) show under the panel.

### 4.6 Global chrome
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
│   ├── AgentPipeline, AgentDetail, InitiativeSummary,
│   │   FindingGroups, FindingRow, SystemChips                  (analysis)
│   ├── DecisionSummary, ReviewPanel, StatRow, DependencyGraph,
│   │   SidePanel, ReasoningDrawer, NodeDrawer                  (results)
│   └── Badges, DepDetail, InitiativeFilter                     (shared)
├── lib/
│   ├── ingest.ts           files → initiatives / sources / analysis
│   ├── csv.ts              RFC-4180 CSV parser
│   ├── analysis.ts         tolerant JSON → Analysis normaliser
│   ├── deps.ts             change types, levels, verdicts: labels, icons, hints
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
| `runId`, `runStatus` | backend run id and status | kept after the run ends, for review, flags and exports |
| `review`, `flags`, `pending` | review state from the run | `pending` = a review was sent and the run is acting on it |
| `starting` | boolean | Analyse is waiting for the backend; blocks a second run |
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

### 5.5 Live runs and replay
With the backend, **Analyse** starts a run and `App.tsx` polls `GET /api/runs/{id}/analysis` every `POLL_MS`; agents, findings and results fill in as they arrive, and polling resumes after each review. Without it, **Analyse** replays a loaded `Analysis` one agent at a time (`STEP_MS` per agent). With no analysis loaded, the Analysis screen shows the empty state.

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

## 8. Backend integration
Done: the client in `src/api/client.ts` covers health, initiatives (list, add, upload), sources (list, reload), runs (start, poll the analysis view), reviewers, review, flags and export downloads. The UI polls rather than using the SSE stream (`GET /api/runs/{id}/events` exists). Not wired yet: the Ask chat (`POST /api/runs/{id}/ask`) and suggested follow-ups, *Save draft*, Excel parsing. The JSON-analysis upload stays as a replay / demo mode.

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
| 1 | Without the backend, Analysis/Results need an uploaded analysis JSON | start the backend for live runs |
| 2 | Initiatives are not edited once added (only removed) | minor |
| 3 | No persistence — refresh clears loaded data (theme is remembered) | consider `localStorage`/IndexedDB or backend drafts |
| 4 | Large datasets: initiative list renders all rows (90 is fine; thousands would need virtualisation) | future |
| 5 | Excel files are not parsed | listed only |
| 6 | Two-column graph: readable to ~15 initiatives and ~30 targets, edges still cross; no zoom/pan | filter to one initiative, or a layout lib at scale |
| 7 | No unit/e2e tests | add Vitest + Playwright |
| 8 | Contrast/focus-trap accessibility gaps (see §7) | audit before wider release |

**Questions for review**
1. Should the final analysis payload match the `Analysis` contract above, or should the contract change to fit the backend's native output?
2. Is a single-page app without routing acceptable, or do we need shareable URLs per screen / per analysis run?
3. Do we need multi-user concerns (auth, saved drafts, history of runs) in the first release?
4. Which themes should ship — all five, or one brand theme?
