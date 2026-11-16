"""Deterministic planning algorithms. The LLM explains these results; it never decides them.

Edge direction in the initiative graph: provider -> consumer. If A depends on B, the
edge is B -> A, so a topological order lists B first.
"""

from __future__ import annotations

from collections import defaultdict

import networkx as nx

from agents.state import Constraint, Dependency, Initiative, Risk, SystemTouch
from context.snapshot import ContextSnapshot

ORDERING_STATUSES = ("verified", "low_confidence")
# Kinds whose directed links change the order of the work. Code and shared-library links are
# directional but soft: they say who should re-test or adapt after whom, not who must wait.
ORDERING_KINDS = ("declared", "explicit", "ownership", "constraint")


def orders(d: Dependency) -> bool:
    """True if the link puts its target before its dependent in the plan."""
    return (d.to_kind == "initiative" and d.directed and d.kind in ORDERING_KINDS
            and d.status in ORDERING_STATUSES)


def build_initiative_graph(initiatives: list[Initiative], deps: list[Dependency],
                           constraints: list[Constraint]) -> nx.DiGraph:
    g = nx.DiGraph()
    ids = {i.id for i in initiatives}
    for i in initiatives:
        g.add_node(i.id, title=i.title, team=i.owning_team)
    for d in deps:
        if not orders(d):
            continue
        if d.from_id not in ids or d.to_id not in ids or d.from_id == d.to_id:
            continue
        if g.has_edge(d.to_id, d.from_id):
            g[d.to_id][d.from_id]["dep_ids"].append(d.id)
        else:
            g.add_edge(d.to_id, d.from_id, dep_ids=[d.id])
    for c in constraints:
        if c.first in ids and c.then in ids and c.first != c.then:
            if g.has_edge(c.first, c.then):
                g[c.first][c.then].setdefault("constraint", True)
            else:
                g.add_edge(c.first, c.then, dep_ids=[], constraint=True)
    return g


def find_cycles(g: nx.DiGraph, limit: int = 20) -> list[list[str]]:
    """Strongly connected components with more than one node, each as a sorted id list."""
    return [sorted(scc) for scc in nx.strongly_connected_components(g) if len(scc) > 1][:limit]


def sequence_steps(g: nx.DiGraph) -> list[dict]:
    """Topological generations over the condensation; a cycle collapses into one step."""
    cond = nx.condensation(g)
    steps = []
    for n, generation in enumerate(nx.topological_generations(cond), 1):
        members = sorted(m for c in generation for m in cond.nodes[c]["members"])
        in_cycle = any(len(cond.nodes[c]["members"]) > 1 for c in generation)
        chain = sorted({dep for m in members for _, _, data in g.in_edges(m, data=True) for dep in data["dep_ids"]})
        constrained = any(data.get("constraint") for m in members for _, _, data in g.in_edges(m, data=True))
        steps.append({"step": n, "initiative_ids": members, "chain": chain, "in_cycle": in_cycle,
                      "constrained": constrained})
    return steps


def to_cytoscape(initiatives: list[Initiative], deps: list[Dependency], systems: list[SystemTouch],
                 risks: list[Risk], snapshot: ContextSnapshot) -> dict:
    """Graph JSON for the UI. Edge classes separate documented (in Jira) from inferred."""
    nodes: dict[str, dict] = {}
    risk_by_entity: dict[str, list[str]] = defaultdict(list)
    for r in risks:
        for e in r.initiative_ids + r.entities:
            risk_by_entity[e].append(r.id)

    def art_of(team: str) -> str:
        row = snapshot.team_row(team) if team else None
        return (row or {}).get("art") or ""

    for i in initiatives:
        nodes[i.id] = {"data": {"id": i.id, "label": i.title, "kind": "initiative", "team": i.owning_team,
                                "group": art_of(i.owning_team) or i.owning_team, "target_pi": i.target_pi,
                                "risk_ids": risk_by_entity.get(i.id, [])}}

    def ensure(node_id: str, label: str, kind: str, team: str = ""):
        if node_id not in nodes:
            nodes[node_id] = {"data": {"id": node_id, "label": label, "kind": kind, "team": team,
                                       "group": art_of(team) or team or kind,
                                       "risk_ids": risk_by_entity.get(label, [])}}

    edges = []
    for d in deps:
        if d.status == "rejected":
            continue
        if d.to_kind == "initiative" and d.to_id not in nodes:
            ensure(d.to_id, d.to_id, "external_initiative")
        elif d.to_kind == "team":
            name = d.to_id.removeprefix("team:")
            ensure(d.to_id, name, "team", name)
        elif d.to_kind == "service":
            name = d.to_id.removeprefix("service:")
            row = snapshot.service_row(name) or {}
            ensure(d.to_id, name, "service", row.get("owner_team", ""))
        documented = d.in_jira is True
        # Arrow reads "depends on": dependent initiative -> what it waits for.
        edges.append({"data": {"id": d.id, "source": d.from_id, "target": d.to_id, "kind": d.kind,
                               "dep_type": d.dep_type, "confidence": round(d.confidence, 2), "status": d.status,
                               "in_jira": d.in_jira, "directed": d.directed, "method": d.method},
                      "classes": " ".join([d.kind, "documented" if documented else "inferred", d.status])})

    touched: dict[str, set[str]] = defaultdict(set)
    for s in systems:
        touched[s.system].add(s.initiative_id)
    for service, ini_ids in touched.items():
        if len(ini_ids) < 2:
            continue
        sid = f"service:{service}"
        row = snapshot.service_row(service) or {}
        ensure(sid, service, "service", row.get("owner_team", ""))
        for iid in sorted(ini_ids):
            edges.append({"data": {"id": f"touch-{iid}-{service}", "source": iid, "target": sid, "kind": "touches"},
                          "classes": "touches"})
    return {"nodes": list(nodes.values()), "edges": edges}
