# PI Planning Assistant ("Co-Pilot for PI")

Hackathon build of the local-first, agentic PI-planning assistant: pick initiatives, watch
the agents find systems, dependencies, a sequence and risks, inspect the evidence behind
each finding, challenge or approve, and export Jira link proposals. Everything runs on one
laptop. Only text snippets of the synthetic data go to the Claude API, and only when an API
key is set.

```
pi-planning-assitant/
├── data/       Haverstone case-study sources (S1–S10)            → data/README.md
├── backend/    FastAPI + LangGraph agents, context store, evals   → backend/README.md
├── frontend/   React + Vite 8 UI (Intake → Analysis → Results)    → frontend/FRONTEND_DESIGN.md
├── ARCHITECTURE.md                     decisions, deviations, open questions
└── AGENT_ARCHITECTURE_CONSIDERATIONS.md
```

## Run locally

Prerequisites: Python 3.11+ and Node 20.19+ or 22.12+ (Vite 8 does not run on older Node).

**1. Backend** (terminal 1)

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements-dev.txt
copy .env.example .env        # optional: put ANTHROPIC_API_KEY in .env
.\.venv\Scripts\python.exe -m uvicorn app.main:app --reload --port 8000
```

**2. Frontend** (terminal 2)

```powershell
cd frontend
npm install
npm run dev                   # http://localhost:5173 (proxies /api to :8000)
```

With the backend running, the Intake screen lists its initiatives and loaded sources. Search
or filter the list, tick up to 15 initiatives (`MAX_INITIATIVES_PER_RUN`), and **Analyse**
runs the agents on the backend for the ticked ones. One uploaded file adds at most 100
initiatives (`MAX_UPLOAD_INITIATIVES`). Without the backend, the UI works offline from
uploaded files as before.

Or, after both installs, run `.\start-dev.ps1` from the root to start both in new windows.

**3. Data.** The backend reads the case-study files from the root `data/` folder, in any
sub-folder (the expected files, columns and Haverstone header mappings are in
[data/README.md](data/README.md)). After changing files, restart the backend (or
`POST /api/sources/reload`) and refresh the page. `GET /api/sources` shows each source as
Ready, Partial, Invalid or Missing, with the row errors, so a header mismatch is visible
straight away.

## Modes

| Situation | What happens |
|---|---|
| `ANTHROPIC_API_KEY` set | Claude Sonnet 5.5 does extraction and explanations; algorithms still decide order and risk |
| No key, or `LLM_PROVIDER=none` | Rule-based extraction and template explanations; a banner says so; the Ask chat is unavailable |
| A source is missing | Steps that need it are skipped and listed as "Not checked" in the results |

## Checks

```powershell
cd backend
python -m pytest                       # unit, pipeline and API tests on a synthetic fixture
python -m evals.run all --mode rule    # after adding data
python -m evals.gate                   # release gate: exit code 1 on any missing or failing metric
cd ..\frontend
npm run build                          # type-check and production build
```
