"""The data source catalogue: which files the loader expects and their column contract.

Column names are a first guess at the Haverstone package. When the real files arrive,
map their headers in ALIASES (or rename the canonical columns) rather than editing the
loader. A required column that is missing makes the whole source invalid; a row with an
empty required value is rejected and counted (considerations §3.3).
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Literal

ColType = Literal["str", "float", "bool", "list"]
Kind = Literal["csv", "markdown_dir", "text", "xlsx"]


@dataclass(frozen=True)
class SourceSpec:
    id: str
    filename: str
    title: str
    stands_in_for: str
    kind: Kind
    used_by: str
    key: str | None = None
    # Other names the file may have in the data package (e.g. a re-issued "_updated" export).
    alt_filenames: tuple[str, ...] = ()
    required: tuple[str, ...] = ()
    optional: tuple[str, ...] = ()
    types: dict[str, ColType] = field(default_factory=dict)
    aliases: dict[str, str] = field(default_factory=dict)
    # Columns chunked into the retrieval index. Label / answer-key columns are never indexed.
    index_columns: tuple[str, ...] = ()
    label_columns: tuple[str, ...] = ()
    mock: bool = False

    @property
    def columns(self) -> tuple[str, ...]:
        return self.required + self.optional


SOURCES: dict[str, SourceSpec] = {
    s.id: s
    for s in [
        SourceSpec(
            id="S1",
            filename="initiatives.csv",
            title="Roadmap initiatives",
            stands_in_for="Jira + Confluence initiative text",
            kind="csv",
            used_by="Initiative Analyser · Sequencing · Ask",
            key="initiative_id",
            required=("initiative_id", "title", "owning_team"),
            optional=("description", "target_pi", "art", "estimate_points", "priority", "size", "targeted_sprint",
                      "status"),
            types={"estimate_points": "float"},
            aliases={"id": "initiative_id", "name": "title", "initiative_name": "title", "team": "owning_team",
                     "team_id": "owning_team", "owner_team": "owning_team", "pi": "target_pi", "text": "description",
                     "summary": "description", "story_points": "estimate_points",
                     # The Nov 6 sheet: "target_pi-explicitly Q1/Q2.." and "T-Shirt Sizing".
                     "target_pi_explicitly_q1_q2": "target_pi", "t_shirt_sizing": "size", "t_shirt_size": "size",
                     "tshirt_size": "size", "tshirt_sizing": "size", "targeted_sprint_id": "targeted_sprint"},
            index_columns=("title", "description"),
        ),
        SourceSpec(
            id="S2",
            filename="epics_jira.csv",
            title="Jira epics",
            stands_in_for="Jira epics & comments",
            kind="csv",
            used_by="Initiative Analyser · Discovery ①",
            key="epic_key",
            required=("epic_key", "summary"),
            optional=("initiative_id", "description", "status", "team", "comments", "components", "story_points"),
            types={"components": "list", "story_points": "float"},
            aliases={"key": "epic_key", "issue_key": "epic_key", "epic_id": "epic_key", "title": "summary",
                     "epic_name": "summary", "owning_team": "team", "team_id": "team", "comment": "comments",
                     "points": "story_points"},
            index_columns=("summary", "description", "comments"),
        ),
        SourceSpec(
            id="S3",
            filename="dependency_statements.csv",
            title="Dependency statements (labelled)",
            stands_in_for="Jira comments / Slack (annotated)",
            kind="csv",
            used_by="Discovery ① · Verifier · Evals",
            key="statement_id",
            alt_filenames=("dependency_statements_updated.csv",),
            required=("statement_id", "text"),
            optional=("source_ref", "channel", "from_entity", "to_entity", "is_dependency", "dependency_type",
                      "dependency_impact", "upstream_initiative_id", "upstream_system", "dependency_eta_date"),
            types={"is_dependency": "bool"},
            aliases={"id": "statement_id", "snippet": "text", "statement": "text", "statement_text": "text",
                     "epic_key": "source_ref", "source": "channel", "source_system": "channel",
                     "label": "is_dependency", "from": "from_entity", "to": "to_entity",
                     "dependency_kind": "dependency_type"},
            index_columns=("text",),
            # The Haverstone annotation columns are answer keys too: never indexed or shown to a model.
            label_columns=("from_entity", "to_entity", "is_dependency", "dependency_type", "dependency_impact",
                           "upstream_initiative_id", "upstream_system", "dependency_eta_date"),
        ),
        SourceSpec(
            id="S4",
            filename="github_repos.csv",
            title="GitHub repositories",
            stands_in_for="GitHub repos & manifests",
            kind="csv",
            used_by="Discovery ② · Risk",
            key="repo",
            alt_filenames=("github_repos_version_aligned.csv",),
            required=("repo", "owner_team"),
            # repo_id: other sources may refer to a repo by id; the resolver maps ids onto names.
            optional=("repo_id", "language", "internal_dependencies", "service", "status"),
            types={"internal_dependencies": "list"},
            aliases={"repo_name": "repo", "name": "repo", "owner": "owner_team", "team": "owner_team",
                     "team_id": "owner_team", "primary_language": "language", "lifecycle_status": "status",
                     "declared_internal_deps": "internal_dependencies", "dependencies": "internal_dependencies",
                     "deps": "internal_dependencies", "declared_internal_repo_ids": "internal_dependencies"},
        ),
        SourceSpec(
            id="S5",
            filename="team_capacity.csv",
            title="Team capacity",
            stands_in_for="PMO / Jira capacity",
            kind="csv",
            used_by="Sequencing · Risk (X-003)",
            required=("team", "pi", "capacity_points"),
            optional=("committed_points", "eng_weeks"),
            types={"capacity_points": "float", "committed_points": "float", "eng_weeks": "float"},
            aliases={"team_id": "team", "target_pi": "pi", "capacity": "capacity_points",
                     "story_points": "capacity_points", "available_story_points": "capacity_points",
                     "committed": "committed_points", "demand_points": "committed_points"},
        ),
        SourceSpec(
            id="S6",
            filename="team_directory.csv",
            title="Team directory",
            stands_in_for="Org directory",
            kind="csv",
            used_by="Analyser · Sequencing · Ask",
            key="team",
            required=("team",),
            optional=("art", "em", "po", "rte"),
            # team_id before team_name: every other source joins on the id.
            aliases={"team_id": "team", "team_name": "team", "engineering_manager": "em", "product_owner": "po"},
        ),
        SourceSpec(
            id="S7",
            filename="service_ownership_map.csv",
            title="Service ownership map",
            stands_in_for="ServiceNow ownership records",
            kind="csv",
            used_by="Discovery ③ · Risk (X-002)",
            key="service",
            required=("service",),
            # service_type (service / API / dataset ...) splits APIs from services in the UI;
            # contract_status (Approved / Draft / Missing) feeds the change classification.
            optional=("owner_team", "capability", "api", "dataset", "status", "repo", "description", "service_type",
                      "contract_status"),
            types={"repo": "list"},
            aliases={"service_name": "service", "owner": "owner_team", "team": "owner_team", "owning_team": "owner_team",
                     "owning_team_id": "owner_team", "lifecycle_status": "status", "related_repo_ids": "repo",
                     "interface_contract_status": "contract_status"},
        ),
        SourceSpec(
            id="S8",
            filename="historical_pi_outcomes.csv",
            title="Historical PI outcomes",
            stands_in_for="Retro / Jira history (6 PIs)",
            kind="csv",
            used_by="Risk · Evals",
            required=("pi", "team"),
            optional=("committed_points", "delivered_points", "blockers", "initiative_id"),
            types={"committed_points": "float", "delivered_points": "float"},
            # Haverstone S8 counts initiatives, not points; the miss rule is a ratio, so it holds.
            # mid_pi_blockers is deliberately not mapped to blockers: 83% of its team-PIs have one or
            # more, which would escalate every team. Map it here only after tuning HISTORY_* thresholds.
            aliases={"historical_pi": "pi", "team_id": "team", "committed": "committed_points",
                     "committed_initiatives": "committed_points", "delivered": "delivered_points",
                     "delivered_initiatives": "delivered_points", "blocker": "blockers"},
        ),
        SourceSpec(
            id="S9",
            filename="kpi_benchmarks.csv",
            title="KPI benchmarks",
            stands_in_for="PMO / industry benchmarks",
            kind="csv",
            used_by="Visualisation",
            alt_filenames=("kpi_benchmarks_updated.csv",),
            # value may be blank: a KPI without a defensible baseline is shown as n/a, never as 0.
            required=("kpi",),
            optional=("value", "target", "unit", "benchmark_type", "description"),
            types={"value": "float", "target": "float"},
            aliases={"metric": "kpi", "name": "kpi", "kpi_metric": "kpi", "metric_name": "kpi",
                     "baseline": "value", "baseline_value": "value", "target_value": "target",
                     "source": "benchmark_type", "type": "benchmark_type", "benchmark_category": "benchmark_type",
                     "notes": "description"},
        ),
        SourceSpec(
            id="S10",
            filename="jira_tagged_links.csv",
            title="Jira 'blocked by' links",
            stands_in_for="Jira blocked-by links (§8 baseline)",
            kind="csv",
            used_by="Discovery · Verifier · Viz",
            required=("from_key", "to_key"),
            optional=("link_type",),
            aliases={"from": "from_key", "to": "to_key", "source_key": "from_key", "target_key": "to_key",
                     "inward": "from_key", "outward": "to_key", "source_epic_id": "from_key",
                     "blocked_by_epic_id": "to_key", "type": "link_type"},
        ),
        SourceSpec(
            id="M1",
            filename="docs",
            title="Confluence docs",
            stands_in_for="Confluence architecture / app inventory / API contracts",
            kind="markdown_dir",
            used_by="Analyser · Discovery ① · Risk (X-005) · Ask",
            mock=True,
        ),
        SourceSpec(
            id="M2",
            filename="archer_controls.csv",
            title="Archer controls",
            stands_in_for="Archer GRC",
            kind="csv",
            used_by="Risk",
            key="control_id",
            required=("control_id", "initiative_id"),
            optional=("control_type", "signoff_required", "signoff_date", "owner"),
            types={"signoff_required": "bool"},
            aliases={"id": "control_id", "type": "control_type", "scheduled_date": "signoff_date"},
            mock=True,
        ),
        SourceSpec(
            id="M3",
            filename="slack_snippets.txt",
            title="Slack snippets",
            stands_in_for="Slack",
            kind="text",
            used_by="Discovery ① · Risk (X-007)",
            mock=True,
        ),
        SourceSpec(
            id="M4",
            filename="spaghetti_sheet.xlsx",
            title="Spaghetti sheet",
            stands_in_for="Spaghetti Sheet / Miro",
            kind="xlsx",
            used_by="Viz (optional)",
            mock=True,
        ),
    ]
}

# Sources whose text goes into the retrieval index.
INDEXED_SOURCES = ("S1", "S2", "S3", "M1", "M3")
