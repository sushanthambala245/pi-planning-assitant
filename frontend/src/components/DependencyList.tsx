import { useMemo, useState, type ReactNode } from 'react'
import { METHOD, plural } from '../lib/deps'
import { FOUND_BY, IMPACT, IMPACT_ORDER } from '../lib/plan'
import type { PlannerApi } from '../lib/planner'
import type { DependencyRow, Impact } from '../types'
import { ChangeBadge } from './Badges'
import { ImpactChip, NoteField, ProvenanceChip } from './Chips'
import { DepDetail } from './DepDetail'
import { Tip } from './Tip'

interface RowProps {
  dep: DependencyRow
  open: boolean
  onToggle: () => void
  labelOf: (k: string) => string
  planner?: PlannerApi
  /** Shown before the names, e.g. the provider team being over capacity. */
  flag?: ReactNode
}

/** One dependency link: what it is, where it came from, what it does to the plan; open for the evidence and notes. */
export function DependencyItem({ dep, open, onToggle, labelOf, planner, flag }: RowProps) {
  const decision = planner?.input.dependencyDecisions[dep.key] ?? ''
  const note = planner?.input.dependencyNotes[dep.key] ?? ''
  const sentDecision = dep.decision
  return (
    <div className={`dl-row${open ? ' open' : ''}${decision === 'dismissed' ? ' dismissed' : ''}`}>
      <div className="dl-head">
        <button className="dl-toggle" aria-expanded={open} onClick={onToggle}>
          <i className={`ti ${open ? 'ti-chevron-down' : 'ti-chevron-right'}`} aria-hidden="true" />
          <span className="dl-names">{dep.fromLabel} <i className="ti ti-arrow-right" aria-hidden="true" /> {dep.toLabel}
            {dep.toTeam && dep.toTeam !== dep.toLabel && <span className="dl-team"> · {dep.toTeam}</span>}
          </span>
        </button>
        <span className="dl-chips">
          {flag}
          {dep.provenance && <ProvenanceChip value={dep.provenance} />}
          {dep.impact && <ImpactChip value={dep.impact} />}
          <ChangeBadge type={dep.changeType} short />
          {(note || decision) && (
            <Tip title="Planner input" content={`${decision ? `Marked “${decision === 'confirmed' ? 'Keep' : 'Dismiss'}”. ` : ''}${note ? `Note: ${note}` : ''} Sent with the next run.`}>
              <i className="ti ti-notes dl-noted" aria-label="Has planner input" />
            </Tip>
          )}
        </span>
      </div>
      {!open && <div className="dl-reason">{dep.reason}</div>}
      {open && (
        <div className="dl-body">
          <DepDetail dep={dep} labelOf={labelOf} />
          {planner && (
            <div className="dl-planner">
              <div className="dl-planner-head">
                <span>Your call for the next run</span>
                {sentDecision && <span className="dl-sent">This run used: {sentDecision === 'confirmed' ? 'Keep' : 'Dismiss'}</span>}
              </div>
              <div className="seg" role="group" aria-label="Keep or dismiss this dependency">
                <Tip title="Keep" content="The teams confirm it. It becomes user-defined (provenance: Planner) and always passes the confidence check, so it keeps ordering the plan.">
                  <button className={`seg-btn${decision === 'confirmed' ? ' active' : ''}`} aria-pressed={decision === 'confirmed'}
                    onClick={() => planner.setDecision(dep.key, decision === 'confirmed' ? '' : 'confirmed')}>
                    <i className="ti ti-check" aria-hidden="true" /> Keep
                  </button>
                </Tip>
                <Tip title="Dismiss" content="Not a real dependency. The next run rejects it (and says a planner dismissed it), so it no longer orders the plan or raises risks. Your note is kept as the reason.">
                  <button className={`seg-btn${decision === 'dismissed' ? ' active' : ''}`} aria-pressed={decision === 'dismissed'}
                    onClick={() => planner.setDecision(dep.key, decision === 'dismissed' ? '' : 'dismissed')}>
                    <i className="ti ti-x" aria-hidden="true" /> Dismiss
                  </button>
                </Tip>
              </div>
              <NoteField value={note} onChange={(t) => planner.setDepNote(dep.key, t)}
                placeholder="Note for this link (why keep or dismiss, what the teams agreed)…"
                hint="Saved in this browser and sent with the next run." />
            </div>
          )}
        </div>
      )}
    </div>
  )
}

interface ListProps {
  deps: DependencyRow[]
  labelOf: (k: string) => string
  planner?: PlannerApi
  /** How to group: by what the link does to the plan, or by the dependent initiative. */
  groupBy: 'impact' | 'initiative'
  /** Groups open by default (the rest start collapsed). */
  openGroups?: string[]
  flagFor?: (d: DependencyRow) => ReactNode
  empty?: string
}

const LIMIT = 40

export function DependencyList({ deps, labelOf, planner, groupBy, openGroups = [], flagFor, empty = 'No dependency matches the filter.' }: ListProps) {
  const [open, setOpen] = useState<string | null>(null)
  const [shown, setShown] = useState<Record<string, number>>({})
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  const groups = useMemo(() => {
    const m = new Map<string, DependencyRow[]>()
    for (const d of deps) {
      const k = groupBy === 'impact' ? (d.impact ?? 'aware') : d.from
      m.set(k, [...(m.get(k) ?? []), d])
    }
    const keys = groupBy === 'impact'
      ? IMPACT_ORDER.filter((k) => m.has(k))
      : [...m.keys()].sort((a, b) => (m.get(a)![0].fromLabel).localeCompare(m.get(b)![0].fromLabel))
    return keys.map((k) => ({ key: k, rows: m.get(k)! }))
  }, [deps, groupBy])

  if (!deps.length) return <div className="list-empty">{empty}</div>
  return (
    <div className="dl">
      {groups.map(({ key, rows }) => {
        const isOpen = collapsed[key] === undefined ? (openGroups.includes(key) || groups.length === 1) : !collapsed[key]
        const limit = shown[key] ?? LIMIT
        const head = groupBy === 'impact'
          ? { icon: IMPACT[key as Impact].icon, label: IMPACT[key as Impact].label, hint: IMPACT[key as Impact].hint }
          : { icon: 'ti-target', label: rows[0].fromLabel, hint: `${rows[0].fromLabel} (${key}): ${plural(rows.length, 'declared dependency', 'declared dependencies')} from its own dependency column.` }
        const methods = [...new Set(rows.flatMap((r) => r.methods))]
        return (
          <section className={`dl-group${isOpen ? ' open' : ''}`} key={key}>
            <div className="dl-group-head">
              <button className="dl-group-toggle" aria-expanded={isOpen} onClick={() => setCollapsed((c) => ({ ...c, [key]: isOpen }))}>
                <i className={`ti ${isOpen ? 'ti-chevron-down' : 'ti-chevron-right'}`} aria-hidden="true" />
                <i className={`ti ${head.icon} dl-group-icon${groupBy === 'impact' ? ` imp-text-${key}` : ''}`} aria-hidden="true" />
                <span className="dl-group-label">{head.label}</span>
                <span className="dl-group-n">{rows.length}</span>
              </button>
              <Tip title={head.label} content={head.hint} wide className="info-tip" focusable>
                <i className="ti ti-info-circle" aria-label={`About ${head.label}`} />
              </Tip>
              <span className="dl-group-methods">
                {methods.map((m) => (
                  <Tip key={m} title={FOUND_BY[m]?.label ?? m} content={FOUND_BY[m]?.hint ?? ''}>
                    <span className="method-chip"><i className={`ti ${FOUND_BY[m]?.icon ?? 'ti-search'}`} aria-hidden="true" /> {METHOD[m] ?? m} {rows.filter((r) => r.methods.includes(m)).length}</span>
                  </Tip>
                ))}
              </span>
            </div>
            {isOpen && (
              <div className="dl-group-body">
                {rows.slice(0, limit).map((d) => (
                  <DependencyItem key={d.key} dep={d} open={open === d.key} onToggle={() => setOpen((o) => (o === d.key ? null : d.key))}
                    labelOf={labelOf} planner={planner} flag={flagFor?.(d)} />
                ))}
                {rows.length > limit && (
                  <button className="link-btn dl-more" onClick={() => setShown((s) => ({ ...s, [key]: limit + LIMIT }))}>
                    Show {Math.min(LIMIT, rows.length - limit)} more of {rows.length - limit}
                  </button>
                )}
              </div>
            )}
          </section>
        )
      })}
    </div>
  )
}
