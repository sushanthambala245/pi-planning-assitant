import type { ReactNode } from 'react'

interface Props {
  children?: ReactNode
}

export function TopBar({ children }: Props) {
  return (
    <div className="topbar">
      <div className="logo-wrap">
        <div className="logo-dot"><i className="ti ti-layers-subtract" aria-hidden="true" /></div>
        <div>
          <div className="logo-name">PI planning assistant</div>
          <div className="logo-sub">Preparation · Financial services</div>
        </div>
      </div>
      <div className="topbar-actions">{children}</div>
    </div>
  )
}

interface BadgeProps {
  icon: string
  label: string
  success?: boolean
}

export function StepBadge({ icon, label, success }: BadgeProps) {
  return (
    <span className={`step-badge${success ? ' success' : ''}`}>
      <i className={`ti ${icon}`} aria-hidden="true" /> {label}
    </span>
  )
}
