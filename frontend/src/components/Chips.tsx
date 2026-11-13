import { useEffect, useState } from 'react'
import { IMPACT, PRIORITY_HINT, PROVENANCE, SIZE_SOURCE, SIZES, bucketLabel, prioClass, tshirtHint, velocityHint, type Scale } from '../lib/plan'
import type { Impact, Plan, PlanTeam, Provenance, SizeSource } from '../types'
import { Tip } from './Tip'

/** Declared / planner / in the text / inferred, with what that means. */
export function ProvenanceChip({ value }: { value: Provenance }) {
  const p = PROVENANCE[value]
  return (
    <Tip title={`${p.label}${p.hidden ? ' · hidden dependency' : ' · user-defined'}`} content={p.hint} wide>
      <span className={`pchip prov-${value}`}><i className={`ti ${p.icon}`} aria-hidden="true" /> {p.label}</span>
    </Tip>
  )
}

/** What a link does to the plan. */
export function ImpactChip({ value }: { value: Impact }) {
  const i = IMPACT[value]
  return (
    <Tip title={i.label} content={i.hint} wide>
      <span className={`pchip imp-${value}`}><i className={`ti ${i.icon}`} aria-hidden="true" /> {i.label}</span>
    </Tip>
  )
}

export function SizeChip({ size, points, source, plan }: { size?: string | null; points?: number; source?: SizeSource; plan?: Scale | null }) {
  const unsized = !size || source === 'assumed' || source === 'none'
  return (
    <Tip title={size ? `Size ${size}${points != null ? ` · ${points} story points` : ''}` : 'Not sized'}
      content={<>{tshirtHint(plan)}{source && <><br /><br /><b>This one:</b> {SIZE_SOURCE[source]}</>}</>} wide>
      <span className={`size-chip${unsized ? ' unsized' : ''}${source === 'planner' ? ' planner' : ''}`}>
        {size ?? '?'}{source === 'assumed' && '*'}
      </span>
    </Tip>
  )
}

export function QuarterChip({ quarter, kind = 'target', note }: { quarter: string; kind?: 'target' | 'recommended' | 'planner'; note?: string }) {
  const what = {
    target: 'Target quarter from the initiatives file: the quarter the team planned it for (the user-defined sequence).',
    recommended: 'The quarter the recommended plan starts it in, after its dependencies and its team’s capacity.',
    planner: 'Placed in this quarter by a planner on the decision dashboard. The next run treats it as the target.',
  }[kind]
  return (
    <Tip title={`${kind === 'recommended' ? 'Recommended' : kind === 'planner' ? 'Decided' : 'Targeted'}: ${bucketLabel(quarter)}`} content={note ? `${what} ${note}` : what}>
      <span className={`q-chip q-${kind}`}>{quarter ? bucketLabel(quarter) : '—'}</span>
    </Tip>
  )
}

export function PriorityChip({ priority }: { priority: string }) {
  if (!priority) return null
  return (
    <Tip title={`Priority: ${priority}`} content={PRIORITY_HINT}>
      <span className={prioClass(priority)}>{priority}</span>
    </Tip>
  )
}

export function VelocityChip({ team, plan }: { team: PlanTeam; plan?: Plan | null }) {
  return (
    <Tip title={`Velocity tier ${team.tier ?? '—'}`} content={velocityHint(team, plan)} wide>
      <span className={`vel-chip vel-${(team.tier ?? 'na').toLowerCase()}`}>{team.tier ?? '—'}</span>
    </Tip>
  )
}

const STATUS_HINT: Record<string, string> = {
  'ready for pi planning': 'Ready for PI Planning: the team has confirmed it is an initiative and it is ready to plan. Only these are analysed.',
  'in discovery': 'In Discovery: the team is still working out whether this is an initiative at all, so it cannot be ready for PI planning. Left out of the analysis.',
  proposed: 'Proposed: suggested but not yet accepted. Left out of the analysis until it is Ready for PI Planning.',
}

export function StatusChip({ status }: { status?: string }) {
  const s = (status || '').trim()
  const key = s.toLowerCase()
  const cls = key === 'ready for pi planning' ? 'ready' : key === 'in discovery' ? 'discovery' : key === 'proposed' ? 'proposed' : 'other'
  return (
    <Tip title={s || 'No status'} content={STATUS_HINT[key] ?? 'Only initiatives with status Ready for PI Planning are analysed.'}>
      <span className={`status-chip st-${cls}`}>{s || 'No status'}</span>
    </Tip>
  )
}

/** A planner's T-shirt size for the next run ('' = the data's size). */
export function SizeSelect({ value, dataSize, onChange }: { value: string; dataSize?: string; onChange: (v: string) => void }) {
  return (
    <Tip title="Change the size for the next run" content="The rerun schedules the initiative with the points of this size, against its team’s capacity. Leave it on the data’s size to keep the initiatives file as it is.">
      <select className="select select-sm" value={value} aria-label="T-shirt size for the next run" onChange={(e) => onChange(e.target.value)}>
        <option value="">{dataSize ? `${dataSize} (data)` : 'Not sized'}</option>
        {SIZES.map((s) => <option key={s} value={s}>{s}</option>)}
      </select>
    </Tip>
  )
}

/** A note field that saves on blur (and after a pause), so typing stays fast. */
export function NoteField({ value, onChange, placeholder, hint }: { value: string; onChange: (v: string) => void; placeholder: string; hint?: string }) {
  const [text, setText] = useState(value)
  useEffect(() => setText(value), [value])
  useEffect(() => {
    if (text === value) return
    const t = window.setTimeout(() => onChange(text), 600)
    return () => window.clearTimeout(t)
  }, [text, value, onChange])
  return (
    <div className="note-field">
      <textarea value={text} placeholder={placeholder} rows={2} maxLength={2000}
        onChange={(e) => setText(e.target.value)} onBlur={() => text !== value && onChange(text)} />
      {hint && <div className="note-hint"><i className="ti ti-info-circle" aria-hidden="true" /> {hint}</div>}
    </div>
  )
}
