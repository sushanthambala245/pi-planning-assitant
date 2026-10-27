import { useState } from 'react'
import { domainColor } from '../data/mock'
import type { Risk } from '../types'

interface Props {
  risk: Risk
  onClose: () => void
  onPrev: () => void
  onNext: () => void
}

export function ReasoningDrawer({ risk, onClose, onPrev, onNext }: Props) {
  const [copied, setCopied] = useState(false)
  const [flagged, setFlagged] = useState(false)

  const copy = async () => {
    await navigator.clipboard.writeText(`${risk.title}\n\n${risk.reasoning.join('\n\n')}`)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  const high = risk.severity === 'High'

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
        <span className={`drawer-risk-badge ${high ? 'high' : 'medium'}`}>
          <i className="ti ti-alert-triangle" aria-hidden="true" /> {risk.severity} risk · {risk.title.split(' — ')[0]}
        </span>

        <div className="drawer-section">
          <div className="drawer-section-label">Why the AI flagged this</div>
          <div className="reasoning-box">
            {risk.reasoning.map((p, i) => <p key={i}>{p}</p>)}
          </div>
        </div>

        <div className="drawer-section">
          <div className="drawer-section-label">Initiatives affected</div>
          {risk.affected.map((a) => (
            <div className="affected-item" key={a.text}>
              <div className="affected-dot" style={{ background: domainColor[a.domain] }} />
              {a.text}
            </div>
          ))}
        </div>

        <div className="drawer-section">
          <div className="drawer-section-label">Knowledge sources used</div>
          {risk.sources.map((s) => (
            <div className="sources-item" key={s.text}>
              <i className={`ti ${s.icon}`} aria-hidden="true" />{s.text}
            </div>
          ))}
        </div>

        <div className="drawer-section">
          <div className="drawer-section-label">Suggested actions</div>
          {risk.suggestedPrompts.map((p) => (
            <button className="prompt-chip" key={p}>
              <i className="ti ti-send" aria-hidden="true" /> {p}
            </button>
          ))}
        </div>
      </div>

      <div className="drawer-footer">
        <button className="btn btn-ghost" onClick={() => setFlagged((f) => !f)}>
          <i className="ti ti-flag" aria-hidden="true" /> {flagged ? 'Flagged' : 'Flag for PI planning'}
        </button>
        <button className="btn btn-primary" onClick={copy}>
          <i className="ti ti-copy" aria-hidden="true" /> {copied ? 'Copied' : 'Copy reasoning'}
        </button>
      </div>
    </aside>
  )
}
