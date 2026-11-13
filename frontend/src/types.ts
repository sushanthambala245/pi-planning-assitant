export type Screen = 'intake' | 'pipeline' | 'results' | 'dashboard'

export interface Initiative {
  id: string
  title: string
  description: string
  meta?: string
  /** Shown as filters on the Intake screen when present. */
  team?: string
  pi?: string
  priority?: string
  /** S1 status; only "Ready for PI Planning" initiatives can be analysed. */
  status?: string
  ready?: boolean
  teamName?: string
  /** T-shirt size (S1 "T-Shirt Sizing": S / M / L / XL); empty when the data has none. */
  size?: string
  /** Story points and a planned sprint, when an older export has them. */
  points?: number
  plannedSprint?: string
  /** ART (agile release train) and the business outcome, from S1. */
  art?: string
  outcome?: string
  /** The user-defined dependency list, e.g. "Upstream: A, B; Downstream: C". */
  dependencyText?: string
}

export type KbKind = 'conf' | 'arch' | 'team' | 'inv'

export type SourceStatus = 'ready' | 'partial' | 'invalid' | 'missing' | 'off'

export interface KnowledgeSource {
  id: string
  kind: KbKind
  icon: string
  name: string
  meta: string
  /** From the backend's source report; uploaded files are always ready. */
  status?: SourceStatus
}

export interface AgentRun {
  id: string
  name: string
  icon: string
  summary: string
  durationMs?: number
  inputs: string[]
  outputs: string[]
  notes: string[]
}

export type AgentState = 'done' | 'active' | 'wait' | 'failed'

/** What a dependency asks of people: change code, agree a flow / contract, re-test, or nothing. */
export type ChangeType = 'code' | 'flow' | 'regression' | 'none'
/** What a dependency is on. */
export type DepLevel = 'initiative' | 'team' | 'system'
/** Whether stated and inferred evidence agree on a dependency. */
export type Verdict = 'confirmed' | 'stated_only' | 'inferred_only'
/**
 * Where a dependency comes from. declared: the initiative's own dependency list; planner: a planner's
 * note or confirmation. stated: written in the description but not declared; inferred: found in GitHub,
 * the ownership lookup or shared systems. The last two are the hidden dependencies.
 */
export type Provenance = 'declared' | 'planner' | 'stated' | 'inferred'
/** What a link does to the plan: orders it, should go first (soft), needs coordination, a re-test, or nothing. */
export type Impact = 'orders' | 'soft' | 'coordinate' | 'retest' | 'aware'
export type Decision = '' | 'confirmed' | 'dismissed'

export interface SystemItem {
  name: string
  /** service, api, dataset or capability (from the service catalogue). */
  type: string
  team: string
  teamName: string
  /** changes, writes, reads or unclear. */
  access: string
  method: string
  quote: string
}

export interface Finding {
  tag: 'sys' | 'dep'
  tagLabel: string
  /** The agent's own tag: systems, explicit, inferred, rejected, sequence, risk. */
  kind: string
  text: string
  note?: string
  highlight?: boolean
  agentId?: string
  /** Initiatives the finding is about; empty means it spans the run, absent means not recorded (older files). */
  initiativeIds?: string[]
  /** For a systems finding: each system, typed, with its owning team. */
  systems?: SystemItem[]
  /** For a dependency finding: the `key` of its row in `Analysis.dependencies`. */
  depKey?: string
  changeType?: ChangeType
}

export interface SourceUsed {
  icon: string
  text: string
}

export interface GraphNode {
  id: string
  label: string
  domain: string
  kind?: DepLevel
  x?: number
  y?: number
}

export interface GraphEdge {
  from: string
  to: string
  inferred: boolean
  changeType?: ChangeType
  key?: string
  declared?: boolean
  impact?: Impact
}

export type Severity = 'High' | 'Medium' | 'Low'

export interface Risk {
  id: string
  title: string
  description: string
  severity: Severity
  reasoning: string[]
  affected: { domain: string; text: string }[]
  sources: SourceUsed[]
  suggestedPrompts: string[]
  highlightNodes: string[]
  initiativeIds: string[]
  /** The rule that raised it, e.g. "No owner for a shared service" (DRI-X-002). */
  rule?: string
  ruleCode?: string
}

/** A risk check that did not run (a source is missing) or ran on partial data. */
export interface NotChecked {
  code: string
  name: string
  reason: string
  partial: boolean
}

export interface PathHop {
  level: 'initiative' | 'system' | 'repo' | 'team'
  id: string
  label: string
}

/** One dependency between an initiative and its target, as drawn in the graph. */
export interface DependencyRow {
  key: string
  from: string
  fromLabel: string
  to: string
  toLabel: string
  level: DepLevel
  /** The team the dependency lands on, when it is not the target itself. */
  toTeam: string
  changeType: ChangeType
  reason: string
  /** One explanation per method that found it. */
  why: { method: string; changeType: ChangeType; text: string }[]
  /** explicit (stated in text), code (repo manifests), ownership (ownership map). */
  methods: string[]
  inferred: boolean
  verdict: Verdict
  /** Keys of other rows from the same initiative that land on the same team. */
  alsoFoundAs: string[]
  /** The hops from the initiative to the target that explain why it is here. */
  path: PathHop[]
  evidence: SourceUsed[]
  evidenceCount: number
  confidence?: number
  status?: string
  inJira?: boolean | null
  provenance?: Provenance
  declared?: boolean
  impact?: Impact
  depTypes?: string[]
  note?: string
  decision?: Decision
}

export interface InitiativeRef {
  id: string
  title: string
  team: string
  teamName: string
  art: string
  pi: string
  priority?: string
  status?: string
  /** T-shirt size (a planner's, else the data's). */
  size?: string
}

export interface SequenceStep {
  step: number
  initiativeIds: string[]
  label: string
  why: string
  inCycle: boolean
}

/** Result of an analysis run. Produced by the backend (or loaded from a JSON file). */
export interface Analysis {
  agents: AgentRun[]
  findings: Finding[]
  sourcesUsed: SourceUsed[]
  graph: { nodes: GraphNode[]; edges: GraphEdge[] }
  risks: Risk[]
  sequence: string[]
  keyRisk?: string
  /** The initiatives in the run (drives the initiative filters and groups). */
  initiatives: InitiativeRef[]
  dependencies: DependencyRow[]
  steps: SequenceStep[]
  /** The executive summary paragraph, and whether the LLM or a template wrote it. */
  summary?: { text: string; method: string }
  notChecked: NotChecked[]
  /** Which roadmap initiatives were ready for PI planning, and which were left out and why. */
  readiness?: Readiness
  /** The three use cases: declared, hidden, and the recommended sprint plan. */
  plan?: Plan
}

export interface Readiness {
  total: number
  ready: number
  analysed: number
  readyStatuses: string[]
  byStatus: Record<string, number>
  excluded: { id: string; title: string; status: string; team: string; teamName: string; pi: string }[]
  readyNotAnalysed: string[]
}

export interface PlanSprint {
  index: number
  name: string
  /** "PI-2026-06 S3" */
  short: string
  pi: string
  /** Beyond the planning horizon: a next quarter at each team's average velocity. */
  assumed: boolean
}

export interface PlanPi {
  /** The quarter (Q1, Q2 …) or PI. */
  id: string
  assumed: boolean
  sprints: number[]
  /** A quarter label (Q1..Q4), not a PI name. */
  quarter?: boolean
}

/** tshirt: the data's T-shirt size; planner: a planner's size; estimate: story points in an older export;
 *  assumed: no size, scheduled at the default size until someone sets one. */
export type SizeSource = 'tshirt' | 'planner' | 'estimate' | 'assumed' | 'none'

/** One initiative on the sprint calendar: as planned (S1) and as recommended. Indices are PlanSprint.index. */
export interface PlanItem {
  id: string
  title: string
  team: string
  teamName: string
  art: string
  priority: string
  type: string
  outcome: string
  status: string
  description: string
  size: string | null
  points: number
  sizeSource: SizeSource
  sizeOverride: string
  plannedSprint: string
  plannedIndex: number | null
  plannedFinish: number | null
  plannedLabel: string
  plannedPi: string
  /** The quarter it is targeted at: the data's, or a planner's placement (targetSource). */
  targetQuarter: string
  targetSource: 'data' | 'planner' | 'sprint' | 'none'
  quarterOverride: string
  /** The T-shirt size in the data (before a planner's override). */
  dataSize: string
  /** Last sprint of the target quarter; it spills when it finishes after it. */
  deadline: number | null
  spills: boolean
  start: number
  finish: number
  startLabel: string
  finishLabel: string
  /** The quarter of the recommended start and finish sprints. */
  pi: string
  finishPi: string
  /** Sprints later than planned (null without a planned sprint). */
  movedBy: number | null
  reasons: string[]
  waitsFor: string[]
  inCycle: boolean
  capacityKnown: boolean
  /** Points per calendar sprint, keyed by sprint index. */
  allocation: Record<string, number>
  declaredUpstream: string[]
  declaredDownstream: string[]
  note: string
  declaredLinks: number
  hiddenLinks: number
}

export interface PlanTeam {
  id: string
  name: string
  art: string
  /** Available points per sprint (S5 spread over a quarter's sprints), per quarter, and the velocity tier. */
  average: number
  median: number
  quarterCapacity: number
  tier: string | null
  known: boolean
  perSprint: number[]
  capacityByPi: Record<string, number>
  plannedByPi: Record<string, number>
  scheduledByPi: Record<string, number>
  initiativeIds: string[]
  /** What other initiatives ask of the team, by change type. */
  asks: Partial<Record<ChangeType, number>>
}

export interface PlanConflict {
  provider: string
  consumer: string
  /** later_quarter: the provider is targeted at a later quarter; too_tight: the provider is still running in the
   *  consumer's quarter (same quarter, or it spills into it) and leaves too little of it for the consumer;
   *  sprint: planned sprints overlap (older exports). */
  kind: 'later_quarter' | 'too_tight' | 'sprint'
  providerQuarter: string
  consumerQuarter: string
  consumerFinishLabel: string
  providerLabel: string
  consumerLabel: string
  providerFinish: number
  consumerStart: number
  providerFinishLabel: string
  consumerStartLabel: string
  declared: boolean
  /** The dependency row key (consumer->provider). */
  depKey: string
  recommendedStart: string
}

export interface PlanCounts {
  declared: number
  declaredByRole: Record<string, number>
  hidden: number
  hiddenShare: number
  hiddenByProvenance: Record<string, number>
  hiddenByMethod: Record<string, number>
  hiddenByImpact: Partial<Record<Impact, number>>
  hiddenByLevel: Record<string, number>
  hiddenNeedChange: number
  ordering: number
  orderingHidden: number
  softLate: number
  conflicts: number
  conflictsHidden: number
  conflictsLaterQuarter: number
  conflictsTight: number
  moved: number
  /** Initiatives whose recommended start is in a later quarter than targeted. */
  laterQuarter: number
  /** Initiatives that finish after their target quarter ends. */
  spill: number
  teamsOver: number
  teamQuartersOver: number
  noSize: number
  steps: number
  cycles: number
}

/** An ordering link between two initiatives in the run: the provider should land before the consumer. */
export interface PlanLink {
  provider: string
  consumer: string
  /** orders: the consumer waits; soft: better first, re-test after. */
  strength: 'orders' | 'soft'
  declared: boolean
  depKeys: string[]
  reason: string
}

export interface Plan {
  sprints: PlanSprint[]
  pis: PlanPi[]
  items: PlanItem[]
  teams: PlanTeam[]
  conflicts: PlanConflict[]
  links: PlanLink[]
  counts: PlanCounts
  realSprints: number
  sprintsPerPi: number
  /** The quarters the decision dashboard shows (then "Later"). */
  horizon: string[]
  tshirt: { size: string; points: number }[]
  defaultSize: string
  velocityTiers: { tier: string; upTo: number | null }[]
  /** What the planner sent with this run. */
  planner: { initiativeNotes: number; sizes: number; quarters: number; dependencyNotes: number; decisions: Record<string, number> }
}

/** Notes, sizes, quarter placements (decision dashboard) and keep / dismiss decisions a planner adds after
 *  a run, sent with the next run. A quarter is a label from Plan.horizon, or "later". */
export interface PlannerInput {
  initiativeNotes: Record<string, string>
  sizes: Record<string, string>
  quarters: Record<string, string>
  dependencyNotes: Record<string, string>
  dependencyDecisions: Record<string, 'confirmed' | 'dismissed'>
}


/** A backend run's review: decisions so far, reviewer constraints, files to download. */
export interface ReviewState {
  approvals: { action: 'approve' | 'challenge'; reviewer: string; role: string; at: string; note: string }[]
  constraints: { first: string; then: string; note: string }[]
  exports: string[]
}

export interface Reviewer {
  id: string
  name: string
  role: string
  can_approve: boolean
}

export interface Run {
  status: 'idle' | 'running' | 'done'
  /** Index of the agent currently running; equals agents.length once done. */
  current: number
  /** The backend run stopped with an error at agent `current`. */
  failed?: boolean
}

export interface Notice {
  id: number
  kind: 'ok' | 'error'
  text: string
}
