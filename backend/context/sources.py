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
    # Other names the file may have in the data package (e.g. a re-issued "_updated" export). Glob
    # patterns are allowed ("initiatives_updated*.csv"): the newest matching file wins.
    alt_filenames: tuple[str, ...] = ()
    required: tuple[str, ...] = ()
    optional: tuple[str, ...] = ()
    types: dict[str, ColType] = field(default_factory=dict)
    aliases: dict[str, str] = field(default_factory=dict)
    # Header prefixes mapped onto a column when no exact alias matched, for headers that carry
    # their own explanation ("target_pi-explicitly Q1/Q2.." normalises to target_pi_explicitly_q1_q2).
    alias_prefixes: dict[str, str] = field(default_factory=dict)
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
            used_by="Initiative Analyser · Discovery · Sequencing · Ask",
            key="initiative_id",
            alt_filenames=("initiatives_updated*.csv", "initiatives_v*.csv"),
            required=("initiative_id", "title", "owning_team"),
            # status gates the run (only READY_STATUSES are analysed); dependency is the user-defined
            # "Upstream: A, B; Downstream: C" list; target_pi is the user-defined quarter (Q1, Q2 ...);
            # tshirt_size (S / M / L / XL) is the size the schedule weighs against team capacity.
            # estimate_points and targeted_sprint are read when an older export still has them.
            optional=("description", "target_pi", "art", "tshirt_size", "estimate_points", "priority", "status",
                      "initiative_type", "business_outcome", "targeted_sprint", "dependency"),
            types={"estimate_points": "float"},
            aliases={"id": "initiative_id", "name": "title", "initiative_name": "title", "team": "owning_team",
                     "team_id": "owning_team", "owner_team": "owning_team", "pi": "target_pi",
                     "target_quarter": "target_pi", "quarter": "target_pi", "text": "description",
                     "summary": "description", "story_points": "estimate_points", "type": "initiative_type",
                     "sprint": "targeted_sprint", "target_sprint": "targeted_sprint", "dependencies": "dependency",
                     "outcome": "business_outcome", "t_shirt_sizing": "tshirt_size", "t_shirt_size": "tshirt_size",
                     "tshirt": "tshirt_size", "size": "tshirt_size", "tshirt_sizing": "tshirt_size"},
            alias_prefixes={"target_pi": "target_pi", "target_quarter": "target_pi", "t_shirt": "tshirt_size",
                            "tshirt": "tshirt_size"},
            index_columns=("title", "description", "dependency"),
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
            alt_filenames=("dependency_statements_updated*.csv",),
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
            # repo_type (service / api / contracts / shared_library) says whether a code link lands on an
            # interface; shared_libraries finds the teams a shared-library change ripples to.
            optional=("repo_id", "language", "internal_dependencies", "service", "status", "repo_type", "description",
                      "shared_libraries", "manifest", "version", "last_commit"),
            types={"internal_dependencies": "list", "shared_libraries": "list"},
            aliases={"repo_name": "repo", "name": "repo", "owner": "owner_team", "team": "owner_team",
                     "team_id": "owner_team", "primary_language": "language", "lifecycle_status": "status",
                     "declared_internal_deps": "internal_dependencies", "dependencies": "internal_dependencies",
                     "deps": "internal_dependencies", "declared_internal_repo_ids": "internal_dependencies",
                     "declared_shared_libraries": "shared_libraries", "libraries": "shared_libraries",
                     "type": "repo_type", "dependency_manifest_path": "manifest", "last_commit_at": "last_commit"},
        ),
        SourceSpec(
            id="S5",
            filename="team_capacity.csv",
            title="Team capacity",
            stands_in_for="PMO / Jira capacity",
            kind="csv",
            used_by="Sequencing · Risk (X-003)",
            alt_filenames=("team_capacity_updated*.csv", "team_capacity_v*.csv"),
            # One row per team is its capacity in every quarter (PI); add pi for a quarter of its own,
            # or sprint for sprint-by-sprint velocity.
            required=("team", "capacity_points"),
            optional=("pi", "sprint", "committed_points", "eng_weeks"),
            types={"capacity_points": "float", "committed_points": "float", "eng_weeks": "float"},
            aliases={"team_id": "team", "target_pi": "pi", "capacity": "capacity_points",
                     "story_points": "capacity_points", "available_story_points": "capacity_points",
                     "committed": "committed_points", "demand_points": "committed_points", "sprint_id": "sprint"},
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
            optional=("team_name", "art", "team_status", "em", "po", "rte"),
            # team_id before team_name: every other source joins on the id.
            aliases={"team_id": "team", "team_name": "team", "engineering_manager": "em", "product_owner": "po"},
        ),
        SourceSpec(
            id="S7",
            filename="service_ownership_map.csv",
            title="Service ownership map",
            stands_in_for="ServiceNow ownership records",
            kind="csv",
            used_by="Analyser · Discovery ④ · Risk (X-002, X-004, X-005)",
            key="service",
            required=("service",),
            # A lookup per named system: its owning team, its kind (service / API / dataset ...), whether
            # it is being retired (lifecycle) and whether its interface contract is approved. A blank
            # owner means "no owner" (DRI-X-002). The related_*_initiative_ids columns are not read:
            # they would hand the agents the answer instead of letting them find the dependencies.
            optional=("owner_team", "service_type", "ownership_status", "status", "contract_status"),
            aliases={"service_name": "service", "owner": "owner_team", "team": "owner_team", "owning_team": "owner_team",
                     "owning_team_id": "owner_team", "lifecycle_status": "status",
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

# The knowledge base the planning agents use by default (ACTIVE_SOURCES overrides it): initiatives,
# GitHub repositories, team capacity and the team directory, plus the ownership map as a lookup of
# who owns each named system. The other sources are reported as switched off.
KNOWLEDGE_BASE = ("S1", "S4", "S5", "S6", "S7")
