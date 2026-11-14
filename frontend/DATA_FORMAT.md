# Data formats

With the backend running, initiatives and knowledge sources come from it (`backend/`, data in
`data/`), and the Analysis and Results screens render the `Analysis` object below as returned by
`GET /api/runs/{id}/analysis`; the Decisions screen works on its `plan`. Without it, the UI ships
**empty**: all content comes from files you upload on the Intake screen. Accepted files: `.csv`,
`.json`, `.xlsx`/`.xls`, `.zip`.

## CSV

| File | How it is read |
|---|---|
| Has `initiative_id` and `initiative_name` (or `title` / `name`) columns, and no `statement_id` / `epic_id` | **Initiatives.** `description`, `owning_team`, `art`, `priority`, `status`, `dependency`, `business_outcome`, the target quarter (any header starting `target_pi` / `target_quarter`) and the T-shirt size (any header starting `T-Shirt` / `tshirt` / `size`) are shown when present. Only *Ready for PI Planning* (or no status) can be ticked for analysis. |
| Any other CSV | **Knowledge source** (name from the file name, row/column counts shown). |

Header names are matched case-insensitively with spaces treated as underscores.

## ZIP

Each `.csv` / `.json` / `.xlsx` inside is handled as above. Excel files are listed as
knowledge sources but not parsed.

## JSON

A JSON file is one of:

- an array of initiatives: `[{ "id", "title", "description", "meta?" }]`
- a bundle: `{ "initiatives?": [...], "knowledgeSources?": [{ "name", "meta" }], "analysis?": { ... } }`
  (the Results screen's **Export** writes this shape, plus `runId`, `flaggedRisks`, `planner` and `comments`, which are ignored on upload)
- an analysis object (the shape below) on its own

### Analysis object

This drives the **Analysis**, **Results** and **Decisions** screens, whether it comes from the backend or a file.
Every field is optional, but at least one must be present.

```jsonc
{
  "agents": [
    {
      "id": "dependency-discovery",
      "name": "Dependency discovery",
      "icon": "ti-search",              // any Tabler icon class
      "summary": "What this agent did, in a sentence or two.",
      "durationMs": 2400,
      "inputs": ["initiatives.csv (90 rows)"],
      "outputs": ["8 dependencies (5 inferred)"],
      "notes": ["Skipped 2 initiatives with no system references"]
    }
  ],
  "findings": [
    {
      "tag": "sys",                     // "sys" = system found, "dep" = dependency
      "tagLabel": "Systems found",
      "text": "…",
      "note": "optional small print",
      "highlight": true,
      "agentId": "dependency-discovery" // links the finding to an agent's detail panel
    }
  ],
  "sourcesUsed": [{ "icon": "ti-users", "text": "Team ownership map — 2 teams matched" }],
  "graph": {
    "nodes": [{ "id": "partner", "label": "Partner API", "domain": "Platform", "x": 315, "y": 55 }],
    "edges": [{ "from": "partner", "to": "profile", "inferred": true }]
  },
  "risks": [
    {
      "id": "schema",
      "title": "Schema conflict — Customer Profile",
      "description": "Short summary shown in the list.",
      "severity": "High",               // High | Medium | Low
      "reasoning": ["Paragraph 1", "Paragraph 2"],
      "affected": [{ "domain": "Platform", "text": "Partner API upgrade — …" }],
      "sources": [{ "icon": "ti-sitemap", "text": "Application inventory — …" }],
      "suggestedPrompts": ["Who should own the schema?"],
      "highlightNodes": ["partner", "profile"]  // node ids highlighted when this risk is open
    }
  ],
  "sequence": ["Partner API", "Fraud Detection", "Returns Enhancement"],
  "keyRisk": "Customer Profile schema ownership — no team assigned",

  // --- optional; older files without these still load (filters and groups are then hidden) ---
  "initiatives": [{ "id": "INI-2", "title": "Partner API upgrade", "team": "PLT", "teamName": "Platform", "art": "Platform", "pi": "25.2" }],
  "dependencies": [
    {
      "key": "INI-2->team:DATA",          // matches graph edge "key"
      "from": "INI-2", "fromLabel": "Partner API upgrade",
      "to": "team:DATA", "toLabel": "Data",
      "level": "team",                     // initiative | team | system
      "toTeam": "Data",
      "changeType": "code",                // code | flow | regression | none
      "reason": "Partner API upgrade changes Customer Profile, which the Data team owns: …",
      "why": [{ "method": "ownership", "changeType": "code", "text": "…" }],
      "methods": ["code", "ownership"],    // explicit = stated in text
      "inferred": true,
      "verdict": "inferred_only",          // confirmed | stated_only | inferred_only
      "alsoFoundAs": [],
      "path": [{ "level": "initiative", "id": "INI-2", "label": "Partner API upgrade" },
               { "level": "system", "id": "service:Customer Profile", "label": "Customer Profile" },
               { "level": "team", "id": "team:DATA", "label": "Data" }],
      "evidence": [{ "icon": "ti-sitemap", "text": "Service ownership map · S7:Customer Profile: …" }],
      "evidenceCount": 2, "confidence": 0.65, "status": "verified", "inJira": false,
      // optional: where it came from and what it does to the plan (see the tables below)
      "declared": false, "provenance": "inferred", "impact": "orders",
      "depTypes": ["needs_change"], "note": "planner note sent with this run", "decision": ""   // "" | confirmed | dismissed
    }
  ],
  "steps": [{ "step": 1, "initiativeIds": ["INI-2"], "label": "Partner API upgrade", "why": "…", "inCycle": false }],

  // --- optional; the counts behind the Results screen's chips ---
  "summary": { "text": "54 initiatives across 34 teams: 97 declared dependencies, 214 hidden ones found …", "method": "template" },
  "notChecked": [                          // risk checks that did not run, or ran on partial data
    { "code": "DRI-X-007", "name": "Dependency only in an informal channel", "reason": "Needs Slack snippets (M3), which is not part of the knowledge base", "partial": false }
  ],

  // --- optional; which initiatives were ready for PI planning ---
  "readiness": {
    "total": 90, "ready": 54, "analysed": 54, "readyStatuses": ["Ready for PI Planning"],
    "byStatus": { "Ready for PI Planning": 54, "Proposed": 18, "In Discovery": 18 },
    "excluded": [{ "id": "INIT-004", "title": "…", "status": "In Discovery", "team": "CBL-Settlement", "teamName": "Settlement", "pi": "Q1" }],
    "readyNotAnalysed": []               // ready, but not ticked for this run
  },

  // --- optional; the three use cases in numbers and the quarter plan (Results use case 3, Decisions) ---
  "plan": {
    "horizon": ["Q1", "Q2", "Q3", "Q4"],  // the dashboard's buckets, then "Later"
    "sprintsPerPi": 5, "realSprints": 20, "defaultSize": "M",
    "tshirt": [{ "size": "S", "points": 5 }, { "size": "M", "points": 8 }],
    "velocityTiers": [{ "tier": "S", "upTo": 24 }, { "tier": "M", "upTo": 32 }, { "tier": "L", "upTo": 40 }, { "tier": "XL", "upTo": null }],
    "sprints": [{ "index": 0, "name": "Q1-Sprint-1", "short": "Q1 S1", "pi": "Q1", "assumed": false }],
    "pis": [{ "id": "Q1", "assumed": false, "sprints": [0, 1, 2, 3, 4], "quarter": true }],
    "items": [{
      "id": "INIT-021", "title": "Real-time payment status notifications", "team": "PAY-Disputes", "teamName": "Disputes",
      "art": "Payments & Money Movement", "priority": "High", "status": "Ready for PI Planning", "type": "", "outcome": "", "description": "…",
      "size": "S", "points": 5, "sizeSource": "tshirt", "sizeOverride": "", "dataSize": "S",   // sizeSource: tshirt | planner | estimate | assumed | none
      "targetQuarter": "Q1", "targetSource": "data", "quarterOverride": "",                    // targetSource: data | planner | sprint | none
      "plannedSprint": "", "plannedIndex": 0, "plannedFinish": 0, "plannedLabel": "Q1 S1", "plannedPi": "Q1",
      "deadline": 4, "spills": false, "movedBy": 7,
      "start": 7, "finish": 8, "startLabel": "Q2 S3", "finishLabel": "Q2 S4", "pi": "Q2", "finishPi": "Q2",
      "reasons": ["Waits for Mobile instant transfer experience, which finishes in Q2 S2 …", "5 points take 2 sprints at Disputes's velocity …"],
      "waitsFor": ["INIT-037"], "inCycle": false, "capacityKnown": true, "allocation": { "7": 2.5, "8": 2.5 },
      "declaredUpstream": ["RTP Network"], "declaredDownstream": ["Mobile Banking"], "note": "", "declaredLinks": 3, "hiddenLinks": 5
    }],
    "teams": [{
      "id": "PAY-ACH", "name": "ACH", "art": "Payments & Money Movement", "average": 4.8, "median": 4.8, "quarterCapacity": 24, "tier": "S",
      "known": true, "perSprint": [4.8], "capacityByPi": { "Q1": 24 }, "plannedByPi": { "Q1": 13 }, "scheduledByPi": { "Q1": 13 },
      "initiativeIds": ["INIT-016"], "asks": { "code": 2, "flow": 1 }
    }],
    "conflicts": [{                       // the plan as written (target quarters) that cannot hold
      "provider": "INIT-037", "consumer": "INIT-021", "kind": "later_quarter",   // later_quarter | too_tight | sprint
      "providerQuarter": "Q2", "consumerQuarter": "Q1", "providerLabel": "…", "consumerLabel": "…",
      "providerFinish": 6, "consumerStart": 0, "providerFinishLabel": "Q2 S2", "consumerStartLabel": "Q1 S1", "consumerFinishLabel": "Q1 S1",
      "declared": false, "depKey": "INIT-021->INIT-037", "recommendedStart": "Q2 S3"
    }],
    "links": [{ "provider": "INIT-037", "consumer": "INIT-021", "strength": "orders", "declared": false, "depKeys": ["INIT-021->INIT-037"], "reason": "…" }],
    "counts": { "declared": 97, "hidden": 214, "hiddenShare": 69, "ordering": 7, "conflicts": 3, "laterQuarter": 2, "spill": 5, "teamsOver": 2, "noSize": 2, "…": 0 },
    "planner": { "initiativeNotes": 0, "sizes": 0, "quarters": 0, "dependencyNotes": 0, "decisions": {} }   // what the run was sent
  }
}
```

Findings may also carry `kind` (the agent's tag: `systems`, `explicit`, `inferred`, `rejected`,
`sequence`, `risk`), `initiativeIds` (empty = spans the run; absent = matched by name in the
text), `depKey` + `changeType` for a dependency finding, and for a systems finding `systems`:
`[{ "name", "type": "service|api|dataset|capability", "team", "teamName", "access": "changes|writes|reads|unclear", "method", "quote" }]`.
Risks may carry `initiativeIds`, and `rule` + `ruleCode` (the rule that raised it, e.g.
`"No owner for a shared service"`, `"DRI-X-002"`; the decision summary groups risks by rule).
Graph nodes may carry `kind` (initiative / team / system, drawn as circle / square / diamond);
graph edges `changeType`, `key`, `declared` (solid line; hidden ones are dashed) and `impact`
(`orders` is drawn thicker).

When the analysis lists its `initiatives`, the graph draws them in a left column (in `steps`
order) and what they depend on in a right column; `x` / `y` are then ignored. Older files
without `initiatives` keep the ring layout: `x` / `y` are used when every node has them
(viewBox 420 × 240), otherwise nodes are spread on an ellipse. `domain` picks the node colour
(the backend sends the owning ART; the six Haverstone ARTs have fixed colour slots, any other
name gets a stable slot from its name; see `src/data/domains.ts`).

### What the change types mean

| `changeType` | Meaning | Typical cause |
|---|---|---|
| `code` | Someone must change code | the initiative changes another team's system; two initiatives change one system; a statement says *blocked on* / *requires* |
| `flow` | An integration, data flow or contract must be agreed | it writes to another team's system; it reads one whose contract is Draft or Missing; access not stated |
| `regression` | Nothing to build, but something must be re-tested | one side only reads a system the other changes; a statement mentions *validation* / *testing* |
| `none` | Awareness only | a repo build link to a team that changes nothing in this run; read-only use of an approved interface |

### Where a dependency came from, and what it does to the plan

| `provenance` | Meaning | Hidden? |
|---|---|---|
| `declared` | In the initiative's own dependency column (S1 `dependency`) | no (use case 1) |
| `planner` | A planner kept it, or wrote it in a note ("blocked on INIT-005") | no |
| `stated` | Written in the description, but not declared | **yes** (use case 2) |
| `inferred` | Found in GitHub (code or shared-library link) or through a shared system | **yes** (use case 2) |

| `impact` | Meaning |
|---|---|
| `orders` | The target must land first: the consumer starts the sprint after the provider finishes |
| `soft` | Should go first (a code link onto an interface another team changes); re-test after, the plan does not move |
| `coordinate` | No order forced, but the teams must agree a change, a flow or a contract |
| `retest` | A regression test after the other change lands |
| `aware` | Nothing to build, agree or re-test |

The TypeScript definitions live in `src/types.ts`; loose input is normalised in `src/lib/analysis.ts`.

### Planner input (backend only)

Notes, sizes, quarter placements and keep / dismiss decisions a planner adds on the Results and
Decisions screens are saved in the browser (`localStorage`, key `pi-planner-v2`) and sent with the
next run as `planner` on `POST /api/runs`:

```jsonc
{
  "initiative_ids": ["INIT-001", "…"],
  "previous_run_id": "run-…",                                    // a rerun: its comments on these initiatives carry over
  "planner": {
    "initiative_notes": { "INIT-021": "blocked on INIT-005" },   // read like a description: a stated dependency becomes planner-defined
    "sizes": { "INIT-030": "L" },                                // replaces the T-shirt size
    "quarters": { "INIT-002": "Q2", "INIT-040": "later" },       // from the decision dashboard; treated as the target quarter
    "dependency_notes": { "INIT-021->INIT-037": "agreed at the sync" },
    "dependency_decisions": { "INIT-021->INIT-037": "confirmed", "INIT-002->INIT-078": "dismissed" }
  }
}
```

"Rerun with updates" starts a new run of the same initiatives with this body; the current results
stay on screen until it finishes, then a message says what changed. A replayed file cannot be
rerun, but the dashboard still checks placements and exports them as CSV.

The Results screen's delivery timeline is drawn from `plan` (`items[].start` / `finish` against
`sprints`, `targetQuarter`, `plannedIndex` / `deadline`, `waitsFor`, `sizeSource`); nothing else is needed.

### Comments (backend; local for a replayed file)

Live feedback per initiative (ported from the `results-timeline-comments` branch), from
`GET /api/runs/{id}/comments?rev=N` (`rev` is what the client last saw; the answer is
`{ "rev": N, "unchanged": true, "comments": [] }` when nothing moved). The Results screen polls it every
5 s while it is open:

```jsonc
{ "id": "c-1a2b3c4d5e", "initiativeId": "INIT-001", "type": "concern",   // concern | question | decision | action
  "text": "…", "author": "Presenter", "authorId": "rte.presenter", "role": "RTE",   // set by the server from X-Demo-User
  "createdAt": "2026-11-12T13:02:11+00:00", "resolved": false, "resolvedBy": null, "resolvedAt": null }
```

`POST /api/runs/{id}/comments` takes `{ "initiative_id", "type", "text" }` (1 to 1000 characters; at
most 500 per run); `POST /api/runs/{id}/comments/{cid}/resolve` takes `{ "resolved": true|false }`
(reviewers, or the author); `GET /api/runs/{id}/comments/export` downloads a CSV. They are stored in the
run folder (`comments.json`) and copied to a rerun (`previous_run_id`) for the initiatives it keeps.
A replayed file has no backend run, so its comments are kept in the browser (`localStorage`) and
written into Export as `comments`. Comments are for people: the agents read only the planner notes.

### Run review (backend only)

`GET /api/runs/{id}/analysis` also returns, next to `analysis`, the run's `review`
(`{ "approvals": [{ "action", "reviewer", "role", "at", "note" }], "constraints": [{ "first", "then", "note" }], "exports": ["jira_link_proposals.csv", …] }`)
and `flags` (risk ids flagged for PI planning). The Results screen's review panel approves or
challenges with `POST /api/runs/{id}/review`, flags with `POST /api/runs/{id}/flags`, and
downloads exports from `GET /api/runs/{id}/export/{name}`.
