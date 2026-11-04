# Backend — FastAPI + LangGraph

Local-first API and agent workflow for the PI Planning Assistant. Python 3.11+ (tested on 3.14).

## Run

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1          # macOS/Linux: source .venv/bin/activate
pip install -r requirements-dev.txt
copy .env.example .env                # then set ANTHROPIC_API_KEY (optional)
uvicorn app.main:app --reload --port 8000
```

Open http://localhost:8000/docs for the OpenAPI UI. `GET /api/health` reports what loaded,
whether the LLM is enabled, and any warnings.

- **No data yet?** The API starts and reports every source as missing. Add the files
  described in [../data/README.md](../data/README.md) anywhere under the root `data/` folder,
  then restart the backend (or `POST /api/sources/reload`).
- **No API key?** Everything runs in rule-based mode (name matching, cue-phrase extraction,
  template explanations), and the UI labels it. The Ask chat needs the LLM.

## Layout

| Folder | What lives there |
|---|---|
| `app/` | FastAPI app (`main.py`), settings (`config.py`), run manager (`runs.py`), identity and policy (`identity.py`), the UI's analysis view (`analysis_view.py`) |
| `agents/` | LangGraph nodes and the graph: `analyser`, `discovery` (3 tools), `verifier`, `sequencing`, `risk`, `visualisation`, `review` (human gate and export), `ask` (chat agent), `state.py` (typed contracts), `runtime.py` (budgets, traces, events) |
| `tools/` | Deterministic tools: rule extractor, citation and provenance checks, guardrails, graph algorithms, DRI rules, Jira baseline and exports |
| `context/` | Source catalogue and column contract, loader and validator, entity resolver, SQLite store, knowledge graph, BM25 index |
| `llm/` | Provider adapter (Anthropic) and the versioned prompt loader |
| `prompts/` | One Markdown prompt per LLM task; each version (`name@sha8`) is recorded on every trace span |
| `evals/` | Offline evals, thresholds, and the release gate. See [evals/README.md](evals/README.md) |
| `tests/` | pytest, run on a tiny synthetic fixture written to a temp dir |
| `runs/` | Per-run `events.jsonl`, `trace.jsonl`, `ask.jsonl`, `state.json` and `export/` (git-ignored) |

## API

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/health` | LLM status, data fingerprint, warnings |
| GET / POST | `/api/sources`, `/api/sources/reload` | Source reports: ready / partial / invalid / missing, with row errors |
| GET / POST | `/api/initiatives`, `/api/initiatives/upload` | List S1 + session initiatives; add manually; upload a CSV (validated like S1) |
| GET | `/api/reviewers` | Demo roster and who may approve |
| POST | `/api/runs` | Start a run: `{"initiative_ids": [...]}` |
| GET | `/api/runs`, `/api/runs/{id}` | Run list; run view with the full state |
| GET | `/api/runs/{id}/analysis` | The run in the UI's `Analysis` contract (`frontend/src/types.ts`); poll it while the run is in progress |
| GET | `/api/runs/{id}/events` | Server-sent events (`?after=<seq>` or `Last-Event-ID` to resume) |
| POST | `/api/runs/{id}/review` | `X-Demo-User` header; `{"action": "approve"}` or `{"action": "challenge", "constraint": {"first", "then", "note"}}` |
| POST | `/api/runs/{id}/flags`, `/api/runs/{id}/ask` | Flag an item for PI planning; ask the explain agent |
| GET | `/api/runs/{id}/export/{file}` | Download an export (allow-listed names only) |

## Test and evaluate

```powershell
python -m pytest                          # 29 tests, no network, no API key
python -m evals.run all --mode rule       # once data is in place
python -m evals.run extraction --mode llm # LLM extractor vs the rule baseline
python -m evals.gate                      # exits 1 if any metric is missing or under its floor
```

## Changing things safely

- New column names → `context/sources.py` (aliases); `../data/README.md` documents the contract.
- Thresholds → `.env` (runtime) or `evals/thresholds.py` (gate). Set them before scoring.
- Prompts → edit `prompts/*.md`; the new version hash shows up in traces and the audit.
- A new LLM step → call `ctx.structured(...)`: it handles the budget, the span, and failures, and returns `None` so you keep a rule path.
