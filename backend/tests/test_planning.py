"""The deterministic planning engine (tools/planning.py): sizes, velocity, the quarter calendar, the
schedule and the plan-as-written check."""

from __future__ import annotations

from tools.planning import (Calendar, Edge, Item, TeamCapacity, interface_word, is_ready, next_pi,
                            parse_dependency_text, pi_key, plan_conflicts, scale_of, schedule, size_points, tshirt,
                            velocity_tier)


def test_tshirt_sizes_and_velocity_tiers():
    # The default scale is the Fibonacci one: XS 3, S 5, M 8, L 13, XL 21, XXL 34.
    assert [tshirt(p) for p in (1, 5, 6, 13, 21, 40)] == ["XS", "S", "M", "L", "XL", "XXL"]
    assert tshirt(None) is None
    assert size_points("xl") == 21 and size_points("") is None
    custom = scale_of((("S", 2), ("M", 3), ("L", 5)))  # a team's own scale (TSHIRT_POINTS)
    assert size_points("L", custom) == 5 and tshirt(4, custom) == "L"
    # A team's velocity tier names its capacity per quarter: up to 24 S, 32 M, 40 L, more XL.
    assert [velocity_tier(v) for v in (24, 31, 38, 42)] == ["S", "M", "L", "XL"] and velocity_tier(0) is None


def test_dependency_lists_split_into_upstream_and_downstream():
    assert parse_dependency_text("Upstream: Posting Engine, Account Ledger; Downstream: RTP Network") == (
        ["Posting Engine", "Account Ledger"], ["RTP Network"])
    assert parse_dependency_text("Downstream: A") == ([], ["A"])
    assert parse_dependency_text("Core Ledger") == (["Core Ledger"], [])  # no label: something it consumes
    assert parse_dependency_text("") == ([], [])


def test_only_ready_initiatives_are_planned():
    ready = ("Ready for PI Planning",)
    assert is_ready("Ready for PI Planning", "S1", ready) and is_ready("ready for pi planning ", "S1", ready)
    assert not is_ready("In Discovery", "S1", ready) and not is_ready("Proposed", "S1", ready)
    assert not is_ready("", "S1", ready) and is_ready("", "manual", ready)  # a planner added it to plan it


def test_quarters_order_and_roll_over():
    assert sorted(["Q2", "Q1 Y+1", "Q4", "Q1"], key=pi_key) == ["Q1", "Q2", "Q4", "Q1 Y+1"]
    assert next_pi("Q2") == "Q3" and next_pi("Q4") == "Q1 Y+1" and next_pi("2027-Q4") == "2028-Q1"
    assert next_pi("PI-2027-01") == "PI-2027-01 +1"  # an unknown cadence: an assumed next PI
    cal = Calendar.quarters(["Q2", "Q1"], per_pi=5, min_pis=4)
    assert cal.pis == ["Q1", "Q2", "Q3", "Q4"] and len(cal.sprints) == 20 and not any(cal.assumed)
    assert (cal.short(7), cal.first_of_pi("Q2"), cal.last_of_pi("Q2")) == ("Q2 S3", 5, 9)
    cal.extend_to(22)
    assert cal.pi_of[20] == "Q1 Y+1" and cal.assumed[20] and cal.pis_real == ["Q1", "Q2", "Q3", "Q4"]


def test_calendar_orders_sprints_by_pi_then_number_and_extends_with_assumed_pis():
    cal = Calendar.build(["PI-2027-01-Sprint-2", "PI-2026-06-Sprint-10", "PI-2026-06-Sprint-2", "PI-2027-01-Sprint-1"])
    assert cal.sprints == ["PI-2026-06-Sprint-2", "PI-2026-06-Sprint-10", "PI-2027-01-Sprint-1", "PI-2027-01-Sprint-2"]
    assert cal.pis == ["PI-2026-06", "PI-2027-01"] and cal.short(1) == "PI-2026-06 S10"
    cal.extend_to(5)
    assert cal.assumed[4:] == [True, True] and cal.pi_of[4] == "PI-2027-01 +1" and cal.pis_real == cal.pis[:2]


def test_a_per_quarter_capacity_row_is_spread_over_its_sprints():
    cal = Calendar.quarters(["Q1"], per_pi=5, min_pis=2)
    cap = TeamCapacity("A", {}, default=24 / 5)  # 24 points a quarter, no sprint rows
    assert cap.at(0, cal) == cap.at(9, cal) == 4.8 and cap.per_quarter(cal) == 24


def test_schedule_respects_providers_capacity_and_the_target_quarter():
    cal = Calendar.quarters(["Q1"], per_pi=3, min_pis=1)
    caps = {"A": TeamCapacity("A", {0: 5, 1: 5, 2: 5}), "B": TeamCapacity("B", {0: 8, 1: 8, 2: 8})}
    items = [Item("P", "Provider", "A", 8, 0, "Medium", deadline=2),  # 8 points at 5 a sprint
             Item("C", "Consumer", "B", 3, 0, "Critical", deadline=2),  # waits for P
             Item("Q", "Queued", "A", 3, 0, "High", deadline=2),  # shares team A with P
             Item("L", "Late plan", "B", 2, 2, "Low", deadline=2)]  # planned for the last sprint: not pulled earlier
    slots = schedule(items, [Edge("P", "C", ["dep-1"])], caps, cal, label={"P": "Provider"}.get)
    assert (slots["Q"].start, slots["Q"].finish) == (0, 0)  # High before Medium on team A
    assert (slots["P"].start, slots["P"].finish) == (0, 2) and slots["P"].allocation == {0: 2, 1: 5, 2: 1}
    assert slots["C"].start == 3 and cal.assumed[3]  # after P, in an assumed next quarter
    assert slots["C"].reasons[0].startswith("Waits for Provider, which finishes in Q1 S3, so it can start in Q2 S1")
    assert any("spills into Q2" in r for r in slots["C"].reasons)
    assert slots["L"].start == 2


def test_schedule_puts_a_cycle_in_one_group_and_ignores_unknown_capacity():
    cal = Calendar.build(["PI-1-Sprint-1", "PI-1-Sprint-2"])
    items = [Item("A", "A", "X", 2, 0), Item("B", "B", "X", 2, 0)]
    slots = schedule(items, [Edge("A", "B"), Edge("B", "A")], {}, cal)
    assert slots["A"].in_cycle and slots["B"].in_cycle
    assert not slots["A"].capacity_known and "No capacity data" in " ".join(slots["A"].reasons)


def test_plan_as_written_conflicts_with_planned_sprints():
    caps = {"A": TeamCapacity("A", {0: 5, 1: 5, 2: 5})}
    items = [Item("P", "P", "A", 8, 0, explicit=True), Item("C", "C", "B", 1, 1, explicit=True),
             Item("D", "D", "B", 1, 2, explicit=True)]
    out = plan_conflicts(items, [Edge("P", "C", ["d1"]), Edge("P", "D", ["d2"])], caps)
    assert [(c["consumer"], c["providerFinish"], c["kind"]) for c in out] == [("C", 1, "sprint")]  # P runs 0-1


def test_plan_as_written_conflicts_with_target_quarters():
    cal = Calendar.quarters(["Q1", "Q2"], per_pi=5, min_pis=2)
    caps = {t: TeamCapacity(t, {}, default=5.0) for t in ("A", "B")}
    items = [Item("P", "Provider", "A", 13, 0, deadline=4),  # Q1, three sprints at 5
             Item("C", "Consumer", "B", 13, 0, deadline=4),  # Q1 too: three more sprints do not fit
             Item("E", "Early", "B", 5, 0, deadline=4),  # Q1, waits for the Q2 provider below
             Item("R", "Q2 provider", "A", 5, 5, deadline=9),
             Item("F", "Fits", "B", 5, 0, deadline=4)]  # Q1, one sprint after P: fits
    edges = [Edge("P", "C", ["d1"]), Edge("R", "E", ["d2"]), Edge("P", "F", ["d3"])]
    kinds = {c["consumer"]: c["kind"] for c in plan_conflicts(items, edges, caps, cal)}
    assert kinds == {"C": "too_tight", "E": "later_quarter"}


def test_a_tight_quarter_is_only_reported_when_waiting_for_the_provider_causes_it():
    cal = Calendar.quarters(["Q1", "Q2"], per_pi=5, min_pis=2)
    caps = {t: TeamCapacity(t, {}, default=5.0) for t in ("A", "B")}
    items = [Item("P", "Done early", "A", 5, 0, deadline=4),  # Q1 S1 only
             Item("C", "Too big alone", "B", 40, 5, deadline=9),  # Q2, eight sprints: spills on its own
             Item("S", "Spills", "A", 34, 0, deadline=4),  # Q1, seven sprints: runs to Q2 S2
             Item("D", "Next quarter", "B", 18, 5, deadline=9)]  # Q2, four sprints: fits, unless it waits
    out = plan_conflicts(items, [Edge("P", "C", ["d1"]), Edge("S", "D", ["d2"])], caps, cal)
    # P is done long before C's quarter, so C's own size is not blamed on P. S is targeted at an
    # earlier quarter but is still running in Q2, so D, which would fit on its own, now ends in Q3.
    assert [(c["consumer"], c["kind"], c["providerStart"], c["providerFinish"], c["consumerFinish"])
            for c in out] == [("D", "too_tight", 0, 6, 10)]


def test_interface_words_ignore_names_of_other_systems():
    class Cat:
        def __init__(self, names):
            self.names = names

        def mentions(self, text):
            return [(n, n.lower()) for n in self.names if f" {n.lower()} " in text]

    class Resolver:
        services = Cat(["Ledger Posting API"])
        initiative_titles = Cat([])

    assert interface_word("RTP expansion", "Blocked on the Ledger Posting API.", Resolver()) is None
    assert interface_word("Ledger posting API v2", "Expose the new contract.", Resolver()) == "v2"
    assert interface_word("Cleanup", "Normalise entries.") is None
