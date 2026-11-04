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


def write_dataset(root: Path) -> Path:
    for name, body in FILES.items():
        p = root / name
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(textwrap.dedent(body), encoding="utf-8")
    return root


@pytest.fixture
def data_dir(tmp_path: Path) -> Path:
    return write_dataset(tmp_path / "data")


@pytest.fixture
def settings(tmp_path: Path, data_dir: Path) -> Settings:
    return replace(Settings(), data_dir=data_dir, runs_dir=tmp_path / "runs", llm_provider="none")


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
