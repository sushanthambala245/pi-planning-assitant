import type { ReactNode } from 'react'
import { countBy, needsChange, plural, risksByRule } from '../lib/deps'
import type { Analysis } from '../types'

interface Props {
  analysis: Analysis
  onViewAnalysis: () => void
  onOpenRisk: (id: string) => void
  /** The review and export controls, when the run can be reviewed. */
  children?: ReactNode
}

/** What to take away, before any chart: the order, the summary, and what to do before PI planning. */
export function DecisionSummary({ analysis, onViewAnalysis, onOpenRisk, children }: Props) {
  const { steps, sequence, summary, notChecked, risks, dependencies: deps } = analysis
  const titles = new Map(analysis.initiatives.map((i) => [i.id, i.title]))
  const notInJira = deps.filter((d) => d.inJira === false).length
  const unconfirmed = deps.filter((d) => d.verdict === 'inferred_only' && needsChange(d.changeType)).length
  const groups = risksByRule(risks)
  const skipped = notChecked.filter((n) => !n.partial)
  const partial = notChecked.filter((n) => n.partial)
  const order = steps.length
    ? steps.map((s) => ({ n: s.step, text: s.initiativeIds.map((id) => titles.get(id) ?? id).join(' + '), cycle: s.inCycle }))
    : sequence.map((text, i) => ({ n: i + 1, text, cycle: false }))

  return (
    <section className="decision" aria-label="Decision summary">
      <div className="decision-head">
        <div className="exec-label">Decision summary</div>
        <button className="link-btn" onClick={onViewAnalysis}>
          <i className="ti ti-topology-star-3" aria-hidden="true" /> How was this analysed?
        </button>
      </div>
      <div className="decision-grid">
        <div className="decision-col">
          <div className="decision-label">Recommended order</div>
          {order.length ? (
            <ol className="decision-steps">
              {order.map((s) => (
                <li key={s.n}>
                  <span className="init-num">{s.n}</span>
                  <span>{s.text}{s.cycle && <span className="sev sev-h" style={{ marginLeft: 6 }}>cycle: break it first</span>}</span>
                </li>
              ))}
            </ol>
          ) : <div className="decision-empty">No sequence was recommended.</div>}
          {order.length > 1 && <div className="decision-method">Initiatives in the same step can run in parallel. Each step’s reason is in the Sequence tab.</div>}
          {summary && (
            <>
              <p className="decision-text">{summary.text}</p>
              <div className="decision-method">
                {summary.method === 'llm'
                  ? 'Paragraph written by the LLM from the computed facts; the numbers on this page are counted from the data.'
                  : 'Paragraph built from a template.'}
              </div>
            </>
          )}
        </div>

        <div className="decision-col">
          <div className="decision-label">Before PI planning</div>
          <ul className="decision-todo">
            {notInJira > 0 && (
              <li>
                <i className="ti ti-ticket" aria-hidden="true" />
                <span><b>{notInJira}</b> of {plural(deps.length, 'dependency link')} {notInJira === 1 ? 'is' : 'are'} not in Jira yet: record them.</span>
              </li>
            )}
            {groups.map((g) => {
              const sev = countBy(g.risks, (r) => r.severity)
              return (
                <li key={g.rule} className={g.worst === 0 ? 'high' : undefined}>
                  <i className="ti ti-alert-triangle" aria-hidden="true" />
                  <span>
                    <button className="link-btn inline" onClick={() => onOpenRisk(g.risks[0].id)} title="Open the first one; step through them with ▲ ▼">
                      <b>{g.risks.length}</b> × {g.rule}
                    </button>{' '}
                    <span className="decision-sev">({(['High', 'Medium', 'Low'] as const).filter((s) => sev[s]).map((s) => `${sev[s]} ${s.toLowerCase()}`).join(', ')})</span>
                    {g.risks.length <= 3 && <span className="decision-sub">{g.risks.map((r) => r.title.split(' — ')[1] ?? r.title).join(' · ')}</span>}
                  </span>
                </li>
              )
            })}
            {!groups.length && analysis.keyRisk && (
              <li><i className="ti ti-alert-triangle" aria-hidden="true" /><span>{analysis.keyRisk}</span></li>
            )}
            {!groups.length && !analysis.keyRisk && (
              <li><i className="ti ti-circle-check" aria-hidden="true" /><span>No risk flags from the checks that ran.</span></li>
            )}
            {unconfirmed > 0 && (
              <li>
                <i className="ti ti-git-fork" aria-hidden="true" />
                <span><b>{unconfirmed}</b> link{unconfirmed === 1 ? '' : 's'} that need a change {unconfirmed === 1 ? 'was' : 'were'} inferred from code or ownership only: confirm with the teams.</span>
              </li>
            )}
            {notChecked.length > 0 && (
              <li className="warn">
                <i className="ti ti-alert-circle" aria-hidden="true" />
                <details className="decision-gaps">
                  <summary>
                    {skipped.length > 0 && <>Not checked: {plural(skipped.length, 'risk check')}</>}
                    {skipped.length > 0 && partial.length > 0 && ' · '}
                    {partial.length > 0 && <>partly checked: {partial.length}</>}
                    {' '}— no flag there does not mean no risk
                  </summary>
                  {notChecked.map((n) => (
                    <div className="decision-gap" key={n.code}>
                      <b>{n.code}</b> {n.name}{n.partial ? ' (partly checked)' : ''}: {n.reason}.
                    </div>
                  ))}
                </details>
              </li>
            )}
          </ul>
          {children}
        </div>
      </div>
    </section>
  )
}
