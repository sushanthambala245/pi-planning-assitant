import { useState } from 'react'
import { findingInitiatives, plural } from '../lib/deps'
import { domainColor } from '../data/domains'
import type { Analysis, InitiativeRef } from '../types'
import { Tip } from './Tip'

interface Props {
  analysis: Analysis
  initiatives: InitiativeRef[]
  onOpen: (id: string) => void
}

/** One initiative as a single card: who and where, then three counts. Click for the systems, findings and risks. */
function Card({ ini, analysis, onOpen }: { ini: InitiativeRef; analysis: Analysis; onOpen: (id: string) => void }) {
  const deps = analysis.dependencies
  const sys = analysis.findings.find((f) => f.kind === 'systems' && findingInitiatives(f, analysis).includes(ini.id))?.systems ?? []
  const out = deps.filter((d) => d.from === ini.id)
  const hidden = out.filter((d) => !(d.declared ?? !d.inferred)).length
  const risks = analysis.risks.filter((r) => r.initiativeIds.includes(ini.id)).length
  const step = analysis.steps.find((s) => s.initiativeIds.includes(ini.id))
  return (
    <button className="summary-card summary-card-btn" onClick={() => onOpen(ini.id)}>
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
      <div className="sum-chips">
        <span className="sum-chip">{plural(sys.length, 'system')}</span>
        <span className="sum-chip">{plural(out.length, 'link')}{hidden > 0 && `, ${hidden} hidden`}</span>
        <span className={`sum-chip${risks ? ' risk' : ''}`}>{plural(risks, 'risk')}</span>
      </div>
    </button>
  )
}

/** One card per initiative, grouped by release train (ART); the groups start closed. */
export function InitiativeSummary({ analysis, initiatives, onOpen }: Props) {
  const [open, setOpen] = useState<Record<string, boolean>>({})
  const deps = analysis.dependencies

  const arts = new Map<string, InitiativeRef[]>()
  for (const i of initiatives) arts.set(i.art || 'Other', [...(arts.get(i.art || 'Other') ?? []), i])
  const groups = [...arts.entries()].sort((a, b) => a[0].localeCompare(b[0]))

  return (
    <>
      {initiatives.length === 0 && <div className="list-empty">The analysis does not list its initiatives yet.</div>}

      {groups.map(([art, list]) => {
        const isOpen = open[art] ?? false
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
