import { useState, type ReactNode } from 'react'
import { needsChange, plural } from '../lib/deps'
import type { Analysis } from '../types'

type Detail = 'spill' | 'comments' | 'jira' | 'gaps' | 'confirm' | 'risks' | 'why' | 'review'

interface Props {
  analysis: Analysis
  openComments: number
  /** Show only the initiatives that have open comments. */
  onShowOpenComments: () => void
  onShowDependencies: () => void
  onShowRisks: () => void
  onSelectInitiative: (id: string) => void
  onViewAnalysis: () => void
  /** The review and export controls, when the run can be reviewed. */
  review?: ReactNode
}

const names = (t: string[]) =>
  t.length <= 1 ? (t[0] ?? '')
    : t.length <= 3 ? `${t.slice(0, -1).join(', ')} and ${t[t.length - 1]}`
      : `${t.slice(0, 3).join(', ')} and ${t.length - 3} more`

/** One sentence and a few status chips. Detail opens on click, so nothing is said twice on the page. */
export function Headline({ analysis, openComments, onShowOpenComments, onShowDependencies, onShowRisks, onSelectInitiative, onViewAnalysis, review }: Props) {
  const [open, setOpen] = useState<Detail | null>(null)
  const { steps, schedule, dependencies: deps, notChecked, risks, initiatives } = analysis
  const title = (id: string) => initiatives.find((i) => i.id === id)?.title ?? id
  const toggle = (d: Detail) => setOpen((o) => (o === d ? null : d))

  const first = steps[0]?.initiativeIds ?? []
  const later = (steps.flatMap((s) => s.initiativeIds).length || initiatives.length) - first.length
  const spilled = schedule?.rows.filter((r) => r.spillsPastPi) ?? []
  const cycle = steps.find((s) => s.inCycle)
  const sentence = [
    first.length ? `Start with ${names(first.map(title))}${later > 0 ? `; ${plural(later, 'other initiative')} follow${later === 1 ? 's' : ''}` : ''}.` : '',
    spilled.length ? `${names(spilled.map((r) => title(r.initiativeId)))} ${spilled.length === 1 ? 'ends' : 'end'} after the PI.` : '',
    cycle ? 'Some initiatives depend on each other: break that cycle first.' : '',
  ].filter(Boolean).join(' ') || 'No recommended order was produced.'

  const notInJira = deps.filter((d) => d.inJira === false).length
  const confirm = deps.filter((d) => d.verdict === 'inferred_only' && needsChange(d.changeType))
  const skipped = notChecked.filter((n) => !n.partial).length

  type Chip = { id: Detail; icon: string; text: string; tone: 'd' | 'w' | 'a' | 'n' }
  const chips: Chip[] = [
    ...(spilled.length ? [{ id: 'spill' as const, icon: 'ti-alert-triangle', tone: 'd' as const, text: `${spilled.length} spill${spilled.length === 1 ? 's' : ''} past the PI` }] : []),
    ...(risks.length ? [{ id: 'risks' as const, icon: 'ti-flag', tone: 'd' as const, text: plural(risks.length, 'risk flag') }] : []),
    { id: 'comments', icon: 'ti-message-circle', tone: openComments ? 'a' : 'n', text: `${plural(openComments, 'open comment')}` },
    ...(notInJira ? [{ id: 'jira' as const, icon: 'ti-ticket', tone: 'w' as const, text: `${notInJira} link${notInJira === 1 ? '' : 's'} not in Jira` }] : []),
    ...(notChecked.length ? [{ id: 'gaps' as const, icon: 'ti-help', tone: 'w' as const, text: `${skipped || notChecked.length} check${(skipped || notChecked.length) === 1 ? '' : 's'} not run` }] : []),
    ...(confirm.length ? [{ id: 'confirm' as const, icon: 'ti-git-fork', tone: 'n' as const, text: `${confirm.length} to confirm` }] : []),
  ]

  return (
    <section className="headline" aria-label="Summary">
      <div className="headline-row">
        <div className="headline-main">
          <p className="headline-text">{sentence}</p>
          <div className="chips">
            {chips.map((c) => (
              <button key={c.id} className={`status-chip ${c.tone}${open === c.id ? ' on' : ''}`} aria-expanded={open === c.id} onClick={() => toggle(c.id)}>
                <i className={`ti ${c.icon}`} aria-hidden="true" /> {c.text}
              </button>
            ))}
            <button className={`link-btn${open === 'why' ? ' on' : ''}`} aria-expanded={open === 'why'} onClick={() => toggle('why')}>
              Why this order?
            </button>
          </div>
        </div>
        {review && (
          <button className={`btn ${open === 'review' ? 'btn-ghost' : 'btn-primary'}`} aria-expanded={open === 'review'} onClick={() => toggle('review')}>
            <i className="ti ti-user-check" aria-hidden="true" /> Review and approve
          </button>
        )}
      </div>

      {open && (
        <div className="headline-detail" role="region" aria-label="Detail">
          <button className="icon-btn detail-close" aria-label="Close detail" onClick={() => setOpen(null)}><i className="ti ti-x" aria-hidden="true" /></button>

          {open === 'spill' && (
            <>
              <p>Sized from the data and placed after what each one waits for, these finish after sprint {schedule?.piSprints}, the end of the PI:</p>
              <ul className="detail-list">
                {spilled.map((r) => (
                  <li key={r.initiativeId}>
                    <button className="link-btn inline" onClick={() => { onSelectInitiative(r.initiativeId); setOpen(null) }}>{title(r.initiativeId)}</button>
                    <span> · sprint {r.start} to {r.end}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
          {open === 'risks' && (
            <>
              <p>{plural(risks.length, 'risk')} flagged by the rules that ran.</p>
              <button className="btn btn-ghost btn-sm" onClick={() => { onShowRisks(); setOpen(null) }}>Show the risks</button>
            </>
          )}
          {open === 'comments' && (
            <>
              <p>{openComments ? `${plural(openComments, 'comment')} still open.` : 'No open comments yet. Click the bubble on any row to add one.'}</p>
              {openComments > 0 && <button className="btn btn-ghost btn-sm" onClick={() => { onShowOpenComments(); setOpen(null) }}>Show only initiatives with open comments</button>}
            </>
          )}
          {open === 'jira' && (
            <>
              <p><b>{notInJira}</b> of {plural(deps.length, 'dependency link')} {notInJira === 1 ? 'has' : 'have'} no Jira blocked-by link. Approving the run exports them as link proposals; nothing is written to Jira.</p>
              <button className="btn btn-ghost btn-sm" onClick={() => { onShowDependencies(); setOpen(null) }}>Show the dependencies</button>
            </>
          )}
          {open === 'confirm' && (
            <>
              <p><b>{confirm.length}</b> link{confirm.length === 1 ? '' : 's'} that need a change {confirm.length === 1 ? 'was' : 'were'} inferred from code or ownership only. Confirm with the teams.</p>
              <button className="btn btn-ghost btn-sm" onClick={() => { onShowDependencies(); setOpen(null) }}>Show the dependencies</button>
            </>
          )}
          {open === 'gaps' && (
            <>
              <p>A check that did not run cannot raise a flag, so no flag there does not mean no risk.</p>
              <ul className="detail-list">
                {notChecked.map((n) => (
                  <li key={n.code}><b>{n.code}</b> {n.name}{n.partial ? ' (partly checked)' : ''}: {n.reason}.</li>
                ))}
              </ul>
            </>
          )}
          {open === 'why' && (
            <>
              {analysis.summary && <p>{analysis.summary.text}</p>}
              {analysis.summary?.method === 'llm' && <p className="detail-note">Paragraph written by the LLM from the computed facts; the numbers are counted from the data.</p>}
              <ol className="detail-steps">
                {steps.map((s) => (
                  <li key={s.step}><b>Step {s.step}</b> {s.label}{s.why ? `: ${s.why}` : ''}</li>
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
