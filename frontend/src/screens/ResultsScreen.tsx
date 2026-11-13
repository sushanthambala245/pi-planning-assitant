import { useMemo, useState, type ReactNode } from 'react'
import { AtAGlance } from '../components/AtAGlance'
import { CapacityTable } from '../components/CapacityTable'
import { StatusChip } from '../components/Chips'
import { DependencyGraph } from '../components/DependencyGraph'
import { DependencyList } from '../components/DependencyList'
import { EmptyState } from '../components/EmptyState'
import { InitiativeFilter } from '../components/InitiativeFilter'
import { NodeDrawer } from '../components/NodeDrawer'
import { PlanTable } from '../components/PlanTable'
import { ReasoningDrawer } from '../components/ReasoningDrawer'
import { RerunBar } from '../components/RerunBar'
import { RiskGroups } from '../components/RiskGroups'
import { Section } from '../components/Section'
import { SidePanel, type SideTab } from '../components/SidePanel'
import { Tip } from '../components/Tip'
import { LEVEL, LEVEL_ORDER, METHOD, depLabel, plural, touches } from '../lib/deps'
import { FOUND_BY, IMPACT } from '../lib/plan'
import type { PlannerApi } from '../lib/planner'
import type { Analysis, DependencyRow, DepLevel } from '../types'

interface Props {
  analysis: Analysis | null
  initiativeCount: number
  onViewAnalysis: () => void
  onOpenDashboard: () => void
  onBack: () => void
  /** Risk ids flagged for PI planning. */
  flags: string[]
  onToggleFlag: (riskId: string) => void
  /** Review and export controls for a backend run; absent for a replayed file. */
  review?: ReactNode
  planner: PlannerApi
}

type Drawer = { type: 'risk' | 'node'; id: string } | null
type GraphScope = 'ordering' | 'change' | 'all'

const CONFLICT = {
  later_quarter: { label: 'Later quarter', icon: 'ti-arrows-cross', hint: 'The provider is targeted at a later quarter than the initiative that waits for it, so the plan as written cannot hold: pull the provider forward or move the consumer after it.' },
  too_tight: { label: 'Tight quarter', icon: 'ti-hourglass-high', hint: 'At its team’s velocity the provider is still running when the consumer’s quarter starts: both are targeted at that quarter, or the provider spills into it from an earlier one. The consumer can only start after it, and then cannot finish inside its quarter. Start the provider first thing, split the work, or move the consumer.' },
  sprint: { label: 'Sprint overlap', icon: 'ti-calendar-x', hint: 'The consumer is planned to start before its provider is planned to finish.' },
} as const

export function ResultsScreen({ analysis, initiativeCount, onViewAnalysis, onOpenDashboard, onBack, flags, onToggleFlag, review, planner }: Props) {
  const [drawer, setDrawer] = useState<Drawer>(null)
  const [initiative, setInitiative] = useState('')
  const [level, setLevel] = useState<DepLevel | ''>('')
  const [scope, setScope] = useState<GraphScope>('ordering')
  const [methods, setMethods] = useState<Set<string>>(new Set())
  const [query, setQuery] = useState('')
  const [tab, setTab] = useState<SideTab>('Dependencies')

  const depsByKey = useMemo(() => new Map((analysis?.dependencies ?? []).map((d) => [d.key, d])), [analysis])
  const plan = analysis?.plan

  // Provider initiatives whose team is over capacity in the quarter they are targeted at: their consumers slip too.
  const overloaded = useMemo(() => {
    const out = new Set<string>()
    if (!plan) return out
    for (const t of plan.teams) {
      for (const [q, pts] of Object.entries(t.plannedByPi)) {
        const cap = t.capacityByPi[q] ?? t.quarterCapacity
        if (cap && pts > cap) plan.items.filter((i) => i.team === t.id && i.targetQuarter === q).forEach((i) => out.add(i.id))
      }
    }
    return out
  }, [plan])

  if (!analysis) {
    return (
      <EmptyState icon="ti-chart-dots" title="No results yet" actions={<button className="btn btn-primary" onClick={onBack}>Go to intake</button>}>
        Load data and run an analysis to see the declared and hidden dependencies, the recommended sequence and the risks here.
      </EmptyState>
    )
  }

  const runIds = new Set(analysis.initiatives.length ? analysis.initiatives.map((i) => i.id) : analysis.graph.nodes.filter((n) => n.kind === 'initiative').map((n) => n.id))
  const order = analysis.steps.flatMap((s) => s.initiativeIds)
  const labelOf = (key: string) => {
    const d = depsByKey.get(key)
    return d ? depLabel(d) : key
  }
  const flagFor = (d: DependencyRow) => (overloaded.has(d.to)
    ? <Tip title="Provider team over capacity" content={`${d.toLabel}’s team has more story points targeted at its quarter than it can deliver, so ${d.toLabel} is likely to slip and ${d.fromLabel} with it.`}><span className="pchip imp-over"><i className="ti ti-gauge" aria-hidden="true" /> Provider over capacity</span></Tip>
    : null)

  const all = analysis.dependencies
  const mine = (d: DependencyRow) => !initiative || touches(d, initiative)
  const declared = all.filter((d) => (d.declared ?? !d.inferred) && mine(d))
  const q = query.trim().toLowerCase()
  const hiddenAll = all.filter((d) => !(d.declared ?? !d.inferred) && mine(d))
  const hidden = hiddenAll.filter((d) => (!methods.size || d.methods.some((m) => methods.has(m)))
    && (!q || `${d.fromLabel} ${d.toLabel} ${d.reason} ${d.toTeam}`.toLowerCase().includes(q)))
  const methodCounts = Object.fromEntries([...new Set(hiddenAll.flatMap((d) => d.methods))].map((m) => [m, hiddenAll.filter((d) => d.methods.includes(m)).length]))
  const conflicts = (plan?.conflicts ?? []).filter((c) => !initiative || c.consumer === initiative || c.provider === initiative)

  // The graph explorer: one set of filters for the graph and the tabs beside it.
  const inScope = all.filter((d) => mine(d) && (!level || d.level === level))
  const graphDeps = inScope.filter((d) => scope === 'all' || (scope === 'change' ? d.changeType !== 'none' : d.impact === 'orders' || d.impact === 'soft'))
  const shownKeys = new Set(graphDeps.map((d) => d.key))
  const classified = all.length > 0
  const edges = classified ? analysis.graph.edges.filter((e) => shownKeys.has(e.key ?? `${e.from}->${e.to}`)) : analysis.graph.edges
  const onGraph = new Set(edges.flatMap((e) => [e.from, e.to]))
  const filtering = !!initiative || !!level || scope !== 'all'
  const nodes = analysis.graph.nodes.filter((n) => !filtering || onGraph.has(n.id) || (initiative ? n.id === initiative : false))
  const risks = initiative ? analysis.risks.filter((r) => r.initiativeIds.includes(initiative) || r.highlightNodes.includes(initiative)) : analysis.risks

  const allRisks = analysis.risks
  const riskIndex = drawer?.type === 'risk' ? allRisks.findIndex((r) => r.id === drawer.id) : -1
  const activeRisk = riskIndex >= 0 ? allRisks[riskIndex] : null
  const step = (delta: number) => setDrawer({ type: 'risk', id: allRisks[(riskIndex + delta + allRisks.length) % allRisks.length].id })
  const activeNode = drawer?.type === 'node' ? analysis.graph.nodes.find((n) => n.id === drawer.id) ?? null : null
  const nodeDeps = activeNode ? all.filter((d) => touches(d, activeNode.id)) : []
  const highlight = activeRisk ? activeRisk.highlightNodes : activeNode ? [activeNode.id, ...nodeDeps.flatMap((d) => [d.from, d.to])] : []
  const openRisk = (id: string) => setDrawer({ type: 'risk', id })
  const r = analysis.readiness
  const flipMethod = (m: string) => setMethods((s) => { const n = new Set(s); if (n.has(m)) n.delete(m); else n.add(m); return n })

  return (
    <div className="results">
      <div className="results-bar">
        <InitiativeFilter initiatives={analysis.initiatives} value={initiative} onChange={setInitiative} />
        <span className="results-bar-note">{initiativeCount} initiatives analysed{initiative && ' · filtered to one initiative and what touches it'}</span>
        <span className="results-bar-end">
          <button className="link-btn" onClick={onViewAnalysis}><i className="ti ti-topology-star-3" aria-hidden="true" /> How was this analysed?</button>
          {plan && <button className="btn btn-primary btn-sm" onClick={onOpenDashboard}><i className="ti ti-layout-kanban" aria-hidden="true" /> Decide quarters</button>}
        </span>
      </div>

      <Section id="glance" title="At a glance" icon="ti-layout-dashboard" tone="accent"
        tip="The three use cases in numbers, then what to resolve before PI planning. Hover any number for how it is counted; click a tile or an item to jump to its section.">
        <AtAGlance analysis={analysis} onOpenRisk={openRisk} />
      </Section>

      <Section id="declared" title="1 · Declared dependencies" icon="ti-clipboard-check" count={declared.length}
        sub="What the teams wrote down: each initiative's dependency column and its target quarter, and whether those quarters hold."
        tip="Use case 1: user-defined dependencies and sequence. The dependency column lists the systems an initiative consumes (upstream) and the systems that consume its output (downstream); the target quarter is the sequence the team planned. The conflicts below are target quarters that break once the dependencies (declared and hidden) and the teams’ capacity are counted.">
        {plan && (
          <div className="conflicts">
            <div className="block-label">
              Target quarters as written: {conflicts.length ? plural(conflicts.length, 'conflict') : 'no conflicts'}
            </div>
            {conflicts.map((c) => (
              <div className={`conflict c-${c.kind}`} key={`${c.provider}-${c.consumer}`}>
                <Tip title={CONFLICT[c.kind].label} content={CONFLICT[c.kind].hint}>
                  <span className="pchip imp-orders"><i className={`ti ${CONFLICT[c.kind].icon}`} aria-hidden="true" /> {CONFLICT[c.kind].label}</span>
                </Tip>
                <span className="conflict-text">
                  <b>{c.consumerLabel}</b> ({c.consumerQuarter}) waits for <b>{c.providerLabel}</b> ({c.providerQuarter || c.providerFinishLabel})
                  {c.kind === 'too_tight' && <>: the provider finishes {c.providerFinishLabel}, so it would end {c.consumerFinishLabel}</>}
                  {' · '}<span className="muted">{c.declared ? 'declared' : 'hidden'} dependency · recommended start {c.recommendedStart}</span>
                </span>
              </div>
            ))}
          </div>
        )}
        {(() => {
          const owners = new Set(declared.map((d) => d.from)).size
          return (
            <details className="steps-more" key={initiative || 'all'} open={owners <= 8}>
              <summary>
                <Tip title="Declared links by initiative" content="Each initiative’s own dependency column, one group per initiative: the systems it consumes (upstream) and the ones that consume its output (downstream), with the team that owns each. Open a link for the evidence, to keep or dismiss it, or to add a note.">
                  <span>Declared links by initiative: {plural(declared.length, 'link')} across {plural(owners, 'initiative')}</span>
                </Tip>
              </summary>
              <DependencyList deps={declared} groupBy="initiative" labelOf={labelOf} planner={planner} flagFor={flagFor}
                empty="No declared dependencies: the initiatives' dependency column is empty." />
            </details>
          )
        })()}
      </Section>

      <Section id="hidden" title="2 · Hidden dependencies" icon="ti-eye-search" count={hiddenAll.length} tone="accent"
        sub={plan ? `${plan.counts.hidden} found that nobody declared (${plan.counts.hiddenShare}% of all links). The ones that change the order come first.` : undefined}
        tip="Use case 2: dependencies that were not found before. The agents read the descriptions (stated but not declared), the GitHub manifests (code and shared-library links between teams with initiatives in the plan) and the ownership lookup (two initiatives on one system). Grouped by what each one does to the plan. Keep the ones the teams confirm and dismiss the rest; the rerun uses your decisions.">
        <div className="hidden-bar">
          <label className="search-box">
            <i className="ti ti-search" aria-hidden="true" />
            <input type="text" placeholder="Search initiatives, systems, teams" aria-label="Search hidden dependencies" value={query} onChange={(e) => setQuery(e.target.value)} />
          </label>
          <span className="chip-bar">
            {Object.entries(methodCounts).map(([m, n]) => (
              <Tip key={m} title={FOUND_BY[m]?.label ?? m} content={FOUND_BY[m]?.hint ?? ''}>
                <button className={`chip${methods.has(m) ? ' on' : ''}`} aria-pressed={methods.has(m)} onClick={() => flipMethod(m)}>
                  <i className={`ti ${FOUND_BY[m]?.icon ?? 'ti-search'}`} aria-hidden="true" /> {METHOD[m] ?? m} <span className="chip-n">{n}</span>
                </button>
              </Tip>
            ))}
            {methods.size > 0 && <button className="link-btn" onClick={() => setMethods(new Set())}>All methods</button>}
          </span>
        </div>
        <DependencyList deps={hidden} groupBy="impact" labelOf={labelOf} planner={planner} openGroups={['orders', 'soft']} flagFor={flagFor}
          empty={hiddenAll.length ? 'No hidden dependency matches the filter.' : 'No hidden dependencies were found.'} />
      </Section>

      <Section id="sequence" title="3 · Recommended sequence" icon="ti-list-numbers" count={plan ? `${plan.counts.laterQuarter} move` : analysis.steps.length}
        sub={plan ? `By quarter, at each initiative's T-shirt size against its team's capacity: ${plan.counts.laterQuarter} start in a later quarter than targeted, ${plan.counts.spill} spill over, ${plan.counts.moved} start later inside a quarter.` : undefined}
        tip="Use case 3: the sequence for dependencies that were not defined. Every initiative starts no earlier than its target quarter, after everything it waits for (the sprint after the provider finishes), and when its team has room, higher priority first. Its T-shirt size in story points fills the team’s capacity sprint by sprint, so a slow team takes longer for the same size. Open a row for the reasons and to add a note or change its size for the rerun."
        actions={plan && <button className="btn btn-ghost btn-sm" onClick={onOpenDashboard}><i className="ti ti-layout-kanban" aria-hidden="true" /> Decide quarters</button>}>
        {plan ? <PlanTable plan={plan} planner={planner} focus={initiative || undefined} /> : <div className="list-empty">This analysis has no quarter plan.</div>}
        {analysis.steps.length > 0 && (
          <details className="steps-more">
            <summary>
              <Tip title="Dependency order" content="The ordering links alone, as steps: an initiative in step 2 waits for one in step 1. Initiatives in one step can run in parallel. The quarter plan above adds sizes and team capacity on top of this order.">
                <span>Dependency order: {plural(analysis.steps.length, 'step')}</span>
              </Tip>
            </summary>
            {analysis.steps.map((s) => (
              <div className={`seq-step${initiative && s.initiativeIds.includes(initiative) ? ' here' : ''}`} key={s.step}>
                <div className="init-num">{s.step}</div>
                <div>
                  <div className="seq-label">{s.initiativeIds.length > 6 ? `${plural(s.initiativeIds.length, 'initiative')} that wait on nothing else in the run` : s.label}
                    {s.inCycle && <span className="sev sev-h" style={{ marginLeft: 6 }}>cycle</span>}</div>
                  {s.why && <div className="seq-why">{s.why}</div>}
                </div>
              </div>
            ))}
          </details>
        )}
      </Section>

      {plan && (
        <Section id="capacity" title="Team capacity & velocity" icon="ti-gauge" count={plan.counts.teamsOver ? `${plan.counts.teamsOver} over` : undefined}
          tip="Each team’s available story points per quarter (team capacity file), its velocity tier, and per quarter the points targeted there or planned there. Different teams have different velocity, so the same T-shirt size fills a different share of their quarter.">
          <CapacityTable plan={plan} />
        </Section>
      )}

      <Section id="risks" title="Risks" icon="ti-alert-triangle" count={risks.length}
        tip="Dependency Risk Index rules over the run: plan conflicts, systems with no owner, contracts that are missing or draft, deprecated systems and repositories, team capacity and cycles. The rule decides each flag and its severity; the reasoning drawer shows the evidence.">
        <RiskGroups risks={risks} notChecked={analysis.notChecked} flags={flags} onOpen={openRisk} />
      </Section>

      <Section id="graph" title="Dependency graph" icon="ti-share" defaultOpen={false}
        tip="Every link as a graph: the analysed initiatives on the left (in sequence order), what they depend on on the right. Colour is the ART, shape the level (circle initiative, square team, diamond system). Hover a line for why it exists; click a node for what touches it.">
        <div className="results-filters">
          <div className="seg" role="group" aria-label="Which links to draw">
            {([['ordering', 'Order-changing'], ['change', 'Need a change'], ['all', 'All links']] as [GraphScope, string][]).map(([k, l]) => (
              <Tip key={k} title={l} content={k === 'ordering' ? `${IMPACT.orders.label} and ${IMPACT.soft.label.toLowerCase()} only: the links that shape the sequence.` : k === 'change' ? 'Links where someone must build, agree or re-test something.' : 'Every link, including awareness-only ones.'}>
                <button className={`seg-btn${scope === k ? ' active' : ''}`} aria-pressed={scope === k} onClick={() => setScope(k)}>{l}</button>
              </Tip>
            ))}
          </div>
          <div className="seg" role="group" aria-label="Filter by level">
            <button className={`seg-btn${level === '' ? ' active' : ''}`} aria-pressed={level === ''} onClick={() => setLevel('')}>All levels</button>
            {LEVEL_ORDER.map((l) => (
              <Tip key={l} title={LEVEL[l].label} content={LEVEL[l].hint}>
                <button className={`seg-btn${level === l ? ' active' : ''}`} aria-pressed={level === l} onClick={() => setLevel(l)}>
                  <i className={`ti ${LEVEL[l].icon}`} aria-hidden="true" /> {LEVEL[l].label}
                </button>
              </Tip>
            ))}
          </div>
        </div>
        <div className="results-outer">
          <div className="s3-main">
            <DependencyGraph nodes={nodes} edges={edges} highlight={highlight} onNodeClick={(id) => setDrawer({ type: 'node', id })}
              depsByKey={depsByKey} innerIds={runIds} order={order} focusId={initiative || undefined}
              caption={filtering ? `showing ${edges.length} of ${classified ? all.length : analysis.graph.edges.length} links` : undefined} />
            <SidePanel analysis={analysis} deps={graphDeps} risks={risks} initiative={initiative} hiddenNoChange={inScope.length - graphDeps.length}
              onShowNoChange={() => setScope('all')} activeRiskId={activeRisk?.id ?? null} onSelectRisk={openRisk} flags={flags} labelOf={labelOf} tab={tab} onTab={setTab} />
          </div>
        </div>
      </Section>

      {r && (
        <Section id="readiness" title="Left out of this run" icon="ti-filter-off" count={r.excluded.length} defaultOpen={false}
          sub={`Only ${r.readyStatuses.join(' / ')} is analysed: ${r.analysed} of ${r.total} initiatives.`}
          tip="Initiatives still In Discovery are not yet known to be initiatives, and Proposed ones are not accepted yet, so neither can be ready for PI planning. They are left out of the dependencies, the sequence and the capacity counts.">
          <div className="readiness">
            {Object.entries(r.byStatus).map(([s, n]) => (
              <span key={s} className="readiness-stat"><StatusChip status={s} /> {n}</span>
            ))}
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
          {r.readyNotAnalysed.length > 0 && <div className="muted">{plural(r.readyNotAnalysed.length, 'ready initiative')} not ticked on Intake: {r.readyNotAnalysed.join(', ')}</div>}
        </Section>
      )}

      {review && (
        <Section id="review" title="Review & export" icon="ti-user-check"
          tip="A release train engineer, engineering manager or architect approves the order before the Jira link proposals are exported, or challenges it with a constraint (which initiative goes first) and the sequence is worked out again.">
          {review}
        </Section>
      )}

      <RerunBar planner={planner} />

      {activeRisk && (
        <ReasoningDrawer key={activeRisk.id} risk={activeRisk} flagged={flags.includes(activeRisk.id)} onToggleFlag={() => onToggleFlag(activeRisk.id)}
          onClose={() => setDrawer(null)} onPrev={() => step(-1)} onNext={() => step(1)} />
      )}
      {activeNode && (
        <NodeDrawer node={activeNode} deps={nodeDeps} risks={allRisks.filter((x) => x.highlightNodes.includes(activeNode.id))} inRun={runIds.has(activeNode.id)}
          onClose={() => setDrawer(null)} onOpenRisk={openRisk} labelOf={labelOf} />
      )}
    </div>
  )
}
