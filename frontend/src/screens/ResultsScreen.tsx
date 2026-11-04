import { useMemo, useState, type ReactNode } from 'react'
import { DecisionSummary } from '../components/DecisionSummary'
import { DependencyGraph } from '../components/DependencyGraph'
import { EmptyState } from '../components/EmptyState'
import { InitiativeFilter } from '../components/InitiativeFilter'
import { NodeDrawer } from '../components/NodeDrawer'
import { ReasoningDrawer } from '../components/ReasoningDrawer'
import { SidePanel, type SideTab } from '../components/SidePanel'
import { StatRow } from '../components/StatRow'
import { LEVEL, LEVEL_ORDER, depLabel, touches } from '../lib/deps'
import type { Analysis, DepLevel } from '../types'

interface Props {
  analysis: Analysis | null
  initiativeCount: number
  onViewAnalysis: () => void
  onBack: () => void
  /** Risk ids flagged for PI planning. */
  flags: string[]
  onToggleFlag: (riskId: string) => void
  /** Review and export controls for a backend run; absent for a replayed file. */
  review?: ReactNode
}

type Drawer = { type: 'risk' | 'node'; id: string } | null

export function ResultsScreen({ analysis, initiativeCount, onViewAnalysis, onBack, flags, onToggleFlag, review }: Props) {
  const [drawer, setDrawer] = useState<Drawer>(null)
  const [initiative, setInitiative] = useState('')
  const [changesOnly, setChangesOnly] = useState(true)
  const [level, setLevel] = useState<DepLevel | ''>('')
  const [tab, setTab] = useState<SideTab>(analysis?.dependencies.length || analysis?.graph.edges.length || !analysis?.risks.length ? 'Dependencies' : 'Risks')

  const depsByKey = useMemo(() => new Map((analysis?.dependencies ?? []).map((d) => [d.key, d])), [analysis])

  if (!analysis) {
    return (
      <EmptyState
        icon="ti-chart-dots"
        title="No results yet"
        actions={<button className="btn btn-primary" onClick={onBack}>Go to intake</button>}
      >
        Load data and run an analysis to see the dependency graph, risks and recommended sequence here.
      </EmptyState>
    )
  }

  const classified = analysis.dependencies.length > 0
  const runIds = new Set(analysis.initiatives.length ? analysis.initiatives.map((i) => i.id) : analysis.graph.nodes.filter((n) => n.kind === 'initiative').map((n) => n.id))
  const order = analysis.steps.flatMap((s) => s.initiativeIds)

  // One set of filters drives the graph, the lists and the stats below them.
  const inScope = analysis.dependencies.filter((d) => (!initiative || touches(d, initiative)) && (!level || d.level === level))
  const deps = inScope.filter((d) => !changesOnly || d.changeType !== 'none')
  const hiddenNoChange = inScope.length - deps.length
  const shownKeys = new Set(deps.map((d) => d.key))
  const edges = classified
    ? analysis.graph.edges.filter((e) => (e.key ? shownKeys.has(e.key) : shownKeys.has(`${e.from}->${e.to}`)))
    : analysis.graph.edges.filter((e) => !initiative || e.from === initiative || e.to === initiative)
  const filtering = !!initiative || !!level || (classified && changesOnly)
  const onGraph = new Set(edges.flatMap((e) => [e.from, e.to]))
  const nodes = analysis.graph.nodes.filter((n) =>
    !filtering || onGraph.has(n.id) || (initiative ? n.id === initiative : runIds.has(n.id)))
  const risks = initiative ? analysis.risks.filter((r) => r.initiativeIds.includes(initiative) || r.highlightNodes.includes(initiative)) : analysis.risks

  const { risks: allRisks } = analysis
  const riskIndex = drawer?.type === 'risk' ? allRisks.findIndex((r) => r.id === drawer.id) : -1
  const activeRisk = riskIndex >= 0 ? allRisks[riskIndex] : null
  const step = (delta: number) => setDrawer({ type: 'risk', id: allRisks[(riskIndex + delta + allRisks.length) % allRisks.length].id })
  const activeNode = drawer?.type === 'node' ? analysis.graph.nodes.find((n) => n.id === drawer.id) ?? null : null
  const nodeDeps = activeNode ? analysis.dependencies.filter((d) => touches(d, activeNode.id)) : []

  const highlight = activeRisk
    ? activeRisk.highlightNodes
    : activeNode
      ? [activeNode.id, ...nodeDeps.flatMap((d) => [d.from, d.to])]
      : []
  const labelOf = (key: string) => {
    const d = depsByKey.get(key)
    return d ? depLabel(d) : key
  }
  const total = classified ? analysis.dependencies.length : analysis.graph.edges.length
  const openRisk = (id: string) => { setTab('Risks'); setDrawer({ type: 'risk', id }) }

  return (
    <>
      <DecisionSummary analysis={analysis} onViewAnalysis={onViewAnalysis} onOpenRisk={openRisk}>{review}</DecisionSummary>

      <StatRow analysis={analysis} initiativeCount={initiativeCount} />

      <div className="results-filters">
        <InitiativeFilter initiatives={analysis.initiatives} value={initiative} onChange={setInitiative} />
        {classified && (
          <>
            <label className="toggle" title="Hide links where nobody has to build, agree or re-test anything">
              <input type="checkbox" checked={changesOnly} onChange={(e) => setChangesOnly(e.target.checked)} />
              Only dependencies that need a change
            </label>
            <div className="seg" role="group" aria-label="Filter by level">
              <button className={`seg-btn${level === '' ? ' active' : ''}`} aria-pressed={level === ''} onClick={() => setLevel('')}>All levels</button>
              {LEVEL_ORDER.map((l) => (
                <button key={l} className={`seg-btn${level === l ? ' active' : ''}`} aria-pressed={level === l} title={LEVEL[l].hint} onClick={() => setLevel(l)}>
                  <i className={`ti ${LEVEL[l].icon}`} aria-hidden="true" /> {LEVEL[l].label}
                </button>
              ))}
            </div>
          </>
        )}
      </div>

      <div className="results-outer">
        <div className="s3-main">
          <DependencyGraph
            nodes={nodes}
            edges={edges}
            highlight={highlight}
            onNodeClick={(id) => setDrawer({ type: 'node', id })}
            depsByKey={depsByKey}
            innerIds={runIds}
            order={order}
            focusId={initiative || undefined}
            caption={filtering ? `showing ${edges.length} of ${total} dependencies` : undefined}
          />
          <SidePanel
            analysis={analysis}
            deps={deps}
            risks={risks}
            initiative={initiative}
            hiddenNoChange={hiddenNoChange}
            onShowNoChange={() => setChangesOnly(false)}
            activeRiskId={activeRisk?.id ?? null}
            onSelectRisk={(id) => setDrawer({ type: 'risk', id })}
            flags={flags}
            labelOf={labelOf}
            tab={tab}
            onTab={setTab}
          />
        </div>
        {activeRisk && (
          <ReasoningDrawer
            key={activeRisk.id}
            risk={activeRisk}
            flagged={flags.includes(activeRisk.id)}
            onToggleFlag={() => onToggleFlag(activeRisk.id)}
            onClose={() => setDrawer(null)}
            onPrev={() => step(-1)}
            onNext={() => step(1)}
          />
        )}
        {activeNode && (
          <NodeDrawer
            node={activeNode}
            deps={nodeDeps}
            risks={allRisks.filter((r) => r.highlightNodes.includes(activeNode.id))}
            inRun={runIds.has(activeNode.id)}
            onClose={() => setDrawer(null)}
            onOpenRisk={openRisk}
            labelOf={labelOf}
          />
        )}
      </div>
    </>
  )
}
