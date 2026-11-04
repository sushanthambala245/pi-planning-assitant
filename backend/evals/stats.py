"""Numbers with their context (considerations §5.6): intervals, case-set fingerprints,
per-metric gates, pass^k."""

from __future__ import annotations

import hashlib
import json
from math import comb

import numpy as np


def bootstrap_ci(values, n: int = 2000, seed: int = 0, level: float = 0.95) -> tuple[float, float, float]:
    a = np.asarray(values, float)
    if a.size == 0:
        return float("nan"), float("nan"), float("nan")
    means = a[np.random.default_rng(seed).integers(0, a.size, (n, a.size))].mean(axis=1)
    lo, hi = np.percentile(means, [(1 - level) / 2 * 100, (1 + level) / 2 * 100])
    return float(a.mean()), float(lo), float(hi)


def paired_difference_ci(before, after, n: int = 2000, seed: int = 0, level: float = 0.95):
    a, b = np.asarray(before, float), np.asarray(after, float)  # same cases, same order
    idx = np.random.default_rng(seed).integers(0, a.size, (n, a.size))
    diffs = b[idx].mean(axis=1) - a[idx].mean(axis=1)
    lo, hi = np.percentile(diffs, [(1 - level) / 2 * 100, (1 + level) / 2 * 100])
    return float(b.mean() - a.mean()), float(lo), float(hi)  # an interval spanning 0 is not a measured difference


def fingerprint(case_ids) -> str:
    ids = sorted(json.dumps(i, default=str) for i in case_ids)
    return hashlib.sha256(json.dumps(ids).encode()).hexdigest()[:12]


def ratio_ci(successes: list[int], trials: list[int], n: int = 2000, seed: int = 0, level: float = 0.95):
    """Bootstrap over cases for a pooled ratio such as precision = sum(tp) / sum(tp + fp)."""
    s, t = np.asarray(successes, float), np.asarray(trials, float)
    if t.sum() == 0:
        return None, None, None
    idx = np.random.default_rng(seed).integers(0, s.size, (n, s.size))
    tot = t[idx].sum(axis=1)
    vals = np.divide(s[idx].sum(axis=1), tot, out=np.full(n, np.nan), where=tot > 0)
    lo, hi = np.nanpercentile(vals, [(1 - level) / 2 * 100, (1 + level) / 2 * 100])
    return float(s.sum() / t.sum()), float(lo), float(hi)


def pass_k(passed: list[bool], k: int) -> float:
    n, c = len(passed), sum(passed)
    return comb(c, k) / comb(n, k) if n >= k and c >= k else 0.0


def gate(scores: dict[str, float | None], minimum: dict[str, float]) -> dict:
    """Per metric, never on an average; a missing metric fails."""
    failed = [m for m, floor in minimum.items() if scores.get(m) is None or scores[m] < floor]
    return {"passed": not failed, "failed": failed}
