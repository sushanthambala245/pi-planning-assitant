import type { DependencyRow, Finding } from '../types'
import { ChangeBadge } from './Badges'
import { DepDetail } from './DepDetail'
import { SystemChips, systemsSummary } from './SystemChips'

interface Props {
  finding: Finding
  /** The dependency row this finding is about, when there is one. */
  dep?: DependencyRow
  expanded: boolean
  onToggle: () => void
  labelOf?: (key: string) => string
  /** Shown before a systems summary when the row is not under its initiative's heading. */
  prefix?: string
}

function Details({ f, dep, labelOf, full }: { f: Finding; dep?: DependencyRow; labelOf?: (k: string) => string; full: boolean }) {
  return (
    <>
      {f.systems && f.systems.length > 0 && <SystemChips systems={f.systems} />}
      {dep && <DepDetail dep={dep} labelOf={labelOf} compact={!full} />}
      {f.note && <div className="fsub"><span className="fsub-label">{dep ? 'Raw evidence' : 'Note'}</span> {f.note}</div>}
      {!f.systems?.length && !dep && f.text.length > 90 && <div className="ftext-full">{f.text}</div>}
    </>
  )
}

/** One finding as a single line: hover for a preview, double-click (or the chevron, or Enter) to expand. */
export function FindingRow({ finding: f, dep, expanded, onToggle, labelOf, prefix }: Props) {
  const headline = f.systems?.length ? `${prefix ? `${prefix} — ` : ''}${systemsSummary(f.systems)}` : f.text
  const hasDetails = !!(f.note || f.systems?.length || dep || f.text.length > 90)
  const change = f.changeType ?? dep?.changeType

  return (
    <div
      className={`finding-row${f.highlight ? ' hi' : ''}${expanded ? ' open' : ''}`}
      role="button"
      tabIndex={0}
      aria-expanded={expanded}
      title={expanded ? undefined : hasDetails ? undefined : f.text}
      onMouseDown={(e) => e.detail > 1 && e.preventDefault()} // no text selection on double-click
      onDoubleClick={onToggle}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onToggle()
        }
      }}
    >
      <div className="finding-head">
        <span className={`ftag ${f.tag}`}>{f.tagLabel}</span>
        {change && <ChangeBadge type={change} short />}
        <span className="ftext">{headline}</span>
        {hasDetails && (
          <button
            className="icon-btn chevron"
            tabIndex={-1}
            aria-label={expanded ? 'Collapse details' : 'Expand details'}
            onClick={(e) => { e.stopPropagation(); onToggle() }}
            onDoubleClick={(e) => e.stopPropagation()}
          >
            <i className={`ti ${expanded ? 'ti-chevron-down' : 'ti-chevron-right'}`} aria-hidden="true" />
          </button>
        )}
      </div>
      {expanded ? (
        <div className="finding-body"><Details f={f} dep={dep} labelOf={labelOf} full /></div>
      ) : (
        hasDetails && (
          <div className="hover-card" role="tooltip">
            <Details f={f} dep={dep} labelOf={labelOf} full={false} />
            <div className="hover-hint"><i className="ti ti-hand-click" aria-hidden="true" /> Double-click to keep the details open</div>
          </div>
        )
      )}
    </div>
  )
}
