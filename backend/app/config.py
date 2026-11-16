"""Settings read once from the environment (and backend/.env).

Every threshold that changes a decision lives here, so it is set before scoring and
saved with each run (considerations §5.6).
"""

from __future__ import annotations

import os
from dataclasses import asdict, dataclass, field
from pathlib import Path

from dotenv import load_dotenv

BACKEND_DIR = Path(__file__).resolve().parent.parent
PROJECT_DIR = BACKEND_DIR.parent
load_dotenv(BACKEND_DIR / ".env")


def _env(name: str, default: str) -> str:
    return os.getenv(name, default).strip()


def _int(name: str, default: int) -> int:
    return int(_env(name, str(default)))


def _float(name: str, default: float) -> float:
    return float(_env(name, str(default)))


def _list(name: str, default: str) -> tuple[str, ...]:
    return tuple(x.strip() for x in _env(name, default).split(",") if x.strip())


def _pairs(name: str, default: str) -> tuple[tuple[str, float], ...]:
    """"S=5,M=8" -> (("S", 5.0), ("M", 8.0)), in the order written."""
    out = []
    for part in _env(name, default).split(","):
        k, sep, v = part.partition("=")
        if sep and k.strip() and v.strip():
            out.append((k.strip().upper(), float(v)))
    return tuple(out)


def _path(name: str, default: Path) -> Path:
    raw = os.getenv(name)
    if not raw:
        return default
    p = Path(raw)
    return p if p.is_absolute() else (BACKEND_DIR / p).resolve()


@dataclass(frozen=True)
class Settings:
    data_dir: Path = field(default_factory=lambda: _path("DATA_DIR", PROJECT_DIR / "data"))
    runs_dir: Path = field(default_factory=lambda: _path("RUNS_DIR", BACKEND_DIR / "runs"))
    cors_origins: tuple[str, ...] = field(
        default_factory=lambda: tuple(
            o.strip() for o in _env("CORS_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173").split(",") if o.strip()
        )
    )

    # The knowledge base: source ids the agents may read (context/sources.py KNOWLEDGE_BASE). The
    # rest are reported as switched off. "all" turns every source on.
    active_sources: tuple[str, ...] | None = field(
        default_factory=lambda: None if _env("ACTIVE_SOURCES", "").lower() == "all"
        else _list("ACTIVE_SOURCES", "S1,S4,S5,S6,S7"))
    # S1 statuses that are ready to plan. Anything else (Proposed, In Discovery) is left out of a run.
    ready_statuses: tuple[str, ...] = field(default_factory=lambda: _list("READY_STATUSES", "Ready for PI Planning"))

    # Planning (tools/planning.py). An initiative's T-shirt size (S1) is worth these story points, the
    # unit of team capacity (S5). The default is the common Fibonacci scale for T-shirt sizes.
    tshirt_points: tuple[tuple[str, float], ...] = field(
        default_factory=lambda: _pairs("TSHIRT_POINTS", "XS=3,S=5,M=8,L=13,XL=21,XXL=34"))
    # The size assumed for an initiative with no size, so it still takes capacity (and says so).
    default_size: str = field(default_factory=lambda: _env("DEFAULT_SIZE", "M").upper())
    # Sprints in a quarter (one PI per quarter) when the data has no sprint-level rows.
    sprints_per_pi: int = field(default_factory=lambda: _int("SPRINTS_PER_PI", 5))
    # Quarters the decision dashboard and the calendar always show (the last bucket is "Later").
    plan_quarters: int = field(default_factory=lambda: _int("PLAN_QUARTERS", 4))
    # A team's velocity tier by its capacity per quarter: up to 24 points is S, 32 M, 40 L, more XL.
    velocity_tiers: tuple[tuple[str, float], ...] = field(
        default_factory=lambda: _pairs("VELOCITY_TIERS", "S=24,M=32,L=40"))

    # LLM adapter
    llm_provider: str = field(default_factory=lambda: _env("LLM_PROVIDER", "anthropic"))  # anthropic | none
    llm_model: str = field(default_factory=lambda: _env("LLM_MODEL", "claude-sonnet-5-5"))
    llm_effort_extract: str = field(default_factory=lambda: _env("LLM_EFFORT_EXTRACT", "low"))
    llm_effort_ask: str = field(default_factory=lambda: _env("LLM_EFFORT_ASK", "medium"))
    llm_refusal_fallback: str = field(default_factory=lambda: _env("LLM_REFUSAL_FALLBACK", "default"))  # default | off
    llm_max_concurrency: int = field(default_factory=lambda: _int("LLM_MAX_CONCURRENCY", 4))
    llm_timeout_s: float = field(default_factory=lambda: _float("LLM_TIMEOUT_S", 120.0))

    # Budgets (considerations §4.1): exit behaviour is "continue without the LLM".
    pipeline_max_model_calls: int = field(default_factory=lambda: _int("PIPELINE_MAX_MODEL_CALLS", 90))
    ask_max_model_calls: int = field(default_factory=lambda: _int("ASK_MAX_MODEL_CALLS", 6))
    ask_max_calls_per_tool: int = field(default_factory=lambda: _int("ASK_MAX_CALLS_PER_TOOL", 4))
    # High enough for every ready initiative of a PI: hidden dependencies only show across the whole set.
    max_initiatives_per_run: int = field(default_factory=lambda: _int("MAX_INITIATIVES_PER_RUN", 60))
    # Rows accepted from one uploaded initiatives file; the rest are skipped and reported.
    max_upload_initiatives: int = field(default_factory=lambda: _int("MAX_UPLOAD_INITIATIVES", 100))

    # Retrieval (considerations §4.3 baseline)
    chunk_chars: int = field(default_factory=lambda: _int("CHUNK_CHARS", 800))
    chunk_overlap: int = field(default_factory=lambda: _int("CHUNK_OVERLAP", 120))
    retrieval_k: int = field(default_factory=lambda: _int("RETRIEVAL_K", 6))

    # Verifier
    confidence_threshold: float = field(default_factory=lambda: _float("CONFIDENCE_THRESHOLD", 0.6))
    max_requery_rounds: int = field(default_factory=lambda: _int("MAX_REQUERY_ROUNDS", 2))
    max_requery_deps: int = field(default_factory=lambda: _int("MAX_REQUERY_DEPS", 10))

    # Entity resolution
    fuzzy_threshold: float = field(default_factory=lambda: _float("FUZZY_THRESHOLD", 0.86))

    # DRI rule thresholds
    capacity_warn_pct: float = field(default_factory=lambda: _float("CAPACITY_WARN_PCT", 100.0))
    capacity_blocker_pct: float = field(default_factory=lambda: _float("CAPACITY_BLOCKER_PCT", 130.0))
    history_miss_ratio: float = field(default_factory=lambda: _float("HISTORY_MISS_RATIO", 0.8))
    history_escalate_share: float = field(default_factory=lambda: _float("HISTORY_ESCALATE_SHARE", 0.5))

    def public(self) -> dict:
        d = asdict(self)
        return {k: (str(v) if isinstance(v, Path) else v) for k, v in d.items()}


_settings: Settings | None = None


def get_settings() -> Settings:
    global _settings
    if _settings is None:
        _settings = Settings()
    return _settings
