import type { ReactNode } from 'react'
import { plural } from '../lib/deps'
import type { Analysis } from '../types'
import { StatusChip, VelocityChip } from './Chips'
import { Tip } from './Tip'

// The status chips over the delivery timeline (after Bhasker Rao's Headline, results-timeline-comments):
// a few chips, each opening its detail on click, so nothing is said twice on the page.

export type Detail = 'moved' | 'capacity' | 'size' | 'risks' | 'comments' | 'jira' | 'gaps' | 'readiness' | 'why' | 'review'

interface Props {
  analysis: Analysis
  openComments: number
  /** The chip whose detail is open (controlled, so "Before PI planning" can open one too). */
  open: Detail | null
  onOpen: (d: Detail | null) => void
  onShowOpenComments: () => void
  onShowRisks: () => void
  onSelectInitiative: (id: string) => void
  onOpenDashboard: () => void
  onViewAnalysis: () => void
  /** The review and export controls, when the run can be reviewed. */
  review?: ReactNode
  /** Download link for every comment on the backend run (CSV). */
  commentsCsv?: string
}

type Chip = { id: Detail; icon: string; text: string; tone: 'd' | 'w' | 'a' | 'n'; tip: string }

export function StatusChips({ analysis, openComments, open, onOpen, onShowOpenComments, onShowRisks, onSelectInitiative, onOpenDashboard, onViewAnalysis, review, commentsCsv }: Props) {
  const { steps, dependencies: deps, notChecked, risks, plan, readiness: r } = analysis
  const toggle = (d: Detail) => onOpen(open === d ? null : d)
  const c = plan?.counts
  const items = plan?.items ?? []
  const later = items.filter((i) => i.targetQuarter && i.pi !== i.targetQuarter)
  const spills = items.filter((i) => i.spills)
  const unsized = items.filter((i) => i.sizeSource === 'assumed' || i.sizeSource === 'none')
  const over = (plan?.teams ?? []).flatMap((t) => Object.entries(t.plannedByPi)
    .map(([q, pts]) => ({ team: t, q, pts, cap: t.capacityByPi[q] ?? t.quarterCapacity }))
    .filter((x) => x.cap && x.pts > x.cap))
  const notInJira = deps.filter((d) => d.inJira === false).length
  const skipped = notChecked.filter((n) => !n.partial).length
  const high = risks.filter((x) => x.severity === 'High').length

  const chips: Chip[] = [
    ...(later.length || spills.length ? [{
      id: 'moved' as const, icon: 'ti-calendar-time', tone: later.length ? 'd' as const : 'w' as const,
      text: [later.length && `${later.length} start a quarter later`, spills.length && `${spills.length} spill over`].filter(Boolean).join(' · '),
      tip: 'Against the quarter each team targeted: some start later because what they wait for lands later or their team is full, and some finish after their quarter ends.',
    }] : []),
    ...(over.length ? [{
      id: 'capacity' as const, icon: 'ti-gauge', tone: 'd' as const, text: `${plural(c?.teamsOver ?? new Set(over.map((o) => o.team.id)).size, 'team')} over capacity`,
      tip: 'The T-shirt sizes targeted at a quarter add up to more story points than the team can deliver in it (team capacity file). The plan moves the lowest-priority work later.',
    }] : []),
    ...(unsized.length ? [{
      id: 'size' as const, icon: 'ti-ruler-measure', tone: 'w' as const, text: `${unsized.length} not sized`,
      tip: `No T-shirt size in the initiatives file: scheduled as ${plan?.defaultSize ?? 'M'} until someone sizes it.`,
    }] : []),
    ...(risks.length ? [{
      id: 'risks' as const, icon: 'ti-flag', tone: high ? 'd' as const : 'w' as const, text: `${plural(risks.length, 'risk flag')}${high ? ` · ${high} high` : ''}`,
      tip: 'Flags from the Dependency Risk Index rules: plan conflicts, missing owners, contracts, deprecated systems, capacity and cycles.',
    }] : []),
    {
      id: 'comments', icon: 'ti-message-circle', tone: openComments ? 'a' : 'n', text: plural(openComments, 'open comment'),
      tip: 'Live feedback on the initiatives, per run: concerns, questions, decisions and actions, with who raised them.',
    },
    ...(notInJira ? [{
      id: 'jira' as const, icon: 'ti-ticket', tone: 'w' as const, text: `${notInJira} not in Jira`,
      tip: 'Dependency links with no Jira blocked-by link. Approving the run exports them as link proposals.',
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
            <button className={`link-btn${open === 'why' ? ' on' : ''}`} aria-expanded={open === 'why'} onClick={() => toggle('why')}>
              Why this order?
            </button>
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

          {open === 'moved' && (
            <>
              {later.length > 0 && <>
                <p><b>{plural(later.length, 'initiative')}</b> start in a later quarter than the team targeted:</p>
                <ul className="detail-list">
                  {later.map((i) => (
                    <li key={i.id}><button className="link-btn inline" onClick={() => pick(i.id)}>{i.title}</button> · targeted {i.targetQuarter}, starts {i.startLabel}{i.waitsFor.length ? ' (waits for something that lands later)' : ' (its team is full)'}</li>
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
          {open === 'size' && (
            <>
              <p>Not sized in the data, so scheduled as {plan?.defaultSize ?? 'M'}. Open one to set its size for the next run:</p>
              <ul className="detail-list">
                {unsized.map((i) => <li key={i.id}><button className="link-btn inline" onClick={() => pick(i.id)}>{i.title}</button> · {i.teamName}</li>)}
              </ul>
            </>
          )}
          {open === 'risks' && (
            <>
              <p>{plural(risks.length, 'risk')} flagged by the rules that ran{high ? `, ${high} of them high` : ''}.</p>
              <button className="btn btn-ghost btn-sm" onClick={() => { onShowRisks(); onOpen(null) }}>Show the risks</button>
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
          {open === 'jira' && (
            <p><b>{notInJira}</b> of {plural(deps.length, 'dependency link')} {notInJira === 1 ? 'has' : 'have'} no Jira blocked-by link. Approving the run exports them as link proposals; nothing is written to Jira.</p>
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
          {open === 'why' && (
            <>
              <p>Every initiative starts no earlier than its target quarter, the sprint after everything it waits for has finished, and when its team has room, higher priority first. The dependency order alone, as steps:</p>
              <ol className="detail-steps">
                {steps.map((s) => (
                  <li key={s.step}><b>Step {s.step}</b> {s.initiativeIds.length > 6 ? `${plural(s.initiativeIds.length, 'initiative')} that wait on nothing earlier` : s.label}{s.inCycle ? ' (cycle: break it first)' : ''}{s.why ? `: ${s.why}` : ''}</li>
                ))}
              </ol>
              <button className="link-btn" onClick={onViewAnalysis}><i className="ti ti-topology-star-3" aria-hidden="true" /> How was this analysed?</button>
            </>
          )}
          {open === 'review' && review}
        </div>
      )}
    </section>
  )
}
