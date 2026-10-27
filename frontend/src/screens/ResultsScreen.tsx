import { useState } from 'react'
import { DependencyGraph } from '../components/DependencyGraph'
import { EmptyState } from '../components/EmptyState'
import { ReasoningDrawer } from '../components/ReasoningDrawer'
import { SidePanel } from '../components/SidePanel'
import { StatRow } from '../components/StatRow'
import type { Analysis } from '../types'

interface Props {
  analysis: Analysis | null
  initiativeCount: number
  onViewAnalysis: () => void
  onBack: () => void
}

export function ResultsScreen({ analysis, initiativeCount, onViewAnalysis, onBack }: Props) {
  const [activeId, setActiveId] = useState<string | null>(null)

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

  const { risks } = analysis
  const index = risks.findIndex((r) => r.id === activeId)
  const active = index >= 0 ? risks[index] : null
  const step = (delta: number) => setActiveId(risks[(index + delta + risks.length) % risks.length].id)

  // clicking a graph node opens the first risk that involves it
  const openForNode = (nodeId: string) => {
    const match = risks.find((r) => r.highlightNodes.includes(nodeId))
    if (match) setActiveId(match.id)
  }

  return (
    <>
      <StatRow analysis={analysis} initiativeCount={initiativeCount} />

      <div className="results-outer">
        <div className="s3-main">
          <DependencyGraph
            nodes={analysis.graph.nodes}
            edges={analysis.graph.edges}
            highlight={active?.highlightNodes ?? []}
            onNodeClick={openForNode}
          />
          <SidePanel analysis={analysis} activeRiskId={activeId} onSelectRisk={setActiveId} />
        </div>
        {active && (
          <ReasoningDrawer risk={active} onClose={() => setActiveId(null)} onPrev={() => step(-1)} onNext={() => step(1)} />
        )}
      </div>

      <div className="exec-strip">
        <div className="exec-head">
          <div className="exec-label">AI summary</div>
          <button className="link-btn" onClick={onViewAnalysis}>
            <i className="ti ti-topology-star-3" aria-hidden="true" /> How was this analysed?
          </button>
        </div>
        <div className="exec-grid">
          <div className="exec-cell">
            <div className="exec-cell-label">Recommended sequence</div>
            <div className="exec-cell-val">{analysis.sequence.length ? analysis.sequence.join(' → ') : '—'}</div>
          </div>
          <div className="exec-cell">
            <div className="exec-cell-label">Key risk to resolve before PI</div>
            <div className="exec-cell-val">{analysis.keyRisk ?? risks[0]?.title ?? '—'}</div>
          </div>
        </div>
      </div>
    </>
  )
}
