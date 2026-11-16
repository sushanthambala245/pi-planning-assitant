# Eval cases (write these after the data is in place)

Keep cases here, outside `data/`, so they can never be retrieved as evidence.

## golden.md — five golden examples, before any model run

```markdown
## G1 <initiative id and title>
- Expected systems: <services from S7>
- Expected dependencies: <initiative/team/service it waits for, and the sentence that says so>
- Expected risks: <DRI codes you would flag>
- Why: <one line>
```

Include at least one initiative with no dependencies, one that depends on another team only
through code (S4), and one whose only evidence is a Slack message.

## retrieval_cases.jsonl — labelled retrieval cases

One JSON object per line. Label evidence at the page level (`doc_id` without `#n`), so labels
survive a change of chunk size. Cases with no evidence (out of scope) are skipped by the metrics.

```json
{"id": "r01", "question": "Which API contract covers partner onboarding?", "evidence_docs": ["M1:architecture/partner-gateway-api-contract.md"], "sources": ["M1"], "corpus_fingerprint": "<from /api/health data.fingerprint>"}
{"id": "r02", "question": "What is the returns epic blocked on?", "evidence_docs": ["S2:RET-1"]}
```

Doc ids: `S1:<initiative_id>`, `S2:<epic_key>`, `S3:<statement_id>`, `M1:<path under docs/>`,
`M3:<message number>`. `corpus_fingerprint` is optional; when present, the eval warns if the
data has changed since the labels were written.
