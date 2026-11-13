"""Test fixtures. The dataset below is a tiny synthetic stand-in written to a pytest temp
dir; it is NOT the project data and never lands in the root data/ folder. It is shaped to trip
specific DRI rules so the tests can assert on them."""

from __future__ import annotations

import os
import textwrap
from dataclasses import replace
from pathlib import Path

import pytest

os.environ.setdefault("LLM_PROVIDER", "none")  # tests never call a real model

from app.config import Settings  # noqa: E402
from llm.adapter import BaseLLM, CallMeta, LLMOutputInvalid  # noqa: E402

FILES = {
    "initiatives.csv": """\
        Initiative ID,Title,Owning Team,Description,Target PI,Estimate Points
        INI-1,Customer returns enhancement,Returns Team,Enable store drop-off returns. Updates the Order Management and Returns Service flows.,25.2,40
        INI-2,Partner API upgrade,Platform Team,Introduce new partner integrations on the Partner Gateway and write partner_id to Customer Profile.,25.2,60
        INI-3,Fraud detection enhancement,Fraud Team,Enable real-time fraud scoring in the Fraud Engine using Customer Profile data.,25.1,30
        INI-4,Ledger modernisation,Core Banking,Replace the batch ledger.,25.3,80
        """,
    "epics_jira.csv": """\
        epic_key,initiative_id,summary,description,status,team,comments,story_points
        RET-1,INI-1,Store drop-off returns,Returns Service API changes for drop-off.,In Progress,Returns Team,Blocked on Partner API upgrade for cross-partner returns.,20
        PAR-1,INI-2,Partner onboarding API,New partner endpoints on the Partner Gateway.,To Do,Platform Team,,30
        FRD-1,INI-3,Real-time scoring,Score transactions and write fraud_score to Customer Profile.,To Do,Fraud Team,Waiting for Platform Team to expose the event stream.,15
        """,
    "dependency_statements.csv": """\
        statement_id,text,source_ref,channel,from_entity,to_entity,is_dependency
        ST-1,Returns can't ship until Partner API upgrade lands.,RET-1,jira,INI-1,INI-2,true
        ST-2,Fraud scoring is unrelated to the returns flow.,FRD-1,jira,INI-3,INI-1,false
        """,
    "github_repos.csv": """\
        repo,owner_team,language,internal_dependencies,service
        returns-svc,Returns Team,java,customer-profile-svc; order-mgmt-svc,Returns Service
        partner-gateway,Platform Team,go,customer-profile-svc,Partner Gateway
        fraud-engine,Fraud Team,python,customer-profile-svc,Fraud Engine
        customer-profile-svc,Data Team,java,,Customer Profile
        order-mgmt-svc,Order Team,java,,Order Management
        """,
    "team_capacity.csv": """\
        team,pi,capacity_points,committed_points
        Platform Team,25.2,100,90
        Returns Team,25.2,80,20
        Fraud Team,25.1,50,10
        Data Team,25.2,40,50
        """,
    "team_directory.csv": """\
        team,art,em,po,rte
        Returns Team,Product ART,Ann Em,Pat Po,Rita Rte
        Platform Team,Platform ART,Ben Em,Paul Po,Rita Rte
        Fraud Team,Data ART,Cat Em,Pia Po,Ray Rte
        Data Team,Data ART,Dan Em,Pam Po,Ray Rte
        Order Team,Product ART,Eve Em,Pete Po,Rita Rte
        Core Banking,Platform ART,Fay Em,Phil Po,Rita Rte
        """,
    "service_ownership_map.csv": """\
        service,owner_team,capability,api,dataset,status,repo
        Customer Profile,,customer data,/profile,profiles,active,customer-profile-svc
        Partner Gateway,Platform Team,partner integrations,/partners,,active,partner-gateway
        Returns Service,Returns Team,returns,/returns,,active,returns-svc
        Fraud Engine,Fraud Team,fraud scoring,,,active,fraud-engine
        Order Management,Order Team,orders,/orders,,deprecated,order-mgmt-svc
        """,
    "historical_pi_outcomes.csv": """\
        pi,team,committed_points,delivered_points,blockers
        24.4,Platform Team,90,60,waiting on Data Team
        25.1,Platform Team,80,75,
        """,
    "kpi_benchmarks.csv": """\
        kpi,value,unit,benchmark_type,description
        PI prep hours,120,hours,internal,Hours spent preparing PI planning
        """,
    "jira_tagged_links.csv": """\
        from_key,to_key,link_type
        FRD-1,PAR-1,blocked_by
        """,
    "archer_controls.csv": """\
        control_id,initiative_id,control_type,signoff_required,signoff_date,owner
        CTL-1,INI-3,model risk,true,,Model Risk Office
        """,
    "slack_snippets.txt": """\
        [2025-01-10] #returns ann: Heads up, Customer returns enhancement depends on Order Management changes from the Order Team.

        [2025-01-11] #platform ben: Partner Gateway release notes are on Confluence.
        """,
    "docs/architecture/partner-gateway-api-contract.md": """\
        # Partner Gateway API contract

        The Partner Gateway exposes /partners endpoints for onboarding. Versioned under v2.
        """,
}


# The knowledge base the app uses by default (S1, S4, S5, S6 + the S7 owner lookup), in the format of
# the current Haverstone package (initiatives_updated_v1.csv: target quarter and T-shirt size;
# team_capacity_updated_v1.csv: one capacity per team and quarter). Shaped so each use case has
# something to find:
# - declared: every initiative lists "Upstream: ...; Downstream: ...".
# - hidden: INIT-1 consumes Account Ledger, which INIT-3's team owns and changes (orders the work);
#   INIT-2's text says it is blocked on INIT-1, whose team owns Ledger Posting API (orders); INIT-2's
#   repo calls INIT-1's team's api repo while INIT-1 changes an API contract (a soft code link);
#   INIT-4 changes the shared event schema, used by two other teams (a library ripple); INIT-1's text
#   names the RTP team.
# - sequence: INIT-1 (Q1, L = 13 points at 5 a sprint) waits for INIT-3, which is targeted at the later
#   Q2 (a conflict in the plan as written), and INIT-2 (Q1, XL = 21 points at 4 a sprint) waits for
#   INIT-1 in a quarter too tight for both. Both slip; PAY-RTP is over capacity in Q1 (21 of 20).
# - sizes: INIT-4 has no T-shirt size, so it is scheduled as the default M and flagged.
# - lookup: Ledger Posting API's contract is a draft, Unowned Feed's is missing, and Partner Payments
#   is deprecated.
# - left out: INIT-5 is In Discovery and INIT-6 is Proposed.
KB_FILES = {
    "initiatives_updated_v1.csv": """\
        initiative_id,initiative_name,description,owning_team,art,target_pi-explicitly Q1/Q2..,priority,status,business_outcome,T-Shirt Sizing,dependency
        INIT-1,Ledger posting API v2,Expose the new posting API contract; Payments RTP will require it.,CBL-Posting,Core,Q1,Critical,Ready for PI Planning,Faster posting,L,Upstream: Account Ledger; Downstream: RTP Network
        INIT-2,RTP network expansion,Expand RTP Network capacity. Blocked on Ledger posting API v2 for the new endpoints.,PAY-RTP,Payments,Q1,High,Ready for PI Planning,More volume,XL,Upstream: Ledger Posting API; Downstream: Partner Payments
        INIT-3,Account ledger cleanup,Normalise Account Ledger entries.,CBL-Ledger,Core,Q2,Medium,Ready for PI Planning,Fewer defects,L,Upstream: Account Ledger
        INIT-4,Partner payments onboarding,Onboard partners through Partner Payments and migrate to the new event schema version.,OBI-Partner,Open Banking,Q1,High,Ready for PI Planning,More partners,,Upstream: Partner Payments; Downstream: Unowned Feed
        INIT-5,Card rewards,Reward points for card spend.,CRD-Cards,Cards,Q2,Medium,In Discovery,Loyalty,M,Upstream: Account Ledger
        INIT-6,Mobile app refresh,Refresh the mobile app theme.,DIG-Mobile,Digital,Q2,Medium,Proposed,Engagement,S,Downstream: RTP Network
        """,
    "github_repos_version_aligned.csv": """\
        repo_id,repo_name,team_id,primary_language,repo_type,description,declared_internal_repo_ids,declared_shared_libraries,dependency_manifest_path,lifecycle_status,version,last_commit_at
        REPO-1,cbl-posting-service,CBL-Posting,Java,service,Posting service,REPO-3,hfg-event-schema,pom.xml,Active,1.0.1,2026-10-01
        REPO-2,cbl-posting-api,CBL-Posting,TypeScript,api,Posting API,REPO-1,,package.json,Active,1.0.2,2026-10-02
        REPO-3,cbl-ledger-api,CBL-Ledger,Java,api,Ledger API,,hfg-event-schema,pom.xml,Active,1.0.3,2026-10-03
        REPO-4,pay-rtp-service,PAY-RTP,Go,service,RTP service,REPO-2,,go.mod,Active,1.0.4,2026-10-04
        REPO-5,obi-partner-service,OBI-Partner,Python,service,Partner service,REPO-6,hfg-event-schema,pyproject.toml,Active,1.0.5,2026-10-05
        REPO-6,pay-legacy-adapter,PAY-RTP,Java,service,Legacy adapter,,,pom.xml,Deprecated,0.9.0,2025-01-01
        """,
    "team_capacity_updated_v1.csv": """\
        team_id,available_story_points
        CBL-Posting,25
        PAY-RTP,20
        CBL-Ledger,25
        OBI-Partner,40
        """,
    "team_directory.csv": """\
        team_id,team_name,art,team_status
        CBL-Posting,Posting Engine,Core,Active
        PAY-RTP,RTP,Payments,Active
        CBL-Ledger,Ledger Platform,Core,Active
        OBI-Partner,Partner API,Open Banking,Active
        CRD-Cards,Card Platform,Cards,Active
        DIG-Mobile,Mobile Banking,Digital,Active
        """,
    "service_ownership_map.csv": """\
        service_id,service_name,service_type,owning_team_id,owning_art,ownership_status,lifecycle_status,interface_contract_status,related_repo_ids
        SVC-1,Account Ledger,ledger_capability,CBL-Ledger,Core,Assigned,Active,Approved,REPO-3
        SVC-2,Ledger Posting API,API,CBL-Posting,Core,Assigned,Active,Draft,REPO-2
        SVC-3,RTP Network,service,PAY-RTP,Payments,Assigned,Active,Approved,REPO-4
        SVC-4,Partner Payments,service,OBI-Partner,Open Banking,Assigned,Deprecated,Approved,REPO-5
        SVC-5,Unowned Feed,dataset,,,Unassigned,Active,Missing,
        """,
    # Present in the folder but not part of the knowledge base: reported as switched off.
    "historical_pi_outcomes.csv": """\
        pi,team,committed_points,delivered_points,blockers
        24.4,PAY-RTP,90,60,waiting on Ledger
        """,
}


def write_dataset(root: Path, files: dict[str, str] | None = None) -> Path:
    for name, body in (files or FILES).items():
        p = root / name
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(textwrap.dedent(body), encoding="utf-8")
    return root


@pytest.fixture
def data_dir(tmp_path: Path) -> Path:
    return write_dataset(tmp_path / "data")


@pytest.fixture
def kb_dir(tmp_path: Path) -> Path:
    return write_dataset(tmp_path / "kb", KB_FILES)


@pytest.fixture
def kb_settings(tmp_path: Path, kb_dir: Path) -> Settings:
    """The default knowledge base (ACTIVE_SOURCES unset): what the app runs on."""
    return replace(Settings(), data_dir=kb_dir, runs_dir=tmp_path / "kb-runs", llm_provider="none",
                   active_sources=("S1", "S4", "S5", "S6", "S7"))


@pytest.fixture
def settings(tmp_path: Path, data_dir: Path) -> Settings:
    """The legacy fixture with every source switched on (the loader, index and tools tests)."""
    return replace(Settings(), data_dir=data_dir, runs_dir=tmp_path / "runs", llm_provider="none", active_sources=None)


class ScriptedLLM(BaseLLM):
    """A stand-in model for tests: each task name maps to a function(user_text) -> model instance."""

    provider = "scripted"

    def __init__(self, scripts: dict):
        super().__init__("scripted-model")
        self.scripts = scripts
        self.calls: list[str] = []

    @property
    def enabled(self) -> bool:
        return True

    def structured(self, *, task, system, stable_context, user, schema, effort, max_tokens=16000):
        self.calls.append(task)
        fn = self.scripts.get(task)
        if fn is None:
            raise LLMOutputInvalid(f"no script for {task}")
        return fn(user, schema), CallMeta(self.provider, self.model, self.model, 10, 5, attempts=1)
