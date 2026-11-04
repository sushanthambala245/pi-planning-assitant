from __future__ import annotations

import csv
import re
from dataclasses import replace

from langgraph.types import Command

from agents.graph import build_graph
from agents.runtime import Budget, EventSink, RunContext, Tracer, register
from agents.state import AgentState, Approval
from context.snapshot import build_snapshot
from llm.adapter import DisabledLLM
from tests.conftest import ScriptedLLM

IDS = ["INI-1", "INI-2", "INI-3"]


def start(settings, llm, ids=IDS, run_id="run-test"):
    snap = build_snapshot(settings)
    run_dir = settings.runs_dir / run_id
    run_dir.mkdir(parents=True, exist_ok=True)
    ctx = RunContext(run_id, settings, snap, llm, Tracer(run_dir / "trace.jsonl", run_id),
                     EventSink(run_id, run_dir / "events.jsonl"), Budget(settings.pipeline_max_model_calls), run_dir)
    register(ctx)
    graph = build_graph()
    config = {"configurable": {"thread_id": run_id}, "recursion_limit": 80}
    inis = [i for i in snap.initiatives() if i.id in ids]
    graph.invoke(AgentState(run_id=run_id, initiatives=inis), config)
    return graph, config, ctx


def values(graph, config) -> AgentState:
    v = graph.get_state(config).values
    return v if isinstance(v, AgentState) else AgentState.model_validate(v)


def resume(graph, config, action, constraint=None):
    approval = Approval(action=action, reviewer="Test", role="RTE", at="now", constraint=constraint)
    graph.invoke(Command(resume=approval.model_dump(mode="json")), config)


def test_rule_based_pipeline_end_to_end(settings):
    graph, config, ctx = start(settings, DisabledLLM("tests"))
    assert graph.get_state(config).next == ("human_gate",)  # paused for the human
    s = values(graph, config)

    touched = {(t.initiative_id, t.system) for t in s.systems}
    assert {("INI-2", "Partner Gateway"), ("INI-2", "Customer Profile"), ("INI-1", "Order Management")} <= touched

    deps = {(d.from_id, d.to_id, d.kind): d for d in s.deps}
    explicit = deps[("INI-1", "INI-2", "explicit")]
    assert explicit.method == "rule" and explicit.status == "low_confidence"
    assert {e.ref for e in explicit.evidence} >= {"S2:RET-1#0", "S3:ST-1#0"}  # merged from two sources
    assert deps[("INI-2", "team:Data Team", "code")].evidence[0].ref == "S4:partner-gateway"
    shared = deps[("INI-2", "INI-3", "ownership")]
    assert shared.dep_type == "shared_service" and shared.directed is False  # Customer Profile has no owner
    assert deps[("INI-3", "team:Platform Team", "explicit")].in_jira is True  # FRD-1 -> PAR-1 is in S10

    order = [step.initiative_ids for step in s.sequence]
    assert order.index(next(x for x in order if "INI-2" in x)) < order.index(next(x for x in order if "INI-1" in x))

    codes = {r.dri_code for r in s.risks}
    assert {"DRI-X-002", "DRI-X-003", "DRI-X-004", "DRI-X-005", "DRI-X-007", "DRI-X-008"} <= codes
    assert "DRI-X-001" not in codes
    capacity = {c.team: c for c in s.capacity}
    assert capacity["Platform Team"].load_pct == 150.0  # (90 committed + 60 selected) / 100
    assert all(not v.startswith("skipped") for v in s.rule_coverage.values())
    assert s.ui["stats"]["dependencies"] == len(s.deps)
    assert ctx.llm_outcomes["disabled"] > 0

    # Challenge: putting INI-1 before INI-2 contradicts the explicit dependency -> a cycle.
    from agents.state import Constraint
    resume(graph, config, "challenge", Constraint(first="INI-1", then="INI-2", note="what if returns goes first?"))
    s = values(graph, config)
    assert graph.get_state(config).next == ("human_gate",)
    assert "DRI-X-001" in {r.dri_code for r in s.risks}
    assert any(step.in_cycle for step in s.sequence)

    resume(graph, config, "approve")
    s = values(graph, config)
    assert graph.get_state(config).next == ()
    assert set(s.exports) == {"jira_link_proposals.csv", "sequence_note.md", "audit.json"}
    rows = list(csv.DictReader((ctx.run_dir / "export" / "jira_link_proposals.csv").open(encoding="utf-8")))
    assert rows and all(r["status"].startswith("PROPOSED") for r in rows)
    assert not any(r["dependency_id"] == deps[("INI-3", "team:Platform Team", "explicit")].id for r in rows)

    trace = (ctx.run_dir / "trace.jsonl").read_text(encoding="utf-8")
    assert '"node.verify"' in trace and '"status": "ok"' in trace


def _doc(user: str, doc_id: str) -> str:
    m = re.search(rf'<document id="{re.escape(doc_id)}"[^>]*>\n(.*?)\n</document>', user, re.S)
    return m.group(1) if m else ""


def test_llm_path_keeps_only_grounded_claims(settings):
    def analyse(user, schema):
        picks = []
        if "INI-2" in user:
            picks.append({"system": "Customer Profile", "access": "writes", "evidence_ref": "S1:INI-2#0",
                          "quote": "write partner_id to Customer Profile", "confidence": 0.9})
            picks.append({"system": "Partner Gateway", "access": "changes", "evidence_ref": "S9:NOT-RETRIEVED#0",
                          "quote": "anything", "confidence": 0.9})  # cites a document never returned
            picks.append({"system": "Mainframe", "access": "reads", "evidence_ref": "S1:INI-2#0",
                          "quote": "Introduce new partner integrations", "confidence": 0.9})  # not in catalogue
        return schema.model_validate({"systems": picks})

    def extract(user, schema):
        deps = []
        if 'focus_initiative id="INI-1"' in user:
            assert "Blocked on Partner API upgrade" in _doc(user, "S2:RET-1#0")
            deps.append({"target_kind": "initiative", "target": "INI-2", "dep_type": "blocked_on",
                         "evidence_ref": "S2:RET-1#0", "quote": "Blocked on Partner API upgrade for cross-partner returns.",
                         "confidence": 0.9})
            deps.append({"target_kind": "team", "target": "Order Team", "dep_type": "requires",
                         "evidence_ref": "S2:RET-1#0", "quote": "Order Team must ship the new order API first.",
                         "confidence": 0.8})  # fabricated quote
            deps.append({"target_kind": "service", "target": "Returns Service", "dep_type": "requires",
                         "evidence_ref": "S2:RET-1#0", "quote": "Returns Service API changes for drop-off.",
                         "confidence": 0.3})  # grounded but weak -> re-query
        return schema.model_validate({"dependencies": deps})

    def requery(user, schema):
        return schema.model_validate({"supported": False, "evidence_ref": "", "quote": "", "confidence": 0.1,
                                      "reason": "the epic changes the service but does not wait for anyone"})

    def seq(user, schema):
        return schema.model_validate({"steps": [{"step": 1, "why": "Starts first [dep-0000000000]."}]})

    def risks(user, schema):
        import json
        payload = json.loads(user)
        return schema.model_validate({"risks": [{"risk_id": r["risk_id"], "rationale": f"Explained: {r['title']}"}
                                                for r in payload["risks"]]})

    def summary(user, schema):
        return schema.model_validate({"headline": "h", "key_risk": "k", "summary": "LLM summary."})

    llm = ScriptedLLM({"analyse_initiative": analyse, "extract_dependencies": extract, "requery": requery,
                       "sequencing_rationale": seq, "risk_rationale": risks, "exec_summary": summary})
    graph, config, ctx = start(settings, llm)
    s = values(graph, config)

    ini2 = {t.system: t for t in s.systems if t.initiative_id == "INI-2"}
    assert ini2["Customer Profile"].method == "llm"
    assert ini2["Partner Gateway"].method == "rule"  # the ungrounded LLM pick was dropped, the name match stays
    assert "Mainframe" not in ini2
    assert any("not in the service catalogue" in w for w in s.warnings)

    live = {(d.from_id, d.to_id): d for d in s.deps}
    rejected = {(d.from_id, d.to_id): d for d in s.rejected_deps}
    assert live[("INI-1", "INI-2")].status == "verified" and live[("INI-1", "INI-2")].method == "llm"
    assert "quote not found verbatim" in rejected[("INI-1", "team:Order Team")].verification_note
    assert "Re-query did not confirm" in rejected[("INI-1", "service:Returns Service")].verification_note
    assert "requery" in llm.calls

    assert all(st.rationale_method == "template" for st in s.sequence)  # LLM cited a dep outside the chain
    assert s.risks and all(r.rationale_method == "llm" for r in s.risks)
    assert s.ui["summary"]["method"] == "llm"


def test_spent_budget_continues_on_the_rule_based_path(settings):
    graph, config, ctx = start(replace(settings, pipeline_max_model_calls=1), ScriptedLLM({}))
    s = values(graph, config)
    assert graph.get_state(config).next == ("human_gate",)
    assert ctx.llm_outcomes["budget_exhausted"] > 0
    assert ctx.llm_outcomes["invalid_output"] == 1  # the one allowed call had no script: recorded, not passed
    assert any(d.method == "rule" for d in s.deps)


def _sequencing_llm(write):
    def seq(user, schema):
        import json
        steps = json.loads(user)["steps"]
        return schema.model_validate({"steps": [{"step": st["step"], "why": write(
            [d["id"] for d in st["dependencies"] + st["coordinate"]])} for st in steps]})
    return ScriptedLLM({"sequencing_rationale": seq})


def test_sequence_rationale_must_read_without_its_dependency_ids(settings):
    def garbled(ids):  # the ids are used as words: "waits via and" once they are removed
        return f"It waits via {' and '.join(f'[{i}]' for i in ids)}." if ids else "It can start immediately."

    def clean(ids):
        return " ".join(f"It waits through a verified dependency [{i}]." for i in ids) or "It can start immediately."

    graph, config, _ = start(settings, _sequencing_llm(garbled), run_id="run-garbled")
    s = values(graph, config)
    assert any(st.chain for st in s.sequence)
    assert all(st.rationale_method == "template" for st in s.sequence)
    assert any("did not read as a sentence" in w for w in s.warnings)

    graph, config, _ = start(settings, _sequencing_llm(clean), run_id="run-clean")
    assert all(st.rationale_method == "llm" for st in values(graph, config).sequence)


def test_parallel_steps_name_the_shared_changes_they_must_coordinate(settings):
    graph, config, _ = start(settings, DisabledLLM("tests"))
    s = values(graph, config)
    step = next(st for st in s.sequence if {"INI-2", "INI-3"} <= set(st.initiative_ids))
    assert "must coordinate" in step.why and "Customer Profile" in step.why


def test_history_calibration_judges_the_team_the_risk_is_about(settings):
    graph, config, _ = start(settings, DisabledLLM("tests"))
    risks = {r.title: r for r in values(graph, config).risks}
    provider = risks["Capacity — provider Data Team at 125%"]
    assert provider.severity == "warning"  # 125% < 130% blocker floor; Data Team has no S8 history
    own = risks["Capacity — Platform Team at 150%"]
    assert own.severity == "blocker" and "Platform Team missed or was blocked in 1 of 2" in own.history_note
