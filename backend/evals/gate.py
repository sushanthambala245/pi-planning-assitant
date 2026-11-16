"""Release gate: reads evals/results/*.json and exits non-zero when any metric is missing
or under its own floor (considerations §4.8, §5.6). Never gates on an average.

    python -m evals.gate                       # gate the latest results
    python -m evals.gate --baseline <dir>      # also refuse drops > 0.05 vs a baseline run,
                                               # comparing only results with the same case-set fingerprint
"""

from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

from evals.stats import gate
from evals.thresholds import AGREED_BY, MINIMUM

RESULTS = Path(__file__).resolve().parent / "results"
NAMES = {"extraction": "extraction", "retrieval": "retrieval", "known_links": "known_links",
         "dri_backtest": "dri_backtest"}
TOLERANCE = 0.05


def load(dir_: Path) -> dict[str, dict]:
    out = {}
    for name in NAMES:
        p = dir_ / f"{name}.json"
        if p.exists():
            out[name] = json.loads(p.read_text(encoding="utf-8"))
    return out


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="python -m evals.gate")
    ap.add_argument("--results", type=Path, default=RESULTS)
    ap.add_argument("--baseline", type=Path, default=None)
    a = ap.parse_args(argv)

    results = load(a.results)
    scores: dict[str, float | None] = {}
    rows = []
    for name, res in results.items():
        for metric, m in res["metrics"].items():
            key = f"{name}.{metric}"
            scores[key] = m["value"]
            rows.append((key, m["value"], m.get("ci95"), res.get("n_cases"), res.get("fingerprint"),
                         res.get("planted_regression", False)))
    verdict = gate(scores, MINIMUM)

    regressions = []
    if a.baseline:
        base = load(a.baseline)
        for name, res in results.items():
            b = base.get(name)
            if b is None:
                continue
            if b.get("fingerprint") != res.get("fingerprint"):
                regressions.append(f"{name}: not comparable (case sets differ: {b.get('fingerprint')} vs "
                                   f"{res.get('fingerprint')})")
                continue
            for metric, m in res["metrics"].items():
                old = b["metrics"].get(metric, {}).get("value")
                if old is not None and m["value"] is not None and m["value"] < old - TOLERANCE:
                    regressions.append(f"{name}.{metric}: {old} -> {m['value']} (drop > {TOLERANCE})")

    print(f"Thresholds: {AGREED_BY}")
    print(f"{'metric':28} {'value':>8} {'ci95':>18} {'floor':>6}  n    fingerprint   status")
    for key, val, ci, n, fp, planted in sorted(rows):
        floor = MINIMUM.get(key)
        status = "-" if floor is None else ("FAIL" if key in verdict["failed"] else "pass")
        ci_s = f"[{ci[0]:.2f}, {ci[1]:.2f}]" if ci else "-"
        val_s = "missing" if val is None else f"{val:.3f}"
        print(f"{key:28} {val_s:>8} {ci_s:>18} {floor if floor is not None else '-':>6}  {n or 0:<4} {fp or '-':13} "
              f"{status}{'  (PLANTED REGRESSION)' if planted else ''}")
    for key in MINIMUM:
        if key not in scores:
            print(f"{key:28} {'missing':>8} {'-':>18} {MINIMUM[key]:>6}  -    -             FAIL (never measured)")
    for r in regressions:
        print(f"REGRESSION: {r}")

    passed = verdict["passed"] and not regressions
    a.results.mkdir(parents=True, exist_ok=True)
    (a.results / "gate.json").write_text(json.dumps({
        "at": datetime.now(timezone.utc).isoformat(timespec="seconds"), "passed": passed, "failed": verdict["failed"],
        "regressions": regressions, "thresholds": MINIMUM, "agreed_by": AGREED_BY, "scores": scores}, indent=1),
        encoding="utf-8")
    print("GATE:", "PASS" if passed else "FAIL")
    return 0 if passed else 1


if __name__ == "__main__":
    sys.exit(main())
