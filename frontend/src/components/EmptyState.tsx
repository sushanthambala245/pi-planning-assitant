import type { ReactNode } from 'react'

interface Props {
  icon: string
  title: string
  children?: ReactNode
  actions?: ReactNode
}

export function EmptyState({ icon, title, children, actions }: Props) {
  return (
    <div className="empty-state">
      <div className="empty-icon"><i className={`ti ${icon}`} aria-hidden="true" /></div>
      <div className="empty-title">{title}</div>
      {children && <div className="empty-text">{children}</div>}
      {actions && <div className="empty-actions">{actions}</div>}
    </div>
  )
}
