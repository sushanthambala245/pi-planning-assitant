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
}

export function TopBar({ current, enabled, onNavigate, onHelp, children }: Props) {
  const currentIndex = steps.findIndex((s) => s.id === current)

  return (
    <header className="topbar">
      <div className="logo-wrap">
        <div className="logo-dot"><i className="ti ti-layers-subtract" aria-hidden="true" /></div>
        <div>
          <div className="logo-name">PI planning assistant</div>
          <div className="logo-sub">Preparation · Financial services</div>
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
        <ThemePicker />
        <button className="icon-circle" aria-label="Help" title="Help &amp; navigation guide" onClick={onHelp}>
          <i className="ti ti-help" aria-hidden="true" />
        </button>
      </div>
    </header>
  )
}
