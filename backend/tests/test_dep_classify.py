from __future__ import annotations

from agents.discovery import library_change
from agents.state import AgentState, Dependency, EvidenceRef, Initiative, SystemTouch
from tools.dep_classify import classify, corroboration

SERVICES = {"Customer Profile": {"owner_team": "Data Team"},
            "Partner Gateway": {"owner_team": "Platform Team"},
            "Returns Service": {"owner_team": "Returns Team"},
            "Order Management": {"owner_team": "Order Team"}}


class Snap:
    resolver = None  # interface words are then read from the whole text

    def service_row(self, name):
        return SERVICES.get(name)


def label(node_id: str) -> str:
    return node_id.split(":", 1)[-1]


def state(*touches: tuple[str, str, str | None]) -> AgentState:
    systems = [SystemTouch(initiative_id=i, system=s,
                           evidence=[EvidenceRef(ref="S1:x", source="S1", detail=f"access: {a}")] if a else [])
               for i, s, a in touches]
    return AgentState(run_id="t", initiatives=[
        Initiative(id="INI-1", title="Returns", owning_team="Returns Team", description="Store drop-off returns."),
        Initiative(id="INI-2", title="Partner", owning_team="Platform Team",
                   description="Publish the v2 partner API contract.")], systems=systems)


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


def test_another_teams_system_needs_a_change_only_when_it_is_changed_or_written():
    d = dep("ownership", "service:Customer Profile", "service", "owned_by_other_team", [s7("Customer Profile")])
    assert classify(d, state(("INI-1", "Customer Profile", "changes")), Snap(), label).change == "code"
    assert classify(d, state(("INI-1", "Customer Profile", "writes")), Snap(), label).change == "flow"
    reads = classify(d, state(("INI-1", "Customer Profile", "reads")), Snap(), label)
    assert reads.change == "none" and "only reads" in reads.reason
    assert [h["level"] for h in reads.path] == ["initiative", "system", "team"]
    assert classify(d, state(("INI-1", "Customer Profile", None)), Snap(), label).change == "flow"  # unclear


def test_declared_systems_are_classified_by_role_and_owner():
    up = classify(dep("declared", "service:Partner Gateway", "service", "upstream"), state(), Snap(), label)
    assert up.change == "flow" and "Declared upstream" in up.reason and "Platform Team" in up.reason
    assert [h["label"] for h in up.path] == ["INI-1", "Partner Gateway", "Platform Team"]
    own = classify(dep("declared", "service:Returns Service", "service", "upstream"), state(), Snap(), label)
    assert own.change == "none" and "its own team" in own.reason
    down = classify(dep("declared", "service:Customer Profile", "service", "downstream"), state(), Snap(), label)
    assert down.change == "regression" and "re-tests" in down.reason  # INI-1's text names no interface
    api = classify(dep("declared", "service:Customer Profile", "service", "downstream", frm="INI-2"), state(), Snap(),
                   label)
    assert api.change == "flow" and "interface change" in api.reason  # "v2 partner API contract"
    unowned = classify(dep("declared", "service:Mainframe", "service", "upstream"), state(), Snap(), label)
    assert unowned.change == "flow" and "no owner" in unowned.reason


def test_a_shared_system_needs_code_coordination_or_a_retest_depending_on_access():
    d = dep("ownership", "INI-2", "initiative", "shared_service", [s7("Customer Profile")])
    both = state(("INI-1", "Customer Profile", "changes"), ("INI-2", "Customer Profile", "changes"))
    assert classify(d, both, Snap(), label).change == "code"
    one = state(("INI-1", "Customer Profile", "reads"), ("INI-2", "Customer Profile", "changes"))
    assert classify(d, one, Snap(), label).change == "regression"
    none = state(("INI-1", "Customer Profile", "reads"), ("INI-2", "Customer Profile", "reads"))
    assert classify(d, none, Snap(), label).change == "none"


def test_a_code_link_asks_for_code_only_when_the_provider_changes_an_interface():
    hop = EvidenceRef(ref="S4:returns-svc", source="S4",
                      detail="returns-svc (Returns Team) declares an internal dependency on partner-api (api), "
                             "owned by Platform Team")
    interface = classify(dep("code", "INI-2", "initiative", "interface_change", [hop]), state(), Snap(), label)
    assert interface.change == "code" and "an api repo" in interface.reason and "should land first" in interface.reason
    assert [h["label"] for h in interface.path] == ["INI-1", "returns-svc", "partner-api", "INI-2"]
    coupling = classify(dep("code", "INI-2", "initiative", "code_coupling", [hop]), state(), Snap(), label)
    assert coupling.change == "regression" and "regression-test INI-1 after INI-2" in coupling.reason


def test_a_library_named_by_one_common_word_needs_its_full_name():
    def ini(text: str) -> Initiative:
        return Initiative(id="I", title="Partner onboarding", owning_team="T", description=text)

    # hfg-api-contract-testing: "contract" alone is any API change, not a change to the test library.
    assert library_change(ini("Publish the new API contract for partners."), "hfg-api-contract-testing") is None
    assert library_change(ini("Upgrade API contract testing to version 2."),
                          "hfg-api-contract-testing") == "API contract testing"
    assert library_change(ini("Move to the new event schema version."), "hfg-event-schema") == "event schema"
    assert library_change(ini("Add idempotency keys to retries."), "hfg-idempotency-utils") == "idempotency"


def test_a_shared_library_change_asks_its_users_to_retest():
    said = EvidenceRef(ref="S1:INI-2", source="S1", detail="Partner changes hfg-event-schema (its text says "
                                                         "“event schema”); 2 other teams use it: A, B")
    lib = classify(dep("library", "library:hfg-event-schema", "library", "shared_library_change", [said], frm="INI-2"),
                   state(), Snap(), label)
    assert lib.change == "regression" and lib.level == "system" and "re-test after it lands" in lib.reason


def test_stated_and_inferred_dependencies_on_the_same_team_confirm_each_other():
    stated = dep("explicit", "service:Order Management", "service", "blocked_on", [quote("blocked on orders")])
    inferred = dep("ownership", "service:Order Management", "service", "owned_by_other_team")
    lonely = dep("ownership", "team:Data Team", "team", "owned_by_other_team", [s7("Customer Profile")])
    out = corroboration([stated, inferred, lonely], state(), Snap())
    assert out[stated.id]["verdict"] == out[inferred.id]["verdict"] == "confirmed"
    assert out[stated.id]["related"] == [inferred.id] and out[stated.id]["methods"] == ["explicit", "ownership"]
    declared = dep("declared", "service:Order Management", "service", "upstream")
    assert corroboration([declared, inferred], state(), Snap())[declared.id]["verdict"] == "confirmed"
    assert out[lonely.id]["verdict"] == "inferred_only"
