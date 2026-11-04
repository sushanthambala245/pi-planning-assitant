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

    # LLM adapter
    llm_provider: str = field(default_factory=lambda: _env("LLM_PROVIDER", "anthropic"))  # anthropic | none
    llm_model: str = field(default_factory=lambda: _env("LLM_MODEL", "claude-sonnet-5-5"))
    llm_effort_extract: str = field(default_factory=lambda: _env("LLM_EFFORT_EXTRACT", "low"))
    llm_effort_ask: str = field(default_factory=lambda: _env("LLM_EFFORT_ASK", "medium"))
    llm_refusal_fallback: str = field(default_factory=lambda: _env("LLM_REFUSAL_FALLBACK", "default"))  # default | off
    llm_max_concurrency: int = field(default_factory=lambda: _int("LLM_MAX_CONCURRENCY", 4))
    llm_timeout_s: float = field(default_factory=lambda: _float("LLM_TIMEOUT_S", 120.0))

    # Budgets (considerations §4.1): exit behaviour is "continue without the LLM".
    pipeline_max_model_calls: int = field(default_factory=lambda: _int("PIPELINE_MAX_MODEL_CALLS", 60))
    ask_max_model_calls: int = field(default_factory=lambda: _int("ASK_MAX_MODEL_CALLS", 6))
    ask_max_calls_per_tool: int = field(default_factory=lambda: _int("ASK_MAX_CALLS_PER_TOOL", 4))
    max_initiatives_per_run: int = field(default_factory=lambda: _int("MAX_INITIATIVES_PER_RUN", 15))
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
