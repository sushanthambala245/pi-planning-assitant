import { useState } from 'react'
import { graphEdges, graphNodes, recommendedSequence } from '../data/mock'
import type { Risk } from '../types'

type Tab = 'Risks' | 'Sequence' | 'Dependencies'
const tabs: Tab[] = ['Risks', 'Sequence', 'Dependencies']

interface Props {
  risks: Risk[]
  activeRiskId: string | null
  onSelectRisk: (id: string) => void
}

export function SidePanel({ risks, activeRiskId, onSelectRisk }: Props) {
  const [tab, setTab] = useState<Tab>('Risks')
  const label = (id: string) => graphNodes.find((n) => n.id === id)?.label.join(' ') ?? id

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
        {tab === 'Risks' &&
          risks.map((r) => {
            const active = r.id === activeRiskId
            return (
              <button
                key={r.id}
                className={`risk-item${active ? ' active-row' : ''}`}
                onClick={() => onSelectRisk(r.id)}
              >
                <div className="risk-dot" style={{ background: r.severity === 'High' ? 'var(--danger)' : 'var(--warn)' }} />
                <div style={{ flex: 1 }}>
                  <div className="risk-head">
                    <div className="risk-title">{r.title}</div>
                    <span className={`sev ${r.severity === 'High' ? 'sev-h' : 'sev-m'}`}>{r.severity}</span>
                  </div>
                  <div className="risk-desc">{r.description}</div>
                  <div className="click-hint">
                    <i className={`ti ${active ? 'ti-arrow-right' : 'ti-chevron-right'}`} aria-hidden="true" />
                    {active ? 'Reasoning open' : 'Click to see AI reasoning'}
                  </div>
                </div>
              </button>
            )
          })}

        {tab === 'Sequence' &&
          recommendedSequence.map((s, i) => (
            <div className="seq-item" key={s}>
              <div className="init-num">{i + 1}</div>
              {s}
            </div>
          ))}

        {tab === 'Dependencies' &&
          graphEdges.map((e) => (
            <div className="dep-item" key={`${e.from}-${e.to}`}>
              <span>{label(e.from)} → {label(e.to)}</span>
              <span className={`dep-tag${e.inferred ? ' inferred' : ''}`}>{e.inferred ? 'inferred' : 'explicit'}</span>
            </div>
          ))}
      </div>
    </div>
  )
}
