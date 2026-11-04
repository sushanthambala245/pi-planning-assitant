"""S10 baseline lookup ("is this dependency already linked in Jira?") and the exports.

Exports are proposals written to the run folder after human approval. Nothing is ever
written to Jira (the agent has no state-changing tool; considerations §4.1).
"""

from __future__ import annotations

import csv
import json
from pathlib import Path

from agents.state import AgentState, Dependency
from context.resolver import norm
from context.snapshot import ContextSnapshot


def jira_links(snapshot: ContextSnapshot) -> set[tuple[str, str]] | None:
    if not snapshot.has("S10"):
        return None
    df = snapshot.table("S10")
    return {(norm(a), norm(b)) for a, b in zip(df["from_key"], df["to_key"])}


def target_epics(snapshot: ContextSnapshot, dep: Dependency) -> set[str]:
    if dep.to_kind == "initiative":
        return snapshot.epic_keys_for(dep.to_id)
    if dep.to_kind == "team":
        return snapshot.epic_keys_for_team(dep.to_id.removeprefix("team:"))
    return set()


def in_jira(snapshot: ContextSnapshot, dep: Dependency, links: set[tuple[str, str]] | None) -> bool | None:
    """True if S10 links an epic of the dependent initiative with an epic of the target, in
    either direction; False if not; None if the S10 baseline is not loaded."""
    if links is None:
        return None
    a = {norm(k) for k in snapshot.epic_keys_for(dep.from_id)}
    b = {norm(k) for k in target_epics(snapshot, dep)}
    return any((x, y) in links or (y, x) in links for x in a for y in b)


def write_exports(run_dir: Path, state: AgentState, snapshot: ContextSnapshot, audit: dict) -> list[str]:
    out_dir = run_dir / "export"
    out_dir.mkdir(parents=True, exist_ok=True)
    titles = {i.id: i.title for i in state.initiatives}

    proposals = out_dir / "jira_link_proposals.csv"
    with proposals.open("w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["dependency_id", "dependent_initiative", "dependent_epic", "depends_on", "target_epic",
                    "proposed_link", "kind", "confidence", "verification", "evidence", "status"])
        for d in state.deps:
            if d.in_jira is True or d.status == "rejected":
                continue
            from_epic = sorted(snapshot.epic_keys_for(d.from_id))
            to_epic = sorted(target_epics(snapshot, d))
            w.writerow([d.id, titles.get(d.from_id, d.from_id), from_epic[0] if from_epic else "",
                        titles.get(d.to_id, d.to_id), to_epic[0] if to_epic else "", "is blocked by", d.kind,
                        f"{d.confidence:.2f}", d.status, " | ".join(e.ref for e in d.evidence),
                        "PROPOSED - create in Jira only after review"])

    note = out_dir / "sequence_note.md"
    lines = [f"# PI sequence note — run {state.run_id}", "",
             "Proposed by the PI Planning Assistant and approved by a reviewer. Not written to Jira.", ""]
    for a in state.approvals:
        lines.append(f"- {a.action} by {a.reviewer} ({a.role}) at {a.at}" + (f": {a.note}" if a.note else ""))
    lines += ["", "## Sequence", ""]
    for s in state.sequence:
        names = ", ".join(titles.get(i, i) for i in s.initiative_ids)
        lines.append(f"{s.step}. **{names}**{' (cycle)' if s.in_cycle else ''} — {s.why}")
    lines += ["", "## Risks", ""]
    for r in state.risks:
        lines.append(f"- [{r.severity.upper()}] {r.dri_code} {r.title}: {r.description}")
    if state.constraints:
        lines += ["", "## Reviewer constraints", ""]
        lines += [f"- {titles.get(c.first, c.first)} before {titles.get(c.then, c.then)}" + (f" — {c.note}" if c.note else "")
                  for c in state.constraints]
    note.write_text("\n".join(lines) + "\n", encoding="utf-8")

    audit_path = out_dir / "audit.json"
    audit_path.write_text(json.dumps(audit, indent=2, default=str), encoding="utf-8")
    return [proposals.name, note.name, audit_path.name]
