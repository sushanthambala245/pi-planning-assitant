# Evaluations

Offline checks that decide whether a change ships. Every result in `results/` records its
case-set fingerprint, data fingerprint, model and prompt version, the per-case rows, and a
95% bootstrap interval per metric. Results are regenerated, never edited by hand.

| Eval | Command | Ground truth | Metric(s) | Blames |
|---|---|---|---|---|
| Explicit extraction | `python -m evals.run extraction --mode rule` / `--mode llm` | S3 labels (`from_entity`, `to_entity`, `is_dependency`) | precision, recall | the extractor (rule baseline vs LLM prompt) |
| Retrieval | `python -m evals.run retrieval` | `cases/retrieval_cases.jsonl` (you write it) | hit rate @k, MRR, latency | the retriever |
| DRI back-test | `python -m evals.run backtest` | S8 history vs S5 capacity | recall, precision of DRI-X-003 | the capacity rule and its threshold |
| Known links | `python -m evals.run links --mode rule` / `--mode llm` | S10 Jira links between initiatives | recall; count of new pairs | the whole pipeline |
| Gate | `python -m evals.gate [--baseline <dir>]` | `thresholds.py` | per-metric floors | exits 1 on any miss |

Run everything from `backend/` with the virtualenv active.

## Order of work (considerations §5.2)

1. **Golden examples first.** Before any model run, write five in `cases/golden.md`: an
   initiative, the dependencies and risks you would accept, and one line on why.
2. **Baseline.** `extraction --mode rule` is the weak version the LLM must beat.
3. **One change at a time**, same cases, same judge; compare with `--baseline` (the gate
   refuses to compare results whose case-set fingerprints differ).
4. **Agree thresholds before scoring.** `thresholds.py` holds starting defaults marked
   UNCONFIRMED. Replace them, and record who agreed, before the first scored run.

## Proving the harness can fail

Every runner takes `--plant-regression`: an extractor that finds nothing, a retriever that
returns the same chunk for every query, a capacity rule that never fires, a pipeline that
finds no links. The metric must drop and `python -m evals.gate` must exit 1.
`tests/test_evals.py` checks this on a fixture.

## What these evals do not cover yet

- The Ask agent: no trajectory eval yet (tasks, simulated user, pass^k; `stats.pass_k` is ready).
- LLM-written rationales and summaries: no judge yet. Start with hand verdicts on a rubric
  before adding a model judge, and measure judge-human agreement with an interval.
- Guardrail false positives on real benign questions: add a benign set beside the attack set.
- S3 as few-shot examples: the prompts use none today. If you add S3 rows as examples,
  exclude those ids from the extraction eval.
