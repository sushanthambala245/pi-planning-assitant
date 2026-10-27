import type {
  Agent,
  Domain,
  Finding,
  GraphEdge,
  GraphNode,
  Initiative,
  KnowledgeSource,
  Risk,
} from '../types'

export const domainColor: Record<Domain, string> = {
  Platform: '#378ADD',
  Compliance: '#1D9E75',
  Product: '#EF9F27',
  Data: '#D4537E',
  Other: '#888780',
}

export const initiatives: Initiative[] = [
  { id: 1, title: 'Customer returns enhancement', description: 'Enable store drop-off returns' },
  { id: 2, title: 'Partner API upgrade', description: 'Introduce new partner integrations' },
  { id: 3, title: 'Fraud detection enhancement', description: 'Enable real-time fraud scoring' },
]

export const knowledgeSources: KnowledgeSource[] = [
  { id: 1, kind: 'conf', icon: 'ti-notes', name: 'Architecture overview', meta: 'Confluence · 12 pages · systems map', status: 'Ready' },
  { id: 2, kind: 'arch', icon: 'ti-sitemap', name: 'Application inventory', meta: 'Confluence · 48 services listed', status: 'Ready' },
  { id: 3, kind: 'team', icon: 'ti-users', name: 'Team ownership map', meta: '8 teams · 34 service assignments', status: 'Ready' },
  { id: 4, kind: 'inv', icon: 'ti-file-code', name: 'Integration dependency docs', meta: 'ADO · API contracts · 6 documents', status: 'Ready' },
]

export const agents: Agent[] = [
  { id: 'analyser', name: 'Initiative analyser', icon: 'ti-check', state: 'done' },
  { id: 'discovery', name: 'Dependency discovery', icon: 'ti-check', state: 'done' },
  { id: 'sequencing', name: 'Sequencing agent', icon: 'ti-loader-2', state: 'active' },
  { id: 'risk', name: 'Risk agent', icon: 'ti-clock', state: 'wait' },
  { id: 'viz', name: 'Visualisation agent', icon: 'ti-chart-dots', state: 'wait' },
]

export const findings: Finding[] = [
  {
    tag: 'sys',
    tagLabel: 'Systems found',
    text: 'Customer returns touches 4 shared systems: PO Portal, Customer Profile, Order Management, Returns Service',
    highlight: true,
  },
  {
    tag: 'dep',
    tagLabel: 'Inferred dependency',
    text: 'Fraud Detection and Partner API both write to Customer Profile — schema conflict risk detected',
    note: '✦ Not stated in either initiative',
  },
  {
    tag: 'dep',
    tagLabel: 'Explicit dependency',
    text: 'Partner API upgrade required before Returns Enhancement can route cross-partner returns',
  },
]

export const sourcesUsed = [
  { icon: 'ti-notes', text: 'Architecture overview — 3 pages read' },
  { icon: 'ti-users', text: 'Team ownership map — 2 teams matched' },
  { icon: 'ti-file-code', text: 'Integration docs — 1 API contract referenced' },
]

export const graphNodes: GraphNode[] = [
  { id: 'returns', label: ['Returns', 'Product'], domain: 'Product', x: 105, y: 55 },
  { id: 'partner', label: ['Partner API', 'Platform'], domain: 'Platform', x: 315, y: 55 },
  { id: 'profile', label: ['Customer', 'Profile'], domain: 'Product', x: 210, y: 123 },
  { id: 'fraud', label: ['Fraud', 'Detection'], domain: 'Data', x: 210, y: 168 },
  { id: 'orders', label: ['Order', 'Mgmt'], domain: 'Other', x: 210, y: 213 },
]

export const graphEdges: GraphEdge[] = [
  { from: 'returns', to: 'profile', inferred: false },
  { from: 'returns', to: 'fraud', inferred: false },
  { from: 'partner', to: 'profile', inferred: true },
  { from: 'partner', to: 'fraud', inferred: true },
  { from: 'profile', to: 'fraud', inferred: false },
  { from: 'fraud', to: 'orders', inferred: true },
]

export const stats = [
  { label: 'Initiatives analysed', value: '3', sub: 'across 4 teams' },
  { label: 'Dependencies found', value: '8', sub: '5 inferred by AI', tone: 'accent' as const },
  { label: 'Risk flags', value: '3', sub: '1 high · 2 medium', tone: 'danger' as const },
  { label: 'Recommended sequence', value: '3', sub: 'steps with reasoning' },
]

export const risks: Risk[] = [
  {
    id: 'schema',
    title: 'Schema conflict — Customer Profile',
    description: 'Fraud Detection and Partner API both write to Customer Profile with no owner for conflict resolution.',
    severity: 'High',
    reasoning: [
      'Both Fraud Detection Enhancement and Partner API Upgrade write to the Customer Profile service — but neither initiative mentions the other. The AI detected this by cross-reading their system descriptions against the application inventory, where Customer Profile is listed as a shared write-target.',
      'If both initiatives proceed in parallel, their schema changes will collide at the Customer Profile layer with no team nominated to arbitrate. This is the most common cause of mid-PI rollback in multi-team programmes.',
    ],
    affected: [
      { domain: 'Platform', text: 'Partner API upgrade — writes new partner_id field to Customer Profile' },
      { domain: 'Data', text: 'Fraud Detection — reads and writes fraud_score field to Customer Profile' },
    ],
    sources: [
      { icon: 'ti-sitemap', text: 'Application inventory — Customer Profile listed as shared write-target' },
      { icon: 'ti-users', text: 'Team ownership map — no team assigned to Customer Profile schema' },
    ],
    suggestedPrompts: [
      'Who should own Customer Profile schema?',
      'What happens if we sequence these apart?',
      'Show all initiatives touching Customer Profile',
    ],
    highlightNodes: ['partner', 'profile'],
  },
  {
    id: 'owner',
    title: 'Missing owner — Returns Service',
    description: 'Returns Service is depended on by 2 initiatives but has no team assigned in the ownership map.',
    severity: 'Medium',
    reasoning: [
      'Returns Service appears as a dependency of both the Customer returns enhancement and the Partner API upgrade, but the team ownership map has no assignment for it.',
    ],
    affected: [{ domain: 'Product', text: 'Customer returns enhancement — routes returns via Returns Service' }],
    sources: [{ icon: 'ti-users', text: 'Team ownership map — Returns Service unassigned' }],
    suggestedPrompts: ['Which team is closest to Returns Service?'],
    highlightNodes: ['returns'],
  },
  {
    id: 'capacity',
    title: 'Capacity — Platform team',
    description: 'Platform team owns Partner API and is depended on by both other initiatives.',
    severity: 'Medium',
    reasoning: [
      'The Platform team is on the critical path: Partner API must land before both Fraud Detection and Returns Enhancement can proceed.',
    ],
    affected: [{ domain: 'Platform', text: 'Partner API upgrade — blocks 2 downstream initiatives' }],
    sources: [{ icon: 'ti-file-code', text: 'Integration docs — Partner API contract' }],
    suggestedPrompts: ['Can any Partner API work be parallelised?'],
    highlightNodes: ['partner'],
  },
]

export const recommendedSequence = ['Partner API', 'Fraud Detection', 'Returns Enhancement']
export const keyRisk = 'Customer Profile schema ownership — no team assigned, 2 initiatives impacted'
