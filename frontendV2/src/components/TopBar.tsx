import type { ReactNode } from 'react'
import type { Screen } from '../types'
import { ThemePicker } from './ThemePicker'

const steps: { id: Screen; label: string; icon: string }[] = [
  { id: 'intake', label: 'Intake', icon: 'ti-upload' },
  { id: 'pipeline', label: 'Analysis', icon: 'ti-topology-star-3' },
  { id: 'results', label: 'Results', icon: 'ti-chart-dots' },
]

interface Props {
  current: Screen
  enabled: Record<Screen, boolean>
  onNavigate: (s: Screen) => void
  onHelp: () => void
  children?: ReactNode
  connected?: boolean
  llmStatus?: { enabled: boolean; provider: string; model: string } | null
}

export function TopBar({ current, enabled, onNavigate, onHelp, children, connected, llmStatus }: Props) {
  const currentIndex = steps.findIndex((s) => s.id === current)

  return (
    <header className="topbar">
      <div className="logo-wrap">
        <div className="acn-logo" aria-label="Accenture">
          {/* The Accenture "greater-than" symbol: a filled chevron with a flat left edge and a flat tip, as in the brand mark */}
          <svg width="24" height="26" viewBox="0 0 33 36" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
            <path d="M0 0L33 13.5V22.5L0 36V26L20.5 17.5L0 9.5Z" fill="#A100FF" />
          </svg>
        </div>
        <div className="logo-divider" />
        <div>
          <div className="logo-name">PI planning assistant</div>
          <div className="logo-sub">Accenture · AI-assisted</div>
        </div>
      </div>

      <nav className="stepper" aria-label="Workflow steps">
        {steps.map((s, i) => {
          const state = s.id === current ? 'current' : i < currentIndex ? 'past' : 'next'
          return (
            <button
              key={s.id}
              className={`step ${state}`}
              disabled={!enabled[s.id]}
              aria-current={s.id === current ? 'step' : undefined}
              title={enabled[s.id] ? `Go to ${s.label}` : s.id === 'results' ? 'Run the analysis to unlock results' : 'Add initiatives to unlock'}
              onClick={() => onNavigate(s.id)}
            >
              <span className="step-num">{i + 1}</span>
              <i className={`ti ${s.icon}`} aria-hidden="true" />
              {s.label}
            </button>
          )
        })}
      </nav>

      <div className="topbar-actions">
        {children}
        {connected !== undefined && (
          <div
            className={`llm-chip ${llmStatus?.enabled ? 'llm-on' : connected ? 'llm-rule' : 'llm-off'}`}
            title={
              !connected ? 'Backend not reachable'
              : llmStatus?.enabled ? `LLM: ${llmStatus.provider} · ${llmStatus.model}`
              : 'Rule-based mode — no LLM key configured'
            }
          >
            <span className="llm-dot" aria-hidden="true" />
            {llmStatus?.enabled ? llmStatus.model : connected ? 'Rule-based' : 'Offline'}
          </div>
        )}
        <ThemePicker />
        <button className="icon-circle" aria-label="Help" title="Help &amp; navigation guide" onClick={onHelp}>
          <i className="ti ti-help" aria-hidden="true" />
        </button>
      </div>
    </header>
  )
}
