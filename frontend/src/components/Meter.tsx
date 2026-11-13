import type { ReactNode } from 'react'
import { Tip } from './Tip'

export type LoadStatus = 'ok' | 'near' | 'over' | 'none'

export function loadStatus(points: number, capacity: number): LoadStatus {
  if (!capacity) return points ? 'over' : 'none'
  const pct = points / capacity
  return pct > 1 ? 'over' : pct > 0.85 ? 'near' : points ? 'ok' : 'none'
}

const WORD: Record<LoadStatus, { label: string; icon: string }> = {
  ok: { label: 'Within capacity', icon: 'ti-circle-check' },
  near: { label: 'Near capacity', icon: 'ti-alert-circle' },
  over: { label: 'Over capacity', icon: 'ti-alert-triangle' },
  none: { label: 'Nothing placed', icon: 'ti-circle-dashed' },
}

/**
 * Story points placed against a team's capacity. The fill is the load (capped at the track), the
 * status is said in an icon and a word as well as a colour, and the tooltip gives the numbers and
 * the initiatives behind them.
 */
export function Meter({ points, capacity, detail, compact = false }: { points: number; capacity: number; detail?: ReactNode; compact?: boolean }) {
  const status = loadStatus(points, capacity)
  const pct = capacity ? Math.round((100 * points) / capacity) : 0
  const w = WORD[status]
  return (
    <Tip title={`${w.label}: ${points} of ${capacity || '—'} story points (${capacity ? `${pct}%` : 'no capacity data'})`}
      content={<>
        {detail}
        <div className="tip-foot">Green: up to 85% of the team’s capacity in that quarter · amber: 85–100% · red: more than the team can deliver, so something slips. Capacity is the team’s available story points per quarter (team capacity file).</div>
      </>} wide>
      <div className={`meter m-${status}${compact ? ' compact' : ''}`} role="img" aria-label={`${w.label}: ${points} of ${capacity} points`}>
        <div className="meter-track"><div className="meter-fill" style={{ width: `${Math.min(100, pct)}%` }} /></div>
        <div className="meter-text">
          <i className={`ti ${w.icon}`} aria-hidden="true" />
          <span>{points}/{capacity || '—'}</span>
          {!compact && <span className="meter-pct">{capacity ? `${pct}%` : ''}</span>}
        </div>
      </div>
    </Tip>
  )
}
