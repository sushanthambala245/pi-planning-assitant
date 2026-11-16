import { useMemo, useState } from 'react'
import { NoteField, PriorityChip, QuarterChip, SizeChip, VelocityChip } from '../components/Chips'
import { EmptyState } from '../components/EmptyState'
import { Meter } from '../components/Meter'
import { RerunBar } from '../components/RerunBar'
import { Section } from '../components/Section'
import { Tip } from '../components/Tip'
import { domainColor } from '../data/domains'
import { plural } from '../lib/deps'
import {
  LATER, PRIORITY_RANK, bucketLabel, buckets, checkPlacement, decisionsCsv, download, placementOf, recommendedBucket,
  targetBucket, useStored, type PlacementIssue, type StartFrom,
} from '../lib/plan'
import type { PlannerApi } from '../lib/planner'
import type { Analysis, PlanItem } from '../types'

interface Props {
  analysis: Analysis | null
  planner: PlannerApi
  onBackToResults: () => void
  onBack: () => void
}

const SEV_CLASS = { High: 'sev-h', Medium: 'sev-m', Low: 'sev-l' } as const
const KIND_ICON: Record<PlacementIssue['kind'], string> = { order: 'ti-arrows-cross', soft: 'ti-arrow-big-up-lines', tight: 'ti-hourglass-high', capacity: 'ti-gauge' }
const KIND_HINT: Record<PlacementIssue['kind'], string> = {
  order: 'An initiative sits in an earlier quarter than something it waits for. The provider must land first, so this placement cannot hold.',
  soft: 'An initiative sits before a code change it uses (an API or contract another team is changing). It can work, but plan a re-test after the change lands.',
  tight: 'Both sit in one quarter, but at the two teams’ velocity the provider and then the consumer do not fit in its sprints.',
  capacity: 'The T-shirt sizes a team has in this quarter add up to more story points than it can deliver there (team capacity file).',
}

const START_HINT: Record<StartFrom, string> = {
  recommended: 'Undecided cards sit in the quarter the recommended plan starts them in: after everything they wait for, at their size against their team’s velocity, higher priority first.',
  targeted: 'Undecided cards sit in the quarter their team targeted in the initiatives file: the plan as written, before the dependencies and capacity are counted.',
}

const byPriority = (a: PlanItem, b: PlanItem) =>
  (PRIORITY_RANK[a.priority.toLowerCase()] ?? 4) - (PRIORITY_RANK[b.priority.toLowerCase()] ?? 4) || a.title.localeCompare(b.title)

export function DashboardScreen({ analysis, planner, onBackToResults, onBack }: Props) {
  const plan = analysis?.plan
  const [prefs, setPrefs] = useStored('pi-dashboard', { from: 'recommended' as StartFrom, onlyIssues: false })
  const [query, setQuery] = useState('')
  const [art, setArt] = useState('')
  const [team, setTeam] = useState('')
  const [dragging, setDragging] = useState<string | null>(null)
  const [over, setOver] = useState<string | null>(null)
  const [noteOpen, setNoteOpen] = useState<string | null>(null)

  const quarters = planner.input.quarters ?? {}
  const place = useMemo(() => (plan ? (i: PlanItem) => placementOf(i, plan, planner.input, prefs.from) : () => LATER),
    [plan, planner.input, prefs.from])
  const check = useMemo(() => (plan ? checkPlacement(plan, place) : null), [plan, place])
  // While a card is dragged over a bucket: what the checks would say if it were dropped there.
  const preview = useMemo(() => {
    if (!plan || !check || !dragging || !over) return null
    const next = checkPlacement(plan, (i) => (i.id === dragging ? over : place(i)))
    const known = new Set(check.issues.map((i) => i.id))
    const now = new Set(next.issues.map((i) => i.id))
    return { added: next.issues.filter((i) => !known.has(i.id)), solved: check.issues.filter((i) => !now.has(i.id)) }
  }, [plan, check, dragging, over, place])

  if (!analysis || !plan || !check) {
    return (
      <EmptyState icon="ti-layout-kanban" title="No quarter plan yet"
        actions={<button className="btn btn-primary" onClick={onBack}>Go to intake</button>}>
        Run an analysis first: the decision dashboard places its initiatives into quarter buckets and checks each placement against the dependencies and every team’s capacity.
      </EmptyState>
    )
  }

  const order = buckets(plan)
  const horizon = order.filter((b) => b !== LATER)
  const titles = new Map(plan.items.map((i) => [i.id, i]))
  const decided = plan.items.filter((i) => order.includes(quarters[i.id] ?? '')).length
  const differ = plan.items.filter((i) => place(i) !== recommendedBucket(i, plan)).length
  const arts = [...new Set(plan.items.map((i) => i.art).filter(Boolean))].sort()
  const teams = [...new Map(plan.items.map((i) => [i.team, i.teamName])).entries()].sort((a, b) => a[1].localeCompare(b[1]))
  const q = query.trim().toLowerCase()
  const visible = (i: PlanItem) => (!q || `${i.title} ${i.id} ${i.teamName}`.toLowerCase().includes(q))
    && (!art || i.art === art) && (!team || i.team === team) && (!prefs.onlyIssues || (check.byItem[i.id]?.length ?? 0) > 0)
  const sev = { High: 0, Medium: 0, Low: 0 }
  for (const i of check.issues) sev[i.severity]++

  const move = (id: string, to: string) => planner.setQuarter(id, to)
  const acceptAll = () => planner.setQuarters({ ...quarters, ...Object.fromEntries(plan.items.map((i) => [i.id, place(i)])) })
  const resetAll = () => planner.setQuarters(Object.fromEntries(Object.entries(quarters).filter(([id]) => !titles.has(id))))
  const exportCsv = () => download('pi-quarter-decisions.csv', decisionsCsv(plan, place, check))

  const teamRows = plan.teams
    .filter((t) => t.initiativeIds.length)
    .map((t) => ({ t, worst: Math.max(0, ...horizon.map((b) => { const l = check.load[t.id]?.[b]; return l && l.capacity ? l.points / l.capacity : 0 })) }))
    .sort((a, b) => b.worst - a.worst || a.t.name.localeCompare(b.t.name))

  return (
    <div className="dash">
      <div className="dash-bar">
        <div className="dash-title">
          <div className="run-title">Decide the quarters</div>
          <div className="run-sub">
            <b>{decided}</b> of {plural(plan.items.length, 'initiative')} decided · {differ} differ from the recommended plan ·{' '}
            {check.issues.length ? <span className="warn-text">{plural(check.issues.length, 'issue')} ({sev.High} high)</span> : 'no issues'}
          </div>
        </div>
        <div className="dash-actions">
          <div className="seg" role="group" aria-label="Where undecided cards start">
            {(['recommended', 'targeted'] as StartFrom[]).map((f) => (
              <Tip key={f} title={f === 'recommended' ? 'Start from the recommended plan' : 'Start from the target quarters'} content={START_HINT[f]}>
                <button className={`seg-btn${prefs.from === f ? ' active' : ''}`} aria-pressed={prefs.from === f} onClick={() => setPrefs((p) => ({ ...p, from: f }))}>
                  {f === 'recommended' ? 'Recommended' : 'As targeted'}
                </button>
              </Tip>
            ))}
          </div>
          <Tip title="Accept every placement" content="Turns every card’s current bucket into your decision, so the rerun treats each one as its target quarter. Cards you already moved keep their place.">
            <button className="btn btn-ghost btn-sm" onClick={acceptAll} disabled={decided === plan.items.length}><i className="ti ti-checks" aria-hidden="true" /> Accept all</button>
          </Tip>
          <Tip title="Reset placements" content="Removes every quarter you decided, so the cards go back to the starting point. Notes stay.">
            <button className="btn btn-ghost btn-sm" onClick={resetAll} disabled={!decided}><i className="ti ti-arrow-back-up" aria-hidden="true" /> Reset</button>
          </Tip>
          <Tip title="Export decisions" content="Downloads one row per initiative: its size, points and priority, the quarter its team targeted, the recommended quarter, the quarter decided here, and the issues it has. Opens in Excel.">
            <button className="btn btn-ghost btn-sm" onClick={exportCsv}><i className="ti ti-file-spreadsheet" aria-hidden="true" /> Export CSV</button>
          </Tip>
          <button className="btn btn-ghost btn-sm" onClick={onBackToResults}><i className="ti ti-chart-dots" aria-hidden="true" /> Results</button>
        </div>
      </div>

      <div className="dash-filters">
        <label className="search-box">
          <i className="ti ti-search" aria-hidden="true" />
          <input type="text" placeholder="Search initiatives or teams" aria-label="Search initiatives" value={query} onChange={(e) => setQuery(e.target.value)} />
        </label>
        {arts.length > 1 && (
          <select className="select" aria-label="Filter by ART" value={art} onChange={(e) => setArt(e.target.value)}>
            <option value="">All ARTs</option>
            {arts.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
        )}
        <select className="select" aria-label="Filter by team" value={team} onChange={(e) => setTeam(e.target.value)}>
          <option value="">All teams</option>
          {teams.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
        </select>
        <label className="toggle">
          <input type="checkbox" checked={prefs.onlyIssues} onChange={(e) => setPrefs((p) => ({ ...p, onlyIssues: e.target.checked }))} />
          Only cards with issues
        </label>
      </div>

      <Section id="buckets" title="Quarter buckets" icon="ti-layout-kanban" count={`${decided}/${plan.items.length} decided`} tone="accent"
        tip={<>Drag a card into a quarter, or use its <b>Move to</b> list. A dashed card is a suggestion from the starting point; a solid one is your decision. The board checks every placement as you go: dependencies placed out of order, quarters too tight for a provider and then its consumer, and teams over capacity. Your decisions are saved in this browser and sent with the next run, which treats each as the initiative’s target quarter.</>}>
        <div className="board" style={{ gridTemplateColumns: `repeat(${order.length}, minmax(200px, 1fr))` }}>
          {order.map((b) => {
            const cards = plan.items.filter((i) => place(i) === b)
            const shown = cards.filter(visible).sort(byPriority)
            const tot = check.totals[b]
            const overTeams = b === LATER ? [] : plan.teams.filter((t) => { const l = check.load[t.id]?.[b]; return l && l.capacity && l.points > l.capacity })
            const hovering = over === b && dragging
            return (
              <div key={b} className={`bucket${hovering ? ' drop' : ''}${b === LATER ? ' later' : ''}`}
                onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; if (over !== b) setOver(b) }}
                onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setOver(null) }}
                onDrop={(e) => { e.preventDefault(); const id = e.dataTransfer.getData('text/plain'); if (id) move(id, b); setOver(null); setDragging(null) }}>
                <Tip as="div" title={`${bucketLabel(b)}: ${plural(tot.count, 'initiative')}, ${tot.points} story points`} wide content={b === LATER
                  ? 'Deferred past the planning horizon: it takes no capacity in the quarters shown. The rerun schedules it after the last one.'
                  : <>{overTeams.length
                    ? <><b>{plural(overTeams.length, 'team')} over capacity:</b> {overTeams.map((t) => `${t.name} (${check.load[t.id][b].points}/${check.load[t.id][b].capacity})`).join(', ')}.</>
                    : 'Every team with work here is within its capacity.'} Capacity is each team’s available story points per quarter.</>}>
                  <div className="bucket-head">
                    <span className="bucket-name">{bucketLabel(b)}</span>
                    <span className="bucket-stats">{tot.count} · {tot.points} pts</span>
                    {overTeams.length > 0 && <span className="bucket-over"><i className="ti ti-gauge" aria-hidden="true" /> {overTeams.length} over</span>}
                  </div>
                </Tip>
                {hovering && preview && (
                  <div className={`bucket-preview${preview.added.length ? ' bad' : ' good'}`} role="status">
                    {preview.added.length
                      ? <><i className="ti ti-alert-triangle" aria-hidden="true" /> Dropping here adds {plural(preview.added.length, 'issue')}: {preview.added[0].title}</>
                      : <><i className="ti ti-circle-check" aria-hidden="true" /> No new issue{preview.solved.length ? `; solves ${preview.solved.length}` : ''}</>}
                  </div>
                )}
                <div className="bucket-body">
                  {shown.map((i) => (
                    <DecisionCard key={i.id} item={i} bucket={b} order={order} decided={order.includes(quarters[i.id] ?? '')}
                      issues={check.byItem[i.id] ?? []} plan={plan} titles={titles} where={place}
                      dragging={dragging === i.id} onDragStart={() => setDragging(i.id)} onDragEnd={() => { setDragging(null); setOver(null) }}
                      onMove={(to) => move(i.id, to)} onUndo={() => planner.setQuarter(i.id, '')}
                      note={planner.input.initiativeNotes[i.id] ?? ''} noteOpen={noteOpen === i.id}
                      onToggleNote={() => setNoteOpen((n) => (n === i.id ? null : i.id))} onNote={(t) => planner.setNote(i.id, t)} />
                  ))}
                  {cards.length > shown.length && <div className="bucket-hidden">{cards.length - shown.length} hidden by the filters</div>}
                  {!cards.length && <div className="bucket-empty">Drop initiatives here</div>}
                </div>
              </div>
            )
          })}
        </div>
      </Section>

      <Section id="checks" title="Placement checks" icon="ti-shield-check" count={check.issues.length}
        tip="Every problem with the placement as it stands, worst first. High: a dependency is placed out of order or a team is far over capacity (more than 130%). Medium: a quarter too tight for a provider and its consumer, or a team over capacity. Low: placed before a code change it uses. Each comes with a one-click fix.">
        {!check.issues.length && <div className="list-empty">No issues: every dependency is placed in order and every team is within its capacity.</div>}
        <div className="checks">
          {check.issues.map((x) => (
            <div key={x.id} className="check-row">
              <Tip title={`${x.severity} · ${x.kind === 'order' ? 'Out of order' : x.kind === 'soft' ? 'Before a code change' : x.kind === 'tight' ? 'Tight quarter' : 'Over capacity'}`} content={KIND_HINT[x.kind]}>
                <span className={`sev ${SEV_CLASS[x.severity]}`}><i className={`ti ${KIND_ICON[x.kind]}`} aria-hidden="true" /> {x.severity}</span>
              </Tip>
              <div className="check-text">
                <div className="check-title">{x.title}</div>
                <div className="check-sub">{x.text}</div>
              </div>
              {x.fix && (
                <button className="btn btn-ghost btn-sm" onClick={() => move(x.fix!.id, x.fix!.to)}>
                  <i className="ti ti-wand" aria-hidden="true" /> {x.fix.label}
                </button>
              )}
            </div>
          ))}
        </div>
      </Section>

      <Section id="team-load" title="Team load by quarter" icon="ti-gauge" count={plan.teams.length ? `${teamRows.filter((r) => r.worst > 1).length} over` : undefined}
        tip="Each team’s story points in each quarter as placed on the board, against its capacity there (team capacity file). Teams have different velocity: the tier names a team’s quarterly capacity as a T-shirt size, so the same initiative size fills a different share of each team’s quarter.">
        <div className="cap-table" role="table" aria-label="Team load per quarter as placed">
          <div className="cap-row cap-headrow" role="row" style={{ gridTemplateColumns: `minmax(160px, 1.4fr) 60px 70px repeat(${horizon.length}, minmax(90px, 1fr))` }}>
            <span role="columnheader">Team</span><span role="columnheader">Tier</span><span role="columnheader">Per quarter</span>
            {horizon.map((b) => <span role="columnheader" key={b}>{b}</span>)}
          </div>
          {teamRows.map(({ t }) => (
            <div className="cap-row" role="row" key={t.id} style={{ gridTemplateColumns: `minmax(160px, 1.4fr) 60px 70px repeat(${horizon.length}, minmax(90px, 1fr))` }}>
              <span role="cell" className="cap-team"><span className="cap-name">{t.name}</span><span className="cap-sub">{t.art}</span></span>
              <span role="cell"><VelocityChip team={t} plan={plan} /></span>
              <span role="cell" className="cap-num">{t.quarterCapacity || '—'}</span>
              {horizon.map((b) => {
                const l = check.load[t.id]?.[b]
                return (
                  <span role="cell" key={b}>
                    <Meter compact points={l?.points ?? 0} capacity={l?.capacity ?? t.quarterCapacity}
                      detail={l?.ids.length ? <ul className="tip-list">{l.ids.map((id) => { const it = titles.get(id)!; return <li key={id}>{it.title}: {it.size ?? '?'} ({it.points} pts)</li> })}</ul> : <span>Nothing of {t.name} placed in {b}.</span>} />
                  </span>
                )
              })}
            </div>
          ))}
        </div>
      </Section>

      <RerunBar planner={planner} />
    </div>
  )
}

interface CardProps {
  item: PlanItem
  bucket: string
  order: string[]
  decided: boolean
  issues: PlacementIssue[]
  plan: NonNullable<Analysis['plan']>
  titles: Map<string, PlanItem>
  where: (i: PlanItem) => string
  dragging: boolean
  onDragStart: () => void
  onDragEnd: () => void
  onMove: (to: string) => void
  onUndo: () => void
  note: string
  noteOpen: boolean
  onToggleNote: () => void
  onNote: (t: string) => void
}

/** One initiative on the board: drag it, or move it with the list; its issues and the reasons behind its suggestion on hover. */
function DecisionCard({ item, bucket, order, decided, issues, plan, titles, where, dragging, onDragStart, onDragEnd, onMove, onUndo, note, noteOpen, onToggleNote, onNote }: CardProps) {
  const rec = recommendedBucket(item, plan)
  const target = targetBucket(item, plan)
  const worst = issues.some((i) => i.severity === 'High') ? 'High' : issues.some((i) => i.severity === 'Medium') ? 'Medium' : issues.length ? 'Low' : null
  const waits = item.waitsFor.map((id) => titles.get(id)).filter((x): x is PlanItem => !!x)
  return (
    <div className={`dcard${decided ? ' decided' : ' suggested'}${dragging ? ' dragging' : ''}${worst ? ` issue-${worst.toLowerCase()}` : ''}`}
      draggable onDragStart={(e) => { e.dataTransfer.setData('text/plain', item.id); e.dataTransfer.effectAllowed = 'move'; onDragStart() }} onDragEnd={onDragEnd}>
      <span className="dcard-art" style={{ background: domainColor(item.art) }} aria-hidden="true" />
      <Tip as="div" title={item.title} wide content={<>
        <div>{item.id} · {item.teamName} · {item.art}</div>
        <div className="tip-foot">Recommended: {item.startLabel} to {item.finishLabel}. Targeted: {item.targetQuarter || 'no quarter'}.</div>
        <ul className="tip-list">{item.reasons.map((r) => <li key={r}>{r}</li>)}</ul>
        {waits.length > 0 && <div className="tip-foot">Waits for: {waits.map((w) => `${w.title} (${bucketLabel(where(w))})`).join(', ')}</div>}
      </>}>
        <div className="dcard-title">{item.title}</div>
        <div className="dcard-meta">{item.teamName}{decided ? '' : ' · suggested'}</div>
      </Tip>
      <div className="dcard-chips">
        <SizeChip size={item.size} points={item.points} source={item.sizeSource} plan={plan} />
        <PriorityChip priority={item.priority} />
        {target !== bucket && <QuarterChip quarter={item.targetQuarter || target} kind="target" />}
        {rec !== bucket && <QuarterChip quarter={rec} kind="recommended" note={`${item.startLabel} to ${item.finishLabel}.`} />}
        {waits.length > 0 && (
          <Tip title={`Waits for ${plural(waits.length, 'initiative')}`} content={waits.map((w) => `${w.title}: ${bucketLabel(where(w))}`).join(' · ')}>
            <span className="pchip imp-orders"><i className="ti ti-hourglass" aria-hidden="true" /> {waits.length}</span>
          </Tip>
        )}
        {worst && (
          <Tip title={plural(issues.length, 'issue')} wide content={<ul className="tip-list">{issues.map((x) => <li key={x.id}><b>{x.severity}:</b> {x.title}</li>)}</ul>}>
            <span className={`sev ${SEV_CLASS[worst]}`}><i className="ti ti-alert-triangle" aria-hidden="true" /> {issues.length}</span>
          </Tip>
        )}
      </div>
      <div className="dcard-actions">
        <select className="select select-sm" aria-label={`Move ${item.title} to`} value={bucket} onChange={(e) => onMove(e.target.value)}>
          {order.map((b) => <option key={b} value={b}>{bucketLabel(b)}</option>)}
        </select>
        <Tip title={note ? 'Edit the note' : 'Add a note'} content="A note on this initiative, sent with the next run. Write “blocked on INIT-005” or “requires Account Ledger” to add a dependency.">
          <button className={`icon-btn note-btn${note ? ' has' : ''}`} aria-label="Note" aria-expanded={noteOpen} onClick={onToggleNote}><i className="ti ti-notes" aria-hidden="true" /></button>
        </Tip>
        {decided && (
          <Tip title="Undo" content="Removes your decision: the card goes back to its suggested quarter.">
            <button className="icon-btn" aria-label="Undo the placement" onClick={onUndo}><i className="ti ti-arrow-back-up" aria-hidden="true" /></button>
          </Tip>
        )}
      </div>
      {noteOpen && <NoteField value={note} onChange={onNote} placeholder="Note for the next run…" />}
    </div>
  )
}
