from __future__ import annotations

from agents.state import Dependency, Initiative
from tools.graph_tools import build_initiative_graph
from tools.schedule import build_schedule, canonical_size, parse_size_sprints, size_of


def ini(i: str, size: str | None = None, points: float | None = None, sprint: str | None = None,
        pi: str = "PI-1") -> Initiative:
    return Initiative(id=i, title=i, owning_team="T", target_pi=pi, size=size, estimate_points=points,
                      targeted_sprint=sprint)


def waits(a: str, b: str) -> Dependency:
    """`a` depends on `b`: b must finish first."""
    return Dependency(id=f"d-{a}-{b}", from_id=a, to_id=b, to_kind="initiative", kind="explicit", method="rule",
                      status="verified")


def schedule(inis: list[Initiative], deps: list[Dependency] | None = None, pi_sprints: int = 5):
    g = build_initiative_graph(inis, deps or [], [])
    s = build_schedule(inis, g, pi_sprints)
    return s, {r.initiative_id: r for r in s.rows}


def test_a_dependent_starts_the_sprint_after_its_provider_ends():
    s, r = schedule([ini("A", "L"), ini("B", "M")], [waits("B", "A")])
    assert (r["A"].start, r["A"].end) == (1, 3)
    assert (r["B"].start, r["B"].end) == (4, 5)
    assert r["B"].waits_for == ["A"] and r["A"].waits_for == []
    assert s.critical_path == ["A", "B"] and r["A"].critical and r["B"].critical


def test_independent_initiatives_run_in_parallel_and_have_no_critical_path():
    s, r = schedule([ini("A", "L"), ini("B", "M")])
    assert r["A"].start == r["B"].start == 1
    assert s.critical_path == []


def test_a_dependent_waits_for_the_latest_of_its_providers():
    _, r = schedule([ini("A", "S"), ini("B", "XL"), ini("C", "S")], [waits("C", "A"), waits("C", "B")])
    assert r["C"].start == 5  # B ends in sprint 4


def test_critical_path_follows_the_chain_that_ends_last():
    s, r = schedule([ini("A", "L"), ini("B", "S"), ini("C", "S"), ini("D", "M")],
                    [waits("C", "B"), waits("D", "A")])
    assert s.critical_path == ["A", "D"]
    assert not r["B"].critical and not r["C"].critical


def test_work_that_ends_after_the_pi_is_flagged_and_explained():
    s, r = schedule([ini("A", "XL"), ini("B", "M")], [waits("B", "A")])  # B ends in sprint 6
    assert r["B"].spills_past_pi and not r["A"].spills_past_pi
    assert any("B" in a and "sprint 5" in a for a in s.assumptions)


def test_cycle_members_start_together_and_are_flagged():
    s, r = schedule([ini("X", "M"), ini("Y", "S"), ini("Z", "S")], [waits("X", "Y"), waits("Y", "X"), waits("Z", "X")])
    assert r["X"].start == r["Y"].start == 1 and r["X"].in_cycle and r["Y"].in_cycle
    assert r["Z"].start == 3 and not r["Z"].in_cycle  # after the cycle, which ends with X in sprint 2
    assert any("depend on each other" in a for a in s.assumptions)


def test_missing_sizes_fall_back_to_points_then_to_one_sprint_and_say_so():
    s, r = schedule([ini("A", "Large"), ini("B", points=3), ini("C", points=20), ini("D")])
    assert (r["A"].size, r["A"].size_source) == ("L", "size")
    assert (r["B"].size, r["B"].size_source) == ("M", "points")
    assert (r["C"].size, r["C"].size_source) == ("XL", "points")
    assert (r["D"].size, r["D"].size_source, r["D"].sprints) == ("S", "default", 1)
    assert any("story points" in a and "B" in a for a in s.assumptions)
    assert any("scheduled as one sprint" in a and "D" in a for a in s.assumptions)


def test_size_names_and_overrides():
    assert [canonical_size(x) for x in ("s", " XL ", "extra-large", "Medium", "xs", "", None, "huge")] == \
        ["S", "XL", "XL", "M", "S", None, None, None]
    assert size_of(ini("A", "huge", points=1)) == ("S", "points")
    assert parse_size_sprints("S=2, XL=6, M=x, Q=9, L=0") == {"S": 2, "M": 2, "L": 3, "XL": 6}
    inis = [ini("A", "S"), ini("B", "M")]
    s = build_schedule(inis, build_initiative_graph(inis, [waits("B", "A")], []), 5, {"S": 2, "M": 3, "L": 3, "XL": 4})
    assert {r.initiative_id: (r.start, r.end) for r in s.rows} == {"A": (1, 2), "B": (3, 5)}


def test_targeted_sprint_number_and_pi_label():
    s, r = schedule([ini("A", "S", sprint="PI-2026-06-Sprint-3"), ini("B", "S", sprint="soon"),
                     ini("C", "S", pi="PI-2")], [])
    assert r["A"].targeted_sprint == 3 and r["B"].targeted_sprint is None
    assert s.pi == "PI-1"
    assert any("several PIs" in a for a in s.assumptions)
