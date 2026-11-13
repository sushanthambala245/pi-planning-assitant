# Data folder

The backend reads every source from this folder (`DATA_DIR`, default `../data` from `backend/`)
at startup and on `POST /api/sources/reload`. Files are found in
any sub-folder (the Haverstone package sits in `data_sources/data_sources/`), so an unzipped
package can be dropped in as it is. Missing files are reported as missing; nothing is invented.
All data is synthetic (Haverstone case study). Do not put eval answer keys or reference
answers in here: anything in this folder can be retrieved and cited.

## The knowledge base

The agents read four sources, plus one lookup:

| ID | Source | What it gives the analysis |
|---|---|---|
| S1 | Initiatives | The initiatives to plan, their **status** (only *Ready for PI Planning* is analysed), the **declared dependencies** (`dependency`), the **target quarter** (the sequence the team planned), the **T-shirt size**, the **priority** and the description (read for dependencies nobody declared) |
| S4 | GitHub repositories | Hidden **code** dependencies: a repo of one team depending on a repo or a **shared library** of another team, the repo type (a link onto an api or contracts repo should go first) and lifecycle (deprecated repos) |
| S5 | Team capacity | Each team's available **story points per quarter**: its velocity, and how long a T-shirt size takes that team |
| S6 | Team directory | Team names and release trains (ARTs) |
| S7 | Service ownership map | **Lookup only**: who owns each named system, its lifecycle and whether its interface contract is approved |

Every other source (S2, S3, S8, S9, S10, M1–M4) is reported as **off** and not read, whether or
not the file is here. `ACTIVE_SOURCES` in `backend/.env` changes the set (`all` turns every
source on). Only initiatives whose `status` is in `READY_STATUSES` (default *Ready for PI
Planning*) can be analysed: *In Discovery* ones are not yet known to be initiatives and
*Proposed* ones are not accepted, so both are listed but left out.

## Finding the files

Each source is looked up by its file name, then by its alternative names. An alternative may be
a pattern: `initiatives_updated*.csv`, `team_capacity_updated*.csv` and
`dependency_statements_updated*.csv` match every re-issue (`_v1`, `_v2` …), and among those the
**most recently saved** file wins. Fixed alternatives are the Haverstone re-issues
`github_repos_version_aligned.csv` and `kpi_benchmarks_updated.csv`. If two copies are found,
the canonical name and then the shallowest path wins, and the other copy is named in the
source report.

Column headers are normalised (lower-case, non-alphanumerics to `_`), then mapped through
the aliases in `backend/context/sources.py`. If your headers differ, add an alias there
rather than renaming files. A missing **required** column makes the source invalid (nothing
loaded); a row with an empty required value, a non-numeric number, or a duplicate key is
rejected and listed in the source report. List columns accept `;`, `|` or `,` as separators.

| ID | File | Stands in for | Required columns | Optional columns | Used by |
|---|---|---|---|---|---|
| S1 | `initiatives.csv` | Jira + Confluence initiative text | `initiative_id`, `title`, `owning_team` | `status`, `dependency`, `target_pi`, `tshirt_size`, `priority`, `description`, `art`, `business_outcome`, `initiative_type`, `estimate_points`, `targeted_sprint` | Analyser · Discovery · Sequencing · Risk |
| S4 | `github_repos.csv` | GitHub repos & manifests | `repo`, `owner_team` | `repo_id`, `internal_dependencies`, `shared_libraries`, `repo_type`, `status`, `language`, `description`, `manifest`, `version`, `last_commit` | Discovery (code) · Risk (X-004) |
| S5 | `team_capacity.csv` | PMO / Jira capacity | `team`, `capacity_points` | `pi`, `sprint`, `committed_points`, `eng_weeks` | Sequencing · Risk (X-003) |
| S6 | `team_directory.csv` | Org directory | `team` | `team_name`, `art`, `team_status`, `em`, `po`, `rte` | Analyser · Sequencing |
| S7 | `service_ownership_map.csv` | ServiceNow ownership records (lookup) | `service` | `owner_team`, `service_type`, `ownership_status`, `status`, `contract_status` | Analyser · Discovery (ownership) · Risk (X-002, X-004, X-005) |
| S2 *(off)* | `epics_jira.csv` | Jira epics & comments | `epic_key`, `summary` | `initiative_id`, `description`, `status`, `team`, `comments`, `components`, `story_points` | — |
| S3 *(off)* | `dependency_statements.csv` | Jira comments / Slack (annotated) | `statement_id`, `text` | `source_ref`, `channel`, `from_entity`, `to_entity`, `is_dependency`, `dependency_type` | Evals |
| S8 *(off)* | `historical_pi_outcomes.csv` | Retro / Jira history (6 PIs) | `pi`, `team` | `committed_points`, `delivered_points`, `blockers`, `initiative_id` | Risk calibration · Evals |
| S9 *(off)* | `kpi_benchmarks.csv` | PMO / industry benchmarks | `kpi` | `value`, `target`, `unit`, `benchmark_type`, `description` | — |
| S10 *(off)* | `jira_tagged_links.csv` | Jira blocked-by links | `from_key`, `to_key` | `link_type` | Evals |
| M1–M4 *(off)* | `docs/`, `archer_controls.csv`, `slack_snippets.txt`, `spaghetti_sheet.xlsx` | Confluence, Archer, Slack, Spaghetti sheet (mocks, not in the package) | — | — | Risk (X-005, X-007, X-008) |

## Haverstone headers → contract

The Haverstone package (see `PI_Planner_S1-S10_Data_Dictionary_UPDATED.xlsx`) maps as follows.
Columns not listed are kept as extra columns (shown as "unknown" in the source report).

| ID | Haverstone column → contract column |
|---|---|
| S1 (`initiatives_updated_v1.csv`) | `initiative_name` → `title`, `T-Shirt Sizing` → `tshirt_size`, `target_pi-explicitly Q1/Q2..` → `target_pi` (matched by its `target_pi` prefix); `status`, `dependency`, `priority`, `art`, `business_outcome` as they are |
| S4 | `repo_name` → `repo`, `team_id` → `owner_team`, `declared_internal_repo_ids` → `internal_dependencies`, `declared_shared_libraries` → `shared_libraries`, `repo_type`, `primary_language` → `language`, `lifecycle_status` → `status`, `dependency_manifest_path` → `manifest` |
| S5 (`team_capacity_updated_v1.csv`) | `team_id` → `team`, `available_story_points` → `capacity_points` (one row per team: its capacity in every quarter) |
| S6 | `team_id` → `team` (`team_name` is kept as a display column) |
| S7 | `service_name` → `service`, `owning_team_id` → `owner_team`, `lifecycle_status` → `status`, `interface_contract_status` → `contract_status`; `service_type`, `ownership_status` as they are |

## How the columns are used

- **S1 `status`**: the readiness gate above. A manual or uploaded initiative without a status
  counts as ready (it was added to be planned).
- **S1 `dependency`**: the user-defined dependencies, `"Upstream: A, B; Downstream: C"`.
  Upstream systems are ones the initiative consumes; downstream systems consume its output. A
  part without a label counts as upstream. Each system's owner comes from S7.
- **S1 `target_pi`**: the target quarter (`Q1`, `Q2` …): the sequence the team planned. The plan
  never starts an initiative before it, and conflicts are reported when a dependency or a
  team's capacity breaks it. Quarters run Q1–Q4 (`PLAN_QUARTERS`), `SPRINTS_PER_PI` sprints each.
- **S1 `tshirt_size`**: S / M / L / XL, worth story points on the `TSHIRT_POINTS` scale (default
  XS 3, S 5, M 8, L 13, XL 21, XXL 34). An initiative without a size is scheduled at
  `DEFAULT_SIZE` and flagged until someone sizes it. A planner can change a size in the UI.
- **S1 `priority`**: Critical → High → Medium → Low decides who goes first when a team is full; it
  never overrides a dependency.
- **S1 `description`** (and planner notes): read for dependencies that are stated but not declared.
- **S4 `declared_internal_repo_ids`**: the repos this repo depends on, by `repo_id` or name. A link
  to another team's repo is a team-level coupling (the Haverstone repos are one service, api and
  contracts repo per team). It becomes a code dependency between two initiatives only when something
  ties it to them: the initiative builds on a system the other team owns (declared upstream or named
  in its text, owner from S7), or the other initiative's text announces an interface change and the
  repo called is an api / contracts repo. Couplings with neither are reported in the code tool's
  notes on the Analysis screen, not counted as dependencies.
- **S4 `declared_shared_libraries`**: an initiative that changes a shared library makes every team
  whose repos use it re-test. The initiative's text must name the library (hfg-event-schema: "event
  schema"); a name that is one common word once generic parts are dropped (hfg-api-contract-testing)
  needs every word, so "the new API contract" is not a change to the contract-testing library.
- **S5 `capacity_points`**: story points per quarter. A row with `pi` applies to that quarter only,
  a row with `sprint` to that sprint. The quarter is spread over its sprints, so a provider can land
  early in a quarter and its consumer later in the same one. The team's velocity tier names its
  quarterly capacity as a size (`VELOCITY_TIERS`: up to 24 is S, 32 M, 40 L, more XL).
- **S7**: a blank `owner_team` means "no owner" (DRI-X-002). `status` values such as `deprecated`,
  `sunset` or `retired` trigger DRI-X-004 (as does a deprecated S4 repo). A `contract_status` of
  Missing or Draft triggers DRI-X-005. The `related_initiative_ids` and upstream / downstream
  initiative id columns are **not read**: they would hand the agents the answer.

## Known gaps

- **S5** has no `committed_points`: load % counts only the initiatives in the run, so it is a floor;
  DRI-X-003 is reported as partly checked.
- **S8** (history) is off, so risk severities are not calibrated against past delivery; the
  analysis lists that under "checks that did not run". If you switch it on, note that
  `mid_pi_blockers` is not mapped to `blockers`: 83% of team-PIs have one, which would escalate
  every team's warnings (tune `HISTORY_MISS_RATIO` / `HISTORY_ESCALATE_SHARE` first).
- **S3** has no `is_dependency` / `to_entity` labels, so `python -m evals.run extraction` reports
  "not measured". Its label columns are never indexed or shown to a model.
- **M1–M4** are not in the package, so DRI-X-007 and X-008 are reported as "Not checked"; X-005 is
  checked from the S7 contract status instead of Confluence pages.

## Notes for switched-on extra sources

- **S2**: `S2.initiative_id` links epics to initiatives; without it, epics cannot be attributed.
- **S3**: `from_entity`, `to_entity`, `is_dependency` and `dependency_type` are eval labels, never
  indexed or shown to a model; only `text` is. `source_ref` attributes a statement to its initiative.
- **S8**: a PI counts as missed when `delivered_points < 0.8 x committed_points` or `blockers` is
  non-empty text or a count above 0.
- **S9**: a blank `value` is shown as n/a, never as 0.
- **S10**: `from_key` / `to_key` are epic keys (as in S2); `from_key` is the blocked epic.
- **M1** `docs/`: Markdown files, any sub-folders. Pages whose path or title mentions
  contract / api / integration / interface count as API contracts for DRI-X-005.
- **M2**: an initiative with `signoff_required` true (or blank) and no `signoff_date` triggers DRI-X-008.
- **M3** `slack_snippets.txt`: one message per paragraph (blank-line separated) or per line;
  `[timestamp] #channel user: text` is parsed when present.
- **M4**: optional; loaded as a raw table for the today-vs-Co-Pilot comparison.
