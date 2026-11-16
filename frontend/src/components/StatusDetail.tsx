import type { ReactNode } from 'react'
import { plural } from '../lib/deps'
import type { Analysis } from '../types'
import { StatusChip, VelocityChip } from './Chips'
import { Tip } from './Tip'

// The detail that opens under "At a glance" (after Bhasker Rao's Headline, results-timeline-comments):
// one item of the "Before PI planning" list is open at a time. The chips themselves live in AtAGlance, so
// nothing is listed twice.

const CONFLICT = {
  later_quarter: { label: 'Later quarter', icon: 'ti-arrows-cross', hint: 'The provider is targeted at a later quarter than the initiative that waits for it, so the plan as written cannot hold: pull the provider forward or move the consumer after it.' },
  too_tight: { label: 'Tight quarter', icon: 'ti-hourglass-high', hint: 'At its team’s velocity the provider is still running when the consumer’s quarter starts: both are targeted at that quarter, or the provider spills into it from an earlier one. The consumer can only start after it, and then cannot finish inside its quarter. Start the provider first thing, split the work, or move the consumer.' },
  sprint: { label: 'Sprint overlap', icon: 'ti-calendar-x', hint: 'The consumer is planned to start before its provider is planned to finish.' },
} as const

export type Detail = 'conflicts' | 'moved' | 'capacity' | 'size' | 'confirm' | 'comments' | 'gaps' | 'readiness' | 'review'

interface Props {
  analysis: Analysis
  openComments: number
  /** The item whose detail is open. */
  open: Detail | null
  onOpen: (d: Detail | null) => void
  onShowOpenComments: () => void
  onSelectInitiative: (id: string) => void
  onOpenDashboard: () => void
  /** The review and export controls, when the run can be reviewed. */
  review?: ReactNode
  /** Download link for every comment on the backend run (CSV). */
  commentsCsv?: string
}


export function StatusDetail({ analysis, openComments, open, onOpen, onShowOpenComments, onSelectInitiative, onOpenDashboard, review, commentsCsv }: Props) {
  const { notChecked, plan, readiness: r, dependencies: deps } = analysis
  const items = plan?.items ?? []
  const conflicts = plan?.conflicts ?? []
  const later = items.filter((i) => i.targetQuarter && i.pi !== i.targetQuarter)
  const spills = items.filter((i) => i.spills)
  const unsized = items.filter((i) => i.sizeSource === 'assumed' || i.sizeSource === 'none')
  // Hidden links that shape the order: nobody declared them, so the teams should confirm them.
  const toConfirm = deps.filter((d) => !(d.declared ?? !d.inferred) && (d.impact === 'orders' || d.impact === 'soft'))
  const over = (plan?.teams ?? []).flatMap((t) => Object.entries(t.plannedByPi)
    .map(([q, pts]) => ({ team: t, q, pts, cap: t.capacityByPi[q] ?? t.quarterCapacity }))
    .filter((x) => x.cap && x.pts > x.cap))

  const pick = (id: string) => onSelectInitiative(id)

  if (!open) return null
  return (
    <section className="headline" aria-label="Detail">
      {(
        <div className="headline-detail" role="region" aria-label="Detail">
          <button className="icon-btn detail-close" aria-label="Close detail" onClick={() => onOpen(null)}><i className="ti ti-x" aria-hidden="true" /></button>

          {open === 'conflicts' && (
            <>
              <p>These target quarters cannot hold as written:</p>
              <ul className="detail-list">
                {conflicts.map((cf) => (
                  <li key={`${cf.provider}-${cf.consumer}`}>
                    <Tip title={CONFLICT[cf.kind].label} content={CONFLICT[cf.kind].hint}>
                      <span className="pchip imp-orders"><i className={`ti ${CONFLICT[cf.kind].icon}`} aria-hidden="true" /> {CONFLICT[cf.kind].label}</span>
                    </Tip>{' '}
                    <button className="link-btn inline" onClick={() => pick(cf.consumer)}>{cf.consumerLabel}</button> ({cf.consumerQuarter}) waits for{' '}
                    <button className="link-btn inline" onClick={() => pick(cf.provider)}>{cf.providerLabel}</button> ({cf.providerQuarter || cf.providerFinishLabel})
                    {cf.kind === 'too_tight' && <>: the provider finishes {cf.providerFinishLabel}, so it would end {cf.consumerFinishLabel}</>}
                    {' · '}<span className="muted">{cf.declared ? 'declared' : 'hidden'} dependency · recommended start {cf.recommendedStart}</span>
                  </li>
                ))}
              </ul>
              <button className="btn btn-ghost btn-sm" onClick={onOpenDashboard}><i className="ti ti-layout-kanban" aria-hidden="true" /> Decide quarters</button>
            </>
          )}
          {open === 'moved' && (
            <>
              {later.length > 0 && <>
                <p><b>{plural(later.length, 'initiative')}</b> start in a later quarter than the team targeted:</p>
                <ul className="detail-list">
                  {later.map((i) => (
                    <li key={i.id}><button className="link-btn inline" onClick={() => pick(i.id)}>{i.title}</button> · targeted {i.targetQuarter}, starts {i.startLabel}{i.waitsFor.length ? ' (waits for something that lands later or its team is full)' : ''}</li>
                  ))}
                </ul>
              </>}
              {spills.length > 0 && <>
                <p><b>{plural(spills.length, 'initiative')}</b> finish after their target quarter at their team’s velocity:</p>
                <ul className="detail-list">
                  {spills.map((i) => <li key={i.id}><button className="link-btn inline" onClick={() => pick(i.id)}>{i.title}</button> · {i.targetQuarter}, ends {i.finishLabel}</li>)}
                </ul>
              </>}
              <button className="btn btn-ghost btn-sm" onClick={onOpenDashboard}><i className="ti ti-layout-kanban" aria-hidden="true" /> Decide quarters</button>
            </>
          )}
          {open === 'confirm' && (
            <>
              <p>Nobody declared these links, and they shape the order. Open an initiative to keep or dismiss each one after confirming with the two teams:</p>
              <ul className="detail-list">
                {toConfirm.map((d) => (
                  <li key={d.key}>
                    <button className="link-btn inline" onClick={() => pick(d.from)}>{d.fromLabel}</button> → {d.toLabel}
                    {d.toTeam && d.toTeam !== d.toLabel ? ` (${d.toTeam})` : ''}
                    <span className="muted"> · {d.impact === 'orders' ? 'changes the order' : 'should go first'}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
          {open === 'size' && (
            <>
              <p>Not sized in the data, so scheduled as {plan?.defaultSize ?? 'M'}. Open one to set its size for the next run:</p>
              <ul className="detail-list">
                {unsized.map((i) => <li key={i.id}><button className="link-btn inline" onClick={() => pick(i.id)}>{i.title}</button> · {i.teamName}</li>)}
              </ul>
            </>
          )}
          {open === 'capacity' && (
            <>
              <p>The sizes targeted at these quarters add up to more than the team can deliver there:</p>
              <ul className="detail-list">
                {over.map((o) => (
                  <li key={`${o.team.id}-${o.q}`}>
                    <b>{o.team.name}</b> <VelocityChip team={o.team} plan={plan} /> · {o.q}: {o.pts} of {o.cap} pts ({Math.round((100 * o.pts) / o.cap)}%)
                    {' · '}{o.team.initiativeIds.filter((id) => items.find((i) => i.id === id)?.targetQuarter === o.q).map((id, k) => (
                      <span key={id}>{k ? ', ' : ''}<button className="link-btn inline" onClick={() => pick(id)}>{items.find((i) => i.id === id)?.title ?? id}</button></span>
                    ))}
                  </li>
                ))}
              </ul>
              <p className="detail-note">Every team’s load per quarter is on the Decisions screen, which re-checks capacity as you move cards.</p>
              <button className="btn btn-ghost btn-sm" onClick={onOpenDashboard}><i className="ti ti-layout-kanban" aria-hidden="true" /> Decide quarters</button>
            </>
          )}
          {open === 'comments' && (
            <>
              <p>{openComments ? `${plural(openComments, 'comment')} still open.` : 'No open comments yet. Click the bubble on any row of the timeline to add one.'}</p>
              <div className="detail-actions">
                {openComments > 0 && <button className="btn btn-ghost btn-sm" onClick={() => { onShowOpenComments(); onOpen(null) }}>Show only initiatives with open comments</button>}
                {commentsCsv && <a className="btn btn-ghost btn-sm" href={commentsCsv} download><i className="ti ti-message-down" aria-hidden="true" /> Download all comments (CSV)</a>}
              </div>
            </>
          )}
          {open === 'gaps' && (
            <>
              <p>A check that did not run cannot raise a flag, so no flag there does not mean no risk.</p>
              <ul className="detail-list">
                {notChecked.map((n) => <li key={n.code}><b>{n.code}</b> {n.name}{n.partial ? ' (partly checked)' : ''}: {n.reason}.</li>)}
              </ul>
            </>
          )}
          {open === 'readiness' && r && (
            <>
              <p>Only {r.readyStatuses.join(' / ')} is analysed: {r.analysed} of {r.total} initiatives. In Discovery ones are not yet known to be initiatives and Proposed ones are not accepted.</p>
              <div className="readiness">
                {Object.entries(r.byStatus).map(([s, n]) => <span key={s} className="readiness-stat"><StatusChip status={s} /> {n}</span>)}
              </div>
              {[...new Set(r.excluded.map((x) => x.status))].sort((a, b) => Number(b === 'In Discovery') - Number(a === 'In Discovery')).map((s) => {
                const rows = r.excluded.filter((x) => x.status === s)
                return (
                  <details className="excluded" key={s}>
                    <summary><StatusChip status={s} /> {plural(rows.length, 'initiative')}</summary>
                    {rows.map((x) => <div className="excluded-row" key={x.id}><span>{x.title}</span><span className="muted">{x.id} · {x.teamName} · {x.pi}</span></div>)}
                  </details>
                )
              })}
              {r.readyNotAnalysed.length > 0 && <p className="detail-note">{plural(r.readyNotAnalysed.length, 'ready initiative')} not ticked on Intake: {r.readyNotAnalysed.join(', ')}</p>}
            </>
          )}
          {open === 'review' && review}
        </div>
      )}
    </section>
  )
}
