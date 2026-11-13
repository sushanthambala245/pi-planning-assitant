import type { Notice } from '../types'

interface Props {
  notices: Notice[]
  onDismiss: (id: number) => void
  onClear: () => void
}

/** Messages from loading data and running the agents, newest first; shown on every screen. */
export function Notices({ notices, onDismiss, onClear }: Props) {
  if (!notices.length) return null
  return (
    <div className="notices-wrap">
      <div className="notices" aria-live="polite">
        {notices.map((n) => (
          <div key={n.id} className={`notice ${n.kind}`}>
            <i className={`ti ${n.kind === 'ok' ? 'ti-circle-check' : 'ti-alert-circle'}`} aria-hidden="true" />
            <span>{n.text}</span>
            <button className="icon-btn" aria-label="Dismiss" onClick={() => onDismiss(n.id)}>
              <i className="ti ti-x" aria-hidden="true" />
            </button>
          </div>
        ))}
      </div>
      {notices.length > 1 && (
        <button className="link-btn notices-clear" onClick={onClear}>
          <i className="ti ti-eraser" aria-hidden="true" /> Clear all messages
        </button>
      )}
    </div>
  )
}
