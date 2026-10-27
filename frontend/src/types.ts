export type Screen = 'intake' | 'pipeline' | 'results'

export interface Initiative {
  id: number
  title: string
  description: string
}

export type KbKind = 'conf' | 'arch' | 'team' | 'inv'

export interface KnowledgeSource {
  id: number
  kind: KbKind
  icon: string
  name: string
  meta: string
  status: 'Ready'
}

export type AgentState = 'done' | 'active' | 'wait'

export interface Agent {
  id: string
  name: string
  icon: string
  state: AgentState
}

export interface Finding {
  tag: 'sys' | 'dep'
  tagLabel: string
  text: string
  note?: string
  highlight?: boolean
}

export type Domain = 'Platform' | 'Compliance' | 'Product' | 'Data' | 'Other'

export interface GraphNode {
  id: string
  label: [string, string]
  domain: Domain
  x: number
  y: number
}

export interface GraphEdge {
  from: string
  to: string
  inferred: boolean
}

export type Severity = 'High' | 'Medium'

export interface Risk {
  id: string
  title: string
  description: string
  severity: Severity
  reasoning: string[]
  affected: { domain: Domain; text: string }[]
  sources: { icon: string; text: string }[]
  suggestedPrompts: string[]
  highlightNodes: string[]
}
