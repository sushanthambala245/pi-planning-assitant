"""Versioned prompt files. The version (name@sha8) is recorded on every trace span and
in the audit, so a score or a decision can always be tied to the prompt that produced it."""

from __future__ import annotations

import hashlib
from dataclasses import dataclass
from functools import lru_cache

from app.config import BACKEND_DIR

PROMPTS_DIR = BACKEND_DIR / "prompts"


@dataclass(frozen=True)
class Prompt:
    name: str
    text: str
    version: str


@lru_cache(maxsize=None)
def load_prompt(name: str) -> Prompt:
    text = (PROMPTS_DIR / f"{name}.md").read_text(encoding="utf-8").strip()
    return Prompt(name, text, f"{name}@{hashlib.sha256(text.encode()).hexdigest()[:8]}")


def all_prompt_versions() -> dict[str, str]:
    return {p.stem: load_prompt(p.stem).version for p in sorted(PROMPTS_DIR.glob("*.md"))}
