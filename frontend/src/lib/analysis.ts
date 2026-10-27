import type {
  AgentRun,
  Analysis,
  Finding,
  GraphEdge,
  GraphNode,
  Initiative,
  Risk,
  Severity,
  SourceUsed,
} from '../types'

type Obj = Record<string, unknown>

const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v)
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])
const str = (v: unknown, fallback = ''): string => (typeof v === 'string' ? v : v == null ? fallback : String(v))
const strArr = (v: unknown): string[] => arr(v).map((x) => str(x)).filter(Boolean)
const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined)

const sourceUsed = (v: unknown): SourceUsed => {
  if (typeof v === 'string') return { icon: 'ti-file-text', text: v }
  const o = isObj(v) ? v : {}
  return { icon: str(o.icon, 'ti-file-text'), text: str(o.text) }
}

const severity = (v: unknown): Severity => {
  const s = str(v).toLowerCase()
  return s === 'high' ? 'High' : s === 'low' ? 'Low' : 'Medium'
}

/** Turns loosely-shaped JSON into a well-formed Analysis; throws if nothing recognisable is present. */
export function normalizeAnalysis(raw: unknown): Analysis {
  if (!isObj(raw)) throw new Error('Analysis must be a JSON object')

  const agents: AgentRun[] = arr(raw.agents).map((a, i) => {
    const o = isObj(a) ? a : {}
    return {
      id: str(o.id, `agent-${i}`),
      name: str(o.name, `Agent ${i + 1}`),
      icon: str(o.icon, 'ti-cpu'),
      summary: str(o.summary),
      durationMs: num(o.durationMs),
      inputs: strArr(o.inputs),
      outputs: strArr(o.outputs),
      notes: strArr(o.notes),
    }
  })

  const findings: Finding[] = arr(raw.findings).map((f) => {
    const o = isObj(f) ? f : {}
    const tag = o.tag === 'sys' ? 'sys' : 'dep'
    return {
      tag,
      tagLabel: str(o.tagLabel, tag === 'sys' ? 'Systems found' : 'Dependency'),
      text: str(o.text),
      note: o.note ? str(o.note) : undefined,
      highlight: o.highlight === true,
      agentId: o.agentId ? str(o.agentId) : undefined,
    }
  })

  const graphRaw = isObj(raw.graph) ? raw.graph : {}
  const nodes: GraphNode[] = arr(graphRaw.nodes).map((n, i) => {
    const o = isObj(n) ? n : {}
    const id = str(o.id, `node-${i}`)
    return { id, label: str(o.label, id), domain: str(o.domain, 'Other'), x: num(o.x), y: num(o.y) }
  })
  const edges: GraphEdge[] = arr(graphRaw.edges).map((e) => {
    const o = isObj(e) ? e : {}
    return { from: str(o.from), to: str(o.to), inferred: o.inferred === true }
  })

  const risks: Risk[] = arr(raw.risks).map((r, i) => {
    const o = isObj(r) ? r : {}
    return {
      id: str(o.id, `risk-${i}`),
      title: str(o.title, 'Untitled risk'),
      description: str(o.description),
      severity: severity(o.severity),
      reasoning: strArr(o.reasoning),
      affected: arr(o.affected).map((a) => {
        const ao = isObj(a) ? a : {}
        return { domain: str(ao.domain, 'Other'), text: str(ao.text) }
      }),
      sources: arr(o.sources).map(sourceUsed),
      suggestedPrompts: strArr(o.suggestedPrompts),
      highlightNodes: strArr(o.highlightNodes),
    }
  })

  const analysis: Analysis = {
    agents,
    findings,
    sourcesUsed: arr(raw.sourcesUsed).map(sourceUsed),
    graph: { nodes, edges },
    risks,
    sequence: strArr(raw.sequence),
    keyRisk: raw.keyRisk ? str(raw.keyRisk) : undefined,
  }

  if (!agents.length && !findings.length && !nodes.length && !risks.length && !analysis.sequence.length) {
    throw new Error('No recognisable analysis fields (agents, findings, graph, risks, sequence)')
  }
  return analysis
}

export function normalizeInitiatives(raw: unknown): Initiative[] {
  return arr(raw).map((v, i) => {
    const o = isObj(v) ? v : {}
    return {
      id: str(o.id, `json-${i}`),
      title: str(o.title ?? o.name, 'Untitled initiative'),
      description: str(o.description),
      meta: o.meta ? str(o.meta) : undefined,
    }
  })
}
