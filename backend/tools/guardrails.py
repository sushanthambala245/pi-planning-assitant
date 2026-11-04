"""Guardrails for the Ask chat, as plain `check(text) -> Verdict` functions in a ladder
(considerations §4.6): cheapest first, stop at the first block, every rung fails closed.

Input rungs: length, prompt-injection rules, scope. Output rungs: claims of actions the
assistant cannot take, and citation grounding. Blocked inputs are logged by the caller
so false positives can be measured on benign traffic.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Callable

GUARDRAIL_VERSION = "ask-guardrails-v1"
MAX_QUESTION_CHARS = 2000


@dataclass
class Verdict:
    allowed: bool
    rung: str | None = None
    reason: str = ""
    error: str | None = None
    info: dict = field(default_factory=dict)


Check = Callable[[str], Verdict]


def fail_closed(name: str, check: Check) -> Check:
    def guarded(text: str) -> Verdict:
        try:
            v = check(text)
            v.rung = v.rung or name
            return v
        except Exception as exc:  # an erroring rung is a block, and the error travels with it
            return Verdict(False, name, "guardrail error", f"{type(exc).__name__}: {exc}")
    return guarded


def ladder(text: str, rungs: list[tuple[str, Check]]) -> Verdict:
    for name, check in rungs:
        v = fail_closed(name, check)(text)
        if not v.allowed:
            return v
    return Verdict(True)


# -- input rungs -----------------------------------------------------------------------------------

def length_rule(text: str) -> Verdict:
    if not text.strip():
        return Verdict(False, reason="empty question")
    if len(text) > MAX_QUESTION_CHARS:
        return Verdict(False, reason=f"question longer than {MAX_QUESTION_CHARS} characters")
    return Verdict(True)


_INJECTION = [
    (r"\b(ignore|disregard|forget|override)\b.{0,40}\b(previous|prior|above|earlier|all|your|system)\b.{0,20}\b(instructions?|rules?|prompts?|messages?)\b",
     "instruction override"),
    (r"\b(reveal|print|show|repeat|output|tell me|what (is|are))\b.{0,30}\b(system prompt|hidden (prompt|instructions)|your (instructions|rules|prompt))\b",
     "prompt extraction"),
    (r"\byou are (now|no longer)\b|\bact as (an?|the) (unfiltered|unrestricted|jailbroken)\b|\bdeveloper mode\b|\bDAN\b",
     "role override"),
    (r"\b(without|bypass|skip|disable)\b.{0,20}\b(guardrails?|safety|restrictions?|filters?|citations?)\b",
     "constraint bypass"),
]


def injection_rule(text: str) -> Verdict:
    for pattern, label in _INJECTION:
        if re.search(pattern, text, re.I | re.S):
            return Verdict(False, reason=f"possible prompt injection ({label})", info={"pattern": label})
    return Verdict(True)


_OFF_TOPIC = re.compile(
    r"\b(recipe|weather|horoscope|lottery|poem|song lyrics|stock tip|crypto|dating|joke|write (me )?(a|an) (essay|story))\b",
    re.I)
_DOMAIN = re.compile(
    r"\b(pi|program increment|initiative|epic|dependenc\w*|depend\w*|risk|sequence|sequencing|capacity|team|owner\w*|"
    r"service|api|repo\w*|release|train|rte|art|blocker|blocked|control|sign-?off|jira|confluence|slack|schema|"
    r"plan\w*|deliver\w*|commit\w*|backlog|what if|who|why|order|first|before|after|apart)\b",
    re.I)


def make_scope_rule(known_names: set[str]) -> Check:
    lowered = {n.lower() for n in known_names if len(n) >= 4}

    def scope_rule(text: str) -> Verdict:
        if _OFF_TOPIC.search(text):
            return Verdict(False, reason="outside PI planning")
        t = text.lower()
        if _DOMAIN.search(text) or any(n in t for n in lowered):
            return Verdict(True)
        return Verdict(False, reason="does not look like a PI-planning question")

    return scope_rule


# -- output rungs ----------------------------------------------------------------------------------

_ACTION_CLAIMS = re.compile(
    r"\bI(?:'ve| have)? (?:created|added|updated|linked|written|posted|sent|notified|approved|committed|assigned|"
    r"changed|modified|filed|raised|scheduled|booked|reset)\b|\b(?:has|have) been (?:created|linked|updated|"
    r"approved|notified|assigned) (?:in|on|to) (?:jira|confluence|slack)\b",
    re.I)


def action_claim_rule(text: str) -> Verdict:
    m = _ACTION_CLAIMS.search(text)
    if m:
        return Verdict(False, reason=f"claims an action the assistant cannot take: {m.group(0)!r}")
    return Verdict(True)


_DECLINE = re.compile(r"\b(sources? (do|does) not say|not (in|covered by) the sources|i (can't|cannot) help with|"
                      r"outside (the scope|pi planning)|could you (clarify|tell me)|which (initiative|pi|team))\b", re.I)


def is_decline_or_question(text: str) -> bool:
    return bool(_DECLINE.search(text)) or text.strip().endswith("?")
