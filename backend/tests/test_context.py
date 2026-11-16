from __future__ import annotations

from dataclasses import replace
from pathlib import Path

from context.resolver import Catalogue
from context.snapshot import build_snapshot


def test_loader_maps_aliases_and_reports_status(settings):
    snap = build_snapshot(settings)
    s1 = snap.reports["S1"]
    assert s1.status == "ready" and s1.rows == 4  # "Initiative ID", "Owning Team" ... normalised
    assert snap.reports["M1"].status == "ready"
    assert snap.reports["M3"].rows == 2  # blank-line separated messages
    assert snap.reports["M4"].status == "missing"  # missing is reported, never filled in
    assert snap.initiatives()[0].estimate_points == 40.0


def test_missing_required_column_makes_source_invalid(tmp_path: Path, settings):
    d = tmp_path / "bad"
    d.mkdir()
    (d / "initiatives.csv").write_text("initiative_id,title\nX-1,Thing\n", encoding="utf-8")
    snap = build_snapshot(replace(settings, data_dir=d))
    rep = snap.reports["S1"]
    assert rep.status == "invalid"
    assert rep.missing_columns == ["owning_team"]
    assert not snap.has("S1")  # nothing from an invalid source is loaded


def test_rows_with_empty_required_values_or_bad_numbers_are_rejected(tmp_path: Path, settings):
    d = tmp_path / "partial"
    d.mkdir()
    (d / "initiatives.csv").write_text(
        "initiative_id,title,owning_team,estimate_points\nA,Alpha,T1,5\nB,,T1,3\nC,Gamma,T1,lots\nA,Dup,T1,1\n",
        encoding="utf-8")
    snap = build_snapshot(replace(settings, data_dir=d))
    rep = snap.reports["S1"]
    assert rep.status == "partial"
    assert rep.rows == 1 and rep.rejected_rows == 3
    assert any("not a number" in e for e in rep.errors)
    assert any("duplicate" in e for e in rep.errors)


def test_label_columns_never_reach_the_index(settings):
    snap = build_snapshot(settings)
    s3 = [c for c in snap.index.chunks if c.source == "S3"]
    assert s3, "S3 statement text should be indexed"
    for c in s3:
        assert "is_dependency" not in c.meta and "to_entity" not in c.meta


def test_source_filter_is_applied_inside_the_query(settings):
    snap = build_snapshot(settings)
    hits = snap.index.search("returns order management", k=10, sources=("M3",))
    assert hits and all(h.chunk.source == "M3" for h in hits)


def test_team_names_are_canonicalised_with_the_raw_value_kept(tmp_path: Path, settings):
    snap = build_snapshot(settings)
    s4 = snap.table("S4")
    assert set(s4["owner_team"]) <= set(snap.resolver.teams.names)
    assert "owner_team_raw" in s4.columns


def test_sources_are_found_in_sub_folders_under_alternative_names(tmp_path: Path, settings):
    d = tmp_path / "nested"
    (d / "pkg" / "v2").mkdir(parents=True)
    (d / "pkg" / "v2" / "dependency_statements_updated.csv").write_text("statement_id,statement_text\nS-1,Blocked\n",
                                                                       encoding="utf-8")
    (d / "pkg" / "kpi_benchmarks_updated.csv").write_text("KPI Metric,Baseline\nPrep hours,64\nCoverage,\n",
                                                          encoding="utf-8")
    (d / "kpi_benchmarks.csv").write_text("kpi,value\nPrep hours,60\n", encoding="utf-8")
    snap = build_snapshot(replace(settings, data_dir=d))
    s3, s9 = snap.reports["S3"], snap.reports["S9"]
    assert s3.status == "ready" and s3.filename == "pkg/v2/dependency_statements_updated.csv"
    assert s9.filename == "kpi_benchmarks.csv"  # the canonical name wins; the other copy is named, not ignored
    assert any("kpi_benchmarks_updated.csv" in e for e in s9.errors)


def test_haverstone_headers_map_onto_the_contract(tmp_path: Path, settings):
    d = tmp_path / "haverstone"
    d.mkdir()
    files = {
        "team_directory.csv": "team_id,team_name,art\nT-A,Alpha Team,ART1\nT-B,Beta Team,ART1\n",
        "github_repos.csv": "repo_id,repo_name,team_id,declared_internal_repo_ids\nR-1,alpha-svc,T-A,R-2\nR-2,beta-lib,T-B,\n",
        "service_ownership_map.csv": "service_name,owning_team_id,lifecycle_status,related_repo_ids\n"
                                     "Beta Store,T-B,Deprecated,R-2;R-1\n",
        "kpi_benchmarks.csv": "KPI Metric,Baseline,Target\nCoverage,,95\n",
    }
    for name, body in files.items():
        (d / name).write_text(body, encoding="utf-8")
    snap = build_snapshot(replace(settings, data_dir=d))
    assert set(snap.table("S6")["team"]) == {"T-A", "T-B"}  # team_id, not team_name: other sources join on it
    assert snap.repo_row("alpha-svc")["internal_dependencies"] == ["beta-lib"]  # repo ids resolve onto names
    assert [r["repo"] for r in snap.repos_of_team("T-A")] == ["alpha-svc"]
    assert snap.team_name("T-B") == "Beta Team" and snap.resolver.team("Beta Team").canonical == "T-B"
    # The ownership map is a lookup per system: owner, lifecycle and contract status; not its repo links.
    assert snap.service_row("Beta Store")["owner_team"] == "T-B"
    assert snap.service_row("Beta Store")["status"] == "Deprecated"
    assert "repo" not in snap.table("S7").columns
    kpi = snap.table("S9").iloc[0]
    assert kpi["value"] != kpi["value"] and kpi["target"] == 95  # blank baseline is NaN, never 0 or a rejected row
    assert not snap.resolution_issues


def test_reissued_exports_are_found_and_their_headers_mapped(tmp_path: Path, settings):
    """The current package: initiatives_updated_v1.csv with a quarter column whose header explains
    itself and a T-shirt size, and one capacity row per team. A newer _v2 export wins over _v1."""
    import os
    import time

    d = tmp_path / "reissued"
    (d / "pkg").mkdir(parents=True)
    old = d / "pkg" / "initiatives_updated_v1.csv"
    old.write_text("initiative_id,initiative_name,owning_team,target_pi-explicitly Q1/Q2..,T-Shirt Sizing\n"
                   "INIT-1,Old,T-A,Q1,S\n", encoding="utf-8")
    new = d / "pkg" / "initiatives_updated_v2.csv"
    new.write_text("initiative_id,initiative_name,owning_team,target_pi-explicitly Q1/Q2..,T-Shirt Sizing\n"
                   "INIT-1,New,T-A,Q2,xl\n", encoding="utf-8")
    t = time.time()
    os.utime(old, (t - 60, t - 60))
    os.utime(new, (t, t))
    (d / "team_capacity_updated_v1.csv").write_text("team_id,available_story_points\nT-A,32\n", encoding="utf-8")
    snap = build_snapshot(replace(settings, data_dir=d))
    s1, s5 = snap.reports["S1"], snap.reports["S5"]
    assert s1.filename == "pkg/initiatives_updated_v2.csv" and any("initiatives_updated_v1.csv" in e for e in s1.errors)
    ini = snap.initiatives()[0]
    assert (ini.title, ini.target_pi, ini.tshirt_size) == ("New", "Q2", "XL")
    assert not s1.unknown_columns  # the self-explaining header maps onto target_pi
    assert s5.status == "ready" and snap.table("S5").iloc[0]["capacity_points"] == 32
    assert snap.pi_names() == ["Q2"]


def test_catalogue_resolution_levels():
    cat = Catalogue("team", ["Payments Team", "Core Banking"], threshold=0.86)
    assert cat.resolve("payments team").method == "exact"
    assert cat.resolve("Payments").method == "loose"
    assert cat.resolve("Core Bankng").method == "fuzzy"
    r = cat.resolve("Marketing")
    assert r.canonical is None and r.method == "none"  # below threshold: reported, not guessed
