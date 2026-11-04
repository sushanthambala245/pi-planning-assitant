"""Identity and authorisation, in code (considerations §1.5).

Locally there is no SSO gateway, so the UI sends `X-Demo-User: <id>` and the role comes
from the server-side roster below, never from the request. In a deployment, replace
`identity_from_request` with the identity forwarded by the gateway; the policy table
stays the same.
"""

from __future__ import annotations

import json
import os
from dataclasses import asdict, dataclass

from fastapi import Request


@dataclass(frozen=True)
class Identity:
    id: str
    name: str
    role: str


_DEFAULT_ROSTER = [
    Identity("rte.presenter", "Presenter", "RTE"),
    Identity("em.demo", "Demo Engineering Manager", "EM"),
    Identity("architect.demo", "Demo Architect", "Architect"),
    Identity("viewer.demo", "Demo Viewer", "Viewer"),
]
ANONYMOUS = Identity("anonymous", "Anonymous", "Viewer")

# (role, action) pairs that are allowed. Anything not listed is refused.
POLICY: set[tuple[str, str]] = {
    *((role, action) for role in ("RTE", "EM", "Architect") for action in ("approve", "challenge")),
    *((role, action) for role in ("RTE", "EM", "Architect", "Viewer") for action in ("run", "ask", "flag", "view")),
}


def _roster() -> dict[str, Identity]:
    raw = os.getenv("REVIEWERS_JSON")
    people = [Identity(**p) for p in json.loads(raw)] if raw else _DEFAULT_ROSTER
    return {p.id: p for p in people}


ROSTER = _roster()


def identity_from_request(request: Request) -> Identity:
    return ROSTER.get(request.headers.get("x-demo-user", ""), ANONYMOUS)


def allowed(identity: Identity, action: str) -> bool:
    return (identity.role, action) in POLICY


def roster_view() -> list[dict]:
    return [{**asdict(p), "can_approve": allowed(p, "approve")} for p in ROSTER.values()]
