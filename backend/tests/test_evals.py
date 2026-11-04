from __future__ import annotations

import json

import pytest

import evals.run as runner
from context.snapshot import build_snapshot
from evals import gate as gate_cli
from evals.stats import bootstrap_ci, fingerprint, gate, pass_k
from llm.adapter import DisabledLLM


def test_stats_helpers():
    assert bootstrap_ci([1, 1, 1])[1:] == (1.0, 1.0)
    assert pass_k([True, True, True, True, False], 3) == pytest.approx(0.4)  # C(4,3)/C(5,3)
    assert fingerprint(["b", "a"]) == fingerprint(["a", "b"])
    assert gate({"m": None}, {"m": 0.5}) == {"passed": False, "failed": ["m"]}  # missing fails


@pytest.fixture
def results_dir(tmp_path, monkeypatch):
    d = tmp_path / "results"
    monkeypatch.setattr(runner, "RESULTS", d)
    return d


def test_the_harness_catches_a_planted_regression(settings, results_dir, tmp_path):
    snap = build_snapshot(settings)
    llm = DisabledLLM("rule mode")

    good = runner.eval_extraction(settings, snap, llm, "rule", plant=False)
    assert good["metrics"]["recall"]["value"] == 1.0 and good["metrics"]["precision"]["value"] == 1.0
    links = runner.eval_links(settings, snap, llm, "rule", plant=False)
    assert links["metrics"]["recall"]["value"] == 1.0  # FRD-1 -> PAR-1 is found by the pipeline

    bad = runner.eval_extraction(settings, snap, llm, "rule", plant=True)
    assert bad["metrics"]["recall"]["value"] == 0.0
    assert bad["fingerprint"] == good["fingerprint"]  # same cases, so the two runs are comparable
    assert runner.eval_links(settings, snap, llm, "rule", plant=True)["metrics"]["recall"]["value"] == 0.0

    # Retrieval with labelled cases, then the planted same-chunk retriever.
    cases = tmp_path / "cases.jsonl"
    cases.write_text(json.dumps({"id": "r1", "question": "partner gateway api contract",
                                 "evidence_docs": ["M1:architecture/partner-gateway-api-contract.md"]}) + "\n",
                     encoding="utf-8")
    assert runner.eval_retrieval(settings, snap, cases, 6, plant=False)["metrics"]["hit_rate"]["value"] == 1.0
    assert runner.eval_retrieval(settings, snap, cases, 6, plant=True)["metrics"]["hit_rate"]["value"] == 0.0

    assert gate_cli.main(["--results", str(results_dir)]) == 1  # planted results and unmeasured metrics fail
    verdict = json.loads((results_dir / "gate.json").read_text(encoding="utf-8"))
    assert "extraction.recall" in verdict["failed"] and "dri_backtest.recall" in verdict["failed"]
