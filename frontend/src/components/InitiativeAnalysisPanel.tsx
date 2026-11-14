import { useEffect, useState } from 'react'
import { domainColor } from '../data/domains'
import { findingInitiatives, plural } from '../lib/deps'
import type { Analysis, DependencyRow, Finding } from '../types'
import { FindingRow } from './FindingRow'
import { SystemChips } from './SystemChips'

interface Props {
  analysis: Analysis
  initiativeId: string
  /** Findings revealed so far (a replay reveals them step by step). */
  findings: Finding[]
  depsByKey: Map<string, DependencyRow>
  labelOf: (key: string) => string
  onClose: () => void
}

const sev = { High: 'h', Medium: 'm', Low: 'l' } as const

/** What the agents found about one initiative: the systems it touches, every finding, and its risks. */
export function InitiativeAnalysisPanel({ analysis, initiativeId, findings, depsByKey, labelOf, onClose }: Props) {
  const [open, setOpen] = useState<string | null>(null)
  const [showNoChange, setShowNoChange] = useState(false)
  useEffect(() => setOpen(null), [initiativeId])
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', esc)
    return () => document.removeEventListener('keydown', esc)
  }, [onClose])

  const ini = analysis.initiatives.find((i) => i.id === initiativeId)
  const mine = findings.filter((f) => findingInitiatives(f, analysis).includes(initiativeId))
  const noChange = (f: Finding) => (f.changeType ?? (f.depKey ? depsByKey.get(f.depKey)?.changeType : undefined)) === 'none'
  const own = (f: Finding) => f.kind !== 'systems' && f.kind !== 'risk' // systems and risks have their own lists below
  const hiddenCount = showNoChange ? 0 : mine.filter((f) => own(f) && noChange(f)).length
  const systems = mine.find((f) => f.kind === 'systems')?.systems ?? []
  const rest = mine.filter((f) => own(f) && (showNoChange || !noChange(f)))
  const risks = analysis.risks.filter((r) => r.initiativeIds.includes(initiativeId))

  return (
    <aside className="drawer" aria-label={ini?.title ?? initiativeId}>
      <div className="drawer-topbar">
        <div className="drawer-title">
          <span className="art-dot" style={{ background: domainColor(ini?.art || 'Other') }} aria-hidden="true" />
          <span className="drawer-title-text">{ini?.title ?? initiativeId}</span>
        </div>
        <button className="drawer-close" aria-label="Close" onClick={onClose}><i className="ti ti-x" aria-hidden="true" /></button>
      </div>
      <div className="drawer-body">
        <div className="init-facts">
          <span>{initiativeId}</span>
          {ini?.teamName && <span>{ini.teamName}</span>}
          {ini?.pi && <span>{ini.pi}</span>}
          {ini?.size && <span>size {ini.size}</span>}
        </div>

        {systems.length > 0 && (
          <div className="drawer-section">
            <div className="drawer-section-label">Systems and owning teams · {systems.length}</div>
            <SystemChips systems={systems} />
          </div>
        )}

        <div className="drawer-section">
          <div className="drawer-section-label">Findings · {rest.length}</div>
          {rest.length === 0 && <div className="ai-note">Nothing found for this initiative yet.</div>}
          {rest.map((f) => (
            <FindingRow key={f.text} finding={f} dep={f.depKey ? depsByKey.get(f.depKey) : undefined}
              expanded={open === f.text} onToggle={() => setOpen((o) => (o === f.text ? null : f.text))} labelOf={labelOf} />
          ))}
          {(hiddenCount > 0 || showNoChange) && (
            <button className="link-btn" onClick={() => setShowNoChange((v) => !v)}>
              {showNoChange ? 'Hide no-change links' : `Show ${plural(hiddenCount, 'no-change link')}`}
            </button>
          )}
        </div>

        {risks.length > 0 && (
          <div className="drawer-section">
            <div className="drawer-section-label">Risks · {risks.length}</div>
            {risks.map((r) => (
              <div key={r.id} className="node-risk static">
                <i className="ti ti-alert-triangle" aria-hidden="true" /><span>{r.title}</span>
                <span className={`sev sev-${sev[r.severity]}`}>{r.severity}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </aside>
  )
}
