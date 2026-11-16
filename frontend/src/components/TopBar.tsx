import type { ReactNode } from 'react'
import type { Screen } from '../types'
import { SCREENS } from '../lib/screens'
import { ThemePicker } from './ThemePicker'
import { Tip } from './Tip'

const LOCKED: Record<Screen, string> = {
  intake: '',
  pipeline: 'Add initiatives to unlock.',
  results: 'Run the analysis to unlock the results.',
  dashboard: 'Run the analysis to unlock the decision dashboard.',
}

interface Props {
  current: Screen
  enabled: Record<Screen, boolean>
  onNavigate: (s: Screen) => void
  onHelp: () => void
  children?: ReactNode
}

export function TopBar({ current, enabled, onNavigate, onHelp, children }: Props) {
  const currentIndex = SCREENS.findIndex((s) => s.id === current)

  return (
    <header className="topbar">
      <div className="logo-wrap">
        <div className="logo-dot"><i className="ti ti-layers-subtract" aria-hidden="true" /></div>
        <div>
          <div className="logo-name">PI planning assistant</div>
          <div className="logo-sub">PI preparation agent · Financial services</div>
        </div>
      </div>

      <nav className="stepper" aria-label="Workflow steps">
        {SCREENS.map((s, i) => {
          const state = s.id === current ? 'current' : i < currentIndex ? 'past' : 'next'
          return (
            <Tip key={s.id} title={`${i + 1} · ${s.label}`} content={enabled[s.id] ? s.hint : `${s.hint} ${LOCKED[s.id]}`}>
              <button
                className={`step ${state}`}
                disabled={!enabled[s.id]}
                aria-current={s.id === current ? 'step' : undefined}
                onClick={() => onNavigate(s.id)}
              >
                <span className="step-num">{i + 1}</span>
                <i className={`ti ${s.icon}`} aria-hidden="true" />
                <span className="step-label">{s.label}</span>
              </button>
            </Tip>
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
