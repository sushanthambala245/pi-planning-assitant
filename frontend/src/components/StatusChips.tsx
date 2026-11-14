import type { ReactNode } from 'react'
import { plural } from '../lib/deps'
import type { Analysis } from '../types'
import { StatusChip, VelocityChip } from './Chips'
import { Tip } from './Tip'

// The status chips over the delivery timeline (after Bhasker Rao's Headline, results-timeline-comments).
// A chip appears only for what the chart cannot show and only when its number is not zero: spills, unsized
// work, risks and comment counts are already on the bars, the Risks tab and the row bubbles.

const CONFLICT = {
  later_quarter: { label: 'Later quarter', icon: 'ti-arrows-cross', hint: 'The provider is targeted at a later quarter than the initiative that waits for it, so the plan as written cannot hold: pull the provider forward or move the consumer after it.' },
  too_tight: { label: 'Tight quarter', icon: 'ti-hourglass-high', hint: 'At its team’s velocity the provider is still running when the consumer’s quarter starts: both are targeted at that quarter, or the provider spills into it from an earlier one. The consumer can only start after it, and then cannot finish inside its quarter. Start the provider first thing, split the work, or move the consumer.' },
  sprint: { label: 'Sprint overlap', icon: 'ti-calendar-x', hint: 'The consumer is planned to start before its provider is planned to finish.' },
} as const

export type Detail = 'conflicts' | 'capacity' | 'comments' | 'gaps' | 'readiness' | 'review'

interface Props {
  analysis: Analysis
  openComments: number
  /** The chip whose detail is open. */
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

type Chip = { id: Detail; icon: string; text: string; tone: 'd' | 'w' | 'a' | 'n'; tip: string }

export function StatusChips({ analysis, openComments, open, onOpen, onShowOpenComments, onSelectInitiative, onOpenDashboard, review, commentsCsv }: Props) {
  const { notChecked, plan, readiness: r } = analysis
  const toggle = (d: Detail) => onOpen(open === d ? null : d)
  const c = plan?.counts
  const items = plan?.items ?? []
  const conflicts = plan?.conflicts ?? []
  const over = (plan?.teams ?? []).flatMap((t) => Object.entries(t.plannedByPi)
    .map(([q, pts]) => ({ team: t, q, pts, cap: t.capacityByPi[q] ?? t.quarterCapacity }))
    .filter((x) => x.cap && x.pts > x.cap))
  const skipped = notChecked.filter((n) => !n.partial).length

  const chips: Chip[] = [
    ...(conflicts.length ? [{
      id: 'conflicts' as const, icon: 'ti-arrows-cross', tone: 'd' as const, text: `${plural(conflicts.length, 'conflict')} in target quarters`,
      tip: 'A team targeted a quarter that cannot hold once what it waits for, and its own team’s velocity, are counted.',
    }] : []),
    ...(over.length ? [{
      id: 'capacity' as const, icon: 'ti-gauge', tone: 'd' as const, text: `${plural(c?.teamsOver ?? new Set(over.map((o) => o.team.id)).size, 'team')} over capacity`,
      tip: 'The T-shirt sizes targeted at a quarter add up to more story points than the team can deliver in it (team capacity file). The plan moves the lowest-priority work later.',
    }] : []),
    ...(openComments ? [{
      id: 'comments' as const, icon: 'ti-message-circle', tone: 'a' as const, text: plural(openComments, 'open comment'),
      tip: 'Live feedback on the initiatives, per run: concerns, questions, decisions and actions, with who raised them.',
    }] : []),
    ...(notChecked.length ? [{
      id: 'gaps' as const, icon: 'ti-eye-off', tone: 'w' as const, text: `${skipped || notChecked.length} check${(skipped || notChecked.length) === 1 ? '' : 's'} not run`,
      tip: 'Risk checks whose source is not in the knowledge base: no flag there does not mean no risk.',
    }] : []),
    ...(r && r.excluded.length ? [{
      id: 'readiness' as const, icon: 'ti-filter-off', tone: 'n' as const, text: `${r.excluded.length} left out`,
      tip: `Only ${r.readyStatuses.join(' / ')} is analysed: In Discovery and Proposed initiatives are left out of the dependencies, the plan and the capacity counts.`,
    }] : []),
  ]

  const pick = (id: string) => onSelectInitiative(id)

  return (
    <section className="headline" aria-label="Status">
      <div className="headline-row">
        <div className="headline-main">
          <div className="chips">
            {chips.map((ch) => (
              <Tip key={ch.id} content={ch.tip}>
                <button className={`status-chip ${ch.tone}${open === ch.id ? ' on' : ''}`} aria-expanded={open === ch.id} onClick={() => toggle(ch.id)}>
                  <i className={`ti ${ch.icon}`} aria-hidden="true" /> {ch.text}
                </button>
              </Tip>
            ))}
          </div>
        </div>
        {review && (
          <button className={`btn ${open === 'review' ? 'btn-ghost' : 'btn-primary'} btn-sm`} aria-expanded={open === 'review'} onClick={() => toggle('review')}>
            <i className="ti ti-user-check" aria-hidden="true" /> Review and approve
          </button>
        )}
      </div>

      {open && (
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
