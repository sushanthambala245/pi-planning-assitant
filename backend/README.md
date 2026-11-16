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

## What a run does

The **knowledge base** is four sources: initiatives (S1), GitHub repositories (S4), team
capacity (S5) and the team directory (S6), plus the service ownership map (S7) read only as a
lookup of who owns each system, its lifecycle and its contract status. Every other source is
reported as `off` (`ACTIVE_SOURCES` in `.env`; `all` switches every source on).

Only initiatives whose S1 `status` is in `READY_STATUSES` (default *Ready for PI Planning*) can
be analysed; *Proposed* and *In Discovery* ones are listed but left out, and the analysis view
says so. A run answers three questions:

1. **Declared**: the dependencies the teams wrote down (S1 `dependency`, "Upstream: …;
   Downstream: …") and their target quarters, and whether those quarters hold.
2. **Hidden**: dependencies nobody declared, found in the descriptions (and planner notes), the
   GitHub manifests (repo-to-repo and shared-library links between teams) and shared systems;
   counted, and sorted by what they do to the plan.
3. **Sequence**: every initiative by quarter, at its T-shirt size (`TSHIRT_POINTS`) against its
   team's capacity per quarter, after what it waits for, higher priority first
   (`tools/planning.py`).

A planner's notes, T-shirt sizes, quarter placements and keep / dismiss decisions are sent with
the next run (`planner` on `POST /api/runs`) and change all three.

## Layout

| Folder | What lives there |
|---|---|
| `app/` | FastAPI app (`main.py`), settings (`config.py`), run manager (`runs.py`), identity and policy (`identity.py`), the UI's analysis view (`analysis_view.py`) |
| `agents/` | LangGraph nodes and the graph: `analyser`, `discovery` (4 tools: declared, stated, code, ownership), `verifier`, `sequencing`, `risk`, `visualisation`, `review` (human gate and export), `ask` (chat agent), `state.py` (typed contracts), `runtime.py` (budgets, traces, events) |
| `tools/` | Deterministic tools: the planning engine (`planning.py`: readiness, T-shirt sizes, velocity, the quarter schedule), dependency classification, rule extractor, citation and provenance checks, guardrails, graph algorithms, DRI rules, Jira baseline and exports |
| `context/` | Source catalogue and column contract, loader and validator, entity resolver, SQLite store, knowledge graph, BM25 index |
| `llm/` | Provider adapter (Anthropic) and the versioned prompt loader |
| `prompts/` | One Markdown prompt per LLM task; each version (`name@sha8`) is recorded on every trace span |
| `evals/` | Offline evals, thresholds, and the release gate. See [evals/README.md](evals/README.md) |
| `tests/` | pytest, run on a tiny synthetic fixture written to a temp dir |
| `runs/` | Per-run `events.jsonl`, `trace.jsonl`, `ask.jsonl`, `state.json` and `export/` (git-ignored) |

## API

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/health` | LLM status, data fingerprint, limits, ready statuses, the planning scale (T-shirt points, sprints per quarter, velocity tiers), warnings |
| GET / POST | `/api/sources`, `/api/sources/reload` | Source reports: ready / partial / invalid / missing / off, with row errors |
| GET / POST | `/api/initiatives`, `/api/initiatives/upload` | List S1 + session initiatives (each with `status`, `ready`, `tshirt_size`, `dependency_text`); add manually; upload a CSV (validated like S1) |
| GET | `/api/reviewers` | Demo roster and who may approve |
| POST | `/api/runs` | Start a run: `{"initiative_ids": [...], "planner": {"initiative_notes", "sizes", "quarters", "dependency_notes", "dependency_decisions"}, "previous_run_id": "..."}` (planner and previous run optional; a rerun copies the previous run's comments on these initiatives); 400 if an initiative is not ready |
| GET | `/api/runs`, `/api/runs/{id}` | Run list; run view with the full state |
| GET | `/api/runs/{id}/analysis` | The run in the UI's `Analysis` contract (`frontend/src/types.ts`); poll it while the run is in progress |
| GET | `/api/runs/{id}/events` | Server-sent events (`?after=<seq>` or `Last-Event-ID` to resume) |
| POST | `/api/runs/{id}/review` | `X-Demo-User` header; `{"action": "approve"}` or `{"action": "challenge", "constraint": {"first", "then", "note"}}` |
| POST | `/api/runs/{id}/flags`, `/api/runs/{id}/ask` | Flag an item for PI planning; ask the explain agent |
| GET / POST | `/api/runs/{id}/comments`, `/api/runs/{id}/comments/{cid}/resolve`, `/api/runs/{id}/comments/export` | Live per-initiative comments (`?rev=` returns `unchanged` when nothing moved); resolve one (reviewers or the author); download them as CSV. Author and role come from `X-Demo-User` |
| GET | `/api/runs/{id}/export/{file}` | Download an export (allow-listed names only) |

## Test and evaluate

```powershell
python -m pytest                          # no network, no API key
python -m evals.run all --mode rule       # once data is in place
python -m evals.run extraction --mode llm # LLM extractor vs the rule baseline
python -m evals.gate                      # exits 1 if any metric is missing or under its floor
```

## Changing things safely

- New column names → `context/sources.py` (aliases); `../data/README.md` documents the contract.
- Sizes, sprints, velocity tiers, readiness → `.env` (`TSHIRT_POINTS`, `SPRINTS_PER_PI`, `VELOCITY_TIERS`, `READY_STATUSES`); see `.env.example`.
- Thresholds → `.env` (runtime) or `evals/thresholds.py` (gate). Set them before scoring.
- Prompts → edit `prompts/*.md`; the new version hash shows up in traces and the audit.
- A new LLM step → call `ctx.structured(...)`: it handles the budget, the span, and failures, and returns `None` so you keep a rule path.
