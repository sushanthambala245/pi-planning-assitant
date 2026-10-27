export type Screen = 'intake' | 'pipeline' | 'results'

export interface Initiative {
  id: string
  title: string
  description: string
  meta?: string
}

export type KbKind = 'conf' | 'arch' | 'team' | 'inv'

export interface KnowledgeSource {
  id: string
  kind: KbKind
  icon: string
  name: string
  meta: string
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

export interface Finding {
  tag: 'sys' | 'dep'
  tagLabel: string
  text: string
  note?: string
  highlight?: boolean
  agentId?: string
}

export interface SourceUsed {
  icon: string
  text: string
}

export interface GraphNode {
  id: string
  label: string
  domain: string
  x?: number
  y?: number
}

export interface GraphEdge {
  from: string
  to: string
  inferred: boolean
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
}

/** Result of an analysis run. Produced by the backend (or loaded from a JSON file until it exists). */
export interface Analysis {
  agents: AgentRun[]
  findings: Finding[]
  sourcesUsed: SourceUsed[]
  graph: { nodes: GraphNode[]; edges: GraphEdge[] }
  risks: Risk[]
  sequence: string[]
  keyRisk?: string
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
