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
  Impact,
  NotChecked,
  PathHop,
  Plan,
  PlanItem,
  PlanTeam,
  Provenance,
  Readiness,
  Risk,
  SequenceStep,
  Severity,
  SourceUsed,
  SystemItem,
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
const PROVENANCES = ['declared', 'planner', 'stated', 'inferred'] as const
const IMPACTS = ['orders', 'soft', 'coordinate', 'retest', 'aware'] as const
const numOr = (v: unknown, fallback: number): number => num(v) ?? fallback
const numOrNull = (v: unknown): number | null => num(v) ?? null
const numMap = (v: unknown): Record<string, number> =>
  Object.fromEntries(Object.entries(isObj(v) ? v : {}).filter(([, x]) => num(x) !== undefined).map(([k, x]) => [k, x as number]))
const impact = (v: unknown): Impact | undefined => ((IMPACTS as readonly string[]).includes(str(v)) ? (str(v) as Impact) : undefined)

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
  provenance: (PROVENANCES as readonly string[]).includes(str(o.provenance)) ? (str(o.provenance) as Provenance) : undefined,
  declared: typeof o.declared === 'boolean' ? o.declared : undefined,
  impact: impact(o.impact),
  depTypes: strArr(o.depTypes),
  note: o.note ? str(o.note) : undefined,
  decision: o.decision === 'confirmed' || o.decision === 'dismissed' ? o.decision : '',
})

const planItem = (o: Obj): PlanItem => ({
  id: str(o.id),
  title: str(o.title, str(o.id)),
  team: str(o.team),
  teamName: str(o.teamName, str(o.team)),
  art: str(o.art, 'Other'),
  priority: str(o.priority),
  type: str(o.type),
  outcome: str(o.outcome),
  status: str(o.status),
  description: str(o.description),
  size: o.size ? str(o.size) : null,
  points: numOr(o.points, 0),
  sizeSource: oneOf(o.sizeSource, ['tshirt', 'planner', 'estimate', 'assumed', 'none'] as const, 'none'),
  sizeOverride: str(o.sizeOverride),
  dataSize: str(o.dataSize),
  targetQuarter: str(o.targetQuarter, str(o.plannedPi)),
  targetSource: oneOf(o.targetSource, ['data', 'planner', 'sprint', 'none'] as const, 'data'),
  quarterOverride: str(o.quarterOverride),
  deadline: numOrNull(o.deadline),
  spills: o.spills === true,
  plannedSprint: str(o.plannedSprint),
  plannedIndex: numOrNull(o.plannedIndex),
  plannedFinish: numOrNull(o.plannedFinish),
  plannedLabel: str(o.plannedLabel),
  plannedPi: str(o.plannedPi),
  start: numOr(o.start, 0),
  finish: numOr(o.finish, numOr(o.start, 0)),
  startLabel: str(o.startLabel),
  finishLabel: str(o.finishLabel),
  pi: str(o.pi),
  finishPi: str(o.finishPi, str(o.pi)),
  movedBy: numOrNull(o.movedBy),
  reasons: strArr(o.reasons),
  waitsFor: strArr(o.waitsFor),
  inCycle: o.inCycle === true,
  capacityKnown: o.capacityKnown !== false,
  allocation: numMap(o.allocation),
  declaredUpstream: strArr(o.declaredUpstream),
  declaredDownstream: strArr(o.declaredDownstream),
  note: str(o.note),
  declaredLinks: numOr(o.declaredLinks, 0),
  hiddenLinks: numOr(o.hiddenLinks, 0),
})

const planTeam = (o: Obj): PlanTeam => ({
  id: str(o.id),
  name: str(o.name, str(o.id)),
  art: str(o.art, 'Other'),
  average: numOr(o.average, 0),
  median: numOr(o.median, 0),
  quarterCapacity: numOr(o.quarterCapacity, 0),
  tier: o.tier ? str(o.tier) : null,
  known: o.known !== false,
  perSprint: arr(o.perSprint).map((x) => num(x) ?? 0),
  capacityByPi: numMap(o.capacityByPi),
  plannedByPi: numMap(o.plannedByPi),
  scheduledByPi: numMap(o.scheduledByPi),
  initiativeIds: strArr(o.initiativeIds),
  asks: numMap(o.asks),
})

function plan(raw: unknown): Plan | undefined {
  if (!isObj(raw)) return undefined
  const c = isObj(raw.counts) ? raw.counts : {}
  const p = isObj(raw.planner) ? raw.planner : {}
  return {
    sprints: objs(raw.sprints).map((o, i) => ({ index: numOr(o.index, i), name: str(o.name), short: str(o.short, str(o.name)), pi: str(o.pi), assumed: o.assumed === true })),
    pis: objs(raw.pis).map((o) => ({ id: str(o.id), assumed: o.assumed === true, sprints: arr(o.sprints).map((x) => num(x) ?? 0), quarter: o.quarter === true })),
    items: objs(raw.items).map(planItem).filter((i) => i.id),
    teams: objs(raw.teams).map(planTeam).filter((t) => t.id),
    conflicts: objs(raw.conflicts).map((o) => ({
      provider: str(o.provider), consumer: str(o.consumer), providerLabel: str(o.providerLabel, str(o.provider)),
      kind: oneOf(o.kind, ['later_quarter', 'too_tight', 'sprint'] as const, 'sprint'),
      providerQuarter: str(o.providerQuarter), consumerQuarter: str(o.consumerQuarter),
      consumerFinishLabel: str(o.consumerFinishLabel),
      consumerLabel: str(o.consumerLabel, str(o.consumer)), providerFinish: numOr(o.providerFinish, 0),
      consumerStart: numOr(o.consumerStart, 0), providerFinishLabel: str(o.providerFinishLabel),
      consumerStartLabel: str(o.consumerStartLabel), declared: o.declared === true, depKey: str(o.depKey),
      recommendedStart: str(o.recommendedStart),
    })),
    counts: {
      declared: numOr(c.declared, 0), declaredByRole: numMap(c.declaredByRole), hidden: numOr(c.hidden, 0),
      hiddenShare: numOr(c.hiddenShare, 0), hiddenByProvenance: numMap(c.hiddenByProvenance),
      hiddenByMethod: numMap(c.hiddenByMethod), hiddenByImpact: numMap(c.hiddenByImpact),
      hiddenByLevel: numMap(c.hiddenByLevel), hiddenNeedChange: numOr(c.hiddenNeedChange, 0),
      ordering: numOr(c.ordering, 0), orderingHidden: numOr(c.orderingHidden, 0), softLate: numOr(c.softLate, 0),
      conflicts: numOr(c.conflicts, 0), conflictsHidden: numOr(c.conflictsHidden, 0),
      conflictsLaterQuarter: numOr(c.conflictsLaterQuarter, 0), conflictsTight: numOr(c.conflictsTight, 0),
      moved: numOr(c.moved, 0), laterQuarter: numOr(c.laterQuarter, 0), spill: numOr(c.spill, 0),
      teamsOver: numOr(c.teamsOver, 0), teamQuartersOver: numOr(c.teamQuartersOver, 0), noSize: numOr(c.noSize, 0),
      steps: numOr(c.steps, 0), cycles: numOr(c.cycles, 0),
    },
    links: objs(raw.links).map((o) => ({
      provider: str(o.provider), consumer: str(o.consumer), strength: oneOf(o.strength, ['orders', 'soft'] as const, 'orders'),
      declared: o.declared === true, depKeys: strArr(o.depKeys), reason: str(o.reason),
    })).filter((l) => l.provider && l.consumer),
    realSprints: numOr(raw.realSprints, 0),
    sprintsPerPi: numOr(raw.sprintsPerPi, 5),
    horizon: strArr(raw.horizon),
    tshirt: objs(raw.tshirt).map((o) => ({ size: str(o.size), points: numOr(o.points, 0) })),
    defaultSize: str(raw.defaultSize, 'M'),
    velocityTiers: objs(raw.velocityTiers).map((o) => ({ tier: str(o.tier), upTo: numOrNull(o.upTo) })),
    planner: { initiativeNotes: numOr(p.initiativeNotes, 0), sizes: numOr(p.sizes, 0), quarters: numOr(p.quarters, 0), dependencyNotes: numOr(p.dependencyNotes, 0), decisions: numMap(p.decisions) },
  }
}

function readiness(raw: unknown): Readiness | undefined {
  if (!isObj(raw)) return undefined
  return {
    total: numOr(raw.total, 0),
    ready: numOr(raw.ready, 0),
    analysed: numOr(raw.analysed, 0),
    readyStatuses: strArr(raw.readyStatuses),
    byStatus: numMap(raw.byStatus),
    excluded: objs(raw.excluded).map((o) => ({ id: str(o.id), title: str(o.title, str(o.id)), status: str(o.status), team: str(o.team), teamName: str(o.teamName, str(o.team)), pi: str(o.pi) })),
    readyNotAnalysed: strArr(raw.readyNotAnalysed),
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
      declared: typeof o.declared === 'boolean' ? o.declared : undefined,
      impact: impact(o.impact),
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
    priority: o.priority ? str(o.priority) : undefined,
    status: o.status ? str(o.status) : undefined,
    size: o.size ? str(o.size) : undefined,
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
    readiness: readiness(raw.readiness),
    plan: plan(raw.plan),
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
      status: o.status ? str(o.status) : undefined,
      ready: typeof o.ready === 'boolean' ? o.ready : undefined,
      size: o.size ? str(o.size) : undefined,
      teamName: o.teamName ? str(o.teamName) : undefined,
      art: o.art ? str(o.art) : undefined,
      outcome: o.outcome ? str(o.outcome) : undefined,
      dependencyText: o.dependencyText ? str(o.dependencyText) : undefined,
    }
  })
}
