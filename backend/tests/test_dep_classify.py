from __future__ import annotations

from agents.state import AgentState, Dependency, EvidenceRef, Initiative, SystemTouch
from tools.dep_classify import classify, corroboration

SERVICES = {"Customer Profile": {"owner_team": "Data Team", "contract_status": "Approved"},
            "Partner Gateway": {"owner_team": "Platform Team", "contract_status": "Draft"},
            "Order Management": {"owner_team": "Order Team", "contract_status": ""}}


class Snap:
    def service_row(self, name):
        return SERVICES.get(name)


def label(node_id: str) -> str:
    return node_id.split(":", 1)[-1]


def state(*touches: tuple[str, str, str | None]) -> AgentState:
    systems = [SystemTouch(initiative_id=i, system=s,
                           evidence=[EvidenceRef(ref="S1:x", source="S1", detail=f"access: {a}")] if a else [])
               for i, s, a in touches]
    return AgentState(run_id="t", initiatives=[Initiative(id="INI-1", title="Returns", owning_team="Returns Team"),
                                               Initiative(id="INI-2", title="Partner", owning_team="Platform Team")],
                      systems=systems)


def dep(kind: str, to_id: str, to_kind: str, dep_type: str = "depends_on", evidence=(), frm: str = "INI-1") -> Dependency:
    return Dependency(id=Dependency.make_id(frm, to_id, kind), from_id=frm, to_id=to_id, to_kind=to_kind, kind=kind,
                      dep_type=dep_type, method="rule", evidence=list(evidence), status="verified")


def quote(text: str) -> EvidenceRef:
    return EvidenceRef(ref="S2:RET-1#0", source="S2", quote=text)


def s7(service: str, detail: str = "") -> EvidenceRef:
    return EvidenceRef(ref=f"S7:{service}", source="S7", detail=detail)


def test_stated_dependencies_are_classified_by_what_the_statement_asks_for():
    st = state()
    validation = classify(dep("explicit", "service:Partner Gateway", "service", "blocked_on",
                              [quote("PO: blocked on validation of Partner Gateway.")]), st, Snap(), label)
    assert validation.change == "regression" and "validation" in validation.reason
    feed = classify(dep("explicit", "service:Partner Gateway", "service", "requires",
                        [quote("requires the partner exchange-rate feed")]), st, Snap(), label)
    assert feed.change == "flow" and "INI-1 requires Partner Gateway" in feed.reason
    plain = classify(dep("explicit", "INI-2", "initiative", "blocked_on", [quote("Returns can't ship until then.")]),
                     st, Snap(), label)
    assert plain.change == "code" and plain.level == "initiative"


def test_another_teams_system_needs_a_change_only_when_it_is_changed_or_its_contract_is_open():
    d = dep("ownership", "team:Data Team", "team", "owned_by_other_team", [s7("Customer Profile")])
    assert classify(d, state(("INI-1", "Customer Profile", "changes")), Snap(), label).change == "code"
    assert classify(d, state(("INI-1", "Customer Profile", "writes")), Snap(), label).change == "flow"
    reads = classify(d, state(("INI-1", "Customer Profile", "reads")), Snap(), label)
    assert reads.change == "none" and "only reads" in reads.reason
    assert [h["level"] for h in reads.path] == ["initiative", "system", "team"]
    draft = dep("ownership", "team:Platform Team", "team", "owned_by_other_team", [s7("Partner Gateway")])
    assert classify(draft, state(("INI-1", "Partner Gateway", "reads")), Snap(), label).change == "flow"  # Draft
    assert classify(d, state(("INI-1", "Customer Profile", None)), Snap(), label).change == "flow"  # unclear


def test_a_shared_system_needs_code_coordination_or_a_retest_depending_on_access():
    d = dep("ownership", "INI-2", "initiative", "shared_service", [s7("Customer Profile")])
    both = state(("INI-1", "Customer Profile", "changes"), ("INI-2", "Customer Profile", "changes"))
    assert classify(d, both, Snap(), label).change == "code"
    one = state(("INI-1", "Customer Profile", "reads"), ("INI-2", "Customer Profile", "changes"))
    assert classify(d, one, Snap(), label).change == "regression"
    none = state(("INI-1", "Customer Profile", "reads"), ("INI-2", "Customer Profile", "reads"))
    assert classify(d, none, Snap(), label).change == "none"


def test_a_repo_link_to_an_unchanged_team_needs_nothing_and_the_path_shows_every_hop():
    hop = EvidenceRef(ref="S4:returns-svc", source="S4",
                      detail="returns-svc (behind Returns Service) declares an internal dependency on "
                             "order-mgmt-svc, owned by Order Team")
    to_team = classify(dep("code", "team:Order Team", "team", "code_dependency", [hop]),
                       state(("INI-1", "Returns Service", "changes")), Snap(), label)
    assert to_team.change == "none" and "nothing to change" in to_team.reason
    assert [h["label"] for h in to_team.path] == ["INI-1", "Returns Service", "returns-svc", "order-mgmt-svc",
                                                  "Order Team"]
    to_ini = classify(dep("code", "INI-2", "initiative", "code_dependency", [hop]), state(), Snap(), label)
    assert to_ini.change == "regression"


def test_stated_and_inferred_dependencies_on_the_same_team_confirm_each_other():
    stated = dep("explicit", "service:Order Management", "service", "blocked_on", [quote("blocked on orders")])
    inferred = dep("code", "team:Order Team", "team", "code_dependency")
    lonely = dep("ownership", "team:Data Team", "team", "owned_by_other_team", [s7("Customer Profile")])
    out = corroboration([stated, inferred, lonely], state(), Snap())
    assert out[stated.id]["verdict"] == out[inferred.id]["verdict"] == "confirmed"
    assert out[stated.id]["related"] == [inferred.id] and out[stated.id]["methods"] == ["code", "explicit"]
    assert out[lonely.id]["verdict"] == "inferred_only"
