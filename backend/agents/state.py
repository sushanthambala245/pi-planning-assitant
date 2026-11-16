"""Typed contracts shared by every node, the API, the UI payload, and the audit trail.

Each model is a record type in the evidence chain: validated on write, with stable
ids so results can be joined across runs (considerations §3.3).
"""

from __future__ import annotations

import hashlib
import operator
from typing import Annotated, Literal

from pydantic import BaseModel, Field

# declared: written in the initiative's own dependency list (S1), i.e. user-defined.
# explicit: stated in the description or a planner note. code / library: GitHub (S4).
# ownership: a system two initiatives share, or one owned by another team. constraint: a reviewer's.
DepKind = Literal["declared", "explicit", "code", "library", "ownership", "constraint"]
Method = Literal["llm", "rule", "structural", "human"]
Severity = Literal["blocker", "warning", "info"]
TargetKind = Literal["initiative", "team", "service", "library"]
DepStatus = Literal["candidate", "verified", "low_confidence", "rejected"]


def stable_id(prefix: str, *parts: str) -> str:
    digest = hashlib.sha256("\x1f".join(parts).encode()).hexdigest()[:10]
    return f"{prefix}-{digest}"


class EvidenceRef(BaseModel):
    """A pointer to the record or chunk that supports a claim.

    `ref` is a stable handle (a chunk id such as ``S2:EPIC-12#0`` or a record id such as
    ``S4:payments-api``). `quote` is a verbatim span from that source and is checked by
    the verifier; `detail` is a human-readable explanation for structural evidence.
    """

    ref: str
    source: str
    quote: str = ""
    detail: str = ""


class Initiative(BaseModel):
    id: str
    title: str
    description: str = ""
    owning_team: str = ""
    target_pi: str | None = None  # S1 target quarter (Q1, Q2 ...) or PI: the user-defined sequence
    art: str | None = None
    tshirt_size: str = ""  # S1 T-shirt size (S / M / L / XL), weighed against team capacity
    estimate_points: float | None = None  # story points, when an older export has them
    origin: Literal["S1", "upload", "manual"] = "S1"
    status: str = ""
    priority: str = ""
    initiative_type: str = ""
    business_outcome: str = ""
    planned_sprint: str = ""  # S1 targeted_sprint: the user-defined start sprint
    dependency_text: str = ""  # S1 dependency: the user-defined "Upstream: ...; Downstream: ..." list
    note: str = ""  # a planner's note for this run (PlannerInput)
    size_override: str = ""  # a planner's T-shirt size for this run
    quarter_override: str = ""  # a planner's quarter for this run (decision dashboard)


class SystemTouch(BaseModel):
    initiative_id: str
    system: str
    owner_team: str | None = None
    # upstream / downstream: declared in the initiative's dependency list (it consumes the system /
    # the system consumes its output); mentioned: named in its text but not declared.
    role: Literal["upstream", "downstream", "mentioned", ""] = ""
    evidence: list[EvidenceRef] = Field(default_factory=list)
    confidence: float = 1.0
    method: Method = "rule"


class Dependency(BaseModel):
    id: str
    from_id: str  # the dependent initiative
    to_id: str  # an initiative id, "team:<name>" or "service:<name>"
    to_kind: TargetKind
    kind: DepKind
    dep_type: str = "depends_on"
    directed: bool = True  # False for a symmetric shared-service conflict
    evidence: list[EvidenceRef] = Field(default_factory=list)
    confidence: float = 0.5
    method: Method
    in_jira: bool | None = None  # None means the S10 baseline was not available
    status: DepStatus = "candidate"
    verification_note: str = ""
    requery_attempts: int = 0
    # User-defined: in the initiative's dependency list, in a planner note, or confirmed by a planner.
    # Everything else the agents found is a hidden dependency.
    declared: bool = False
    note: str = ""  # a planner's note on this dependency
    decision: Literal["", "confirmed", "dismissed"] = ""

    @staticmethod
    def make_id(from_id: str, to_id: str, kind: str) -> str:
        """One dependency per (dependent, target, kind); evidence from several places merges into it."""
        return stable_id("dep", from_id, to_id, kind)


class SequenceStep(BaseModel):
    step: int
    initiative_ids: list[str]
    why: str
    chain: list[str] = Field(default_factory=list)  # dependency ids that place this step here
    in_cycle: bool = False
    rationale_method: Literal["llm", "template"] = "template"


class CapacityLine(BaseModel):
    team: str
    pi: str | None = None
    capacity_points: float | None = None
    committed_points: float | None = None
    selected_demand_points: float = 0.0
    load_pct: float | None = None
    formula: str = ""
    initiative_ids: list[str] = Field(default_factory=list)


class Risk(BaseModel):
    id: str
    dri_code: str
    severity: Severity
    title: str
    description: str  # written by the rule, deterministic
    initiative_ids: list[str] = Field(default_factory=list)
    entities: list[str] = Field(default_factory=list)
    dependency_ids: list[str] = Field(default_factory=list)
    sources: list[EvidenceRef] = Field(default_factory=list)
    rationale: str = ""  # explanation only; the rule decided the flag
    rationale_method: Literal["llm", "template"] = "template"
    history_note: str | None = None


class Constraint(BaseModel):
    """A reviewer's sequencing constraint: `first` must be delivered before `then`."""

    type: Literal["before"] = "before"
    first: str
    then: str
    note: str = ""


class Approval(BaseModel):
    action: Literal["approve", "challenge"]
    reviewer: str
    role: str
    at: str
    constraint: Constraint | None = None
    note: str = ""


class PlannerInput(BaseModel):
    """What a planner added after a run, sent with the next run: notes, sizes and quarter placements
    (from the decision dashboard) per initiative, notes and keep / dismiss decisions per dependency
    link (keyed "from->to")."""

    initiative_notes: dict[str, str] = Field(default_factory=dict)
    sizes: dict[str, str] = Field(default_factory=dict)
    quarters: dict[str, str] = Field(default_factory=dict)
    dependency_notes: dict[str, str] = Field(default_factory=dict)
    dependency_decisions: dict[str, Literal["confirmed", "dismissed"]] = Field(default_factory=dict)


class ScheduleItem(BaseModel):
    """One initiative on the sprint calendar: as planned (S1) and as recommended.

    size_source: tshirt (S1 T-shirt size), planner (a planner's size), estimate (story points in an
    older export) or assumed (no size: DEFAULT_SIZE is used, and the plan says so)."""

    initiative_id: str
    team: str
    size: str | None = None
    points: float = 0.0
    size_source: Literal["tshirt", "planner", "estimate", "assumed", "none"] = "tshirt"
    planned_index: int | None = None
    planned_finish: int | None = None
    deadline: int | None = None  # last sprint of the target quarter
    target_source: Literal["data", "planner", "sprint", "none"] = "data"
    start: int
    finish: int
    allocation: dict[int, float] = Field(default_factory=dict)
    reasons: list[str] = Field(default_factory=list)
    waits_for: list[str] = Field(default_factory=list)  # initiative ids that must finish first
    in_cycle: bool = False
    capacity_known: bool = True


class PlanConflict(BaseModel):
    """An ordering link the plan as written breaks.

    later_quarter: the provider is targeted at a later quarter than its consumer. too_tight: at the
    provider team's velocity the provider is still running when the consumer's quarter starts (same
    quarter, or it spills into it), and the consumer cannot finish inside its quarter after it.
    sprint: with planned sprints, the consumer starts before its provider is planned to finish."""

    provider: str
    consumer: str
    provider_start: int | None = None  # the provider's planned start (its target quarter's first sprint)
    provider_finish: int
    consumer_start: int
    dependency_ids: list[str] = Field(default_factory=list)
    declared: bool = False
    kind: Literal["later_quarter", "too_tight", "sprint"] = "sprint"
    consumer_finish: int | None = None


class AgentState(BaseModel):
    """Shared state for one run. Keys written by parallel branches carry a reducer."""

    run_id: str
    initiatives: list[Initiative]
    systems: list[SystemTouch] = Field(default_factory=list)
    candidate_deps: Annotated[list[Dependency], operator.add] = Field(default_factory=list)
    deps: list[Dependency] = Field(default_factory=list)
    rejected_deps: list[Dependency] = Field(default_factory=list)
    requery_round: int = 0
    cycles: list[list[str]] = Field(default_factory=list)
    sequence: list[SequenceStep] = Field(default_factory=list)
    capacity: list[CapacityLine] = Field(default_factory=list)
    risks: list[Risk] = Field(default_factory=list)
    rule_coverage: dict[str, str] = Field(default_factory=dict)
    constraints: list[Constraint] = Field(default_factory=list)
    planner: PlannerInput = Field(default_factory=PlannerInput)
    schedule: list[ScheduleItem] = Field(default_factory=list)
    calendar: list[dict] = Field(default_factory=list)  # [{"sprint", "pi", "assumed"}] by calendar index
    conflicts: list[PlanConflict] = Field(default_factory=list)
    approvals: list[Approval] = Field(default_factory=list)
    ui: dict = Field(default_factory=dict)
    exports: list[str] = Field(default_factory=list)
    warnings: Annotated[list[str], operator.add] = Field(default_factory=list)
