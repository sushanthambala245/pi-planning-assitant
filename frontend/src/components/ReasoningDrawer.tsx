import { useState } from 'react'
import { domainColor } from '../data/domains'
import type { Risk } from '../types'
import { Tip } from './Tip'

interface Props {
  risk: Risk
  /** Flagged for PI planning: kept per risk by the app (and on the backend for a live run). */
  flagged: boolean
  onToggleFlag: () => void
  onClose: () => void
  onPrev: () => void
  onNext: () => void
}

const badgeClass = { High: 'high', Medium: 'medium', Low: 'low' } as const

export function ReasoningDrawer({ risk, flagged, onToggleFlag, onClose, onPrev, onNext }: Props) {
  const [copied, setCopied] = useState(false)

  const copy = async () => {
    await navigator.clipboard.writeText(`${risk.title}\n\n${risk.reasoning.join('\n\n')}`)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <aside className="drawer" aria-label="AI reasoning">
      <div className="drawer-topbar">
        <div className="drawer-title">AI reasoning</div>
        <div className="drawer-nav">
          <button className="btn btn-ghost btn-sm" aria-label="Previous risk" onClick={onPrev}><i className="ti ti-chevron-up" aria-hidden="true" /></button>
          <button className="btn btn-ghost btn-sm" aria-label="Next risk" onClick={onNext}><i className="ti ti-chevron-down" aria-hidden="true" /></button>
          <button className="drawer-close" aria-label="Close" onClick={onClose}><i className="ti ti-x" aria-hidden="true" /></button>
        </div>
      </div>

      <div className="drawer-body">
        <span className={`drawer-risk-badge ${badgeClass[risk.severity]}`}>
          <i className="ti ti-alert-triangle" aria-hidden="true" /> {risk.severity} risk · {risk.title.split(' — ')[0]}
        </span>
        <div className="drawer-risk-title">{risk.title}</div>
        {risk.rule && <div className="drawer-risk-rule">Raised by rule {risk.ruleCode}: {risk.rule}</div>}

        {risk.reasoning.length > 0 && (
          <div className="drawer-section">
            <div className="drawer-section-label">Why the AI flagged this</div>
            <div className="reasoning-box">
              {risk.reasoning.map((p, i) => <p key={i}>{p}</p>)}
            </div>
          </div>
        )}

        {risk.affected.length > 0 && (
          <div className="drawer-section">
            <div className="drawer-section-label">Initiatives affected</div>
            {risk.affected.map((a) => (
              <div className="affected-item" key={a.text}>
                <div className="affected-dot" style={{ background: domainColor(a.domain) }} />
                {a.text}
              </div>
            ))}
          </div>
        )}

        {risk.sources.length > 0 && (
          <div className="drawer-section">
            <div className="drawer-section-label">Knowledge sources used</div>
            {risk.sources.map((s) => (
              <div className="sources-item" key={s.text}>
                <i className={`ti ${s.icon}`} aria-hidden="true" />{s.text}
              </div>
            ))}
          </div>
        )}

        {risk.suggestedPrompts.length > 0 && (
          <div className="drawer-section">
            <div className="drawer-section-label">Suggested follow-ups</div>
            {risk.suggestedPrompts.map((p) => (
              <button className="prompt-chip" key={p} disabled title="Follow-up questions are not available in this version">
                <i className="ti ti-send" aria-hidden="true" /> {p}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="drawer-footer">
        <Tip title={flagged ? 'Flagged for PI planning' : 'Flag for PI planning'}
          content={flagged
            ? 'This risk is marked to raise in PI planning. Click to remove the flag.'
            : 'Marks this risk to raise in PI planning. The flag is saved with the run, carried over to a rerun while the risk is still raised, and included in Export.'}>
          <button className={`btn btn-ghost${flagged ? ' flag-on' : ''}`} aria-pressed={flagged} onClick={onToggleFlag}>
            <i className={`ti ${flagged ? 'ti-flag-check' : 'ti-flag'}`} aria-hidden="true" /> {flagged ? 'Flagged for PI planning' : 'Flag for PI planning'}
          </button>
        </Tip>
        <button className="btn btn-primary" onClick={copy}>
          <i className="ti ti-copy" aria-hidden="true" /> {copied ? 'Copied' : 'Copy reasoning'}
        </button>
      </div>
    </aside>
  )
}
