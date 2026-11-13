import { useMemo, useState } from 'react'
import { plural } from '../lib/deps'
import { LATER, PRIORITY_RANK, bucketLabel, buckets, recommendedBucket } from '../lib/plan'
import type { PlannerApi } from '../lib/planner'
import type { Plan, PlanItem } from '../types'
import { NoteField, PriorityChip, QuarterChip, SizeChip, SizeSelect } from './Chips'
import { Tip } from './Tip'

type GroupBy = 'quarter' | 'team' | 'art'

interface Props {
  plan: Plan
  planner?: PlannerApi
  /** Filter to one initiative (the screen's filter). */
  focus?: string
}

function statusOf(i: PlanItem): { cls: string; label: string; hint: string } {
  if (i.inCycle) return { cls: 'bad', label: 'Cycle', hint: 'Part of a dependency cycle: no order satisfies every dependency. Break the cycle (split the scope or re-plan an interface).' }
  if (i.targetQuarter && i.pi !== i.targetQuarter) return { cls: 'bad', label: `Moves to ${i.pi}`, hint: `Targeted at ${i.targetQuarter}, but it cannot start before ${i.startLabel}: see the reasons.` }
  if (i.spills) return { cls: 'warn', label: `Spills into ${i.finishPi}`, hint: `Starts in its target quarter but its points do not fit before ${i.targetQuarter} ends: it finishes in ${i.finishLabel}.` }
  if (i.movedBy) return { cls: 'info', label: 'Later in quarter', hint: `Still in ${i.pi}, but it starts ${i.movedBy} sprint${i.movedBy === 1 ? '' : 's'} into it (${i.startLabel}) because it waits for another initiative or its team is busy.` }
  return { cls: 'ok', label: 'On track', hint: 'Starts in its target quarter and finishes inside it.' }
}

/** The horizon's sprints as cells: the target quarter outlined, the sprints the work takes filled. */
function Timeline({ item, plan }: { item: PlanItem; plan: Plan }) {
  const horizon = buckets(plan).filter((b) => b !== LATER)
  const pis = plan.pis.filter((p) => horizon.includes(p.id))
  const last = pis.length ? pis[pis.length - 1].sprints.slice(-1)[0] : -1
  const alloc = item.allocation
  const beyond = Object.keys(alloc).some((k) => Number(k) > last)
  return (
    <div className="tl" aria-hidden="true">
      {pis.map((p) => (
        <div className={`tl-q${p.id === item.targetQuarter ? ' target' : ''}`} key={p.id}>
          {p.sprints.map((k) => <span key={k} className={`tl-s${alloc[String(k)] ? ' on' : ''}${k > (item.deadline ?? 1e9) && alloc[String(k)] ? ' late' : ''}`} />)}
        </div>
      ))}
      <div className={`tl-q later${beyond ? ' on' : ''}`}><span className={`tl-s${beyond ? ' on late' : ''}`} /></div>
    </div>
  )
}

export function PlanTable({ plan, planner, focus }: Props) {
  const [groupBy, setGroupBy] = useState<GroupBy>('quarter')
  const [open, setOpen] = useState<string | null>(null)
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  const titles = useMemo(() => new Map(plan.items.map((i) => [i.id, i.title])), [plan])
  const items = focus ? plan.items.filter((i) => i.id === focus || i.waitsFor.includes(focus)) : plan.items

  const groups = useMemo(() => {
    const key = (i: PlanItem) => (groupBy === 'quarter' ? recommendedBucket(i, plan) : groupBy === 'team' ? i.teamName : i.art)
    const m = new Map<string, PlanItem[]>()
    for (const i of items) m.set(key(i), [...(m.get(key(i)) ?? []), i])
    const order = groupBy === 'quarter' ? buckets(plan).filter((b) => m.has(b)) : [...m.keys()].sort()
    return order.map((k) => ({
      key: k,
      rows: m.get(k)!.sort((a, b) => a.start - b.start || (PRIORITY_RANK[a.priority.toLowerCase()] ?? 4) - (PRIORITY_RANK[b.priority.toLowerCase()] ?? 4)),
    }))
  }, [items, groupBy, plan])

  const horizon = buckets(plan).filter((b) => b !== LATER)

  return (
    <div className="pt">
      <div className="pt-bar">
        <div className="seg" role="group" aria-label="Group the sequence by">
          {(['quarter', 'team', 'art'] as GroupBy[]).map((g) => (
            <button key={g} className={`seg-btn${groupBy === g ? ' active' : ''}`} aria-pressed={groupBy === g} onClick={() => setGroupBy(g)}>
              {g === 'quarter' ? 'By recommended quarter' : g === 'team' ? 'By team' : 'By ART'}
            </button>
          ))}
        </div>
        <Tip title="How to read the timeline" wide content={<>Each row shows the {horizon.length} quarters ({horizon.join(', ')}) as {plan.sprintsPerPi} sprints each, then Later. The outlined quarter is the one the team targeted; filled cells are the sprints the recommended plan uses at the team’s velocity; red cells fall after the target quarter ends.</>}>
          <span className="pt-legend">
            <span className="tl-key target" /> targeted quarter <span className="tl-key on" /> planned sprints <span className="tl-key late" /> after the target
          </span>
        </Tip>
      </div>
      {groups.map(({ key, rows }) => {
        const isOpen = !collapsed[key]
        const pts = rows.reduce((s, r) => s + r.points, 0)
        return (
          <section key={key} className={`pt-group${isOpen ? ' open' : ''}`}>
            <button className="pt-group-head" aria-expanded={isOpen} onClick={() => setCollapsed((c) => ({ ...c, [key]: isOpen }))}>
              <i className={`ti ${isOpen ? 'ti-chevron-down' : 'ti-chevron-right'}`} aria-hidden="true" />
              <span className="pt-group-label">{groupBy === 'quarter' ? bucketLabel(key) : key}</span>
              <span className="pt-group-n">{plural(rows.length, 'initiative')} · {pts} pts</span>
            </button>
            {isOpen && rows.map((i) => {
              const st = statusOf(i)
              const isRow = open === i.id
              const sizeNow = planner?.input.sizes[i.id] ?? ''
              const note = planner?.input.initiativeNotes[i.id] ?? ''
              return (
                <div key={i.id} className={`pt-row${isRow ? ' open' : ''}`}>
                  <button className="pt-main" aria-expanded={isRow} onClick={() => setOpen((o) => (o === i.id ? null : i.id))}>
                    <i className={`ti ${isRow ? 'ti-chevron-down' : 'ti-chevron-right'} pt-chev`} aria-hidden="true" />
                    <span className="pt-title">
                      <span className="pt-name">{i.title}</span>
                      <span className="pt-meta">{i.id} · {i.teamName}{(note || sizeNow) && <i className="ti ti-notes pt-noted" aria-label="Has planner input" />}</span>
                    </span>
                  </button>
                  <span className="pt-cells">
                    <SizeChip size={i.size} points={i.points} source={i.sizeSource} plan={plan} />
                    <PriorityChip priority={i.priority} />
                    <QuarterChip quarter={i.targetQuarter} kind={i.targetSource === 'planner' ? 'planner' : 'target'} />
                    <i className="ti ti-arrow-right pt-arrow" aria-hidden="true" />
                    <QuarterChip quarter={i.pi} kind="recommended" note={`${i.startLabel} to ${i.finishLabel}.`} />
                    <Tip title={st.label} content={st.hint}><span className={`pt-status s-${st.cls}`}>{st.label}</span></Tip>
                    <Tip title={`${i.title}: ${i.startLabel} → ${i.finishLabel}`} wide content={<ul className="tip-list">{i.reasons.map((r) => <li key={r}>{r}</li>)}</ul>}>
                      <span><Timeline item={i} plan={plan} /></span>
                    </Tip>
                  </span>
                  {isRow && (
                    <div className="pt-body">
                      <div className="pt-col">
                        <div className="pt-label">Why it lands here</div>
                        <ul className="pt-reasons">{i.reasons.map((r) => <li key={r}>{r}</li>)}</ul>
                        {i.waitsFor.length > 0 && <div className="pt-waits"><i className="ti ti-hourglass" aria-hidden="true" /> Waits for {i.waitsFor.map((w) => titles.get(w) ?? w).join(', ')}</div>}
                        {(i.declaredUpstream.length > 0 || i.declaredDownstream.length > 0) && (
                          <div className="pt-declared">
                            <Tip title="Declared in the dependency column" content="Upstream systems are ones this initiative consumes; downstream systems consume what it produces (the initiatives file’s data dictionary).">
                              <span className="pt-label">Declared</span>
                            </Tip>
                            {i.declaredUpstream.length > 0 && <span>Upstream: {i.declaredUpstream.join(', ')}</span>}
                            {i.declaredDownstream.length > 0 && <span>Downstream: {i.declaredDownstream.join(', ')}</span>}
                          </div>
                        )}
                        <div className="pt-facts">
                          <span>{i.declaredLinks} declared · {i.hiddenLinks} hidden links</span>
                          {i.outcome && <span>Outcome: {i.outcome}</span>}
                        </div>
                        {i.description && <div className="pt-desc">{i.description}</div>}
                      </div>
                      {planner && (
                        <div className="pt-col pt-planner">
                          <div className="pt-label">Your input for the next run</div>
                          <label className="pt-field"><span>T-shirt size</span>
                            <SizeSelect value={sizeNow} dataSize={i.dataSize} onChange={(v) => planner.setSize(i.id, v)} />
                          </label>
                          <NoteField value={note} onChange={(t) => planner.setNote(i.id, t)}
                            placeholder="Note on this initiative: what changed, who agreed what. Write “blocked on INIT-005” or “requires Account Ledger” to add a dependency."
                            hint="The rerun reads the note like the description: a stated dependency in it becomes a planner-defined one." />
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </section>
        )
      })}
    </div>
  )
}
