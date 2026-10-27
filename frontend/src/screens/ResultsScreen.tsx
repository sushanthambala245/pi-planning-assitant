import { useState } from 'react'
import { DependencyGraph } from '../components/DependencyGraph'
import { ReasoningDrawer } from '../components/ReasoningDrawer'
import { SidePanel } from '../components/SidePanel'
import { StatRow } from '../components/StatRow'
import { StepBadge, TopBar } from '../components/TopBar'
import { graphEdges, graphNodes, keyRisk, recommendedSequence, risks, stats } from '../data/mock'

interface Props {
  onRestart: () => void
}

export function ResultsScreen({ onRestart }: Props) {
  const [activeId, setActiveId] = useState<string | null>(null)
  const index = risks.findIndex((r) => r.id === activeId)
  const active = index >= 0 ? risks[index] : null

  const step = (delta: number) =>
    setActiveId(risks[(index + delta + risks.length) % risks.length].id)

  // clicking a graph node opens the first risk that involves it
  const openForNode = (nodeId: string) => {
    const match = risks.find((r) => r.highlightNodes.includes(nodeId))
    if (match) setActiveId(match.id)
  }

  return (
    <div className="screen">
      <TopBar>
        <StepBadge icon="ti-check" label="Analysis complete" success />
        <button className="btn btn-ghost btn-sm"><i className="ti ti-download" aria-hidden="true" /> Export</button>
        <button className="btn btn-ghost btn-sm" onClick={onRestart}><i className="ti ti-refresh" aria-hidden="true" /> New analysis</button>
      </TopBar>

      <StatRow stats={stats} />

      <div className="results-outer">
        <div className="s3-main">
          <DependencyGraph
            nodes={graphNodes}
            edges={graphEdges}
            highlight={active?.highlightNodes ?? []}
            onNodeClick={openForNode}
          />
          <SidePanel risks={risks} activeRiskId={activeId} onSelectRisk={setActiveId} />
        </div>
        {active && (
          <ReasoningDrawer
            risk={active}
            onClose={() => setActiveId(null)}
            onPrev={() => step(-1)}
            onNext={() => step(1)}
          />
        )}
      </div>

      <div className="exec-strip">
        <div className="exec-label">AI summary</div>
        <div className="exec-grid">
          <div className="exec-cell">
            <div className="exec-cell-label">Recommended sequence</div>
            <div className="exec-cell-val">{recommendedSequence.join(' → ')}</div>
          </div>
          <div className="exec-cell">
            <div className="exec-cell-label">Key risk to resolve before PI</div>
            <div className="exec-cell-val">{keyRisk}</div>
          </div>
        </div>
      </div>
    </div>
  )
}
