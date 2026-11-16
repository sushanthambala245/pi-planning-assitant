"""The supervisor: a LangGraph state machine over AgentState.

The graph owns the order of steps; agents decide inside their node (considerations
§4.5). Routing is deterministic code, not a model: fan-out to four discovery tools,
a critic loop with at most MAX_REQUERY_ROUNDS re-queries, and a human gate that either
approves (export) or adds a constraint and re-runs sequencing and risk.
"""

from __future__ import annotations

from langgraph.checkpoint.memory import InMemorySaver
from langgraph.checkpoint.serde.jsonplus import JsonPlusSerializer
from langgraph.graph import END, START, StateGraph

from agents.analyser import analyse
from agents.discovery import code_deps, declared_deps, explicit_deps, ownership_deps
from agents.review import export, human_gate, load_context, route_after_review
from agents.risk import risk
from agents.sequencing import sequencing
from agents import state as state_models
from agents.state import AgentState
from agents.verifier import merge, requery, route_after_verify, verify
from agents.visualisation import visualise

PIPELINE_NODES = ["load_context", "analyser", "declared_deps", "explicit_deps", "code_deps", "ownership_deps", "merge",
                  "verify", "requery", "sequencing", "risk", "visualisation", "human_gate", "export"]
DISCOVERY = ("declared_deps", "explicit_deps", "code_deps", "ownership_deps")


def build_graph(checkpointer=None):
    g = StateGraph(AgentState)
    g.add_node("load_context", load_context)
    g.add_node("analyser", analyse)
    g.add_node("declared_deps", declared_deps)
    g.add_node("explicit_deps", explicit_deps)
    g.add_node("code_deps", code_deps)
    g.add_node("ownership_deps", ownership_deps)
    g.add_node("merge", merge)
    g.add_node("verify", verify)
    g.add_node("requery", requery)
    g.add_node("sequencing", sequencing)
    g.add_node("risk", risk)
    g.add_node("visualisation", visualise)
    g.add_node("human_gate", human_gate)
    g.add_node("export", export)

    g.add_edge(START, "load_context")
    g.add_edge("load_context", "analyser")
    for tool in DISCOVERY:  # parallel fan-out
        g.add_edge("analyser", tool)
    g.add_edge(list(DISCOVERY), "merge")  # join
    g.add_edge("merge", "verify")
    g.add_conditional_edges("verify", route_after_verify, {"requery": "requery", "sequencing": "sequencing"})
    g.add_edge("requery", "verify")
    g.add_edge("sequencing", "risk")
    g.add_edge("risk", "visualisation")
    g.add_edge("visualisation", "human_gate")
    g.add_conditional_edges("human_gate", route_after_review, {"export": "export", "sequencing": "sequencing"})
    g.add_edge("export", END)
    return g.compile(checkpointer=checkpointer or InMemorySaver(serde=serializer()))


def serializer() -> JsonPlusSerializer:
    """Allow-list exactly our state record types for checkpoint deserialisation."""
    models = ["AgentState", "Initiative", "SystemTouch", "Dependency", "EvidenceRef", "SequenceStep",
              "CapacityLine", "Risk", "Constraint", "Approval", "PlannerInput", "ScheduleItem", "PlanConflict"]
    assert all(hasattr(state_models, m) for m in models)
    return JsonPlusSerializer(allowed_msgpack_modules=[("agents.state", m) for m in models])
