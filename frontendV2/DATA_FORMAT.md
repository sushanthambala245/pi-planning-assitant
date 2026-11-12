# Data formats

With the backend running, initiatives and knowledge sources come from it (`backend/`, data in
`data/`), and the Analysis and Results screens render the `Analysis` object below as returned by
`GET /api/runs/{id}/analysis`. Without it, the UI ships **empty**: all content comes from files
you upload on the Intake screen. Accepted files: `.csv`, `.json`, `.xlsx`/`.xls`, `.zip`.

## CSV

| File | How it is read |
|---|---|
| Has `initiative_id` and `initiative_name` (or `title` / `name`) columns, and no `statement_id` / `epic_id` | **Initiatives.** `description`, `owning_team`, `priority`, `target_pi` are shown when present. |
| Any other CSV | **Knowledge source** (name from the file name, row/column counts shown). |

Header names are matched case-insensitively with spaces treated as underscores.

## ZIP

Each `.csv` / `.json` / `.xlsx` inside is handled as above. Excel files are listed as
knowledge sources but not parsed.

## JSON

A JSON file is one of:

- an array of initiatives: `[{ "id", "title", "description", "meta?" }]`
- a bundle: `{ "initiatives?": [...], "knowledgeSources?": [{ "name", "meta" }], "analysis?": { ... } }`
  (the Results screen's **Export** writes this shape, plus `runId` and `flaggedRisks`, which are ignored on upload)
- an analysis object (the shape below) on its own

### Analysis object

This drives the **Analysis** and **Results** screens, whether it comes from the backend or a file.
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
      "evidenceCount": 2, "confidence": 0.65, "status": "verified", "inJira": false
    }
  ],
  "steps": [{ "step": 1, "initiativeIds": ["INI-2"], "label": "Partner API upgrade", "why": "…", "inCycle": false }],

  // --- optional; shown in the Results screen's decision summary ---
  "summary": { "text": "The analysis covers 3 initiatives …", "method": "llm" },   // llm | template
  "notChecked": [                          // risk checks that did not run, or ran on partial data
    { "code": "DRI-X-005", "name": "No API contract documented", "reason": "Needs Confluence docs (M1), which is not loaded", "partial": false }
  ]
}
```

Findings may also carry `kind` (the agent's tag: `systems`, `explicit`, `inferred`, `rejected`,
`sequence`, `risk`), `initiativeIds` (empty = spans the run; absent = matched by name in the
text), `depKey` + `changeType` for a dependency finding, and for a systems finding `systems`:
`[{ "name", "type": "service|api|dataset|capability", "team", "teamName", "access": "changes|writes|reads|unclear", "method", "quote" }]`.
Risks may carry `initiativeIds`, and `rule` + `ruleCode` (the rule that raised it, e.g.
`"No owner for a shared service"`, `"DRI-X-002"`; the decision summary groups risks by rule).
Graph nodes may carry `kind` (initiative / team / system, drawn as circle / square / diamond);
graph edges `changeType` and `key`.

When the analysis lists its `initiatives`, the graph draws them in a left column (in `steps`
order) and what they depend on in a right column; `x` / `y` are then ignored. Older files
without `initiatives` keep the ring layout: `x` / `y` are used when every node has them
(viewBox 420 × 240), otherwise nodes are spread on an ellipse. `domain` picks the node colour
(the backend sends the owning ART; Platform, Compliance, Product, Data, Other have fixed
colours; any other name gets a stable fallback colour).

### Delivery schedule (`schedule`)

Drives the Timeline view on the Results screen. Absent in older files and while a run has not
reached sequencing; the timeline then shows one column per step instead of sprints.

```jsonc
"schedule": {
  "pi": "PI-2026-06",
  "piSprints": 5,                       // sprints in the PI; bars past it spill
  "sizeSprints": { "S": 1, "M": 2, "L": 3, "XL": 4 },
  "criticalPath": ["INIT-001", "INIT-009"],
  "assumptions": ["Team capacity is not modelled: bars show size and dependency order only."],
  "rows": [
    {
      "initiativeId": "INIT-001",
      "team": "CBL-Account-Services",
      "size": "L",                      // S | M | L | XL
      "sizeSource": "size",             // size = from the data, points = estimated from story points, default = assumed
      "sprints": 3,
      "start": 1, "end": 3,             // 1-based sprints; end > piSprints means it spills past the PI
      "spillsPastPi": false,
      "waitsFor": [],                   // initiative ids that must finish first
      "critical": true, "inCycle": false,
      "targetedSprint": 2               // optional: the sprint number the roadmap asked for
    }
  ]
}
```

The backend derives it in `backend/tools/schedule.py`: an initiative starts the sprint after the last
initiative it waits for ends, and takes `SIZE_SPRINTS` sprints (default `S=1,M=2,L=3,XL=4`); `PI_SPRINTS`
(default 5) sets the PI length. The source CSV may call the size `T-Shirt Sizing`, `size` or similar.

### Comments

Live feedback per initiative, from `GET /api/runs/{id}/comments?rev=N` (`rev` is what the client last
saw; the answer is `{ "rev": N, "unchanged": true, "comments": [] }` when nothing moved):

```jsonc
{ "id": "c-1a2b3c4d5e", "initiativeId": "INIT-001", "type": "concern",   // concern | question | decision | action
  "text": "…", "author": "Presenter", "authorId": "rte.presenter", "role": "RTE",   // set by the server from X-Demo-User
  "createdAt": "2026-11-12T13:02:11+00:00", "resolved": false, "resolvedBy": null, "resolvedAt": null }
```

`POST /api/runs/{id}/comments` takes `{ "initiative_id", "type", "text" }` (1 to 1000 characters; at most 500 per run);
`POST /api/runs/{id}/comments/{cid}/resolve` takes `{ "resolved": true|false }` (reviewers, or the author);
`GET /api/runs/{id}/comments/export` downloads a CSV. They are stored in the run folder. A replayed file has no
backend run, so its comments are kept in the browser (`localStorage`) and written into Export as `comments`.

### What the change types mean

| `changeType` | Meaning | Typical cause |
|---|---|---|
| `code` | Someone must change code | the initiative changes another team's system; two initiatives change one system; a statement says *blocked on* / *requires* |
| `flow` | An integration, data flow or contract must be agreed | it writes to another team's system; it reads one whose contract is Draft or Missing; access not stated |
| `regression` | Nothing to build, but something must be re-tested | one side only reads a system the other changes; a statement mentions *validation* / *testing* |
| `none` | Awareness only | a repo build link to a team that changes nothing in this run; read-only use of an approved interface |

The TypeScript definitions live in `src/types.ts`; loose input is normalised in `src/lib/analysis.ts`.

### Run review (backend only)

`GET /api/runs/{id}/analysis` also returns, next to `analysis`, the run's `review`
(`{ "approvals": [{ "action", "reviewer", "role", "at", "note" }], "constraints": [{ "first", "then", "note" }], "exports": ["jira_link_proposals.csv", …] }`)
and `flags` (risk ids flagged for PI planning). The Results screen's review panel approves or
challenges with `POST /api/runs/{id}/review`, flags with `POST /api/runs/{id}/flags`, and
downloads exports from `GET /api/runs/{id}/export/{name}`.
