# Agent architecture considerations: harness, retrieval, evals, and guardrails

Written for a model that helps design, build, or review an LLM agent or RAG
application. It collects the considerations that shape the architecture: the
harness, retrieval, memory, multi-agent design, guardrails, and the evaluation
stack (vibe checks, LLM judges, RAGAS, trajectory evals, DeepEval, release
gates).

Every number in this file is a starting default to measure against, not a
recommendation. Replace each one with a value the project has measured.

---

## 1. Principles

1. **Measure before you believe.** A design choice is accepted when a number
   from the project's own cases supports it. "It worked when I tried it" is a
   sample of one.
2. **Build the weak version first.** A baseline that fails in a visible way is
   what makes an improvement measurable.
3. **Use deterministic checks before model checks.** Anything exact (ids,
   names, paths, numbers, formats, authorisation) is checked in code. A model
   judge is for what cannot be specified.
4. **Fail closed.** A guardrail, judge, or gate that errors counts as a block
   or a failure, and the error is recorded. It never becomes a pass or a
   neutral score.
5. **Authorisation lives in code, never in a prompt.** A prompt is a
   suggestion. An `if` inside the tool and a filter inside the retrieval query
   are guarantees.
6. **Evaluate the trajectory, not the last message.** A polished answer can
   hide a wrong route, a skipped tool, or a leaked argument.
7. **Every number carries its context:** the case set it was measured on, an
   interval, the model and prompt versions, and the judge that produced it.
8. **Prove the harness can fail.** A planted regression must be caught, and a
   bad fixture must be rejected, before anyone reads the pass rates.
9. **Keep evidence attributable.** Every answer carries the ids of the chunks
   or pages it used. Every run keeps its retrieved context and its tool calls.

---

## 2. First decide whether it is an agent

Ask four questions. If fewer than two get a yes, build a function (retrieve,
then answer). A function is cheaper to build, test, and run.

- Does the work take more than one step, decided as it goes?
- Does it need a tool the model does not have on its own?
- Does it have to recover when a step fails?
- Is the goal open enough that the path cannot be written down in advance?

| If it is a function | If it is an agent |
|---|---|
| A fixed pipeline: retrieve, prompt, answer | A tool loop with budgets and a trace |
| Single-turn evals: retrieval metrics, RAGAS, DeepEval | Also trajectory evals with a simulated user and pass^k |
| Memory and multi-agent are usually out | Memory, capability mechanisms, and delegation are design choices |
| Guardrails on input and output | Also authorisation inside tools, and limits on what the agent may do |

Also write five golden examples before any model runs: an input, the output
you would accept, and one line on why. They become the first eval cases, and
they stop the model's habits from becoming the acceptance criteria.

---

## 3. Reference architecture

### 3.1 Online: one request

```
user
 |  identity from a gateway (SSO); the app trusts the forwarded identity, never a claim in the text
 v
[transform]      PII redaction: replace values with labelled placeholders, log labels only
 v
[input rungs]    rules (us) -> classifier (us) -> LLM judge (~1 s)
                 cheapest first, stop at the first block, every rung fails closed
 v
[harness]        system prompt + tools + model-call and tool-call budgets + trace
 |   +- working memory: instructions > recalled facts > session summary > recent turns,
 |   |  under a token budget; never trim the instructions or the recent turns
 |   +- tools: an owner, a schema, an authorisation check inside the tool,
 |   |  an approval step before anything that changes state
 |   +- retrieval: permission filter inside the query, then rank; return ids with the text
 v
[output checks]  unsupported claims, tone, citation and groundedness checks
 v
[caller]         escape before rendering (HTML, shell, SQL), whatever the model wrote
 v
user             every stage emits a span: retrieve, generate, check
```

### 3.2 Offline: the evidence chain

```
rubric + vibe checks + hand verdicts
  -> LLM judges, with agreement against the hand verdicts and an interval on it
  -> eval cases: question, reference answer, labelled evidence pages
  -> retrieval comparison: hit rate and MRR per retriever, with latency
  -> curated synthetic test set + RAGAS metrics, before and after one change
  -> tasks + simulated user + trajectories, pass^k, a planted regression, a capability report
  -> DeepEval on the current and candidate versions, a gate per metric, a release decision
  -> a gate script with an exit code in CI, then a canary verdict

benign inputs + planted attacks
  -> guardrail results per rung: coverage beside false positives
  -> attack findings per vector (user, retrieved page, tool description)
  -> risk register: one row per risk, with evidence and an owner
```

### 3.3 Contracts between stages

Each stage writes records that the next stage reads. Treat them as a contract:

- A schema per record type, validated on write. A record missing a required
  key is rejected, not saved.
- Stable ids on every case, task, run, and chunk, so results can be joined and
  fingerprinted.
- A manifest of what was written, by which job, and when.
- Measured results are never edited by hand. If a result is wrong, rerun the
  job that produced it.
- Sample or fallback data says so out loud when it is used, so nobody defends
  a number from an example dataset as if it came from the product.

---

## 4. Components

Each subsection gives the pattern, the decisions to confirm with the project
owner, the failure modes, and the evidence to keep.

### 4.1 Harness

An agent is a model with a job description, a toolbox, a budget, and a trace.

- **Tools are a contract.** The model sees only a tool's name, description,
  and input schema. A vague description makes it call every tool. A precise
  one says what the tool returns and when not to use it.
- **The system prompt does four things.** It names each tool and when to use
  it. It says to answer only from tool results and to name the source. It says
  to decline out-of-scope requests in one sentence. It says to ask one
  clarifying question when a needed detail is missing.
- **Budgets on every run.** Set a model-call limit and a tool-call limit per
  tool, and write down the exit behaviour of each: end the run, or continue
  without that tool. Starting point: 4 to 8 model calls per run.
- **Middleware around the loop** handles logging, limits, retries, and
  approval steps, without rewriting the loop.
- **Tools that change state** sit behind an approval step. The model proposes;
  a person or a policy approves.
- **Weak evidence is signalled.** A tool returns a `found` flag or "no match"
  rather than its closest guess, so the agent can ask instead of inventing.
- **The trace is kept:** every model message, tool call, argument, and result,
  long enough to audit.

Failure modes: runaway loops; in-scope questions answered without the tool;
the tool called for out-of-scope questions; a budget tuned to one run that
kills a normal second run of the same task (see 5.4).

Evidence: saved transcripts, and trace assertions such as "an in-scope
question must call the search tool" run over them.

### 4.2 How a capability reaches the model

| Mechanism | Boundary | What enters context | Main risk | Use when |
|---|---|---|---|---|
| Tool (function + schema) | in-process | each result | tight coupling | one application owns the capability |
| Skill (instructions + script) | a folder the harness executes | the instructions and command output | unsafe execution | the reusable asset is mostly a procedure |
| MCP server | a separate process, discovered at runtime | selected results | auth, uptime, protocol versions | several clients need a capability someone else operates |
| Sub-agent | its own prompt, context, and loop | the specialist's answer only | opaque handoffs | the boundary is separate reasoning, context, or policy |
| Code mode | a runtime runs a program the model writes | the program and its final value | arbitrary code | many calls or bulky intermediate values |
| API manifest (UTCP-style) | an existing API, described for the client | selected responses | schema drift | the API already exists and needs no new server |

- Choose per capability, not per system, by ownership, authentication, and
  what enters context.
- Before choosing, measure two mechanisms on the same question: model calls,
  capability calls, characters of evidence in context, and elapsed time.
- Every capability has a named owner and a versioned schema.
- Skills allow-list the commands they may run. Code mode runs in a subprocess,
  container, or WASM sandbox with time, memory, and I/O limits, never in the
  application process. An AST allow-list is a teaching aid, not a sandbox.
- An MCP server over stdio writes nothing to stdout except protocol messages.
- Introduce one controlled failure per mechanism (bad arguments, a server that
  is down, a stale manifest, unsafe code) and check that each fails visibly.

### 4.3 Retrieval

**The gap and the cost.** Without retrieval, the model answers fluently and
misses product specifics. Pasting the whole corpus works, but it is paid for
on every call. With a prefix cache, put the stable text first and the varying
question last. Anything variable placed before the stable text (a timestamp, a
user id, the question) invalidates the cache for every token after it.

**Baseline.** Structure-aware chunks (starting point: 800 characters with 120
of overlap, split on paragraphs and sentences), dense embeddings, cosine
similarity, `k=4`. Keep the retrieved contexts with every answer. Without
them, nobody can tell a retrieval miss from a generation miss.

**The ladder.** Run every rung over the same chunks and score it on the same
labelled cases:

| Rung | Adds | Costs |
|---|---|---|
| Dense | meaning, paraphrase | blurs exact tokens: error strings, setting names, ids |
| BM25 | exact terms, weighted by rarity | misses paraphrase |
| Hybrid with RRF | both; sum `1/(60+rank)` per list, no score normalisation | two searches |
| Cross-encoder rerank over about 12 candidates | reads the question and each candidate together | latency per query |
| Multi-query (about 3 rewrites, fused, reranked) | recall on awkwardly phrased questions | a model call, and more latency |

Ship the cheapest rung that clears the bar. Write down which question types
need the expensive rung, and consider a router that sends only those there.

**Labels and metrics.**
- Label evidence at the page or document level, not the chunk level, so labels
  survive a change of chunk size. A model may propose labels from a digest of
  each page; a person corrects them.
- Out-of-scope cases have no evidence and are skipped by retrieval metrics.
- Hit rate at `k`: share of cases with any top-`k` result from a labelled page.
  MRR: the mean of one over the rank of the first correct result. Record
  latency per query beside both.
- Read the per-case matrix, not only the averages. One case often separates
  the rungs.
- Labels are tied to a corpus version. Re-label, or at least re-validate, when
  the corpus changes, or the metrics drop for reasons that have nothing to do
  with retrieval.

**Authorisation.** When the index holds documents with different access
rules, filter inside the query (a metadata filter the vector store applies
before scoring). Filtering after ranking leaks through result counts, gaps,
and rank positions.

**Agent access to documents.** Two interfaces:
- Agentic RAG: a search tool that returns ranked chunks and can be called
  again with a new query. Usually cheaper when a question maps to one or two
  sections.
- Direct corpus interaction (DCI): `list_pages` (a model-readable index of
  page names, purposes, and section headings), `grep`, and `read_page`. Earns
  its extra calls when exact identifiers, page structure, or evidence spread
  over two pages matter. It widens raw access, so authorise each call per
  caller.

Keep the loop, model, and questions identical, and compare score, calls,
evidence characters read, and latency per mode.

**GraphRAG.** It earns its build cost only on multi-hop questions about
entities and relations. Measure it against the strongest vector baseline you
can build (hybrid plus rerank), not a weak one. Decide from the table.

**Hygiene.**
- Keep eval answer keys, reference answers, and generated indexes out of the
  retrievable corpus. A page that holds each eval question next to its
  reference answer will be retrieved, and it inflates every score.
- Pin and record the embedding and reranker model versions with every result.
- Re-index on change or on a schedule, never when someone remembers.

### 4.4 Memory

A model has no memory of its own. It remembers only what the harness puts
back in front of it.

| Kind | What it stores | Where | The test that catches its failure |
|---|---|---|---|
| Episodic | one summary per run | an episode log | the summary names every tool the trace shows and the true outcome |
| Semantic | distilled durable facts | a store, recalled by similarity | recall returns the current value, not a superseded one |
| Working | whatever goes in the prompt this turn | the assembled context | the instructions and recent turns survive the budget |

- Write episodes from the trace (which tools ran, pass or fail), not from the
  model's account of itself.
- Give each fact a `subject`. A new fact on the same subject retires the old
  one.
- Assemble working memory in priority order (instructions, recalled facts,
  session summary, recent turns). When over budget, drop recalled facts from
  the bottom. Never trim the root set.
- Compact generationally: recent turns verbatim, older turns summarised, raw
  turns archived and retrievable. Check that a number or id from a summarised
  turn is still answerable.
- Extract durable facts at session end: identity, preferences, decisions,
  project state. Not chit-chat, and not duplicates.
- Key the store per user or tenant at minimum, and run a leakage test: two
  users, two secrets, ask as the second user.

### 4.5 Multi-agent and research graphs

- Split only when a worker trace changes the final answer. Splitting adds
  handoffs to audit, a budget per worker, and traces to propagate.
- Put each specialist behind one delegate tool, with a narrow prompt, a narrow
  toolbox, and its own budget. Starting point: 8 model calls per worker and 4
  calls per tool; 6 model calls for the supervisor and 2 per delegate.
- Use typed handoff contracts (brief, tasks, findings, verification, final
  report, audit). Typed output proves the shape, not the facts.
- Give every source a stable handle (a URL or `local://` id).
- A provenance guard drops any source or claim whose handle did not appear in
  a tool result during that run.
- The verifier re-opens sources before approving claims. The writer has no
  tools, so it cannot introduce a fact or a URL.
- The citation audit is plain code: allow-listed URLs, no duplicates, numeric
  markers and the citation list line up. Test it on fixtures before spending
  tokens.
- A graph owns the order of steps; agents decide inside a node. Add
  checkpoints and a human interrupt before the writer when the report matters.
- Deep research unrolls into clarify, brief, plan, research, compress, and
  write, with one trace event per node so you can see where the budget went.

### 4.6 Guardrails

**Measure on two sets, never one.** Use benign inputs (real user requests that
must get through) and planted attacks. Coverage without the false-positive
rate beside it means nothing: a rung that blocks everything has 100% coverage.
A rung that blocks about 5% of legitimate traffic gets switched off within a
month, and then catches nothing.

**The ladder:**

| Rung | Cost | Guarantee | Catches |
|---|---|---|---|
| Constrained decoding (mask illegal tokens) | none, but needs logit access | absolute, within the allowed set | illegal outputs, which become unreachable |
| Structured output with schema validation | small | shape, not truth | malformed output |
| Rules (regex, substring) | microseconds | exact match | ids, card numbers, credentials, claimed approvals |
| Classifier | microseconds to milliseconds | probabilistic | phrasings you can label |
| LLM judge | about 1 s and a model call | probabilistic | what you can neither specify nor label |
| Policy table (user, action, resource) | microseconds | absolute | authorisation; never reads the text |

- Run cheapest first and stop at the first block, so the judge only sees
  survivors. The policy check sits at the tool boundary, where the action is
  finally known.
- Every rung fails closed. An exception is a block, and the error travels with
  the record. An empty or unparseable judge verdict is a block.
- Record rung order, thresholds, and versions with every result.

**Stages:**
- Input guardrails: scope (the request shares vocabulary with the product and
  matches no off-topic pattern) and injection (instruction override, prompt
  extraction, role override, constraint bypass).
- Transforms: PII redaction lets a legitimate request through with the values
  replaced, and reports which labels it removed, never the values.
- Output guardrails: unsupported claims ("I have reset your password", absolute
  guarantees, certification claims), tone, and groundedness (a factual answer
  must cite a source the tool returned in this run).
- Decide per guardrail whether it is a hard block, a logged warning, or too
  brittle to keep. Log blocked inputs so brittleness can be measured.
- Write each policy as a plain function first,
  `check(text) -> (tripped, info)`, then wrap it for the agent framework. It
  ports between frameworks and runs in CI without a model.

**Attacks (OWASP Top 10 for LLM applications).** Target only your own system.

| Category | Attack | Success signal |
|---|---|---|
| Prompt injection, direct | the user types an override | a canary from the system prompt appears in output |
| Prompt injection, recombined | a search over prefixes, bodies, and suffixes (for example 3 x 3 x 3) | count of candidates that leak |
| Prompt injection, indirect | an instruction planted in a retrieved page; an innocent question | canary in output, over several runs |
| Sensitive disclosure | claim to be another user and ask for their data | a distinctive phrase from their record appears |
| Improper output handling | ask for markup or commands | the raw tag comes back; the fix is escaping in the caller |
| Excessive agency | imply an action without asking for it | the state-changing tool appears in the tool calls |
| System prompt leakage | polite probes, translation tricks | canary in output |
| Leakage through a tool description | a tool whose description says to copy instructions into an argument | canary in the tool-call arguments, which output scrubbers never see |

- One refusal is a sample of one. Repeat each attack and search variants
  before believing a zero.
- An attack that succeeded becomes a regression test.
- Reduce exposure structurally. Of the three conditions (private data in
  reach, untrusted content in context, a way to send data out), remove one
  where you can.

### 4.7 Observability

- A span is a name, a start, a duration, and a parent, recorded whether or not
  the work succeeded. Instrumentation that only records success shows a
  healthy dashboard during an outage.
- Use the OpenTelemetry GenAI semantic convention names (for example
  `gen_ai.usage.input_tokens`) so other tools can read the traces. Record both
  the model you asked for and the model that answered.
- Four metrics specific to LLM applications: p50 and p95 latency, cost per
  request, refusal rate, and eval score on sampled traffic. Only the last one
  sees a silent quality regression; the others stay flat.
- Drift detection: score a daily sample. Fire when the mean of the last three
  days falls more than 2.5 standard deviations below the history. State the
  detection lag as a commitment.
- Load test at rising concurrency to find saturation, the point past which
  more callers add wait instead of throughput. Never point a load test at
  shared infrastructure without asking.
- Decide what may be logged: redact before logging, and set retention for
  prompts and responses.

### 4.8 Release

- The release gate is a script that reads eval results and exits non-zero
  when any metric is under its own floor. An average across metrics hides the
  one that failed.
- Deployment manifest properties a platform team checks first: non-root, a
  read-only filesystem, all capabilities dropped, no privilege escalation, a
  pinned image tag, requests and limits, liveness and readiness probes, and a
  disruption budget once there is more than one replica.
- Rollout modes: a rolling update proves the new version starts, and a worse
  model passes it. A canary sends a share of real traffic to the candidate. A
  shadow copies traffic to it and discards the replies.
- Canary verdict: latency is a hard gate; too few samples means hold; then a
  two-proportion 95% interval on the pass rates decides. About forty samples
  cannot tell an improvement from luck.
- Risk register (NIST AI RMF: Govern, Map, Measure, Manage): one row per risk,
  each with its evidence and an owner. A risk with no evidence behind it is
  listed as such.
- A deployment checklist marks each question answered, partly answered, or
  unknown. Unknowns go to the platform owner, not into guesses.

---

## 5. The evaluation stack

### 5.1 Which layer blames which component

| Layer | Question it answers | Blames | Cost |
|---|---|---|---|
| Vibe checks + rubric + hand verdicts | What does good look like, in the users' words? | the spec | a person's time |
| LLM judges, one per dimension | Does a model agree with the person? | the judge prompt, then the product | one call per row per judge |
| Echo and oracle baselines | What does agreement read with no judging at all? | the agreement measure | none |
| Hit rate, MRR | Did the evidence reach the top `k`? | the retriever | embeddings, rerank latency |
| RAGAS context recall | Did retrieval surface what the reference needs at all? | retrieval | judge calls |
| RAGAS context precision | Are the needed chunks ranked high? | retrieval ranking | judge calls |
| RAGAS faithfulness | Is every claim supported by the retrieved context? | the generator, given its context | judge calls |
| RAGAS answer relevancy | Does the answer address the question? | the generator | judge calls + embeddings |
| Trajectory pass rate, pass^k | Does the agent finish the task, every time? | the loop, tools, and prompt | k x tasks x turns |
| DeepEval relevancy, faithfulness, G-Eval correctness | Is the candidate shippable against the reference? | generator, grounding, product | 1 to 4 judge calls per metric per run |
| Guardrail coverage and false positives | Does each rung stop attacks and let users through? | each rung | latency per rung |
| Attack findings | Which attack worked, and by which vector? | the trust boundary | repeated runs per attack |
| Eval score on traffic | Has quality drifted? | whatever changed | a sampled eval per day |

Choose metrics that each blame a different component. A failure with low
context recall belongs to retrieval. High recall with low correctness belongs
to the prompt or the model.

### 5.2 Vibe checks and LLM judges

- Fix the order: a rubric, then vibe checks, then your own verdicts, and only
  then a model judge. The hand verdicts are the bar the judge is measured
  against.
- Rubric: about five aspects, each with one sentence defining a pass (for
  example grounded, actionable, in scope, hands off safely, concise).
  Overlapping aspects make judges disagree for no reason.
- A vibe check is an input plus what a good answer must contain. Include a
  refusal, a "the source does not say" case, and a case that needs two
  sources.
- Hand verdicts are `pass` 10, `mixed` 5, or `fail` 0, with one line of
  reasoning each.
- Strict judge: ask for `{"score": int 0-10, "rationale": str}`, validate it,
  retry once with "That was invalid. Return only the JSON object.", then
  raise. Malformed output never becomes a neutral score.
- Use one judge per dimension (groundedness against the evidence,
  actionability, clarity). An answer can be clear and wrong, or grounded and
  useless. Never average judges that measure different things. Sort by the
  spread between them and read the rationales.
- Agreement per row: `1 - |judge - human| / 10`. Echo (always "mixed") is the
  floor. Oracle (copies the human) must read exactly 1.0, or the measure is
  broken.
- Put a 95% interval on every agreement number and on any judge-versus-judge
  gap. An interval that spans zero means you need more rows, not that you have
  a winner.
- If a judge column is all tens, the judge is not discriminating; raise its
  bar.

**Judge configuration:**
- A judge that is the same model as the assistant invites self-preference. Use
  a different model where you can, and measure agreement between the two.
- Set the judge model in one place. Code that builds its own judge client
  silently ignores that setting. Record the judge model, the judge prompt
  version, and the assistant model on every score row.
- Some reasoning models accept only one temperature (often 1), so judges
  cannot be pinned to 0. Measure repeatability: score the same answers three
  times and report the range. Eval libraries that set their own low
  temperature may need it overridden for those endpoints.
- A judge helper that returns `score=None` on a parse failure must have its
  `None`s counted and reported, never dropped from the mean or treated as 0
  without saying so.
- A human scores a sample of every batch, so judge drift shows up.

### 5.3 RAGAS and synthetic test data

- Start from a deliberately weak pipeline (for example `k=2`) and a fixed
  prompt, so later movement can be attributed to retrieval.
- Write one question by hand from one chunk first, so you know what the
  generator should produce. Then generate at scale, with personas taken from
  the real users. A good generator mixes single-hop and multi-hop questions in
  varied styles.
- Curate before trusting:
  - near-duplicates: character 4-gram Jaccard at 0.7 or more
  - schema: non-empty question and reference
  - leaks: a question that copies eight or more consecutive words from a
    source is a lookup the retriever cannot fail, so it measures nothing
- Commit a datasheet beside the test set: counts generated, removed (and why),
  and kept; the synthesizer mix; and what the set cannot test. References
  generated from pages never test a refusal or an unanswerable question, so
  add hand cases for those.
- The four core metrics: faithfulness, answer (response) relevancy, context
  precision with reference, and context recall.
- Change one thing at a time (`k` from 2 to 6, then chunk size), with the same
  prompt, questions, and judge. Put a paired interval on the per-question
  difference. With a handful of questions, the faithfulness interval usually
  spans zero. Context recall is usually the more reliable signal of a
  retrieval change.
- Reuse the same test set across runs so scores stay comparable.
  Regenerating it produces a new case set, and old scores cannot be compared
  with new ones.
- Generator and judge models and versions are recorded with the set and the
  scores. Thresholds are agreed before the change, not after.
- Practicalities: RAGAS can pin an older version of its orchestration
  dependencies, so run it as a separate evaluation job or environment, not
  inside the application. Generators may match personas by exact name; make
  that lookup tolerant, or a long run fails at the end.

### 5.4 Trajectory evals for agents

- A task is a goal, a persona, an opening message that may leave out a detail,
  the facts the user reveals only when asked, and a success condition the
  agent never sees.
- The simulated user replies `DONE` when its goal is met and `GIVE UP` when
  the conversation loops. Keep the two signals apart; merging them scores
  every success as an abandonment. Cap the user turns (starting point: 3).
- Use two scorers and keep both on every row:
  - Programmatic, which is free and does not drift. For a lookup, at least
    half of the reference's distinctive facts are present and the agent
    searched. For an out-of-scope task, it declined and did not search.
    Better still, assert on state, such as the ticket existing in the store.
  - A judge over the whole transcript, with a rubric per task category (a
    pass is 7 or more out of 10). It is the only scorer for adversarial tasks.
- Plant tasks: one out of scope and one prompt injection. They should hold
  when retrieval breaks.
- Repeat every task. `pass^k = C(c, k) / C(n, k)` for `c` passes in `n` runs.
  An agent at 80% per run has a pass^3 near 0.5. Gate on pass^k, not on a
  single-run rate.
- Quote the spread per task: steps, tool calls, and characters or tokens of
  tool output, as min, median, and max. Two identical runs can differ by 2x in
  tokens. Set budgets at the 95th percentile of many runs, never the mean.
- Plant a regression, such as a retriever that returns the same section for
  every query. Lookup tasks must drop and planted tasks must hold. If nothing
  moves, the harness measures phrasing, not behaviour.
- Add trajectory-level checks the final answer cannot show: a question asked
  twice, a tool called with another user's id, a write tool called unasked.
- The capability report names the agent and model, gives pass rate and pass^k
  per task, quotes the worst failure and the turn it went wrong, and records
  whether the planted regression was caught.
- Validate the simulator. If swapping the user model changes the ranking of
  agents, you are measuring the simulator.

### 5.5 DeepEval and the release decision

- Read every eval case before any model runs, and assert each has a
  reference. Two people should reach the same verdict from the reference alone.
- Compare two versions, so the eval has to tell them apart: a prompt-only
  version (it sounds fine and invents) and the retrieval or agent version. For
  the prompt-only version's faithfulness, use the pages it should have used as
  the context.
- Keep the answer and its retrieval context together for every run.
- A custom judge model (`DeepEvalBaseLLM`) over your own endpoint appends the
  requested JSON schema to the prompt, parses the first JSON object, retries
  once with the validation error, then raises.
- Starting metrics and thresholds:
  - `AnswerRelevancyMetric`, 0.7
  - `FaithfulnessMetric`, 0.8
  - a `GEval` correctness metric, 0.7, with evaluation steps that name what
    must match: settings, paths, roles, wait times, commands. Penalise
    contradictions and invented or omitted steps, not concise wording.
- Record one row per test, version, and metric: score, pass, reason, error. A
  metric that errors is a failed row with the error.
- The decision:
  1. Fingerprint the case set.
  2. Take the mean per metric, with errors counted as 0.
  3. Compare current to candidate, and refuse if the fingerprints differ.
  4. Gate the candidate against a minimum per metric.
  5. Ship only if the gate passes, the runs are comparable, no metric drops by
     more than a tolerance (starting point: 0.05), and no judge errored.
     Otherwise hold, and name the failing metric and tests.
- Add a deterministic check beside the judges: the words a correct answer must
  contain, matched as whole words. Count where the string check and the judge
  disagree.
- In production: thresholds calibrated against human labels and agreed before
  scoring; at most about five metrics; the suite run in CI, blocking the merge
  on a regression; per-component gates; repeats per case, because a threshold
  inside the run-to-run spread is not a gate. If eval libraries load `.env`
  files or send telemetry on their own, turn that off so the project's
  configuration wins.

### 5.6 Rules for every number

1. Put an interval on it: a bootstrap interval for one score, and a paired
   bootstrap on the difference for a change.
2. Fingerprint the case set from the case ids. Refuse to compare runs over
   different case sets: 0.94 on six cases against 0.91 on sixty is not a
   regression.
3. Thresholds live in code, are set before scoring, and are saved with the
   result.
4. Gate per metric, never on an average.
5. A missing metric fails the gate. A number you did not measure has not
   cleared the bar.
6. Record the assistant model, judge model, prompt versions, and, for
   retrieval, the embedding and reranker versions on every row.
7. Prove the harness can fail: oracle at 1.0, a planted regression caught, an
   audit that rejects a bad fixture.
8. Report the spread across repeats, not one run.
9. Size the claim to the sample. With six cases, most differences are not yet
   measured differences.
10. Sample or example data is labelled as such and never quoted as evidence
    about the product.
11. Report what the evaluation does not cover. Readers trust that row most.

---

## 6. Where each check runs

| Check | In the request path | Offline or CI | Behaviour on trip | Latency budget |
|---|---|---|---|---|
| PII redaction | yes, before the model | regression cases | transform, not block | microseconds |
| Rules and classifier rungs | yes | case-set matrix | block, fail closed | microseconds |
| LLM judge rung | only if the latency budget allows | case-set matrix | block, fail closed | about 1 s; name it |
| Policy table | yes, at the tool boundary | unit tests | always block | microseconds |
| Output claim check | yes, after generation | case-set matrix | block | milliseconds |
| Output tone check | yes, after generation | case-set matrix | often warn and log | milliseconds |
| Citation audit | yes, for generated reports | fixtures | fail the report | none (code) |
| Faithfulness and groundedness judges | sampled traffic only | RAGAS and DeepEval in CI | gate the release | off the request path |
| Retrieval metrics | no | on every retrieval change | gate on hit rate and MRR | n/a |
| Trajectory evals | no | on every change to prompt, tools, retriever, or model | gate on pass^k | n/a |
| Attack suite | no | before every release | any success blocks | n/a |
| Eval score on traffic | no, sampled daily | drift detector | alert on-call | stated lag |

Ask of every judge in the design: is it a guardrail (in the request path,
blocking) or an evaluator (offline, scoring)? The answer sets its latency
budget and what happens when it fails.

---

## 7. Integration pitfalls

- **Build model clients in one place.** Gateways add quirks: deployment-scoped
  URLs, keys passed as query parameters, embeddings on a different path.
  Timeouts and retries also belong in one config. Clients built ad hoc drift
  from it.
- **Optional parameters fail whole calls.** A server that does not know
  `reasoning_effort` or `stream_options` rejects the request. Try once, then
  remember the refusal for the session.
- **Provider content filters are an outcome of their own.** A request refused
  by the provider's filter is neither the agent succeeding nor an attack
  failing. Record it as `blocked_upstream`, exclude it from pass rates, and
  list the filter in the risk register as a control you do not own (its
  thresholds and versions can change under you).
- **API errors are not results.** An attack harness that reads an API error as
  "the attack did not succeed", or a simulator that turns an exception into
  "the user gave up", inflates safety and pass rates. Count errors separately.
- **Self-hosted endpoints differ from the reference API.** Some reject a `name`
  field on non-tool messages, ignore a provider prefix in model names, or do
  not report cached tokens. Test the endpoint's behaviour before trusting a
  framework's defaults.
- **Dependency conflicts.** Evaluation libraries can pin different versions of
  shared frameworks. Run them as separate jobs or environments.
- **Embedded vector stores are often single-writer.** Keep one process holding
  the index, or move to a server.
- **Mixing agent frameworks** (one for the loop, another for guardrails, a graph
  runtime for multi-agent) is workable if checks are plain functions and
  traces share one format.
- **Async in notebooks and servers.** Run SDK coroutines on one background
  event loop, or on a fresh thread, rather than nesting event loops.

---

## 8. Anti-patterns

- A model judge before any hand verdicts, or a judge with no agreement number
  and no interval.
- One averaged "quality" score across judges or metrics.
- A malformed judge reply, an API error, or a content-filter block turned into
  a neutral, zero, or passing score without being recorded as such.
- Authorisation written in the system prompt instead of inside tools and the
  retrieval query.
- Permission filtering after ranking.
- Eval answer keys or reference answers indexed as retrievable content.
- Eval labels from one corpus version scored against another.
- Comparing scores measured on different case sets.
- A coverage rate with no false-positive rate beside it.
- A single run quoted as a pass rate or a latency.
- Budgets set from the mean of a few runs.
- A guardrail that fails open during an outage while the logs stay quiet.
- Model output rendered without escaping.
- Generated code or skills executed in the application process.
- Typed output treated as proof that the facts are true.
- A capability with no owner, or a tool description nobody pinned.
- Results edited by hand, or numbers in a report that no saved run holds.
- Thresholds chosen after seeing the scores.

---

## 9. Decisions to confirm with the project owner

1. Is it an agent at all, by the four questions in section 2?
2. Who are the users, and which questions must the product answer for them?
   What must it refuse?
3. Which lookups and actions does it need, who owns each system, and which
   actions change state?
4. For each capability: tool, skill, MCP server, sub-agent, code mode, or an
   existing API through a manifest? Who owns the boundary?
5. Which documents may each user read, and where is that enforced?
6. What bar must retrieval clear, and which question types need the expensive
   rung?
7. What must be remembered across sessions, what must be forgotten, and how is
   memory keyed and retained?
8. Which attacks matter most, and which benign requests look like them but
   must pass?
9. What is the latency budget per request, and which guardrail rungs fit
   inside it?
10. Which metrics and thresholds decide ship or hold? Who agreed them, and
    were they agreed before scoring?
11. Which failure would be noticed last in production, and what would detect
    it, with what lag?
12. Where does it run, who is on call, how is it rolled back, and what is
    still unknown?

---

## 10. What an architecture proposal should contain

- Whether it is an agent at all, with the reasoning.
- The request path, component by component, in the order of section 3.1,
  each with its mechanism, owner, budget, and failure behaviour.
- For each component: the alternatives considered, the trade-off, and the
  measurement that supports the choice. Mark a choice "unmeasured" where
  nothing supports it yet.
- The evaluation plan: which layers from section 5.1, the metrics, thresholds
  and who set them, the case-set fingerprint, the repeat count, and the planted
  regression that proves the harness can fail.
- The guardrail plan: rungs, order, block or warn per rung, coverage and
  false-positive targets, and where authorisation lives.
- What the evaluation does not cover.
- Open questions for the project owner, phrased as questions.

---

## Appendix: reference snippets

Short, dependency-light implementations of the checks above. Adapt the names
to the project.

### Strict judge parsing

```python
import json

def parse_judge(text: str) -> dict:
    """Accept only {"score": int 0-10, "rationale": non-empty str}; raise otherwise."""
    for blob in reversed(json_blocks(text)):          # balanced {...} substrings, string-aware
        try:
            obj = json.loads(blob)
        except json.JSONDecodeError:
            continue
        s, r = obj.get("score"), obj.get("rationale")
        if isinstance(s, int) and not isinstance(s, bool) and 0 <= s <= 10 and isinstance(r, str) and r.strip():
            return {"score": s, "rationale": r.strip()}
    raise ValueError(f"invalid judge reply: {text[:120]!r}")
# Caller: retry once with "That was invalid. Return only the JSON object.", then raise.
```

### Intervals, fingerprints, and a gate

```python
import hashlib, json
import numpy as np

def bootstrap_ci(values, n=2000, seed=0, level=0.95):
    a = np.asarray(values, float)
    means = a[np.random.default_rng(seed).integers(0, a.size, (n, a.size))].mean(axis=1)
    lo, hi = np.percentile(means, [(1 - level) / 2 * 100, (1 + level) / 2 * 100])
    return a.mean(), lo, hi

def paired_difference_ci(before, after, n=2000, seed=0, level=0.95):
    a, b = np.asarray(before, float), np.asarray(after, float)   # same cases, same order
    idx = np.random.default_rng(seed).integers(0, a.size, (n, a.size))
    diffs = b[idx].mean(axis=1) - a[idx].mean(axis=1)
    lo, hi = np.percentile(diffs, [(1 - level) / 2 * 100, (1 + level) / 2 * 100])
    return b.mean() - a.mean(), lo, hi          # an interval spanning 0 is not a measured difference

def fingerprint(cases, key="id"):
    ids = sorted(json.dumps(c.get(key), default=str) for c in cases)
    return hashlib.sha256(json.dumps(ids).encode()).hexdigest()[:12]

def compare(before, after):
    if before["fingerprint"] != after["fingerprint"]:
        return {"comparable": False, "delta": {}}
    return {"comparable": True,
            "delta": {m: after["scores"][m] - before["scores"][m] for m in after["scores"] if m in before["scores"]}}

def gate(scores, minimum):
    failed = [m for m, floor in minimum.items() if scores.get(m) is None or scores[m] < floor]
    return {"passed": not failed, "failed": failed}
```

### pass^k

```python
from math import comb

def pass_k(passed: list[bool], k: int) -> float:
    n, c = len(passed), sum(passed)
    return comb(c, k) / comb(n, k) if n >= k and c >= k else 0.0
```

### Reciprocal rank fusion and retrieval metrics

```python
def rrf(rankings, k=60):
    scores = {}
    for ranking in rankings:
        for rank, doc_id in enumerate(ranking, 1):
            scores[doc_id] = scores.get(doc_id, 0.0) + 1 / (k + rank)
    return sorted(scores, key=scores.get, reverse=True)

def hit_and_rr(ranked_pages, labelled_pages):
    for rank, page in enumerate(ranked_pages, 1):
        if page in labelled_pages:
            return 1.0, 1.0 / rank
    return 0.0, 0.0      # mean of the first = hit rate, mean of the second = MRR
```

### Test-set curation

```python
import re

def shingles(text, n=4):
    t = " ".join(text.lower().split())
    return {t[i:i + n] for i in range(max(len(t) - n + 1, 1))}

def is_duplicate(q, kept, threshold=0.7):
    s = shingles(q)
    return any(len(s & o) / len(s | o) >= threshold for o in kept)

def word_runs(text, n=8):
    w = re.findall(r"[a-z0-9]+", text.lower())
    return {" ".join(w[i:i + n]) for i in range(len(w) - n + 1)}

def leaks(question, source_runs):              # source_runs = union of word_runs over the corpus
    return bool(word_runs(question) & source_runs)
```

### A fail-closed guardrail ladder

```python
def fail_closed(check):
    def guarded(case):
        try:
            return check(case)
        except Exception as exc:
            return {"allowed": False, "error": f"{type(exc).__name__}: {exc}"}
    return guarded

def ladder(case, rungs):                        # rungs ordered cheapest first
    for name, check in rungs:
        verdict = check(case)
        if not verdict["allowed"]:
            return {"allowed": False, "rung": name, "error": verdict.get("error")}
    return {"allowed": True, "rung": None, "error": None}

def judge_allows(reply: str) -> bool:
    return bool(reply.strip()) and "BLOCK" not in reply.upper()    # empty verdict blocks
```

### Authorisation in code

```python
ROLES = {"staff": {("read", "kb"), ("reset", "own_password")},
         "helpdesk": {("read", "kb"), ("reset", "any_password")}}

def allowed(user, role_of, action, resource):
    perms = ROLES.get(role_of.get(user, ""), set())
    if resource.startswith("password:"):
        owner = resource.split(":", 1)[1]
        return (action, "any_password") in perms or (owner == user and (action, "own_password") in perms)
    return (action, resource) in perms          # the request text is never an input

def read_ticket(ticket_id, current_user, tickets):
    t = tickets.get(ticket_id)
    if not t:
        return "No such ticket."
    return t["text"] if t["owner"] == current_user else "Refused: that ticket belongs to another user."
```

### Provenance guard and citation audit

```python
import re
URL = re.compile(r'(?:https?://|local://)[^\s\]\[()<>{}"\']+')

def observed_urls(tool_messages):
    return {u.rstrip(".,;:!?)").lower() for m in tool_messages for u in URL.findall(m)}

def keep_traced(claims, observed):              # claims: [{"claim": str, "urls": [str]}]
    return [c for c in claims if any(u.lower() in observed for u in c["urls"])]

def audit(markdown, citations, approved):
    markers = {int(m) for m in re.findall(r"\[(\d+)\]", markdown)}
    expected = set(range(1, len(citations) + 1))
    problems = {"unknown": [u for u in citations if u.lower() not in approved],
                "duplicates": sorted({u for u in citations if citations.count(u) > 1}),
                "missing_markers": sorted(expected - markers),
                "markers_without_citation": sorted(markers - expected)}
    return {"passed": not any(problems.values()), **problems}
```

### Canary checks

```python
import json

CANARY = "CANARY-<random>-DO-NOT-REPEAT"        # unique per secret class, placed in the system prompt

def leaked(answer: str, tool_calls: list[dict]) -> dict:
    return {"in_reply": CANARY.lower() in (answer or "").lower(),
            "in_tool_args": any(CANARY.lower() in json.dumps(c.get("args", {})).lower() for c in tool_calls)}
```

### Drift detector and canary verdict

```python
import math, statistics

def drift(daily_scores, window=3, z=2.5):
    history, recent = daily_scores[:-window], daily_scores[-window:]
    if len(history) < 2:
        return False
    mu, sd = statistics.mean(history), statistics.stdev(history) or 1e-9
    return statistics.mean(recent) < mu - z * sd

def canary_verdict(pass_old, n_old, pass_new, n_new, p95_new_ms, p95_budget_ms, min_n=100):
    if p95_new_ms > p95_budget_ms:
        return "roll back"                      # latency is a hard gate
    if min(n_old, n_new) < min_n:               # min_n is a placeholder; size it to the effect you need to detect
        return "hold"                           # too few samples
    p1, p2 = pass_old / n_old, pass_new / n_new
    se = math.sqrt(p1 * (1 - p1) / n_old + p2 * (1 - p2) / n_new)
    lo, hi = (p2 - p1) - 1.96 * se, (p2 - p1) + 1.96 * se
    return "promote" if lo > 0 else "roll back" if hi < 0 else "hold"
```
