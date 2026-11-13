"""End-to-end runs of the agent graph on the knowledge-base fixture (tests/conftest.py KB_FILES):
the three use cases (declared, hidden, sequence), the planner's notes and decisions on a re-run,
the LLM path's guardrails, and the human gate."""

from __future__ import annotations

import csv
import json
from dataclasses import replace

from langgraph.types import Command

from agents.graph import build_graph
from agents.runtime import Budget, EventSink, RunContext, Tracer, register
from agents.state import AgentState, Approval, Constraint, PlannerInput
from context.snapshot import build_snapshot
from llm.adapter import DisabledLLM
from tests.conftest import ScriptedLLM

READY = ["INIT-1", "INIT-2", "INIT-3", "INIT-4"]


def start(settings, llm, ids=READY, run_id="run-test", planner: PlannerInput | None = None):
    snap = build_snapshot(settings)
    run_dir = settings.runs_dir / run_id
    run_dir.mkdir(parents=True, exist_ok=True)
    ctx = RunContext(run_id, settings, snap, llm, Tracer(run_dir / "trace.jsonl", run_id),
                     EventSink(run_id, run_dir / "events.jsonl"), Budget(settings.pipeline_max_model_calls), run_dir)
    register(ctx)
    graph = build_graph()
    config = {"configurable": {"thread_id": run_id}, "recursion_limit": 80}
    planner = planner or PlannerInput()
    inis = [i.model_copy(update={"note": planner.initiative_notes.get(i.id, ""),
                                 "size_override": planner.sizes.get(i.id, ""),
                                 "quarter_override": planner.quarters.get(i.id, "")})
            for i in snap.initiatives() if i.id in ids]
    graph.invoke(AgentState(run_id=run_id, initiatives=inis, planner=planner), config)
    return graph, config, ctx


def values(graph, config) -> AgentState:
    v = graph.get_state(config).values
    return v if isinstance(v, AgentState) else AgentState.model_validate(v)


def resume(graph, config, action, constraint=None):
    approval = Approval(action=action, reviewer="Test", role="RTE", at="now", constraint=constraint)
    graph.invoke(Command(resume=approval.model_dump(mode="json")), config)


def live(s: AgentState) -> dict[tuple[str, str, str], object]:
    return {(d.from_id, d.to_id, d.kind): d for d in s.deps}


def sched(s: AgentState) -> dict[str, object]:
    return {x.initiative_id: x for x in s.schedule}


def test_declared_hidden_and_sequence_on_the_knowledge_base(kb_settings):
    graph, config, ctx = start(kb_settings, DisabledLLM("tests"))
    assert graph.get_state(config).next == ("human_gate",)  # paused for the human
    s = values(graph, config)
    deps = live(s)

    # 1. Declared: every system on the initiatives' own lists, with its role; the owner from S7.
    declared = {(d.from_id, d.to_id, d.dep_type) for d in s.deps if d.kind == "declared"}
    assert ("INIT-1", "service:Account Ledger", "upstream") in declared
    assert ("INIT-1", "service:RTP Network", "downstream") in declared
    assert len(declared) == 7 and all(d.declared for d in s.deps if d.kind == "declared")
    roles = {(t.initiative_id, t.system): (t.role, t.owner_team) for t in s.systems}
    assert roles[("INIT-1", "Ledger Posting API")] == ("mentioned", "CBL-Posting")  # named in its title

    # 2. Hidden: nobody declared these.
    provider = deps[("INIT-1", "INIT-3", "ownership")]  # INIT-3's team owns Account Ledger, INIT-1 consumes it
    assert provider.dep_type == "provider_changes" and provider.directed and not provider.declared
    assert deps[("INIT-2", "INIT-1", "explicit")].dep_type == "blocked_on"  # stated in the description
    code = deps[("INIT-2", "INIT-1", "code")]
    assert code.dep_type == "interface_change" and code.evidence[0].ref == "S4:pay-rtp-service"
    # A repo link counts only when something ties it to both initiatives. INIT-1 builds on Account
    # Ledger, which INIT-3's team owns, and its team's repo calls that team's api repo: a code link.
    # INIT-4's team calls RTP's deprecated adapter, but INIT-4 names nothing of RTP's: team-level only,
    # reported in the code tool's notes and not counted (the deprecated repo is still a DRI-X-004 risk).
    coupled = deps[("INIT-1", "INIT-3", "code")]
    assert coupled.dep_type == "code_coupling" and "S7:Account Ledger" in {e.ref for e in coupled.evidence}
    assert ("INIT-4", "INIT-2", "code") not in deps
    notes = [e["data"]["text"] for e in ctx.events.events if e["type"] == "note" and e["node"] == "code_deps"]
    assert any(n.startswith("1 team pair linked by code only (1 initiative pair)") for n in notes), notes
    lib = deps[("INIT-4", "library:hfg-event-schema", "library")]
    assert {e.ref for e in lib.evidence} >= {"S4:cbl-posting-service", "S4:cbl-ledger-api"}
    assert deps[("INIT-1", "team:PAY-RTP", "explicit")].dep_type == "mentioned"  # "Payments RTP will require it"
    assert not any(d.to_id == "INIT-5" or d.from_id == "INIT-5" for d in s.deps)  # not ready, not in the run

    # 3. Sequence on the quarter calendar (Q1..Q4, five sprints each: Q1 S1 = 0, Q2 S1 = 5).
    # INIT-3 (Q2, L = 13 points at 5 a sprint) runs Q2 S1-S3; INIT-1 (targeted at Q1) waits for it
    # and slips into Q2 S4-Q3 S1; INIT-2 (XL = 21 points at RTP's 4 a sprint) waits for INIT-1.
    p = sched(s)
    assert [x["pi"] for x in s.calendar[::5]] == ["Q1", "Q2", "Q3", "Q4"]
    assert (p["INIT-3"].start, p["INIT-3"].finish, p["INIT-3"].size, p["INIT-3"].size_source) == (5, 7, "L", "tshirt")
    assert (p["INIT-1"].planned_index, p["INIT-1"].deadline, p["INIT-1"].start, p["INIT-1"].finish) == (0, 4, 8, 10)
    assert p["INIT-2"].start == 11 and p["INIT-2"].finish == 16 and p["INIT-2"].waits_for == ["INIT-1"]
    assert "Waits for Account ledger cleanup, which finishes in Q2 S3" in p["INIT-1"].reasons[0]
    assert any("spills into Q3" in r for r in p["INIT-1"].reasons)
    assert any("at RTP's velocity (4 points a sprint, 20 a quarter)" in r for r in p["INIT-2"].reasons)
    # No size in the data: scheduled as the default M and flagged, not dropped.
    assert (p["INIT-4"].size, p["INIT-4"].size_source, p["INIT-4"].points) == ("M", "assumed", 8)
    assert p["INIT-4"].reasons[0].startswith("No T-shirt size in the data")
    # The plan as written: INIT-3 is targeted at a later quarter than INIT-1, and Q1 is too tight for
    # INIT-1 and then INIT-2. Both conflicts come from hidden dependencies.
    assert {(c.kind, c.provider, c.consumer) for c in s.conflicts} == {
        ("later_quarter", "INIT-3", "INIT-1"), ("too_tight", "INIT-1", "INIT-2")}
    assert not any(c.declared for c in s.conflicts)
    order = [st.initiative_ids for st in s.sequence]
    assert order == [["INIT-3", "INIT-4"], ["INIT-1"], ["INIT-2"]]  # code links inform, they do not reorder
    load = {(c.team, c.pi): c.load_pct for c in s.capacity}
    assert load[("PAY-RTP", "Q1")] == 105.0 and load[("CBL-Posting", "Q1")] == 52.0

    codes = {(r.dri_code, r.entities[0] if r.entities else "") for r in s.risks}
    assert ("DRI-X-002", "Unowned Feed") in codes and ("DRI-X-004", "pay-legacy-adapter") in codes
    assert ("DRI-X-004", "Partner Payments") in codes  # deprecated in the ownership lookup
    assert ("DRI-X-005", "Unowned Feed") in codes and ("DRI-X-005", "Ledger Posting API") in codes  # contract gaps
    assert ("DRI-X-003", "PAY-RTP") in codes
    sev = {r.title.split(" — ")[0]: r.severity for r in s.risks if r.dri_code == "DRI-X-006"}
    assert sev == {"Plan conflict": "blocker", "Tight quarter": "warning"}
    assert s.rule_coverage["DRI-X-005"].startswith("evaluated")  # from the lookup, without Confluence
    assert s.rule_coverage["DRI-X-007"].startswith("skipped")  # Slack is not in the knowledge base
    assert ctx.llm_outcomes["disabled"] > 0

    # Challenge: putting INIT-2 before INIT-1 contradicts INIT-2's stated dependency -> a cycle.
    resume(graph, config, "challenge", Constraint(first="INIT-2", then="INIT-1", note="what if RTP goes first?"))
    s = values(graph, config)
    assert graph.get_state(config).next == ("human_gate",)
    assert "DRI-X-001" in {r.dri_code for r in s.risks}
    assert any(step.in_cycle for step in s.sequence)
    assert sched(s)["INIT-1"].in_cycle

    resume(graph, config, "approve")
    s = values(graph, config)
    assert graph.get_state(config).next == ()
    assert set(s.exports) == {"jira_link_proposals.csv", "sequence_note.md", "audit.json"}
    rows = list(csv.DictReader((ctx.run_dir / "export" / "jira_link_proposals.csv").open(encoding="utf-8")))
    assert rows and all(r["status"].startswith("PROPOSED") for r in rows)


def test_planner_notes_sizes_and_decisions_change_the_next_run(kb_settings):
    planner = PlannerInput(
        initiative_notes={"INIT-4": "Waiting for Account ledger cleanup before go-live."},
        sizes={"INIT-3": "S"},
        quarters={"INIT-2": "Q2"},
        dependency_notes={"INIT-1->INIT-3": "They only read the ledger; no need to wait."},
        dependency_decisions={"INIT-1->INIT-3": "dismissed", "INIT-2->INIT-1": "confirmed"})
    graph, config, _ = start(kb_settings, DisabledLLM("tests"), planner=planner)
    s = values(graph, config)
    deps = live(s)
    rejected = {(d.from_id, d.to_id, d.kind): d for d in s.rejected_deps}

    gone = rejected[("INIT-1", "INIT-3", "ownership")]
    assert gone.decision == "dismissed" and "no need to wait" in gone.verification_note
    kept = deps[("INIT-2", "INIT-1", "code")]  # a hidden link the planner kept is now user-defined
    assert kept.declared and kept.decision == "confirmed"
    from_note = deps[("INIT-4", "INIT-3", "explicit")]  # the planner's note is a user-defined dependency
    assert from_note.declared and from_note.method == "human" and from_note.evidence[0].source == "NOTE"

    p = sched(s)
    assert p["INIT-3"].size == "S" and p["INIT-3"].size_source == "planner" and p["INIT-3"].finish == 5
    assert (p["INIT-1"].start, p["INIT-1"].finish) == (0, 2)  # no longer waits for INIT-3: Q1 as targeted
    assert p["INIT-4"].start == 6  # waits for INIT-3, which now ends in Q2 S1
    # The dashboard moved INIT-2 to Q2: it starts there, and the tight-quarter conflict is gone.
    assert (p["INIT-2"].planned_index, p["INIT-2"].target_source, p["INIT-2"].start) == (5, "planner", 5)
    # The planner's own note makes INIT-4 (Q1) wait for INIT-3 (Q2): a declared conflict, still reported.
    assert {(c.kind, c.provider, c.consumer, c.declared) for c in s.conflicts} == {
        ("later_quarter", "INIT-3", "INIT-4", True)}


def test_a_later_placement_takes_no_capacity_inside_the_horizon(kb_settings):
    graph, config, _ = start(kb_settings, DisabledLLM("tests"), planner=PlannerInput(quarters={"INIT-4": "later"}))
    s = values(graph, config)
    p = sched(s)
    assert p["INIT-4"].start == 20 and p["INIT-4"].deadline is None  # the first sprint after Q4
    assert s.calendar[20]["assumed"] and s.calendar[20]["pi"] == "Q1 Y+1"
    assert not any("OBI-Partner" == c.team for c in s.capacity)


def test_llm_path_keeps_only_grounded_claims_and_reads_direction(kb_settings):
    def extract(user, schema):
        deps = []
        if 'focus_initiative id="INIT-1"' in user:
            deps.append({"target_kind": "team", "target": "PAY-RTP (RTP)", "direction": "needed_by",
                         "dep_type": "requires", "evidence_ref": "S1:INIT-1#0",
                         "quote": "Payments RTP will require it.", "confidence": 0.9})
            deps.append({"target_kind": "initiative", "target": "INIT-4", "direction": "needed_by",
                         "dep_type": "requires", "evidence_ref": "S1:INIT-1#0",
                         "quote": "Expose the new posting API contract", "confidence": 0.8})
            deps.append({"target_kind": "team", "target": "CBL-Ledger", "dep_type": "blocked_on",
                         "evidence_ref": "S1:INIT-1#0", "quote": "Ledger team must ship first.",
                         "confidence": 0.9})  # fabricated quote
            deps.append({"target_kind": "service", "target": "Mainframe", "dep_type": "requires",
                         "evidence_ref": "S1:INIT-1#0", "quote": "Expose the new posting API contract",
                         "confidence": 0.9})  # not in the catalogue
        return schema.model_validate({"dependencies": deps})

    def risks(user, schema):
        payload = json.loads(user)
        return schema.model_validate({"risks": [{"risk_id": r["risk_id"], "rationale": f"Explained: {r['title']}"}
                                                for r in payload["risks"]]})

    llm = ScriptedLLM({"extract_dependencies": extract, "risk_rationale": risks})
    graph, config, ctx = start(kb_settings, llm)
    s = values(graph, config)
    deps = live(s)
    rejected = {(d.from_id, d.to_id): d for d in s.rejected_deps}

    needed = deps[("INIT-1", "team:PAY-RTP", "explicit")]
    assert needed.method == "llm" and needed.dep_type == "needed_by"
    reverse = deps[("INIT-4", "INIT-1", "explicit")]  # "INIT-4 needs INIT-1": the arrow points at the provider
    assert reverse.directed and reverse.method == "llm"
    assert "quote not found verbatim" in rejected[("INIT-1", "team:CBL-Ledger")].verification_note
    assert any("unknown service 'Mainframe'" in w for w in s.warnings)
    assert sched(s)["INIT-4"].waits_for == ["INIT-1"]
    assert s.risks and all(r.rationale_method == "llm" for r in s.risks)
    assert "analyse_initiative" not in llm.calls and "exec_summary" not in llm.calls  # deterministic now


def test_spent_budget_continues_on_the_rule_based_path(kb_settings):
    graph, config, ctx = start(replace(kb_settings, pipeline_max_model_calls=1), ScriptedLLM({}))
    s = values(graph, config)
    assert graph.get_state(config).next == ("human_gate",)
    assert ctx.llm_outcomes["budget_exhausted"] > 0
    assert ctx.llm_outcomes["invalid_output"] == 1  # the one allowed call had no script: recorded, not passed
    assert any(d.method == "rule" for d in s.deps)


def _sequencing_llm(write):
    def seq(user, schema):
        steps = json.loads(user)["steps"]
        return schema.model_validate({"steps": [{"step": st["step"], "why": write(
            [d["id"] for d in st["dependencies"] + st["coordinate"]])} for st in steps]})
    return ScriptedLLM({"sequencing_rationale": seq})


def test_sequence_rationale_must_read_without_its_dependency_ids(kb_settings):
    def garbled(ids):  # the ids are used as words: "waits via and" once they are removed
        return f"It waits via {' and '.join(f'[{i}]' for i in ids)}." if ids else "It can start immediately."

    def clean(ids):
        return " ".join(f"It waits through a verified dependency [{i}]." for i in ids) or "It can start immediately."

    graph, config, _ = start(kb_settings, _sequencing_llm(garbled), run_id="run-garbled")
    s = values(graph, config)
    assert any(st.chain for st in s.sequence)
    assert all(st.rationale_method == "template" for st in s.sequence)
    assert any("did not read as a sentence" in w for w in s.warnings)

    graph, config, _ = start(kb_settings, _sequencing_llm(clean), run_id="run-clean")
    assert all(st.rationale_method == "llm" for st in values(graph, config).sequence)


def test_parallel_steps_name_the_links_they_must_coordinate(kb_settings):
    graph, config, _ = start(kb_settings, DisabledLLM("tests"))
    s = values(graph, config)
    first = s.sequence[0]
    assert set(first.initiative_ids) == {"INIT-3", "INIT-4"}
    later = next(st for st in s.sequence if "INIT-2" in st.initiative_ids)
    assert "waits for Ledger posting API v2 (hidden" in later.why
