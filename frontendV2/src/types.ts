export type Screen = 'intake' | 'pipeline' | 'results'

export interface Initiative {
  id: string
  title: string
  description: string
  meta?: string
  /** Shown as filters on the Intake screen when present. */
  team?: string
  pi?: string
  priority?: string
}

export type KbKind = 'conf' | 'arch' | 'team' | 'inv'

export type SourceStatus = 'ready' | 'partial' | 'invalid' | 'missing'

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

export type AgentState = 'done' | 'active' | 'wait'

/** What a dependency asks of people: change code, agree a flow / contract, re-test, or nothing. */
export type ChangeType = 'code' | 'flow' | 'regression' | 'none'
/** What a dependency is on. */
export type DepLevel = 'initiative' | 'team' | 'system'
/** Whether stated and inferred evidence agree on a dependency. */
export type Verdict = 'confirmed' | 'stated_only' | 'inferred_only'

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
}

export interface InitiativeRef {
  id: string
  title: string
  team: string
  teamName: string
  art: string
  pi: string
}

export interface SequenceStep {
  step: number
  initiativeIds: string[]
  label: string
  why: string
  inCycle: boolean
}

export type TShirt = 'S' | 'M' | 'L' | 'XL'

/** One initiative's place on the delivery timeline; sprints are numbered from 1. */
export interface ScheduleRow {
  initiativeId: string
  team: string
  size: TShirt
  /** Where the size came from: the data, estimated from story points, or assumed (one sprint). */
  sizeSource: 'size' | 'points' | 'default'
  sprints: number
  start: number
  end: number
  spillsPastPi: boolean
  waitsFor: string[]
  critical: boolean
  inCycle: boolean
  targetedSprint?: number
}

/** Delivery timeline derived from T-shirt sizes and the dependency order. */
export interface Schedule {
  pi: string
  piSprints: number
  sizeSprints: Record<string, number>
  rows: ScheduleRow[]
  criticalPath: string[]
  assumptions: string[]
}

export type CommentType = 'concern' | 'question' | 'decision' | 'action'

/** Live feedback on one initiative, captured during PI planning. */
export interface Comment {
  id: string
  initiativeId: string
  type: CommentType
  text: string
  author: string
  authorId: string
  role: string
  createdAt: string
  resolved: boolean
  resolvedBy?: string | null
  resolvedAt?: string | null
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
  /** Absent in older files and while the run has not reached sequencing: the timeline falls back to steps. */
  schedule?: Schedule
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
}

export interface Notice {
  id: number
  kind: 'ok' | 'error'
  text: string
}
