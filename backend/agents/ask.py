"""Ask / Explain agent: the RAG chat in the reasoning drawer.

A real tool loop (the one part of the system that decides its own steps), so it gets
the full harness: input guardrail ladder -> tool loop with a model-call budget and a
per-tool budget -> output checks (no claimed actions, citations must be ids returned by
a tool in this conversation) -> a trace record per question in ask.jsonl.
"""

from __future__ import annotations

import json
from dataclasses import asdict, dataclass, field

from agents.runtime import Budget, BudgetExceeded, RunContext, now_iso
from agents.state import AgentState
from context.resolver import norm
from llm.adapter import LLMError, dumps_content
from llm.prompts import load_prompt
from tools.citations import audit_answer, strip_unknown_citations
from tools.guardrails import (
    action_claim_rule,
    injection_rule,
    is_decline_or_question,
    ladder,
    length_rule,
    make_scope_rule,
)
from tools.text_tools import render_documents

_TEXT_SOURCES = ["S1", "S2", "S3", "M1", "M3"]
_TABLE_SOURCES = ["S4", "S5", "S6", "S7", "S8", "M2"]
_KEYS = {"S4": "repo", "S6": "team", "S7": "service", "M2": "control_id"}

TOOLS = [
    {
        "name": "run_findings",
        "description": "Return this planning run's dependencies, risks and sequence steps that mention an entity "
                       "(initiative id or title, team, or service). Each line starts with its id in square brackets.",
        "input_schema": {"type": "object", "additionalProperties": False, "required": ["entity"],
                         "properties": {"entity": {"type": "string", "description": "Name or id to look for"}}},
        "strict": True,
    },
    {
        "name": "search_text",
        "description": "Keyword search over initiatives (S1), Jira epics (S2), dependency statements (S3), "
                       "Confluence pages (M1) and Slack messages (M3). Returns up to 6 documents with their ids. "
                       "Pass an empty sources list to search all of them.",
        "input_schema": {"type": "object", "additionalProperties": False, "required": ["query", "sources"],
                         "properties": {"query": {"type": "string"},
                                        "sources": {"type": "array", "items": {"type": "string", "enum": _TEXT_SOURCES}}}},
        "strict": True,
    },
    {
        "name": "lookup_record",
        "description": "Exact rows from a table matching a name or id: S4 repos, S5 team capacity, S6 team directory "
                       "(EM/PO/RTE), S7 service ownership, S8 historical PI outcomes, M2 controls. Up to 10 rows.",
        "input_schema": {"type": "object", "additionalProperties": False, "required": ["source", "value"],
                         "properties": {"source": {"type": "string", "enum": _TABLE_SOURCES},
                                        "value": {"type": "string"}}},
        "strict": True,
    },
    {
        "name": "graph_neighbours",
        "description": "What an initiative, team, service, repo or epic is connected to in the knowledge graph "
                       "(ownership, repo dependencies, epics, controls, Jira links), with the source of each edge.",
        "input_schema": {"type": "object", "additionalProperties": False, "required": ["entity"],
                         "properties": {"entity": {"type": "string"}}},
        "strict": True,
    },
]


@dataclass
class AskResult:
    status: str
    answer: str
    citations: list[dict] = field(default_factory=list)
    guardrail: dict | None = None
    tool_calls: list[dict] = field(default_factory=list)
    model_calls: int = 0

    def as_dict(self) -> dict:
        return asdict(self)


class AskTools:
    def __init__(self, ctx: RunContext, state: AgentState):
        self.ctx, self.state = ctx, state
        self.observed: set[str] = set()
        self.catalog: dict[str, dict] = {}  # ref -> {source, title, snippet} for the UI

    def _note(self, ref: str, source: str, title: str, snippet: str) -> None:
        self.observed.add(ref)
        self.catalog.setdefault(ref, {"ref": ref, "source": source, "title": title, "snippet": snippet[:300]})

    def run_findings(self, entity: str) -> str:
        e = norm(entity)
        titles = {i.id: i.title for i in self.state.initiatives}

        def hit(*names: str) -> bool:
            return any(e and (e in norm(n) or norm(n) in e) for n in names if n and len(norm(n)) >= 3)

        lines = []
        for d in self.state.deps:
            if hit(d.from_id, d.to_id, titles.get(d.from_id, ""), titles.get(d.to_id, ""), d.to_id.split(":")[-1]):
                ev = "; ".join(f"[{x.ref}] " + (f"“{x.quote[:160]}”" if x.quote else x.detail) for x in d.evidence[:3])
                lines.append(f"[{d.id}] {titles.get(d.from_id, d.from_id)} depends on {titles.get(d.to_id, d.to_id)} "
                             f"({d.kind}, {d.dep_type}, {d.status}, confidence {d.confidence:.2f}, in Jira: {d.in_jira}). "
                             f"Evidence: {ev}")
                self._note(d.id, "run", "dependency", lines[-1])
                for x in d.evidence[:3]:
                    self._note(x.ref, x.source, x.ref, x.quote or x.detail)
        for r in self.state.risks:
            if hit(r.title, *r.initiative_ids, *r.entities, *(titles.get(i, "") for i in r.initiative_ids)):
                lines.append(f"[{r.id}] {r.severity} {r.dri_code} {r.title}: {r.description}")
                self._note(r.id, "run", "risk", lines[-1])
        for s in self.state.sequence:
            if any(hit(i, titles.get(i, "")) for i in s.initiative_ids):
                names = ", ".join(titles.get(i, i) for i in s.initiative_ids)
                lines.append(f"Sequence step {s.step}: {names} — {s.why}")
        return "\n".join(lines) or f"No dependencies, risks or steps in this run mention {entity!r}."

    def search_text(self, query: str, sources: list[str]) -> str:
        srcs = tuple(s for s in sources if s in _TEXT_SOURCES) or tuple(_TEXT_SOURCES)
        hits = self.ctx.snapshot.index.search(query, k=6, sources=srcs)
        for h in hits:
            self._note(h.chunk.chunk_id, h.chunk.source, h.chunk.title, h.chunk.text)
        return render_documents([h.chunk for h in hits], self.ctx.snapshot.owner_of) if hits else "No matching documents."

    def lookup_record(self, source: str, value: str) -> str:
        rows = self.ctx.snapshot.store.lookup(source, value)
        out = []
        for row in rows:
            key = _KEYS.get(source)
            ref = f"{source}:{row[key]}" if key else f"{source}:{row.get('team')}@{row.get('pi')}"
            text = json.dumps({k: v for k, v in row.items() if not k.endswith("_raw")}, default=str)
            self._note(ref, source, ref, text)
            out.append(f"[{ref}] {text}")
        return "\n".join(out) or f"No {source} rows match {value!r}."

    def graph_neighbours(self, entity: str) -> str:
        kg = self.ctx.snapshot.kg
        r = self.ctx.snapshot.resolver
        candidates = [f"initiative:{r.initiative(entity).canonical}", f"team:{r.team(entity).canonical}",
                      f"service:{r.service(entity).canonical}", f"repo:{r.repo(entity).canonical}", f"epic:{entity}"]
        node_id = next((c for c in candidates if c in kg and not c.endswith(":None")), None)
        if node_id is None:
            return f"{entity!r} is not in the knowledge graph."
        lines = []
        for _, other, data in list(kg.out_edges(node_id, data=True))[:20]:
            lines.append(f"[{data['ref']}] {node_id} --{data['rel']}--> {other}")
            self._note(data["ref"], data["source"], data["ref"], lines[-1])
        for other, _, data in list(kg.in_edges(node_id, data=True))[:20]:
            lines.append(f"[{data['ref']}] {other} --{data['rel']}--> {node_id}")
            self._note(data["ref"], data["source"], data["ref"], lines[-1])
        return "\n".join(lines) or f"{node_id} has no edges."

    def run(self, name: str, args: dict) -> str:
        fn = {"run_findings": self.run_findings, "search_text": self.search_text,
              "lookup_record": self.lookup_record, "graph_neighbours": self.graph_neighbours}.get(name)
        if fn is None:
            raise ValueError(f"unknown tool {name!r}; expected one of run_findings, search_text, lookup_record, "
                             "graph_neighbours")
        return fn(**args)


def _focus_text(state: AgentState, focus: dict | None) -> str:
    if not focus:
        return ""
    fid = focus.get("id", "")
    for r in state.risks:
        if r.id == fid:
            return f"The user is looking at risk [{r.id}]: {r.title}. {r.description}"
    for d in state.deps:
        if d.id == fid:
            return f"The user is looking at dependency [{d.id}]: {d.from_id} depends on {d.to_id} ({d.kind})."
    for i in state.initiatives:
        if i.id == fid:
            return f"The user is looking at initiative {i.id}: {i.title}."
    return f"The user is looking at {fid}."


def _log(ctx: RunContext, record: dict) -> None:
    if ctx.run_dir:
        with (ctx.run_dir / "ask.jsonl").open("a", encoding="utf-8") as f:
            f.write(json.dumps(record, default=str) + "\n")


def ask(ctx: RunContext, state: AgentState, question: str, focus: dict | None = None) -> AskResult:
    record = {"ts": now_iso(), "question": question, "focus": focus}
    known = {i.title for i in state.initiatives} | set(ctx.snapshot.resolver.teams.names) | set(
        ctx.snapshot.resolver.services.names)
    verdict = ladder(question, [("length", length_rule), ("injection", injection_rule),
                                ("scope", make_scope_rule(known))])
    if not verdict.allowed:
        res = AskResult("blocked", "I can only help with questions about this PI-planning run.",
                        guardrail={"rung": verdict.rung, "reason": verdict.reason, "error": verdict.error})
        _log(ctx, {**record, "result": res.as_dict()})
        return res
    if not ctx.llm.enabled:
        res = AskResult("llm_unavailable", f"The Ask agent needs an LLM, which is disabled: {ctx.llm.status().reason}.")
        _log(ctx, {**record, "result": res.as_dict()})
        return res

    prompt = load_prompt("ask")
    tools = AskTools(ctx, state)
    budget = Budget(ctx.settings.ask_max_model_calls, ctx.settings.ask_max_calls_per_tool)
    focus_line = _focus_text(state, focus)
    messages: list = [{"role": "user", "content": f"{focus_line}\n\nQuestion: {question}".strip()}]
    calls: list[dict] = []
    final: str | None = None
    status = "ok"

    with ctx.tracer.span("agent.ask", **{"prompt.version": prompt.version}) as attrs:
        try:
            while True:
                budget.charge_model()
                turn = ctx.llm.tool_turn(system=prompt.text, messages=messages, tools=TOOLS,
                                         effort=ctx.settings.llm_effort_ask)
                attrs.setdefault("turns", []).append(turn.meta.span_attributes())
                messages.append({"role": "assistant", "content": turn.assistant_content})
                if turn.stop_reason == "pause_turn":
                    continue
                if turn.stop_reason != "tool_use" or not turn.tool_calls:
                    final = turn.text
                    break
                results = []
                for call in turn.tool_calls:
                    calls.append({"name": call["name"], "input": call["input"]})
                    try:
                        budget.charge_tool(call["name"])
                        content, is_error = tools.run(call["name"], call["input"]), False
                    except BudgetExceeded as exc:
                        content, is_error = f"{exc}. Answer with what you have.", True
                    except Exception as exc:  # tool errors go back to the model, marked as errors
                        content, is_error = f"Tool error: {type(exc).__name__}: {exc}", True
                    block = {"type": "tool_result", "tool_use_id": call["id"], "content": content}
                    if is_error:
                        block["is_error"] = True
                    results.append(block)
                messages.append({"role": "user", "content": results})
        except BudgetExceeded:
            status = "budget_exhausted"
            final = "I ran out of my step budget before finishing. Try a narrower question."
        except LLMError as exc:
            status = "blocked" if exc.kind == "blocked_upstream" else "error"
            final = f"The question could not be answered ({exc.kind})."
            attrs["error"] = str(exc)[:300]
        attrs["budget"] = budget.as_dict()
        attrs["status"] = status

    answer = (final or "").strip() or "No answer was produced."
    guard = None
    if status == "ok":
        claim = action_claim_rule(answer)
        if not claim.allowed:
            status, guard = "blocked", {"rung": "action_claim", "reason": claim.reason}
            answer = "I can't take actions such as updating Jira or approving the plan; I can only explain the analysis."
        else:
            audit = audit_answer(answer, tools.observed)
            if audit["unknown"]:
                answer = strip_unknown_citations(answer, audit["unknown"])
            if not audit["has_citations"] and not is_decline_or_question(answer):
                status = "ungrounded"
                guard = {"rung": "citation", "reason": "the answer cites no source returned in this conversation"}

    cited = [tools.catalog[c] for c in audit_answer(answer, tools.observed)["cited"] if c in tools.catalog]
    res = AskResult(status, answer, cited, guard, calls, budget.model_used)
    _log(ctx, {**record, "result": res.as_dict(), "messages": [
        {"role": m["role"], "content": dumps_content(m["content"]) if isinstance(m["content"], list) else m["content"]}
        for m in messages]})
    return res
