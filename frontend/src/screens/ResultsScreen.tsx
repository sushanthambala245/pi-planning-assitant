import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { AtAGlance, type GlanceTarget } from '../components/AtAGlance'
import { DependencyGraph } from '../components/DependencyGraph'
import { DependencyList } from '../components/DependencyList'
import { EmptyState } from '../components/EmptyState'
import { InitiativeDrawer, type DrawerTab } from '../components/InitiativeDrawer'
import { InitiativeFilter } from '../components/InitiativeFilter'
import { NodeDrawer } from '../components/NodeDrawer'
import { ReasoningDrawer } from '../components/ReasoningDrawer'
import { RerunBar } from '../components/RerunBar'
import { RiskGroups } from '../components/RiskGroups'
import { Section } from '../components/Section'
import { StatusChips, type Detail } from '../components/StatusChips'
import { GROUP_LABEL, TimelineView, type GroupBy } from '../components/TimelineView'
import { Tip } from '../components/Tip'
import type { useComments } from '../hooks/useComments'
import { LEVEL, LEVEL_ORDER, METHOD, depLabel, plural, touches } from '../lib/deps'
import { FOUND_BY, IMPACT, criticalChain } from '../lib/plan'
import type { PlannerApi } from '../lib/planner'
import { useSections } from '../lib/sections'
import type { Analysis, CommentType, DependencyRow, DepLevel } from '../types'

export type ResultsComments = ReturnType<typeof useComments> & {
  /** "Presenter (RTE)": who a new comment is posted as. */
  postingAs: string
}

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
  /** Live per-initiative comments: the backend run's, or this browser's for a replayed file. */
  comments: ResultsComments
  /** Download link for the backend run's comments (CSV). */
  commentsCsv?: string
}

type Drawer = { type: 'risk' | 'node'; id: string } | { type: 'initiative'; id: string; tab: DrawerTab } | null
type GraphScope = 'ordering' | 'change' | 'all'
type View = 'timeline' | 'graph' | 'risks'

// The view switcher (after Bhasker Rao's Results screen, results-timeline-comments). Dependencies are
// sections 1 and 2 above, so there is no separate tab for them.
const VIEWS: { id: View; label: string; icon: string; hint: string }[] = [
  { id: 'timeline', label: 'Timeline', icon: 'ti-timeline', hint: 'One bar per initiative across the quarters’ sprints, from the recommended plan. Click a bar for why it lands there, its dependencies and comments.' },
  { id: 'graph', label: 'Graph', icon: 'ti-topology-star-3', hint: 'Every link as a graph: the analysed initiatives in sequence order, what they depend on around them. Colour is the ART, shape the level. Click a node for what touches it.' },
  { id: 'risks', label: 'Risks', icon: 'ti-flag', hint: 'Dependency Risk Index rules over the run, grouped by rule. The rule decides each flag and its severity; open one for the evidence and to flag it for PI planning.' },
]

const CONFLICT = {
  later_quarter: { label: 'Later quarter', icon: 'ti-arrows-cross', hint: 'The provider is targeted at a later quarter than the initiative that waits for it, so the plan as written cannot hold: pull the provider forward or move the consumer after it.' },
  too_tight: { label: 'Tight quarter', icon: 'ti-hourglass-high', hint: 'At its team’s velocity the provider is still running when the consumer’s quarter starts: both are targeted at that quarter, or the provider spills into it from an earlier one. The consumer can only start after it, and then cannot finish inside its quarter. Start the provider first thing, split the work, or move the consumer.' },
  sprint: { label: 'Sprint overlap', icon: 'ti-calendar-x', hint: 'The consumer is planned to start before its provider is planned to finish.' },
} as const

export function ResultsScreen({ analysis, initiativeCount, onViewAnalysis, onOpenDashboard, onBack, flags, onToggleFlag, review, planner, comments, commentsCsv }: Props) {
  const { jump } = useSections()
  const [drawer, setDrawer] = useState<Drawer>(null)
  const [initiative, setInitiative] = useState('')
  const [level, setLevel] = useState<DepLevel | ''>('')
  const [scope, setScope] = useState<GraphScope>('ordering')
  const [methods, setMethods] = useState<Set<string>>(new Set())
  const [query, setQuery] = useState('')
  const [view, setView] = useState<View>('timeline')
  const [groupBy, setGroupBy] = useState<GroupBy>('quarter')
  const [openOnly, setOpenOnly] = useState(false)
  const [detail, setDetail] = useState<Detail | null>(null)
  const [expanded, setExpanded] = useState(false)

  useEffect(() => {
    if (!expanded) return
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setExpanded(false)
    document.addEventListener('keydown', esc)
    return () => document.removeEventListener('keydown', esc)
  }, [expanded])

  const depsByKey = useMemo(() => new Map((analysis?.dependencies ?? []).map((d) => [d.key, d])), [analysis])
  const plan = analysis?.plan
  const chain = useMemo(() => (plan ? criticalChain(plan) : new Set<string>()), [plan])

  // Initiatives the timeline shows: the focused one with what it waits for and what waits for it,
  // and, when asked, only those with open comments.
  const visibleIds = useMemo(() => {
    if (!plan || (!initiative && !openOnly)) return null
    let ids = new Set(plan.items.map((i) => i.id))
    if (initiative) {
      const near = new Set([initiative, ...(plan.items.find((i) => i.id === initiative)?.waitsFor ?? []),
        ...plan.items.filter((i) => i.waitsFor.includes(initiative)).map((i) => i.id)])
      ids = new Set([...ids].filter((id) => near.has(id)))
    }
    if (openOnly) ids = new Set([...ids].filter((id) => (comments.byInitiative.get(id)?.open ?? 0) > 0))
    return ids
  }, [plan, initiative, openOnly, comments.byInitiative])

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
        Load data and run an analysis to see the declared and hidden dependencies, the delivery timeline and the risks here.
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
  const activeIni = drawer?.type === 'initiative' ? drawer.id : null
  const focusId = activeIni ?? activeNode?.id ?? null
  const focusDeps = focusId ? all.filter((d) => touches(d, focusId)) : []
  const highlight = activeRisk ? activeRisk.highlightNodes : focusId ? [focusId, ...focusDeps.flatMap((d) => [d.from, d.to])] : []
  const openRisk = (id: string) => setDrawer({ type: 'risk', id })
  const openInitiative = (id: string, t: DrawerTab = 'details') => setDrawer({ type: 'initiative', id, tab: t })
  const onNodeClick = (id: string) => (runIds.has(id) ? openInitiative(id) : setDrawer({ type: 'node', id }))
  const mineCount = activeIni ? comments.byInitiative.get(activeIni) : undefined
  // "Before PI planning" opens the matching chip (or view) below and scrolls to it.
  const show = (target: GlanceTarget) => {
    if (target === 'risks') setView('risks')
    else { setView('timeline'); if (target !== 'timeline') setDetail(target) }
    jump('timeline')
  }
  const flipMethod = (m: string) => setMethods((s) => { const n = new Set(s); if (n.has(m)) n.delete(m); else n.add(m); return n })

  return (
    <div className={`results${expanded ? ' expanded' : ''}`}>
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
        <AtAGlance analysis={analysis} onOpenRisk={openRisk} onShow={show} />
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

      <Section id="timeline" title="3 · Delivery timeline" icon="ti-timeline" count={plan ? `${plan.counts.laterQuarter} move` : analysis.steps.length}
        sub={plan ? `By quarter, at each initiative's T-shirt size against its team's capacity: ${plan.counts.laterQuarter} start in a later quarter than targeted, ${plan.counts.spill} spill over.` : undefined}
        tip="Use case 3: the sequence for dependencies that were not defined. Every initiative starts no earlier than its target quarter, after everything it waits for (the sprint after the provider finishes), and when its team has room, higher priority first. Its T-shirt size in story points fills the team’s capacity sprint by sprint, so a slow team takes longer for the same size. Click a bar for why it lands there, to set its size or a note for the rerun, or to comment on it."
        actions={plan && <button className="btn btn-ghost btn-sm" onClick={onOpenDashboard}><i className="ti ti-layout-kanban" aria-hidden="true" /> Decide quarters</button>}>
        <StatusChips
          analysis={analysis}
          openComments={comments.openCount}
          open={detail}
          onOpen={setDetail}
          onShowOpenComments={() => { setView('timeline'); setOpenOnly(true) }}
          onShowRisks={() => setView('risks')}
          onSelectInitiative={(id) => openInitiative(id)}
          onOpenDashboard={onOpenDashboard}
          onViewAnalysis={onViewAnalysis}
          review={review}
          commentsCsv={commentsCsv}
        />

        <div className={`dt-area${expanded ? ' expanded' : ''}`}>
          <div className="view-bar">
            <div className="seg" role="tablist" aria-label="Results view">
              {VIEWS.map((v) => (
                <Tip key={v.id} title={v.label} content={v.hint}>
                  <button role="tab" aria-selected={view === v.id} className={`seg-btn${view === v.id ? ' active' : ''}`} onClick={() => setView(v.id)}>
                    <i className={`ti ${v.icon}`} aria-hidden="true" /> {v.label}{v.id === 'risks' && <span className="tab-n">{risks.length}</span>}
                  </button>
                </Tip>
              ))}
            </div>
            <div className="view-filters">
              {view === 'timeline' && plan && (
                <>
                  <label className="filter-field">
                    <i className="ti ti-layout-rows" aria-hidden="true" />
                    <select className="select" aria-label="Group by" value={groupBy} onChange={(e) => setGroupBy(e.target.value as GroupBy)}>
                      {(Object.keys(GROUP_LABEL) as GroupBy[]).map((g) => <option key={g} value={g}>Group: {GROUP_LABEL[g]}</option>)}
                    </select>
                  </label>
                  <label className="filter-field">
                    <i className="ti ti-message-circle" aria-hidden="true" />
                    <select className="select" aria-label="Comments filter" value={openOnly ? 'open' : 'all'} onChange={(e) => setOpenOnly(e.target.value === 'open')}>
                      <option value="all">Comments: all</option>
                      <option value="open">Comments: open only</option>
                    </select>
                  </label>
                </>
              )}
              {view === 'graph' && (
                <>
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
                </>
              )}
              <Tip title={expanded ? 'Leave full screen' : 'Full screen'} content={expanded ? 'Back to the page (Esc).' : 'Show this view on the whole screen, for presenting at PI planning. Esc leaves it.'}>
                <button className="icon-circle sm" aria-label={expanded ? 'Leave full screen' : 'Full screen'} onClick={() => setExpanded((e) => !e)}>
                  <i className={`ti ${expanded ? 'ti-arrows-minimize' : 'ti-arrows-maximize'}`} aria-hidden="true" />
                </button>
              </Tip>
            </div>
          </div>

          <div className="view-main">
            {view === 'timeline' && (plan ? (
              <TimelineView analysis={analysis} plan={plan} groupBy={groupBy} visibleIds={visibleIds} selectedId={activeIni}
                counts={comments.byInitiative}
                onSelect={(id) => openInitiative(id, drawer?.type === 'initiative' ? drawer.tab : 'details')}
                onOpenComments={(id) => openInitiative(id, 'comments')} />
            ) : (
              <div className="dt-flat">
                <div className="list-empty">This analysis has no quarter plan, so there is no timeline: the dependency order alone, as steps.</div>
                {analysis.steps.map((s) => (
                  <div className="seq-step" key={s.step}>
                    <div className="init-num">{s.step}</div>
                    <div><div className="seq-label">{s.label}{s.inCycle && <span className="sev sev-h" style={{ marginLeft: 6 }}>cycle</span>}</div>{s.why && <div className="seq-why">{s.why}</div>}</div>
                  </div>
                ))}
              </div>
            ))}
            {view === 'graph' && (
              <DependencyGraph nodes={nodes} edges={edges} highlight={highlight} onNodeClick={onNodeClick}
                depsByKey={depsByKey} innerIds={runIds} order={order} focusId={initiative || undefined}
                caption={filtering ? `showing ${edges.length} of ${classified ? all.length : analysis.graph.edges.length} links` : undefined} />
            )}
            {view === 'risks' && (
              <div className="dt-risks"><RiskGroups risks={risks} notChecked={analysis.notChecked} flags={flags} onOpen={openRisk} /></div>
            )}
          </div>
        </div>
      </Section>

      <RerunBar planner={planner} />

      {activeRisk && (
        <ReasoningDrawer key={activeRisk.id} risk={activeRisk} flagged={flags.includes(activeRisk.id)} onToggleFlag={() => onToggleFlag(activeRisk.id)}
          onClose={() => setDrawer(null)} onPrev={() => step(-1)} onNext={() => step(1)} />
      )}
      {activeNode && (
        <NodeDrawer node={activeNode} deps={focusDeps} risks={allRisks.filter((x) => x.highlightNodes.includes(activeNode.id))} inRun={runIds.has(activeNode.id)}
          onClose={() => setDrawer(null)} onOpenRisk={openRisk} labelOf={labelOf} />
      )}
      {drawer?.type === 'initiative' && activeIni && (
        <InitiativeDrawer key={activeIni} analysis={analysis} plan={plan} initiativeId={activeIni} tab={drawer.tab}
          onTab={(t) => setDrawer({ type: 'initiative', id: activeIni, tab: t })}
          deps={focusDeps} critical={chain.size > 1 && chain.has(activeIni)}
          risks={allRisks.filter((x) => x.initiativeIds.includes(activeIni) || x.highlightNodes.includes(activeIni))}
          commentCount={mineCount?.count ?? 0} openComments={mineCount?.open ?? 0}
          comments={{
            comments: comments.comments.filter((x) => x.initiativeId === activeIni),
            status: comments.status, updatedAt: comments.updatedAt, postingAs: comments.postingAs,
            onAdd: (type: CommentType, text: string) => comments.add(activeIni, type, text),
            onResolve: comments.resolve,
          }}
          planner={planner} onClose={() => setDrawer(null)} onOpenRisk={openRisk} onSelectInitiative={(id) => openInitiative(id)} labelOf={labelOf} />
      )}
    </div>
  )
}
