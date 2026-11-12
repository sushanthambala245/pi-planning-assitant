import type {
  AgentRun,
  Analysis,
  ChangeType,
  DependencyRow,
  DepLevel,
  Finding,
  GraphEdge,
  GraphNode,
  Initiative,
  InitiativeRef,
  NotChecked,
  PathHop,
  Risk,
  Schedule,
  ScheduleRow,
  SequenceStep,
  Severity,
  SourceUsed,
  SystemItem,
  TShirt,
  Verdict,
} from '../types'

type Obj = Record<string, unknown>

const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v)
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])
const str = (v: unknown, fallback = ''): string => (typeof v === 'string' ? v : v == null ? fallback : String(v))
const strArr = (v: unknown): string[] => arr(v).map((x) => str(x)).filter(Boolean)
const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined)
const objs = (v: unknown): Obj[] => arr(v).map((x) => (isObj(x) ? x : {}))
const oneOf = <T extends string>(v: unknown, options: readonly T[], fallback: T): T =>
  (options as readonly string[]).includes(str(v)) ? (str(v) as T) : fallback

export const CHANGE_TYPES = ['code', 'flow', 'regression', 'none'] as const
const LEVELS = ['initiative', 'team', 'system'] as const
const VERDICTS = ['confirmed', 'stated_only', 'inferred_only'] as const
const HOPS = ['initiative', 'system', 'repo', 'team'] as const

const changeType = (v: unknown): ChangeType | undefined =>
  (CHANGE_TYPES as readonly string[]).includes(str(v)) ? (str(v) as ChangeType) : undefined

const sourceUsed = (v: unknown): SourceUsed => {
  if (typeof v === 'string') return { icon: 'ti-file-text', text: v }
  const o = isObj(v) ? v : {}
  return { icon: str(o.icon, 'ti-file-text'), text: str(o.text) }
}

const severity = (v: unknown): Severity => {
  const s = str(v).toLowerCase()
  return s === 'high' ? 'High' : s === 'low' ? 'Low' : 'Medium'
}

const system = (o: Obj): SystemItem => ({
  name: str(o.name),
  type: str(o.type, 'service'),
  team: str(o.team),
  teamName: str(o.teamName),
  access: str(o.access, 'unclear'),
  method: str(o.method),
  quote: str(o.quote),
})

const dependency = (o: Obj): DependencyRow => ({
  key: str(o.key, `${str(o.from)}->${str(o.to)}`),
  from: str(o.from),
  fromLabel: str(o.fromLabel, str(o.from)),
  to: str(o.to),
  toLabel: str(o.toLabel, str(o.to)),
  level: oneOf<DepLevel>(o.level, LEVELS, 'team'),
  toTeam: str(o.toTeam),
  changeType: changeType(o.changeType) ?? 'none',
  reason: str(o.reason),
  why: objs(o.why).map((w) => ({ method: str(w.method), changeType: changeType(w.changeType) ?? 'none', text: str(w.text) })),
  methods: strArr(o.methods),
  inferred: o.inferred === true,
  verdict: oneOf<Verdict>(o.verdict, VERDICTS, 'inferred_only'),
  alsoFoundAs: strArr(o.alsoFoundAs),
  path: objs(o.path).map<PathHop>((h) => ({ level: oneOf(h.level, HOPS, 'system'), id: str(h.id), label: str(h.label, str(h.id)) })),
  evidence: arr(o.evidence).map(sourceUsed),
  evidenceCount: num(o.evidenceCount) ?? arr(o.evidence).length,
  confidence: num(o.confidence),
  status: o.status ? str(o.status) : undefined,
  inJira: typeof o.inJira === 'boolean' ? o.inJira : null,
})

const SIZES = ['S', 'M', 'L', 'XL'] as const

function schedule(raw: unknown): Schedule | undefined {
  if (!isObj(raw)) return undefined
  const rows = objs(raw.rows)
    .map((o): ScheduleRow => {
      const start = Math.max(1, Math.round(num(o.start) ?? 1))
      return {
        initiativeId: str(o.initiativeId),
        team: str(o.team),
        size: oneOf<TShirt>(str(o.size).toUpperCase(), SIZES, 'S'),
        sizeSource: oneOf(o.sizeSource, ['size', 'points', 'default'] as const, 'size'),
        sprints: Math.max(1, Math.round(num(o.sprints) ?? 1)),
        start,
        end: Math.max(start, Math.round(num(o.end) ?? start)),
        spillsPastPi: o.spillsPastPi === true,
        waitsFor: strArr(o.waitsFor),
        critical: o.critical === true,
        inCycle: o.inCycle === true,
        targetedSprint: num(o.targetedSprint),
      }
    })
    .filter((r) => r.initiativeId)
  if (!rows.length) return undefined
  const sizeSprints: Record<string, number> = {}
  for (const [k, v] of Object.entries(isObj(raw.sizeSprints) ? raw.sizeSprints : {})) if (typeof v === 'number') sizeSprints[k] = v
  return {
    pi: str(raw.pi),
    piSprints: Math.max(1, Math.round(num(raw.piSprints) ?? 5)),
    sizeSprints,
    rows,
    criticalPath: strArr(raw.criticalPath),
    assumptions: strArr(raw.assumptions),
  }
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
      kind: str(o.kind, tag === 'sys' ? 'systems' : ''),
      text: str(o.text),
      note: o.note ? str(o.note) : undefined,
      highlight: o.highlight === true,
      agentId: o.agentId ? str(o.agentId) : undefined,
      initiativeIds: Array.isArray(o.initiativeIds) ? strArr(o.initiativeIds) : undefined,
      systems: Array.isArray(o.systems) ? objs(o.systems).map(system) : undefined,
      depKey: o.depKey ? str(o.depKey) : undefined,
      changeType: changeType(o.changeType),
    }
  })

  const graphRaw = isObj(raw.graph) ? raw.graph : {}
  const nodes: GraphNode[] = arr(graphRaw.nodes).map((n, i) => {
    const o = isObj(n) ? n : {}
    const id = str(o.id, `node-${i}`)
    return {
      id,
      label: str(o.label, id),
      domain: str(o.domain, 'Other'),
      kind: o.kind ? oneOf<DepLevel>(o.kind, LEVELS, 'initiative') : undefined,
      x: num(o.x),
      y: num(o.y),
    }
  })
  const edges: GraphEdge[] = arr(graphRaw.edges).map((e) => {
    const o = isObj(e) ? e : {}
    return {
      from: str(o.from),
      to: str(o.to),
      inferred: o.inferred === true,
      changeType: changeType(o.changeType),
      key: o.key ? str(o.key) : undefined,
    }
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
      initiativeIds: strArr(o.initiativeIds),
      rule: o.rule ? str(o.rule) : undefined,
      ruleCode: o.ruleCode ? str(o.ruleCode) : undefined,
    }
  })

  const summaryRaw = isObj(raw.summary) ? raw.summary : {}
  const notChecked: NotChecked[] = objs(raw.notChecked).map((o) => ({
    code: str(o.code),
    name: str(o.name, str(o.code)),
    reason: str(o.reason),
    partial: o.partial === true,
  })).filter((n) => n.code)

  const initiatives: InitiativeRef[] = objs(raw.initiatives).map((o) => ({
    id: str(o.id),
    title: str(o.title, str(o.id)),
    team: str(o.team),
    teamName: str(o.teamName, str(o.team)),
    art: str(o.art),
    pi: str(o.pi),
  })).filter((i) => i.id)

  const steps: SequenceStep[] = objs(raw.steps).map((o, i) => ({
    step: num(o.step) ?? i + 1,
    initiativeIds: strArr(o.initiativeIds),
    label: str(o.label),
    why: str(o.why),
    inCycle: o.inCycle === true,
  }))

  const analysis: Analysis = {
    agents,
    findings,
    sourcesUsed: arr(raw.sourcesUsed).map(sourceUsed),
    graph: { nodes, edges },
    risks,
    sequence: strArr(raw.sequence),
    keyRisk: raw.keyRisk ? str(raw.keyRisk) : undefined,
    initiatives,
    dependencies: objs(raw.dependencies).map(dependency),
    steps,
    summary: summaryRaw.text ? { text: str(summaryRaw.text), method: str(summaryRaw.method, 'template') } : undefined,
    notChecked,
    schedule: schedule(raw.schedule),
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
      team: o.team ? str(o.team) : undefined,
      pi: o.pi ? str(o.pi) : undefined,
      priority: o.priority ? str(o.priority) : undefined,
    }
  })
}
