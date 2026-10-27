import { useState } from 'react'
import type { Analysis } from '../types'

type Tab = 'Risks' | 'Sequence' | 'Dependencies'
const tabs: Tab[] = ['Risks', 'Sequence', 'Dependencies']

const sevClass = { High: 'sev-h', Medium: 'sev-m', Low: 'sev-l' } as const
const sevColor = { High: 'var(--danger)', Medium: 'var(--warn)', Low: 'var(--success)' } as const

interface Props {
  analysis: Analysis
  activeRiskId: string | null
  onSelectRisk: (id: string) => void
}

export function SidePanel({ analysis, activeRiskId, onSelectRisk }: Props) {
  const [tab, setTab] = useState<Tab>('Risks')
  const { risks, sequence, graph } = analysis
  const label = (id: string) => graph.nodes.find((n) => n.id === id)?.label ?? id

  return (
    <div className="side-panel">
      <div className="side-tabs" role="tablist">
        {tabs.map((t) => (
          <button
            key={t}
            role="tab"
            aria-selected={tab === t}
            className={`side-tab${tab === t ? ' active' : ''}`}
            onClick={() => setTab(t)}
          >
            {t}
          </button>
        ))}
      </div>
      <div className="side-content">
        {tab === 'Risks' && (risks.length === 0
          ? <div className="list-empty">No risks were flagged.</div>
          : risks.map((r) => {
              const active = r.id === activeRiskId
              return (
                <button key={r.id} className={`risk-item${active ? ' active-row' : ''}`} onClick={() => onSelectRisk(r.id)}>
                  <div className="risk-dot" style={{ background: sevColor[r.severity] }} />
                  <div style={{ flex: 1 }}>
                    <div className="risk-head">
                      <div className="risk-title">{r.title}</div>
                      <span className={`sev ${sevClass[r.severity]}`}>{r.severity}</span>
                    </div>
                    <div className="risk-desc">{r.description}</div>
                    <div className="click-hint">
                      <i className={`ti ${active ? 'ti-arrow-right' : 'ti-chevron-right'}`} aria-hidden="true" />
                      {active ? 'Reasoning open' : 'Click to see AI reasoning'}
                    </div>
                  </div>
                </button>
              )
            }))}

        {tab === 'Sequence' && (sequence.length === 0
          ? <div className="list-empty">No sequence was recommended.</div>
          : sequence.map((s, i) => (
              <div className="seq-item" key={`${i}-${s}`}>
                <div className="init-num">{i + 1}</div>
                {s}
              </div>
            )))}

        {tab === 'Dependencies' && (graph.edges.length === 0
          ? <div className="list-empty">No dependencies were found.</div>
          : graph.edges.map((e) => (
              <div className="dep-item" key={`${e.from}-${e.to}`}>
                <span>{label(e.from)} → {label(e.to)}</span>
                <span className={`dep-tag${e.inferred ? ' inferred' : ''}`}>{e.inferred ? 'inferred' : 'explicit'}</span>
              </div>
            )))}
      </div>
    </div>
  )
}
