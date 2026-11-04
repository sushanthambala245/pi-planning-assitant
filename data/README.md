# Data folder

The backend reads every source from this folder (`DATA_DIR`, default `../data` from `backend/`)
at startup and on `POST /api/sources/reload`. Files are found in
any sub-folder (the Haverstone package sits in `data_sources/data_sources/`), so an unzipped
package can be dropped in as it is. Missing files are reported as missing; nothing is invented.
All data is synthetic (Haverstone case study). Do not put eval answer keys or reference
answers in here: anything in this folder can be retrieved and cited.

Each source is looked up by its file name, then by its alternative names (the Haverstone
re-issues: `dependency_statements_updated.csv`, `github_repos_version_aligned.csv`,
`kpi_benchmarks_updated.csv`). If two copies are found, the canonical name and then the
shallowest path wins, and the other copy is named in the source report.

Column headers are normalised (lower-case, non-alphanumerics to `_`), then mapped through
the aliases in `backend/context/sources.py`. If your headers differ, add an alias there
rather than renaming files. A missing **required** column makes the source invalid (nothing
loaded); a row with an empty required value, a non-numeric number, or a duplicate key is
rejected and listed in the source report. List columns accept `;`, `|` or `,` as separators.

| ID | File | Stands in for | Required columns | Optional columns | Used by |
|---|---|---|---|---|---|
| S1 | `initiatives.csv` | Jira + Confluence initiative text | `initiative_id`, `title`, `owning_team` | `description`, `target_pi`, `art`, `estimate_points`, `priority` | Initiative Analyser · Sequencing · Ask |
| S2 | `epics_jira.csv` | Jira epics & comments | `epic_key`, `summary` | `initiative_id`, `description`, `status`, `team`, `comments`, `components`, `story_points` | Initiative Analyser · Discovery ① |
| S3 | `dependency_statements.csv` | Jira comments / Slack (annotated) | `statement_id`, `text` | `source_ref`, `channel`, `from_entity`, `to_entity`, `is_dependency`, `dependency_type` | Discovery ① · Verifier · Evals |
| S4 | `github_repos.csv` | GitHub repos & manifests | `repo`, `owner_team` | `repo_id`, `language`, `internal_dependencies`, `service`, `status` | Discovery ② · Risk |
| S5 | `team_capacity.csv` | PMO / Jira capacity | `team`, `pi`, `capacity_points` | `committed_points`, `eng_weeks` | Sequencing · Risk (X-003) |
| S6 | `team_directory.csv` | Org directory | `team` | `art`, `em`, `po`, `rte` | Analyser · Sequencing · Ask |
| S7 | `service_ownership_map.csv` | ServiceNow ownership records | `service` | `owner_team`, `capability`, `api`, `dataset`, `status`, `repo`, `description` | Discovery ③ · Risk (X-002) |
| S8 | `historical_pi_outcomes.csv` | Retro / Jira history (6 PIs) | `pi`, `team` | `committed_points`, `delivered_points`, `blockers`, `initiative_id` | Risk · Evals |
| S9 | `kpi_benchmarks.csv` | PMO / industry benchmarks | `kpi` | `value`, `target`, `unit`, `benchmark_type`, `description` | Visualisation |
| S10 | `jira_tagged_links.csv` | Jira blocked-by links (§8 baseline) | `from_key`, `to_key` | `link_type` | Discovery · Verifier · Viz |
| M1 (mock) | `docs/` | Confluence architecture / app inventory / API contracts | — | — | Analyser · Discovery ① · Risk (X-005) · Ask |
| M2 (mock) | `archer_controls.csv` | Archer GRC | `control_id`, `initiative_id` | `control_type`, `signoff_required`, `signoff_date`, `owner` | Risk |
| M3 (mock) | `slack_snippets.txt` | Slack | — | — | Discovery ① · Risk (X-007) |
| M4 (mock) | `spaghetti_sheet.xlsx` | Spaghetti Sheet / Miro | — | — | Viz (optional) |

## Haverstone headers → contract

The Haverstone package (see `PI_Planner_S1-S10_Data_Dictionary_UPDATED.xlsx`) maps as follows.
Columns not listed are kept as extra columns (shown as "unknown" in the source report).

| ID | Haverstone column → contract column |
|---|---|
| S1 | `initiative_name` → `title`, `story points` → `estimate_points` |
| S2 | `epic_id` → `epic_key`, `epic_name` → `summary`, `team_id` → `team` |
| S3 | `statement_text` → `text`, `source_system` → `channel`, `dependency_kind` → `dependency_type` (label) |
| S4 | `repo_name` → `repo`, `team_id` → `owner_team`, `declared_internal_repo_ids` → `internal_dependencies`, `primary_language` → `language`, `lifecycle_status` → `status` |
| S5 | `team_id` → `team`, `target_pi` → `pi`, `available_story_points` → `capacity_points` (one row per sprint; summed per PI) |
| S6 | `team_id` → `team` (`team_name` is kept as a display column) |
| S7 | `service_name` → `service`, `owning_team_id` → `owner_team`, `lifecycle_status` → `status`, `related_repo_ids` → `repo` |
| S8 | `historical_pi` → `pi`, `team_id` → `team`, `committed_initiatives` → `committed_points`, `delivered_initiatives` → `delivered_points` |
| S9 | `KPI Metric` → `kpi`, `Baseline` → `value`, `Target` → `target`, `Notes` → `description` |
| S10 | `source_epic_id` → `from_key`, `blocked_by_epic_id` → `to_key` |

Known gaps in the Haverstone package:

- **S3** has no `is_dependency` / `to_entity` labels, so `python -m evals.run extraction` reports
  "not measured". `dependency_impact`, `upstream_initiative_id`, `upstream_system` and
  `dependency_eta_date` are treated as labels: never indexed or shown to a model.
- **S5** has no `committed_points`: load % counts only the initiatives selected in the run, so it is
  a floor; the UI and DRI-X-003 (reported as partly checked) say so. S5
  covers the planned PIs (PI-2026-06, PI-2027-01) and S8 only past ones, so the DRI back-test
  eval finds no matching team-PI and reports "not measured".
- **S8** `mid_pi_blockers` is not mapped to `blockers`: 83% of team-PIs have at least one, which
  would escalate every team's warnings. Map it (alias in `sources.py`) only after tuning
  `HISTORY_MISS_RATIO` / `HISTORY_ESCALATE_SHARE`. Until then the history note reports delivery
  shortfalls only and shows the mid-PI blocker count as context (not used for severity).
- **M1–M4** are not in the package, so DRI-X-005, X-007 and X-008 are reported as "Not checked".

Notes per source:

- **S1 / S2**: `S2.initiative_id` links epics to initiatives; without it, epics cannot be
  attributed and the attribution guard treats them as shared documents.
- **S3**: `from_entity`, `to_entity`, `is_dependency` and `dependency_type` are eval labels.
  They are never indexed or shown to a model; only `text` is. `source_ref` (an epic key or
  initiative id) attributes a statement to its initiative.
- **S4**: `internal_dependencies` lists the repos this repo declares a dependency on, by name
  or by `repo_id`.
- **S5**: `committed_points` is existing load; load % = (committed + selected estimate) / capacity.
- **S7**: a blank `owner_team` means "no owner" (DRI-X-002). `status` values such as
  `deprecated`, `sunset` or `retired` trigger DRI-X-004. `repo` (one or more, by name or
  `repo_id`) joins a service to S4.
- **S8**: a PI counts as missed when `delivered_points < 0.8 x committed_points` (a ratio, so
  initiative counts work too) or `blockers` is non-empty text or a count above 0.
- **S9**: a blank `value` is shown as n/a, never as 0.
- **S10**: `from_key` / `to_key` are epic keys (as in S2); `from_key` is the blocked epic.
- **M1** `docs/`: Markdown files, any sub-folders. Pages whose path or title mentions
  contract / api / integration / interface count as API contracts for DRI-X-005.
- **M2**: an initiative with `signoff_required` true (or blank) and no `signoff_date` triggers DRI-X-008.
- **M3** `slack_snippets.txt`: one message per paragraph (blank-line separated) or per line;
  `[timestamp] #channel user: text` is parsed when present.
- **M4**: optional; loaded as a raw table for the today-vs-Co-Pilot comparison.
