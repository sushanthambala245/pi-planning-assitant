import { CHANGE, CHANGE_ORDER, countBy, findingInitiatives, needsChange, plural } from '../lib/deps'
import type { Analysis, InitiativeRef } from '../types'
import { ChangeBadge } from './Badges'
import { SystemChips, systemsSummary } from './SystemChips'

interface Props {
  analysis: Analysis
  initiatives: InitiativeRef[]
  onOpen: (id: string) => void
}

const sevRank = { High: 0, Medium: 1, Low: 2 } as const

/** The run in a few numbers, then one card per initiative: what it touches, what it needs from others, its risks. */
export function InitiativeSummary({ analysis, initiatives, onOpen }: Props) {
  const deps = analysis.dependencies
  const change = deps.filter((d) => needsChange(d.changeType))
  const byType = countBy(change, (d) => d.changeType)
  const systems = analysis.findings.flatMap((f) => f.systems ?? [])
  const confirmed = deps.filter((d) => d.verdict === 'confirmed').length

  return (
    <>
      <div className="summary-strip">
        <div className="summary-stat">
          <div className="summary-num">{new Set(systems.map((s) => s.name)).size}</div>
          <div className="summary-lbl">shared systems touched</div>
        </div>
        <div className="summary-stat">
          <div className="summary-num accent">{change.length}</div>
          <div className="summary-lbl">
            of {plural(deps.length, 'dependency', 'dependencies')} need a change
            {change.length > 0 && <div className="summary-sub">{CHANGE_ORDER.filter((t) => byType[t]).map((t) => `${byType[t]} ${CHANGE[t].short.toLowerCase()}`).join(' · ')}</div>}
          </div>
        </div>
        <div className="summary-stat">
          <div className="summary-num">{deps.length - change.length}</div>
          <div className="summary-lbl">need no change<div className="summary-sub">awareness only: nothing to build or test</div></div>
        </div>
        <div className="summary-stat">
          <div className="summary-num ok">{confirmed}</div>
          <div className="summary-lbl">confirmed<div className="summary-sub">stated, and seen in code or ownership data</div></div>
        </div>
      </div>

      {initiatives.length === 0 && <div className="list-empty">The analysis does not list its initiatives yet.</div>}

      <div className="summary-cards">
        {initiatives.map((ini) => {
          const sys = analysis.findings.find((f) => f.kind === 'systems' && findingInitiatives(f, analysis).includes(ini.id))?.systems ?? []
          const out = deps.filter((d) => d.from === ini.id)
          const needed = out.filter((d) => needsChange(d.changeType))
          const incoming = deps.filter((d) => d.to === ini.id)
          const risks = analysis.risks.filter((r) => r.initiativeIds.includes(ini.id)).sort((a, b) => sevRank[a.severity] - sevRank[b.severity])
          const step = analysis.steps.find((s) => s.initiativeIds.includes(ini.id))
          const t = countBy(needed, (d) => d.changeType)
          return (
            <div className="summary-card" key={ini.id}>
              <div className="summary-card-head">
                <div>
                  <div className="summary-card-title">{ini.title}</div>
                  <div className="init-meta">{ini.id}{ini.teamName && ` · ${ini.teamName} team`}{ini.pi && ` · ${ini.pi}`}</div>
                </div>
                {step && <span className="step-pill" title={step.why}>Step {step.step}{step.inCycle ? ' (cycle)' : ''}</span>}
              </div>

              <div className="summary-line" title={sys.length ? undefined : 'No catalogue systems were found for this initiative'}>
                <i className="ti ti-server" aria-hidden="true" />
                {sys.length ? systemsSummary(sys) : 'No shared systems found'}
              </div>
              {sys.length > 0 && (
                <details className="summary-more">
                  <summary>Systems and owning teams</summary>
                  <SystemChips systems={sys} />
                </details>
              )}

              <div className="summary-line">
                <i className="ti ti-route" aria-hidden="true" />
                {out.length === 0 ? 'Depends on nothing else' : (
                  <span>
                    <b>{needed.length}</b> of {plural(out.length, 'dependency', 'dependencies')} need a change
                    {needed.length > 0 && ': '}
                    {CHANGE_ORDER.filter((c) => t[c]).map((c) => `${t[c]} ${CHANGE[c].short.toLowerCase()}`).join(' · ')}
                  </span>
                )}
              </div>
              {needed.slice(0, 3).map((d) => (
                <div className="summary-dep" key={d.key} title={d.reason}>
                  <ChangeBadge type={d.changeType} short />
                  <span>{d.toLabel}{d.toTeam && d.toTeam !== d.toLabel ? ` (${d.toTeam})` : ''}</span>
                </div>
              ))}
              {needed.length > 3 && <div className="summary-more-text">+{needed.length - 3} more</div>}

              {incoming.length > 0 && (
                <div className="summary-line">
                  <i className="ti ti-arrow-back-up" aria-hidden="true" />
                  {plural(incoming.length, 'other initiative')} in this run depend{incoming.length === 1 ? 's' : ''} on it
                </div>
              )}
              <div className={`summary-line${risks.length ? ' risk' : ''}`}>
                <i className="ti ti-alert-triangle" aria-hidden="true" />
                {risks.length ? `${plural(risks.length, 'risk')}: ${risks[0].title}${risks.length > 1 ? ` (+${risks.length - 1})` : ''}` : 'No risks flagged'}
              </div>

              <button className="link-btn summary-open" onClick={() => onOpen(ini.id)}>
                <i className="ti ti-list-details" aria-hidden="true" /> See all findings for this initiative
              </button>
            </div>
          )
        })}
      </div>
    </>
  )
}
