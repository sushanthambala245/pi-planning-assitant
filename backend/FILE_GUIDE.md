# Backend file guide

What every folder and file in `backend/` is for. For setup and the API reference, see
[README.md](README.md).

## The big picture first

The backend is a FastAPI server (`app/`) that runs a fixed pipeline of agents (`agents/`) over
the case-study data (`context/`), using plain-code tools (`tools/`) and, when an API key is
set, Claude (`llm/` + `prompts/`). The main rule throughout: **the LLM extracts and explains,
and code decides.** Orderings come from graph algorithms, risks come from rule functions, and
a claim is kept only if its quote is found word for word in a source document.

```
POST /api/runs  (app/main.py → app/runs.py starts a background thread)
  │
  ▼  the pipeline, wired in agents/graph.py
  load_context ─► analyser ─┬─► explicit_deps ─┐
                            ├─► code_deps ─────┼─► merge ─► verify ⇄ requery ─► sequencing ─► risk ─► visualisation ─► human_gate ─► export
                            └─► ownership_deps ┘                                     ▲                                    │
                                                                                     └──────── reviewer challenge ────────┘
  │
  ▼
GET /api/runs/{id}/analysis  (app/analysis_view.py turns the run into what the UI shows)
```

**Suggested reading order:** `agents/graph.py` (the pipeline), then `agents/state.py` (the
records passed between steps), then any single agent, then `context/snapshot.py` (what the
agents can read).

---

## Top-level files

| File | What it is |
|---|---|
| `.env` | Your local settings, including `ANTHROPIC_API_KEY`. Read once when the server starts, so restart after editing. Git-ignored: never commit it. |
| `.env.example` | The template for `.env`, with every setting and its default. Safe to commit. |
| `README.md` | Setup, the API endpoint table, test and eval commands. |
| `FILE_GUIDE.md` | This file. |
| `requirements.txt` | Python packages the server needs (FastAPI, LangGraph, pandas, NetworkX, Anthropic SDK…). |
| `requirements-dev.txt` | The above plus `pytest` and `httpx` for the tests. |
| `pyproject.toml` | Project name and Python version (3.11+), plus pytest settings. |

Every `__init__.py` is empty. It only marks a folder as a Python package so imports work.

---

## `app/` — the web server

The entry point. Receives HTTP requests, holds the loaded data in memory, starts and resumes runs.

| File | What it does |
|---|---|
| `main.py` | The FastAPI app and all 16 `/api/...` endpoints. At startup it loads `data/`, then serves health, sources, initiatives (list, add, CSV upload), runs (start, list, view, analysis, event stream), review (approve/challenge), flags, Ask and export downloads. |
| `config.py` | Reads every setting from the environment and `.env`: API key and model, data and runs paths, budgets, thresholds. Relative paths resolve from `backend/`, and `DATA_DIR` defaults to `../data`. Each run saves the settings it used. |
| `runs.py` | The run manager. Starts each pipeline run on a background thread, resumes it after a review, and writes its files to `runs/<run_id>/`. Run memory is in-process, so a restart can't resume a paused run (`state.json` stays readable). |
| `identity.py` | Who may do what. The UI sends an `X-Demo-User` header, and the role comes from a server-side roster, never from the request. A policy table says which roles may approve or challenge (RTE, EM, Architect). |
| `analysis_view.py` | Converts a run into the shape the new frontend expects (`frontend/src/types.ts`). It groups the 13 pipeline steps into the 6 agent cards, reports wait/active/done from progress events, lays out the graph, and maps severities (blocker→High, warning→Medium, info→Low). It also lists the run's initiatives, tags every finding with the initiatives it is about, splits each initiative's systems into services / APIs / datasets with their owning team, and builds one dependency row per graph edge with its change class from `tools/dep_classify.py`. It only presents data; it decides nothing. |

---

## `agents/` — the pipeline steps

Each agent is one step (a "node") in the LangGraph state machine. Every node reads the shared
run state, does one job, and writes its results back.

| File | What it does |
|---|---|
| `graph.py` | Wires the 14 nodes together: the order, the 4-way parallel fan-out of the discovery tools, the verify ⇄ requery loop (max 2 rounds), and the human gate that either exports or re-runs sequencing with a new constraint. Routing is plain code, not a model. |
| `state.py` | The typed records every step passes along: `Initiative`, `SystemTouch`, `Dependency`, `EvidenceRef` (pointer to the supporting quote or record), `SequenceStep`, `CapacityLine`, `Risk`, `Constraint`, `Approval`, and the overall `AgentState`. Pydantic validates them on write. |
| `runtime.py` | Per-run plumbing: the **budget** (max model calls, 90 by default; once spent, steps continue rule-based), the **tracer** (one log line per unit of work), the **event sink** (progress events the UI shows), and the **observed** list (every document a tool returned, used to reject citations of anything not actually retrieved). Also `ctx.structured(...)`, the one way agents call the LLM. |
| `review.py` | Three nodes. `load_context` sets up the run. `human_gate` pauses the run until someone approves or challenges via `POST /api/runs/{id}/review`. `export` writes the proposals after approval. Also builds the audit record. |
| `analyser.py` | **Initiative Analyser**, deterministic. Which shared systems each initiative touches, and how: the systems in its dependency column (S1 `dependency`: upstream ones it reads, downstream ones it writes, its own team's ones it changes) and the S7 system names its title, description or planner note mentions without declaring. Owners come from the S7 lookup. Only initiatives that are Ready for PI Planning reach it. |
| `discovery.py` | **Dependency Discovery**, four tools run in parallel. `declared_deps`: the user-defined dependency column (use case 1). `explicit_deps`: dependencies stated in a description or planner note but not declared ("blocked on", "requires", another team named), by the LLM or the rule extractor. `code_deps`: a repo of one team declares a dependency on a repo of another team with an initiative in the run (S4), counted only when the initiative builds on a system that team owns or the other initiative changes an interface (otherwise it is a team-level coupling, noted but not counted); and shared libraries an initiative's text names, which every team using them re-tests. `ownership_deps`: two initiatives touching one system, ordered when its owning team changes it (S7). The last three are the hidden dependencies (use case 2). They only propose candidates. |
| `verifier.py` | **Evidence Verifier.** `merge` dedupes candidates, keeps a dependency declared if any source declared it, and applies the planner's keep / dismiss decisions and notes from the previous run. `verify` rejects anything without citable evidence and marks weak ones low-confidence (below 0.6). `requery` asks a narrow yes/no follow-up question about low-confidence ones (max 2 rounds). |
| `sequencing.py` | **Sequencing** (use case 3). Orders the work by the verified ordering links plus reviewer constraints (a cycle becomes one flagged step), then schedules each initiative by quarter with `tools/planning.py`: its T-shirt size in story points against its team's capacity per quarter (S5), never before its target quarter (or a planner's placement), after everything it waits for, higher priority first. Also checks the plan as written for conflicts. The LLM only writes the "why" for each step. |
| `risk.py` | **Risk.** Runs the DRI rules (`tools/dri_rules.py`), which decide every flag and severity. The LLM only writes the explanation, and invented risk ids are ignored. |
| `visualisation.py` | **Visualisation.** Graph data, the counted facts the summary tiles are built from, sequence text and key risk. No text is generated here. |
| `ask.py` | **Ask agent**, the chat. Not part of the pipeline: called by `POST /api/runs/{id}/ask`. The only part that picks its own steps, a tool loop with safety checks before and after (see `tools/guardrails.py`). Needs the API key, and the new frontend doesn't expose it. |

---

## `context/` — loading and understanding the data

Runs at startup. Turns the files under `data/` into one read-only `ContextSnapshot` the agents query.

| File | What it does |
|---|---|
| `sources.py` | **The data catalogue.** Every expected source (S1–S10 Haverstone files, M1–M4 mock sources), its file name(s) (alternatives may be globs, e.g. `initiatives_updated*.csv`), required and optional columns, and **aliases** that map the Haverstone headers onto those columns (e.g. `initiative_name` → `title`, `T-Shirt Sizing` → `tshirt_size`). `KNOWLEDGE_BASE` lists the sources the agents read (S1, S4, S5, S6, plus S7 as a lookup); `ACTIVE_SOURCES` in `.env` overrides it. Edit here if a file's columns change. |
| `loader.py` | Finds each source anywhere under `data/` (among several matches of a glob, the most recently saved file wins), checks its columns and rows, and reports each as ready, partial (some rows rejected), invalid (required column missing), missing, or off (not part of the knowledge base, so not read). Nothing is guessed or filled in. Also turns text into documents for search. |
| `resolver.py` | **Entity resolution**: maps the names written in the data ("Payments team", "payments") onto the canonical team, service, repo and initiative names. Exact match first, then a suffix-free match, then a fuzzy match (≥ 0.86). Below that it reports "unresolved" rather than guessing. |
| `snapshot.py` | Builds the `ContextSnapshot`. Resolves names in every table (keeping the original in a `<column>_raw` column), builds the **knowledge graph** (teams, services, repos, initiatives and their links, in NetworkX) and record ids such as `S7:<service>` that evidence can point at. |
| `index.py` | The **search index** over free text (initiative titles, descriptions and dependency columns, and planner notes). Splits text into ~800-character chunks with stable ids and ranks them with BM25 (keyword search). Includes `rrf()` for adding a semantic search later. |
| `store.py` | Every loaded CSV as a table in an in-memory SQLite database, for exact lookups. Queries are fixed and parameterised; the model never writes SQL. |

---

## `tools/` — deterministic helpers

Plain functions with no LLM. These make the decisions the agents report.

| File | What it does |
|---|---|
| `dri_rules.py` | **The risk rules (DRI-X-001…008)** as code: X-001 cycle, X-002 a dependency on a system with no owner (S7), X-003 a team over capacity (S5), X-004 a deprecated repository (S4) or system (S7), X-005 a missing or draft interface contract (S7 contract status; Confluence pages when loaded), X-006 the plan as written does not hold (a provider targeted at a later quarter than its consumer, or a provider still running in its consumer's quarter, targeted there too or spilling into it, so the consumer cannot finish in it), X-007 dependency only in an informal channel, X-008 control sign-off unscheduled. A rule whose source is not in the knowledge base reports "not checked". `_history` raises severity when the teams involved often missed past PIs (S8, off by default). |
| `graph_tools.py` | Graph algorithms: build the initiative graph (edges point provider → consumer, from the links that order the plan), find cycles, order into steps. `to_cytoscape` builds the graph data saved in the run state (the old UI's format). The new frontend's graph is built in `app/analysis_view.py` instead. |
| `dep_classify.py` | **What each verified dependency asks of people**: a code change, a flow / integration change, regression testing, or nothing (awareness only), each with the reason that decided it. Also its provenance (declared, planner, stated in the text, inferred), what it does to the plan (changes the order, should go first, coordinate, re-test, awareness), the level of the target (initiative / team / system), the hops that led there, and whether stated and inferred evidence agree. A view only: it never adds, drops or re-scores a dependency. |
| `planning.py` | **The planning engine**, no LLM: the readiness rule (`is_ready`), the T-shirt scale (`TSHIRT_POINTS`), team velocity tiers, the dependency-column parser, the quarter calendar, and the list scheduler that places each initiative by sprint against its team's remaining capacity, with the reason for every move. Every number the UI shows about sizes, quarters and load comes from here. |
| `citations.py` | **Grounding checks.** A quote counts only if its document was retrieved in this run and the quote appears in it word for word (ignoring case and spacing). A structural claim counts only if its record exists. Also audits the Ask agent's citations. |
| `wording.py` | Text people read: `plural()`, and the dependency ids inside model-written text. `strip_dep_refs` removes `[dep-…]` ids (also grouped ones) before the UI shows a rationale; `reads_without_refs` is the check that rejects a rationale which only makes sense with the ids in it. `has_values` tells an empty optional column from a filled one. |
| `text_tools.py` | Gathers the documents an agent reads for an initiative: its own text and its planner note. Registers each as "observed" and wraps them for the prompt. Includes the **attribution guard**: evidence about an initiative must come from that initiative's own documents or from shared ones. |
| `rule_extractor.py` | The no-LLM extractors: service names found in text, and dependency phrases ("blocked on", "waiting for"…) followed by a known name in the same sentence. Used when there's no API key, and as the baseline the LLM is measured against. |
| `guardrails.py` | Safety checks for the Ask chat, cheapest first: question length, prompt-injection patterns, on-topic scope, then on the answer: no claims of actions it can't take, and citations must be real. Any check that errors blocks the message. |
| `jira.py` | Looks up S10 ("is this dependency already linked in Jira?") and writes the exports after approval: `jira_link_proposals.csv`, `sequence_note.md`, `audit.json`. Nothing is ever written to Jira itself. |

---

## `llm/` — talking to Claude

| File | What it does |
|---|---|
| `adapter.py` | Wraps the Anthropic SDK. `structured()` asks for JSON matching a Pydantic model and retries once if it doesn't validate. `tool_turn()` is used by the Ask agent. Turns failures into typed errors (unavailable, refused, invalid output, call failed) so callers can fall back. `DisabledLLM` is used when there's no key. |
| `prompts.py` | Loads the prompt files below and gives each a version (`name@` + first 8 characters of its content hash), recorded on every trace line and in the audit. |

## `prompts/` — one Markdown prompt per LLM task

Edit these to change what the model is asked; the new version shows up in the traces automatically.

| File | Used by |
|---|---|
| `explicit_deps.md` | `agents/discovery.py`: dependencies stated in a description or planner note, and their direction |
| `requery.md` | `agents/verifier.py`: the yes/no follow-up check |
| `sequencing_rationale.md` | `agents/sequencing.py`: why each step is in that order |
| `risk_rationale.md` | `agents/risk.py`: the explanation of each flagged risk |
| `ask.md` | `agents/ask.py`: the chat agent |

---

## `evals/` — measuring quality offline

Not used by the running server. Commands to score the pipeline against known answers.

| File | What it does |
|---|---|
| `README.md` | What each eval measures, how to run it, and the order of work. |
| `run.py` | The four evals: `extraction` (stated dependencies vs S3 labels), `retrieval` (search quality on your labelled questions), `backtest` (does the capacity rule predict S8 history?), `links` (does the pipeline find S10's Jira links?). `--plant-regression` swaps in a broken component to prove the eval notices. |
| `gate.py` | The release gate. Exits with an error if any metric is missing or below its floor. |
| `thresholds.py` | The floors the gate uses. **Placeholder values, marked UNCONFIRMED**: agree real ones before scoring. |
| `stats.py` | Math helpers: confidence intervals, fingerprints of the case set, pass^k. |
| `cases/README.md` | How to write the eval cases (`golden.md`, `retrieval_cases.jsonl`). None have been written yet. |
| `results/` | Output of the last eval runs (JSON per eval plus `history.jsonl`). Regenerated, never hand-edited; git-ignored except `.gitkeep`. |

---

## `tests/` — automated tests

Run with `.\.venv\Scripts\python.exe -m pytest` from `backend/` (29 tests, no network, no API key).
They use a tiny made-up dataset, not your `data/` folder.

| File | Covers |
|---|---|
| `conftest.py` | Shared setup: writes the synthetic dataset to a temp folder, and `ScriptedLLM`, a fake model with canned answers. |
| `test_context.py` | Loading: header aliases, sub-folders and alternative file names, invalid sources, rejected rows, name resolution, search filtering. |
| `test_tools.py` | Quote matching, citation audit, guardrails, sequencing and cycles, the S8 history blocker check. |
| `test_pipeline.py` | Whole pipeline: rule-based end to end, the LLM path keeping only grounded claims, budget exhaustion, history calibration. |
| `test_api.py` | Endpoints: health, run → review → Ask → export, the analysis view matching the UI contract, uploads, an empty data folder. |
| `test_evals.py` | The eval helpers, and that a planted regression makes the gate fail. |

---

## Folders created on your machine (all git-ignored)

| Folder | What's in it |
|---|---|
| `.venv/` | The Python virtual environment with the installed packages. Recreate it with the README's install steps if it breaks. |
| `runs/` | One folder per run: `events.jsonl` (progress events), `trace.jsonl` (one line per step and LLM call, with model, tokens and outcome), `state.json` (the full result), `ask.jsonl` (chat questions, if any) and, after approval, `export/`. Safe to delete. |
| `__pycache__/`, `.pytest_cache/` | Python and pytest caches. Safe to delete. |

---

## "Where do I change…?"

| To change… | Edit |
|---|---|
| The API key or model | `.env`, then restart the backend |
| How many initiatives per run, the call budget, a threshold | `.env` (defaults in `app/config.py`) |
| A data file's column names | `context/sources.py` (aliases) |
| What the model is asked | `prompts/*.md` |
| A risk rule or its severity | `tools/dri_rules.py` |
| The order of pipeline steps | `agents/graph.py` |
| What the frontend receives | `app/analysis_view.py` |
| Who can approve or challenge | `app/identity.py`, or `REVIEWERS_JSON` in `.env` |
| The eval floors | `evals/thresholds.py` |
