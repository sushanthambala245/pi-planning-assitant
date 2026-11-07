# Changes Log

All changes are isolated to `backend/` and `frontendV2/`. The original `frontend/` directory is untouched.

---

## FrontendV2 — UX improvements

### `frontendV2/src/components/TopBar.tsx`
- Added `connected` and `llmStatus` props.
- Added persistent **LLM status chip** in the top-right action bar with three states:
  - `llm-on` (green) — LLM enabled, shows model name (e.g. `gpt-4o`).
  - `llm-rule` (amber) — backend connected but LLM disabled; shows `Rule-based`.
  - `llm-off` (red) — backend unreachable; shows `Offline`.

### `frontendV2/src/components/InitiativeList.tsx`
- **Compact mode on by default** — cards show only title + team/PI pills; descriptions and IDs are hidden. Toggle with the density button.
- **Merged toolbars** — filter bar (search, team, PI dropdowns) and selection controls (`0/15` pill, Select, Clear, Selected toggle, density button) are now a single row.
- **Hover-reveal trash** — "Remove all" button is hidden by default; appears on hover of the section header.
- **Improved empty states** — icon + label + sub-label structure for "No initiatives yet" and "No matches".

### `frontendV2/src/components/KnowledgeBaseList.tsx`
- Removed verbose `section-sub` description block.
- Section title now shows inline count pill (`10 loaded · 4 missing`).
- KB item name strips the ` (S1)` parenthetical suffix.
- KB item meta shows only the row count (strips the file path).
- Empty states use icon + label + sub-label structure.

### `frontendV2/src/screens/IntakeScreen.tsx`
- Replaced verbose `cta-note` text with three **stat pills** in the bottom bar:
  - `0/15 selected` (turns purple when non-zero).
  - `N initiatives` (total loaded).
  - `N sources` (turns purple when > 0).
- Removed "Save draft" button.

### `frontendV2/src/screens/PipelineScreen.tsx`
- Added `connected` prop.
- Split the `!analysis` empty state into two distinct branches:
  - **Backend not reachable** — shown when `connected` is false. Actions: Upload analysis file + How to start the backend.
  - **Ready to analyse** — shown when connected but no run started. Actions: Go to Intake + Upload analysis file.

### `frontendV2/src/components/DecisionSummary.tsx`
- **Recommended order chips** — each initiative in a step now renders as a purple chip instead of a long `+`-joined sentence, making parallel-step groups easy to scan.
- **Removed "Paragraph built from a template" note** — the method label is suppressed for rule-based summaries; it only appears when the LLM authored the paragraph.

### `frontendV2/src/App.tsx`
- Added `llmStatus` state populated from `/api/health` response.
- Shortened the connection notice banner to a single compact line.
- Passes `llmStatus` and `connected` to `TopBar`.
- Passes `connected` to `PipelineScreen`.

### `frontendV2/src/styles.css`
New CSS classes added (existing classes unchanged):

| Class | Purpose |
|---|---|
| `.llm-chip`, `.llm-dot` | Persistent LLM status chip in TopBar |
| `.llm-on`, `.llm-rule`, `.llm-off` | Chip colour states (green / amber / red) |
| `.section-danger-btn` | Hover-reveal trash button on section headers |
| `.density-btn` | Card density toggle button |
| `.step-initiatives`, `.step-chip` | Chips in the recommended order list |
| `.list-empty`, `.list-empty-label`, `.list-empty-sub` | Icon + label + sub empty-state layout |
| `.upload-limit-chip` | Compact chips inside the upload drop zone |
| `.cta-stats`, `.stat-pill`, `.stat-pill.active` | Bottom-bar stat pills on IntakeScreen |

---

## What is NOT changed

- `frontend/` — original UI, completely untouched.
- `backend/` — no backend changes included in this commit (kept local only).
- `data/` — no data files changed.
