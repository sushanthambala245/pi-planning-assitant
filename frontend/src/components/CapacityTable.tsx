import { useState } from 'react'
import { LATER, buckets } from '../lib/plan'
import type { Plan } from '../types'
import { VelocityChip } from './Chips'
import { Meter } from './Meter'
import { Tip } from './Tip'

type Basis = 'targeted' | 'recommended'

/**
 * Team velocity and load: each team's capacity per quarter (team capacity file), its velocity tier,
 * and per quarter the story points targeted there (the plan as written) or planned there (the
 * recommended plan), against what it can deliver.
 */
export function CapacityTable({ plan }: { plan: Plan }) {
  const [basis, setBasis] = useState<Basis>('targeted')
  const [all, setAll] = useState(false)
  const quarters = buckets(plan).filter((b) => b !== LATER)
  const titles = new Map(plan.items.map((i) => [i.id, i]))
  const load = (t: Plan['teams'][number], q: string) => (basis === 'targeted' ? t.plannedByPi[q] : t.scheduledByPi[q]) ?? 0
  const cap = (t: Plan['teams'][number], q: string) => t.capacityByPi[q] ?? t.quarterCapacity
  const worst = (t: Plan['teams'][number]) => Math.max(0, ...quarters.map((q) => (cap(t, q) ? load(t, q) / cap(t, q) : 0)))
  const teams = [...plan.teams].sort((a, b) => worst(b) - worst(a) || a.name.localeCompare(b.name))
  const shown = all ? teams : teams.filter((t) => worst(t) > 0.85).concat(teams.filter((t) => worst(t) <= 0.85).slice(0, Math.max(0, 8 - teams.filter((t) => worst(t) > 0.85).length)))

  return (
    <div className="cap">
      <div className="pt-bar">
        <div className="seg" role="group" aria-label="Which load to show">
          <Tip title="As targeted" content="The story points of the initiatives each team targeted at a quarter (the initiatives file), before anything is moved. Over 100% means the plan as written cannot hold.">
            <button className={`seg-btn${basis === 'targeted' ? ' active' : ''}`} aria-pressed={basis === 'targeted'} onClick={() => setBasis('targeted')}>As targeted</button>
          </Tip>
          <Tip title="Recommended" content="The story points the recommended plan puts in each quarter after moving work for dependencies and capacity. It never goes over capacity: what does not fit moves later.">
            <button className={`seg-btn${basis === 'recommended' ? ' active' : ''}`} aria-pressed={basis === 'recommended'} onClick={() => setBasis('recommended')}>Recommended</button>
          </Tip>
        </div>
        <span className="cap-note">{plan.teams.length} teams · velocity from the team capacity file · sizes: {plan.tshirt.map((s) => `${s.size} ${s.points}`).join(', ')}</span>
      </div>
      <div className="cap-table" role="table" aria-label="Team capacity per quarter">
        <div className="cap-row cap-headrow" role="row">
          <span role="columnheader">Team</span>
          <Tip title="Velocity tier" content="The team’s capacity per quarter named as a T-shirt size, so fast and slow teams stand out. The same initiative size takes a different share of each team’s quarter."><span role="columnheader">Tier</span></Tip>
          <Tip title="Capacity per quarter" content="Available story points per quarter from the team capacity file. The schedule spreads it over the quarter’s sprints."><span role="columnheader">Per quarter</span></Tip>
          {quarters.map((q) => <span role="columnheader" key={q}>{q}</span>)}
        </div>
        {shown.map((t) => (
          <div className="cap-row" role="row" key={t.id}>
            <span role="cell" className="cap-team"><span className="cap-name">{t.name}</span><span className="cap-sub">{t.art}</span></span>
            <span role="cell"><VelocityChip team={t} plan={plan} /></span>
            <span role="cell" className="cap-num">{t.quarterCapacity || '—'}</span>
            {quarters.map((q) => {
              const ids = t.initiativeIds.filter((id) => {
                const it = titles.get(id)
                return it && (basis === 'targeted' ? it.targetQuarter === q : Object.keys(it.allocation).some((k) => plan.sprints[Number(k)]?.pi === q))
              })
              return (
                <span role="cell" key={q}>
                  <Meter compact points={Math.round(load(t, q) * 10) / 10} capacity={cap(t, q)}
                    detail={ids.length ? <ul className="tip-list">{ids.map((id) => { const it = titles.get(id)!; return <li key={id}>{it.title}: {it.size ?? '?'} ({it.points} pts){basis === 'recommended' ? `, ${it.startLabel}–${it.finishLabel}` : ''}</li> })}</ul> : <span>No initiative of {t.name} in {q}.</span>} />
                </span>
              )
            })}
          </div>
        ))}
      </div>
      {teams.length > shown.length || all ? (
        <button className="link-btn" onClick={() => setAll((a) => !a)}>{all ? 'Show the busiest teams only' : `Show all ${teams.length} teams`}</button>
      ) : null}
    </div>
  )
}
