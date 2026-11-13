import { useState } from 'react'
import { CHANGE, CHANGE_ORDER, countBy, findingInitiatives, needsChange, plural } from '../lib/deps'
import { domainColor } from '../data/domains'
import type { Analysis, InitiativeRef } from '../types'
import { ChangeBadge } from './Badges'
import { SystemChips, systemsSummary } from './SystemChips'
import { Tip } from './Tip'

interface Props {
  analysis: Analysis
  initiatives: InitiativeRef[]
  onOpen: (id: string) => void
}

const sevRank = { High: 0, Medium: 1, Low: 2 } as const

function Card({ ini, analysis, onOpen }: { ini: InitiativeRef; analysis: Analysis; onOpen: (id: string) => void }) {
  const deps = analysis.dependencies
  const sys = analysis.findings.find((f) => f.kind === 'systems' && findingInitiatives(f, analysis).includes(ini.id))?.systems ?? []
  const out = deps.filter((d) => d.from === ini.id)
  const needed = out.filter((d) => needsChange(d.changeType))
  const hidden = out.filter((d) => !(d.declared ?? !d.inferred)).length
  const incoming = deps.filter((d) => d.to === ini.id)
  const risks = analysis.risks.filter((r) => r.initiativeIds.includes(ini.id)).sort((a, b) => sevRank[a.severity] - sevRank[b.severity])
  const step = analysis.steps.find((s) => s.initiativeIds.includes(ini.id))
  const t = countBy(needed, (d) => d.changeType)
  return (
    <div className="summary-card">
      <div className="summary-card-head">
        <div>
          <div className="summary-card-title">{ini.title}</div>
          <div className="init-meta">{ini.id}{ini.teamName && ` · ${ini.teamName} team`}{ini.pi && ` · ${ini.pi}`}{ini.size && ` · size ${ini.size}`}</div>
        </div>
        {step && (
          <Tip title={`Step ${step.step} of the dependency order`} content={step.why || 'Initiatives in the same step wait on nothing else in it and can run in parallel.'}>
            <span className="step-pill">Step {step.step}{step.inCycle ? ' (cycle)' : ''}</span>
          </Tip>
        )}
      </div>

      <Tip as="div" title="Systems it touches" content={sys.length ? 'The shared systems this initiative names in its dependency column, description or a planner note, each with the team that owns it (ownership lookup). The access (changes, writes, reads) decides what a dependency asks of that team.' : 'No system from the ownership lookup was found for this initiative.'}>
        <div className="summary-line"><i className="ti ti-server" aria-hidden="true" />{sys.length ? systemsSummary(sys) : 'No shared systems found'}</div>
      </Tip>
      {sys.length > 0 && (
        <details className="summary-more">
          <summary>Systems and owning teams</summary>
          <SystemChips systems={sys} />
        </details>
      )}

      <Tip as="div" title="What it needs from others" content={`${out.length} links leave this initiative: ${out.length - hidden} declared by its team, ${hidden} hidden (found by the agents). ${needed.length} of them ask someone to change code, agree a flow or re-test.`}>
        <div className="summary-line">
          <i className="ti ti-route" aria-hidden="true" />
          {out.length === 0 ? 'Depends on nothing else' : (
            <span>
              <b>{needed.length}</b> of {plural(out.length, 'dependency', 'dependencies')} need a change{hidden > 0 && <> · <b>{hidden}</b> hidden</>}
              {needed.length > 0 && ': '}
              {CHANGE_ORDER.filter((c) => t[c]).map((c) => `${t[c]} ${CHANGE[c].short.toLowerCase()}`).join(' · ')}
            </span>
          )}
        </div>
      </Tip>
      {needed.slice(0, 3).map((d) => (
        <Tip as="div" key={d.key} title={`${d.fromLabel} → ${d.toLabel}`} content={d.reason}>
          <div className="summary-dep">
            <ChangeBadge type={d.changeType} short />
            <span>{d.toLabel}{d.toTeam && d.toTeam !== d.toLabel ? ` (${d.toTeam})` : ''}</span>
          </div>
        </Tip>
      ))}
      {needed.length > 3 && <div className="summary-more-text">+{needed.length - 3} more</div>}

      {incoming.length > 0 && (
        <div className="summary-line">
          <i className="ti ti-arrow-back-up" aria-hidden="true" />
          {plural(incoming.length, 'other link')} in this run land{incoming.length === 1 ? 's' : ''} on it
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
}

/** The run in a few numbers, then one card per initiative, grouped by release train (ART). */
export function InitiativeSummary({ analysis, initiatives, onOpen }: Props) {
  const [open, setOpen] = useState<Record<string, boolean>>({})
  const deps = analysis.dependencies
  const change = deps.filter((d) => needsChange(d.changeType))
  const byType = countBy(change, (d) => d.changeType)
  const systems = analysis.findings.flatMap((f) => f.systems ?? [])
  const confirmed = deps.filter((d) => d.verdict === 'confirmed').length

  const arts = new Map<string, InitiativeRef[]>()
  for (const i of initiatives) arts.set(i.art || 'Other', [...(arts.get(i.art || 'Other') ?? []), i])
  const groups = [...arts.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  const small = initiatives.length <= 6 || groups.length === 1

  return (
    <>
      <div className="summary-strip">
        <Tip as="div" title="Shared systems touched" content="Distinct systems from the ownership lookup that the analysed initiatives name in their dependency column or description.">
          <div className="summary-stat">
            <div className="summary-num">{new Set(systems.map((s) => s.name)).size}</div>
            <div className="summary-lbl">shared systems touched</div>
          </div>
        </Tip>
        <Tip as="div" title="Need a change" content="Dependencies where someone must change code, agree a flow or contract, or re-test after the other change lands. The rest need nothing more than awareness.">
          <div className="summary-stat">
            <div className="summary-num accent">{change.length}</div>
            <div className="summary-lbl">
              of {plural(deps.length, 'dependency', 'dependencies')} need a change
              {change.length > 0 && <div className="summary-sub">{CHANGE_ORDER.filter((t) => byType[t]).map((t) => `${byType[t]} ${CHANGE[t].short.toLowerCase()}`).join(' · ')}</div>}
            </div>
          </div>
        </Tip>
        <Tip as="div" title="Need no change" content="Awareness only: both sides only read a system, or the system belongs to the initiative’s own team. Listed so nothing is a surprise at PI planning.">
          <div className="summary-stat">
            <div className="summary-num">{deps.length - change.length}</div>
            <div className="summary-lbl">need no change<div className="summary-sub">awareness only</div></div>
          </div>
        </Tip>
        <Tip as="div" title="Confirmed" content="Written down by the team (dependency column, description or a planner note) and pointed to by GitHub or the ownership lookup as well: the strongest evidence.">
          <div className="summary-stat">
            <div className="summary-num ok">{confirmed}</div>
            <div className="summary-lbl">confirmed<div className="summary-sub">declared or stated, and seen in data</div></div>
          </div>
        </Tip>
      </div>

      {initiatives.length === 0 && <div className="list-empty">The analysis does not list its initiatives yet.</div>}

      {groups.map(([art, list]) => {
        const isOpen = open[art] ?? small
        const ids = new Set(list.map((i) => i.id))
        const groupDeps = deps.filter((d) => ids.has(d.from))
        const hidden = groupDeps.filter((d) => !(d.declared ?? !d.inferred)).length
        const risks = analysis.risks.filter((r) => r.initiativeIds.some((id) => ids.has(id))).length
        return (
          <section className={`art-group${isOpen ? ' open' : ''}`} key={art}>
            <button className="art-head" aria-expanded={isOpen} onClick={() => setOpen((o) => ({ ...o, [art]: !isOpen }))}>
              <i className={`ti ${isOpen ? 'ti-chevron-down' : 'ti-chevron-right'}`} aria-hidden="true" />
              <span className="art-dot" style={{ background: domainColor(art) }} aria-hidden="true" />
              <span className="art-name">{art}</span>
              <span className="art-meta">{plural(list.length, 'initiative')} · {groupDeps.length} links ({hidden} hidden) · {plural(risks, 'risk')}</span>
            </button>
            {isOpen && (
              <div className="summary-cards">
                {list.map((ini) => <Card key={ini.id} ini={ini} analysis={analysis} onOpen={onOpen} />)}
              </div>
            )}
          </section>
        )
      })}
    </>
  )
}
