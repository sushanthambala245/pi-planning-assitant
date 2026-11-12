"""Typed contracts shared by every node, the API, the UI payload, and the audit trail.

Each model is a record type in the evidence chain: validated on write, with stable
ids so results can be joined across runs (considerations §3.3).
"""

from __future__ import annotations

import hashlib
import operator
from typing import Annotated, Literal

from pydantic import BaseModel, Field

DepKind = Literal["explicit", "code", "ownership", "constraint"]
Method = Literal["llm", "rule", "structural", "human"]
Severity = Literal["blocker", "warning", "info"]
TargetKind = Literal["initiative", "team", "service"]
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
    target_pi: str | None = None
    art: str | None = None
    estimate_points: float | None = None
    size: str | None = None  # T-shirt size as written in the source (S, M, L, XL, ...)
    targeted_sprint: str | None = None  # e.g. "PI-2026-06-Sprint-3"
    status: str | None = None
    priority: str | None = None
    origin: Literal["S1", "upload", "manual"] = "S1"


class SystemTouch(BaseModel):
    initiative_id: str
    system: str
    owner_team: str | None = None
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


class ScheduleRow(BaseModel):
    initiative_id: str
    team: str = ""
    size: str  # canonical: S, M, L or XL
    size_source: Literal["size", "points", "default"]
    sprints: int  # duration
    start: int  # 1-based sprint in the run's timeline
    end: int
    spills_past_pi: bool = False
    waits_for: list[str] = Field(default_factory=list)
    critical: bool = False
    in_cycle: bool = False
    targeted_sprint: int | None = None


class Schedule(BaseModel):
    """A delivery timeline derived from T-shirt sizes and the verified dependency order."""

    pi: str = ""
    pi_sprints: int = 5
    size_sprints: dict[str, int] = Field(default_factory=dict)
    rows: list[ScheduleRow] = Field(default_factory=list)
    critical_path: list[str] = Field(default_factory=list)
    assumptions: list[str] = Field(default_factory=list)


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
    schedule: Schedule | None = None
    risks: list[Risk] = Field(default_factory=list)
    rule_coverage: dict[str, str] = Field(default_factory=dict)
    constraints: list[Constraint] = Field(default_factory=list)
    approvals: list[Approval] = Field(default_factory=list)
    ui: dict = Field(default_factory=dict)
    exports: list[str] = Field(default_factory=list)
    warnings: Annotated[list[str], operator.add] = Field(default_factory=list)
