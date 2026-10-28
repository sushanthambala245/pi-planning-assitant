# Data formats

The UI ships **empty**: all content comes from files you upload on the Intake screen
(or from the backend once it exists). Accepted files: `.csv`, `.json`, `.xlsx`/`.xls`, `.zip`.

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
- an analysis object (the shape below) on its own

### Analysis object

Until the analysis backend is connected, this drives the **Analysis** and **Results** screens.
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
  "keyRisk": "Customer Profile schema ownership — no team assigned"
}
```

`x` / `y` on graph nodes are optional (viewBox is 420 × 240); nodes without them are spread
on an ellipse. `domain` picks the node colour (Platform, Compliance, Product, Data, Other have
fixed colours; any other name gets a stable fallback colour).

The TypeScript definitions live in `src/types.ts`; loose input is normalised in `src/lib/analysis.ts`.
