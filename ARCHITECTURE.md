# PI Planning Assistant — architecture decisions

How the hackathon architecture (`pi-planner-hackathon-architecture.html`) was built, checked
against `AGENT_ARCHITECTURE_CONSIDERATIONS.md`. Structure follows §10 of that document.
"Unmeasured" marks a choice no number supports yet: there is no data yet, so every
threshold here is a starting default.

## 1. Is it an agent?

Mostly no, deliberately. Against the four questions in §2:

| Part | Multi-step, decided as it goes? | Needs tools? | Must recover? | Open-ended path? | Built as |
|---|---|---|---|---|---|
| Analyse → discover → verify → sequence → risk → visualise | No: the order is fixed | Yes | Yes | No | A **LangGraph workflow**: the graph owns the order, the LLM decides only inside a node (§4.5) |
| Evidence verifier | Re-query only when needed | Yes | Yes | No | A bounded critic loop (≤ 2 rounds), routing in code |
| Ask / Explain chat | Yes | Yes | Yes | Yes | A **real tool-loop agent**, with the full harness (§4.1) |

The "Supervisor / orchestrator" in the diagram is therefore code (the LangGraph state
machine plus `app/runs.py`), not a model. That keeps routing testable and cheap.

**Hybrid rule:** the LLM extracts and explains; algorithms decide. Sequencing is a
topological sort, risks are DRI rule functions, and grounding is a string check. An LLM
rationale is accepted only if it passes a deterministic check (every step covered, no
cited id outside the step's chain); otherwise the template stays and a warning is emitted.

## 2. Request path (one "Analyse initiatives" click)

| # | Component | Mechanism | Budget | Failure behaviour |
|---|---|---|---|---|
| 1 | Intake (`POST /api/runs`) | Validates ids against S1 + uploads; ≤ 15 initiatives | `MAX_INITIATIVES_PER_RUN` | 400 on unknown ids |
| 2 | Load context | Validated snapshot built at startup (`context/`) | — | Missing/invalid sources reported, never filled in |
| 3 | Initiative Analyser | Rule baseline (catalogue names in own text) + LLM structured extraction with RAG | 1 call / initiative | LLM down / over budget / invalid → rule result, labelled |
| 4 | Discovery ①②③ (parallel fan-out) | ① LLM or rule extractor over text · ② S4 repo graph · ③ S7 ownership | 1 call / initiative for ① | Same as above; ②③ are code |
| 5 | Merge & dedupe | Stable dependency id per (from, to, kind); S10 "in Jira?" tag | — | `in_jira = null` when S10 missing (unknown ≠ false) |
| 6 | Evidence verifier | Grounding gate (quote verbatim in a chunk returned this run) + confidence gate (0.6) | ≤ 2 re-query rounds, ≤ 10 deps/round | Ungrounded → rejected with reason; re-query error → unchanged |
| 7 | Sequencing | Topological generations over the condensation; cycles collapse into a flagged step; capacity check | 1 call (rationale) | Template rationale |
| 8 | Risk (DRI) | Rule functions X-001…X-008, S8 history calibration | 1 call (rationale) | Template rationale; a rule whose source is missing reports "skipped" |
| 9 | Visualisation | Cytoscape JSON, stats, KPI strip, summary | 1 call (summary) | Template summary |
| 10 | Human gate | LangGraph `interrupt`; role checked in code before resume | — | Challenge → re-run 7–9 with the constraint; approve → export |
| 11 | Export | Proposals CSV, sequence note, audit JSON in the run folder | — | Nothing is ever written to Jira |

Whole run: `PIPELINE_MAX_MODEL_CALLS = 60` (unmeasured; set it at the 95th percentile of
real runs once there are some). When spent, every remaining LLM step takes its rule path
and the UI says so.

## 3. Components and alternatives

| Component | Chosen | Alternatives considered | Why / status |
|---|---|---|---|
| Orchestration | LangGraph, typed Pydantic state, in-memory checkpointer | LLM supervisor; plain functions | The diagram asks for LangGraph; deterministic routing. Checkpointer is in memory, so only the process that started a run can resume it (past runs stay readable from `state.json`). |
| LLM | Claude Sonnet 5.5 via the Anthropic SDK, structured outputs (`output_config.format`), effort `low` for extraction, `medium` for Ask | Ollama for offline demo | One adapter (`llm/adapter.py`); Ollama is a slot, not implemented. Server-side refusal fallback (`fallbacks="default"`) is on by default; `LLM_REFUSAL_FALLBACK=off` disables it. |
| Retrieval | **BM25** with source filter inside the query, structure-aware 800/120 chunks, stable chunk ids | Chroma / FAISS + embeddings (diagram) | **Deviation.** Claude has no embeddings endpoint, and the §4.3 ladder says ship the cheapest rung that clears the bar. Epic keys, service and team names are exact tokens, where BM25 is strong. `rrf()` is in place for a dense rung. **Unmeasured**: decide from `evals.run retrieval` once cases exist. |
| Tabular store | SQLite in memory | DuckDB | Parameterised lookups only; the model never writes SQL. |
| Knowledge graph | NetworkX MultiDiGraph, every edge with `source` and `ref` | Neo4j | Graph is small; Neo4j is the "later" in the diagram. |
| Entity resolution | Exact → suffix-free → fuzzy (≥ 0.86) over S6/S7/S4; raw value kept; every fuzzy or failed match listed | Embedding match | Below threshold returns "not found" rather than a guess. |
| Attribution | Each S1/S2/S3 document has an owning initiative; evidence from another initiative's document cannot support a claim about the focus initiative | Trust the model | Found by testing: retrieval pulled other initiatives' "blocked on" sentences into the wrong initiative. |
| UI | React + Vite + TypeScript, a two-column SVG graph, polling | Streamlit; Cytoscape.js; SSE | Matches the wireframes. The UI polls `GET /api/runs/{id}/analysis` (the SSE stream stays for other clients). Initiatives on the left and what they depend on on the right keeps every label readable without a layout library. Approve / challenge / export and flags are wired in the Results screen; the Ask chat is not. |

## 4. Guardrails and authorisation

- **Authorisation in code:** `app/identity.py` holds the policy table. Only RTE, EM and
  Architect may approve or challenge. Locally there is no SSO, so the UI sends
  `X-Demo-User` and the **role comes from the server-side roster**, never from the request.
  Replace `identity_from_request` with the gateway identity in a deployment.
- **Untrusted content:** every document reaches the model inside `<document>` tags (a
  document cannot close its own tag), and the prompts say documents are data. Structurally,
  the agent has no tool that sends data out or changes state: exports are files written
  after human approval.
- **Ask chat ladder** (cheapest first, every rung fails closed): length → injection rules →
  scope → tool loop (6 model calls, 4 per tool) → action-claim check → citation audit
  (unknown ids stripped; an uncited factual answer is marked `ungrounded`). Every question is
  logged with its verdict in `runs/<id>/ask.jsonl`, so false positives can be measured.
- **Escaping:** the UI renders model text as text, with no `dangerouslySetInnerHTML`.
- **Provider refusals** are recorded as `blocked_upstream`, never as a pass.

## 5. Evaluation plan

See `backend/evals/README.md`. Layers in place: extraction precision/recall against S3,
retrieval hit rate/MRR against hand-labelled cases, DRI back-test against S8, known-link
recall against S10, and a per-metric gate script with an exit code. Every result carries
its case-set fingerprint and an interval. Each runner has a planted regression, and a test
proves the gate fails on it. **Thresholds are UNCONFIRMED defaults** (`evals/thresholds.py`).

## 6. What is not covered

- No trajectory eval for the Ask agent (simulated user, pass^k) and no LLM judge for
  rationales; hand verdicts come first.
- No guardrail false-positive measurement on a real benign set.
- No dense retrieval rung, no reranker.
- No PII redaction rung: the data is synthetic. Add one before any real data.
- No observability backend: traces are JSONL with OpenTelemetry GenAI attribute names,
  ready to ship to Langfuse or an OTel collector.
- No Docker Compose, and no Ollama provider.
- In-memory checkpointer: a server restart ends any run that is waiting for review.

## 7. Decisions to confirm with the project owner

1. Do the column names in `context/sources.py` match the Haverstone package, or which aliases are needed?
2. Is DRI-X-008 (control sign-off unscheduled, from M2) the right code, or should it fold into an existing rule?
3. Who agrees the gate floors in `evals/thresholds.py`, and the 0.6 confidence threshold?
4. Who are the demo reviewers, and which roles may approve?
5. Is it acceptable to send synthetic text snippets to the Claude API during the demo, or must the demo run offline (rule mode)?
6. Should dependencies on teams (rather than initiatives) influence the sequence, or only the risk view (current behaviour)?
