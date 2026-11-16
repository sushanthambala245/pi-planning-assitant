import type { ReactNode } from 'react'
import { plural } from '../lib/deps'
import { IMPACT, IMPACT_ORDER } from '../lib/plan'
import type { Analysis } from '../types'
import { Tip } from './Tip'

/** Where a tile or a "Before PI planning" item leads: the detail that opens under this row, the timeline, or the risks view. */
export type GlanceTarget = 'timeline' | 'conflicts' | 'moved' | 'capacity' | 'size' | 'confirm' | 'comments' | 'readiness' | 'gaps' | 'risks'

interface Props {
  analysis: Analysis
  openComments: number
  /** The item whose detail is open, so its chip shows as pressed. */
  active: string | null
  onOpenRisk: (id: string) => void
  onShow: (target: GlanceTarget) => void
}

function Tile({ n, title, big, unit, lines, tip, go, tone }: {
  n: number; title: string; big: ReactNode; unit: string; lines: ReactNode[]; tip: ReactNode; go?: () => void; tone?: 'accent' | 'warn'
}) {
  return (
    <div className={`uc-tile${tone ? ` ${tone}` : ''}`}>
      <Tip title={`Use case ${n} · ${title}`} content={tip} wide as="div">
        <div className="uc-head"><span className="uc-num">{n}</span>{title}<i className="ti ti-info-circle uc-info" aria-hidden="true" /></div>
      </Tip>
      <div className="uc-big">{big}<span className="uc-unit">{unit}</span></div>
      <div className="uc-lines">{lines.filter(Boolean).map((l, i) => <div key={i}>{l}</div>)}</div>
      {go && <button className="link-btn uc-go" onClick={go}>Details <i className="ti ti-arrow-down" aria-hidden="true" /></button>}
    </div>
  )
}

interface Todo {
  key: string
  icon: string
  tone: 'high' | 'warn' | 'info' | 'ok'
  text: ReactNode
  tip: string
  go: () => void
}

/** The run in three use cases and a short to-do list; every number explains itself on hover. */
export function AtAGlance({ analysis, openComments, active, onOpenRisk, onShow }: Props) {
  const plan = analysis.plan
  const deps = analysis.dependencies
  const r = analysis.readiness
  const c = plan?.counts
  const declared = c?.declared ?? deps.filter((d) => d.declared).length
  const hidden = c?.hidden ?? deps.length - declared
  const share = c?.hiddenShare ?? (deps.length ? Math.round((100 * hidden) / deps.length) : 0)
  const byImpact = c?.hiddenByImpact ?? {}
  const quarters = plan ? [...new Set(plan.items.map((i) => i.pi))].filter(Boolean) : []
  const perQuarter = quarters.map((q) => `${q} ${plan!.items.filter((i) => i.pi === q).length}`).join(' · ')
  const high = analysis.risks.filter((x) => x.severity === 'High')

  const todos: Todo[] = []
  if (c?.conflicts) todos.push({
    key: 'conflicts', icon: 'ti-arrows-cross', tone: 'high', go: () => onShow('conflicts'),
    text: <><b>{c.conflicts}</b> {c.conflicts === 1 ? 'conflict' : 'conflicts'} in the target quarters as written</>,
    tip: `${c.conflictsLaterQuarter} initiative(s) are targeted at an earlier quarter than something they wait for, and ${c.conflictsTight} wait for a provider that, at its team’s velocity, is still running in their quarter and leaves too little of it for them. ${c.conflictsHidden} of them come from hidden dependencies nobody declared.`,
  })
  if (c?.teamsOver) todos.push({
    key: 'capacity', icon: 'ti-gauge', tone: 'high', go: () => onShow('capacity'),
    text: <><b>{c.teamsOver}</b> {c.teamsOver === 1 ? 'team is' : 'teams are'} over capacity as targeted</>,
    tip: 'The T-shirt sizes targeted at a quarter add up to more story points than the team can deliver in it (team capacity file). The recommended plan moves the lowest-priority work later; the decision dashboard lets you choose.',
  })
  if (c?.laterQuarter || c?.spill) todos.push({
    key: 'moved', icon: 'ti-calendar-time', tone: 'warn', go: () => onShow('moved'),
    text: <><b>{c.laterQuarter}</b> start in a later quarter · <b>{c.spill}</b> finish after their target quarter</>,
    tip: 'From the recommended plan: an initiative starts later than its target quarter when something it waits for lands later or its team has no room; it spills when its points do not fit before its target quarter ends. Click its bar in the timeline for why.',
  })
  if (c?.noSize) todos.push({
    key: 'size', icon: 'ti-ruler-measure', tone: 'warn', go: () => onShow('size'),
    text: <><b>{c.noSize}</b> not sized: scheduled as {plan?.defaultSize ?? 'M'} for now</>,
    tip: 'These initiatives have no T-shirt size in the initiatives file. They are scheduled at the default size so they still take capacity; set a size in its details on the timeline and rerun.',
  })
  const toConfirm = (byImpact.orders ?? 0) + (byImpact.soft ?? 0)
  if (toConfirm) todos.push({
    key: 'confirm', icon: 'ti-user-check', tone: 'info', go: () => onShow('confirm'),
    text: <><b>{toConfirm}</b> hidden {toConfirm === 1 ? 'link shapes' : 'links shape'} the order: confirm with the teams</>,
    tip: `${byImpact.orders ?? 0} hidden dependencies change the order of the work and ${byImpact.soft ?? 0} should go first. Nobody declared them, so confirm each with the two teams: Keep the real ones (they become user-defined) and Dismiss the rest, then rerun.`,
  })
  if (high.length) todos.push({
    key: 'risks', icon: 'ti-alert-triangle', tone: 'high', go: () => onOpenRisk(high[0].id),
    text: <><b>{high.length}</b> high {high.length === 1 ? 'risk' : 'risks'} · {analysis.risks.length} in total</>,
    tip: 'Risk flags from the Dependency Risk Index rules (plan conflicts, missing owners, contracts, deprecated systems, capacity). The rules decide each flag and its severity. Click to open the first high one.',
  })
  if (r && r.total > r.analysed) todos.push({
    key: 'readiness', icon: 'ti-filter', tone: 'info', go: () => onShow('readiness'),
    text: <><b>{r.analysed}</b> of {r.total} analysed · {Object.entries(r.byStatus).filter(([s]) => !r.readyStatuses.includes(s)).map(([s, n]) => `${n} ${s}`).join(' · ')} left out</>,
    tip: `Only initiatives with status ${r.readyStatuses.join(' / ')} are planned. In Discovery means the team is still working out whether it is an initiative; Proposed means it is not accepted yet. Neither can be ready for PI planning.`,
  })
  const gaps = analysis.notChecked.filter((n) => !n.partial).length
  if (gaps) todos.push({
    key: 'gaps', icon: 'ti-eye-off', tone: 'info', go: () => onShow('gaps'),
    text: <>{plural(gaps, 'risk check')} not run: no flag there is not a clean bill</>,
    tip: analysis.notChecked.filter((n) => !n.partial).map((n) => `${n.name}: ${n.reason}.`).join(' '),
  })
  if (openComments) todos.push({
    key: 'comments', icon: 'ti-message-circle', tone: 'info', go: () => onShow('comments'),
    text: <><b>{openComments}</b> open {openComments === 1 ? 'comment' : 'comments'} from the room</>,
    tip: 'Live feedback on the initiatives, per run: concerns, questions, decisions and actions, with who raised them.',
  })
  if (!todos.length) todos.push({ key: 'ok', icon: 'ti-circle-check', tone: 'ok', go: () => onShow('timeline'), text: 'Nothing to resolve before PI planning from the checks that ran.', tip: 'No conflicts, no team over capacity and no high risks.' })

  return (
    <div className="glance">
      <div className="uc-row">
        <Tile n={1} title="Declared by the teams" go={c?.conflicts ? () => onShow('conflicts') : undefined} big={declared} unit={declared === 1 ? 'link' : 'links'}
          tip="User-defined dependencies and sequence: the systems each initiative lists in its own dependency column (upstream: it consumes them; downstream: they consume its output), and the quarter each one targets. The check below says whether those target quarters work once the dependencies and team capacity are counted."
          lines={[
            c?.declaredByRole && <>{c.declaredByRole.upstream ?? 0} upstream · {c.declaredByRole.downstream ?? 0} downstream systems</>,
            c && <span className={c.conflicts ? 'uc-bad' : 'uc-good'}>{c.conflicts ? `${plural(c.conflicts, 'conflict')} in the target quarters` : 'The target quarters hold'}</span>,
          ]} />
        <Tile n={2} title="Hidden, found by the agents" go={(byImpact.orders ?? 0) + (byImpact.soft ?? 0) ? () => onShow('confirm') : undefined} tone="accent" big={hidden} unit={`links · ${share}% of all`}
          tip="Dependencies nobody declared. The agents found them in the descriptions, in GitHub (code and shared-library links between teams that both have initiatives here) and through shared systems in the ownership lookup. They are sorted by what they do to the plan, so the few that change the order come first."
          lines={[
            <span className="uc-imp">{IMPACT_ORDER.filter((k) => byImpact[k]).map((k) => (
              <Tip key={k} title={IMPACT[k].label} content={IMPACT[k].hint}><span className={`pchip imp-${k}`}>{byImpact[k]} {IMPACT[k].label.toLowerCase()}</span></Tip>
            ))}</span>,
          ]} />
        <Tile n={3} title="Delivery timeline" go={() => onShow('timeline')} big={plan?.items.length ?? analysis.steps.length} unit={plan ? `initiatives in ${plural(quarters.length, 'quarter')}` : 'steps'}
          tip="Dependencies not yet sequenced, put in order: every initiative starts after what it waits for and when its team has room, at its T-shirt size against its team’s capacity per quarter, higher priority first. It never starts before its target quarter."
          lines={[
            perQuarter,
            c && <>{c.laterQuarter} later quarter · {c.spill} spill · {plural(c.teamsOver, 'team')} over</>,
          ]} />
      </div>

      <div className="todo-row" aria-label="Before PI planning">
        <span className="todo-label">Before PI planning</span>
        {todos.map((t) => (
          <Tip key={t.key} content={t.tip} wide>
            <button className={`todo t-${t.tone}${active === t.key ? ' on' : ''}`} aria-expanded={active === t.key} onClick={t.go}>
              <i className={`ti ${t.icon}`} aria-hidden="true" /><span>{t.text}</span>
            </button>
          </Tip>
        ))}
      </div>
    </div>
  )
}
