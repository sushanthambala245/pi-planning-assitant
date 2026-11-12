import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { DependencyGraph } from '../components/DependencyGraph'
import { EmptyState } from '../components/EmptyState'
import { Headline } from '../components/Headline'
import { InitiativeDrawer, type DrawerTab } from '../components/InitiativeDrawer'
import { InitiativeFilter } from '../components/InitiativeFilter'
import { NodeDrawer } from '../components/NodeDrawer'
import { ReasoningDrawer } from '../components/ReasoningDrawer'
import { SidePanel, type SideTab } from '../components/SidePanel'
import { TimelineView, type GroupBy } from '../components/TimelineView'
import type { useComments } from '../hooks/useComments'
import { LEVEL, LEVEL_ORDER, depLabel, touches } from '../lib/deps'
import type { Analysis, CommentType, DepLevel } from '../types'

type View = 'timeline' | 'graph' | 'dependencies' | 'risks'
type Drawer = { type: 'risk' | 'node'; id: string } | { type: 'initiative'; id: string; tab: DrawerTab } | null

export type ResultsComments = ReturnType<typeof useComments> & {
  /** "Presenter (RTE)": who a new comment is posted as. */
  postingAs: string
}

interface Props {
  analysis: Analysis | null
  onViewAnalysis: () => void
  onBack: () => void
  /** Risk ids flagged for PI planning. */
  flags: string[]
  onToggleFlag: (riskId: string) => void
  /** Review and export controls for a backend run; absent for a replayed file. */
  review?: ReactNode
  comments: ResultsComments
}

const VIEWS: { id: View; label: string; icon: string }[] = [
  { id: 'timeline', label: 'Timeline', icon: 'ti-timeline' },
  { id: 'graph', label: 'Graph', icon: 'ti-topology-star-3' },
  { id: 'dependencies', label: 'Dependencies', icon: 'ti-link' },
  { id: 'risks', label: 'Risks', icon: 'ti-flag' },
]

export function ResultsScreen({ analysis, onViewAnalysis, onBack, flags, onToggleFlag, review, comments }: Props) {
  const [view, setView] = useState<View>('timeline')
  const [drawer, setDrawer] = useState<Drawer>(null)
  const [initiative, setInitiative] = useState('')
  const [groupBy, setGroupBy] = useState<GroupBy>('step')
  const [openOnly, setOpenOnly] = useState(false)
  const [changesOnly, setChangesOnly] = useState(true)
  const [level, setLevel] = useState<DepLevel | ''>('')
  const [depTab, setDepTab] = useState<SideTab>('Dependencies')
  const [expanded, setExpanded] = useState(false)

  useEffect(() => {
    if (!expanded) return
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setExpanded(false)
    document.addEventListener('keydown', esc)
    return () => document.removeEventListener('keydown', esc)
  }, [expanded])

  const depsByKey = useMemo(() => new Map((analysis?.dependencies ?? []).map((d) => [d.key, d])), [analysis])

  // Initiatives the timeline shows: the focused one with what it waits for and what waits for it,
  // and, when asked, only those with open comments.
  const visibleIds = useMemo(() => {
    if (!analysis || (!initiative && !openOnly)) return null
    let ids = new Set(analysis.initiatives.map((i) => i.id))
    if (initiative) {
      const rows = analysis.schedule?.rows ?? []
      const near = new Set([initiative, ...(rows.find((r) => r.initiativeId === initiative)?.waitsFor ?? []),
        ...rows.filter((r) => r.waitsFor.includes(initiative)).map((r) => r.initiativeId)])
      ids = new Set([...ids].filter((id) => near.has(id)))
    }
    if (openOnly) ids = new Set([...ids].filter((id) => (comments.byInitiative.get(id)?.open ?? 0) > 0))
    return ids
  }, [analysis, initiative, openOnly, comments.byInitiative])

  if (!analysis) {
    return (
      <EmptyState
        icon="ti-chart-dots"
        title="No results yet"
        actions={<button className="btn btn-primary" onClick={onBack}>Go to intake</button>}
      >
        Load data and run an analysis to see the timeline, dependencies and risks here.
      </EmptyState>
    )
  }

  const classified = analysis.dependencies.length > 0
  const runIds = new Set(analysis.initiatives.length ? analysis.initiatives.map((i) => i.id) : analysis.graph.nodes.filter((n) => n.kind === 'initiative').map((n) => n.id))
  const order = analysis.steps.flatMap((s) => s.initiativeIds)

  // One set of filters drives the graph and the lists.
  const inScope = analysis.dependencies.filter((d) => (!initiative || touches(d, initiative)) && (!level || d.level === level))
  const deps = inScope.filter((d) => !changesOnly || d.changeType !== 'none')
  const hiddenNoChange = inScope.length - deps.length
  const shownKeys = new Set(deps.map((d) => d.key))
  const edges = classified
    ? analysis.graph.edges.filter((e) => (e.key ? shownKeys.has(e.key) : shownKeys.has(`${e.from}->${e.to}`)))
    : analysis.graph.edges.filter((e) => !initiative || e.from === initiative || e.to === initiative)
  const filtering = !!initiative || !!level || (classified && changesOnly)
  const onGraph = new Set(edges.flatMap((e) => [e.from, e.to]))
  const nodes = analysis.graph.nodes.filter((n) =>
    !filtering || onGraph.has(n.id) || (initiative ? n.id === initiative : runIds.has(n.id)))
  const risks = initiative ? analysis.risks.filter((r) => r.initiativeIds.includes(initiative) || r.highlightNodes.includes(initiative)) : analysis.risks

  const { risks: allRisks } = analysis
  const riskIndex = drawer?.type === 'risk' ? allRisks.findIndex((r) => r.id === drawer.id) : -1
  const activeRisk = riskIndex >= 0 ? allRisks[riskIndex] : null
  const stepRisk = (delta: number) => setDrawer({ type: 'risk', id: allRisks[(riskIndex + delta + allRisks.length) % allRisks.length].id })
  const activeNode = drawer?.type === 'node' ? analysis.graph.nodes.find((n) => n.id === drawer.id) ?? null : null
  const activeIni = drawer?.type === 'initiative' ? drawer.id : null
  const focusId = activeIni ?? activeNode?.id ?? null
  const focusDeps = focusId ? analysis.dependencies.filter((d) => touches(d, focusId)) : []

  const highlight = activeRisk ? activeRisk.highlightNodes : focusId ? [focusId, ...focusDeps.flatMap((d) => [d.from, d.to])] : []
  const labelOf = (key: string) => {
    const d = depsByKey.get(key)
    return d ? depLabel(d) : key
  }
  const total = classified ? analysis.dependencies.length : analysis.graph.edges.length
  const openRisk = (id: string) => { setView('risks'); setDrawer({ type: 'risk', id }) }
  const openInitiative = (id: string, tab: DrawerTab = 'details') => setDrawer({ type: 'initiative', id, tab })
  const onNodeClick = (id: string) => (runIds.has(id) ? openInitiative(id) : setDrawer({ type: 'node', id }))

  const counts: Record<View, number | null> = { timeline: null, graph: null, dependencies: classified ? deps.length : analysis.graph.edges.length, risks: risks.length }
  const mine = activeIni ? comments.comments.filter((c) => c.initiativeId === activeIni) : []
  const mineCount = activeIni ? comments.byInitiative.get(activeIni) : undefined
  const depViewOnly: SideTab[] = ['Dependencies', 'Teams', 'Sequence']
  const showDepFilters = classified && (view === 'graph' || view === 'dependencies')

  return (
    <div className={`results${expanded ? ' expanded' : ''}`}>
      {!expanded && (
        <Headline
          analysis={analysis}
          openComments={comments.openCount}
          onShowOpenComments={() => { setView('timeline'); setOpenOnly(true) }}
          onShowDependencies={() => { setView('dependencies'); setDepTab('Dependencies') }}
          onShowRisks={() => setView('risks')}
          onSelectInitiative={(id) => { setView('timeline'); openInitiative(id) }}
          onViewAnalysis={onViewAnalysis}
          review={review}
        />
      )}

      <div className="view-bar">
        <div className="seg" role="tablist" aria-label="Results view">
          {VIEWS.map((v) => (
            <button key={v.id} role="tab" aria-selected={view === v.id} className={`seg-btn${view === v.id ? ' active' : ''}`} onClick={() => setView(v.id)}>
              <i className={`ti ${v.icon}`} aria-hidden="true" /> {v.label}{counts[v.id] !== null && <span className="tab-n">{counts[v.id]}</span>}
            </button>
          ))}
        </div>
        <div className="view-filters">
          <InitiativeFilter initiatives={analysis.initiatives} value={initiative} onChange={setInitiative} />
          {view === 'timeline' && (
            <>
              <label className="filter-field" title="Group the timeline">
                <i className="ti ti-layout-rows" aria-hidden="true" />
                <select className="select" aria-label="Group by" value={groupBy} onChange={(e) => setGroupBy(e.target.value as GroupBy)}>
                  <option value="step">Group: Step</option>
                  <option value="team">Group: Team</option>
                  <option value="art">Group: ART</option>
                </select>
              </label>
              <label className="filter-field" title="Filter by comments">
                <i className="ti ti-message-circle" aria-hidden="true" />
                <select className="select" aria-label="Comments filter" value={openOnly ? 'open' : 'all'} onChange={(e) => setOpenOnly(e.target.value === 'open')}>
                  <option value="all">Comments: all</option>
                  <option value="open">Comments: open only</option>
                </select>
              </label>
            </>
          )}
          <button className="icon-circle sm" aria-label={expanded ? 'Leave full screen' : 'Full screen'} title={expanded ? 'Leave full screen (Esc)' : 'Full screen'} onClick={() => setExpanded((e) => !e)}>
            <i className={`ti ${expanded ? 'ti-arrows-minimize' : 'ti-arrows-maximize'}`} aria-hidden="true" />
          </button>
        </div>
      </div>

      {showDepFilters && (
        <div className="results-filters">
          <label className="toggle" title="Hide links where nobody has to build, agree or re-test anything">
            <input type="checkbox" checked={changesOnly} onChange={(e) => setChangesOnly(e.target.checked)} />
            Only dependencies that need a change
          </label>
          <div className="seg" role="group" aria-label="Filter by level">
            <button className={`seg-btn${level === '' ? ' active' : ''}`} aria-pressed={level === ''} onClick={() => setLevel('')}>All levels</button>
            {LEVEL_ORDER.map((l) => (
              <button key={l} className={`seg-btn${level === l ? ' active' : ''}`} aria-pressed={level === l} title={LEVEL[l].hint} onClick={() => setLevel(l)}>
                <i className={`ti ${LEVEL[l].icon}`} aria-hidden="true" /> {LEVEL[l].label}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="results-outer">
        <div className="view-main">
          {view === 'timeline' && (
            <TimelineView
              analysis={analysis}
              groupBy={groupBy}
              visibleIds={visibleIds}
              selectedId={activeIni}
              counts={comments.byInitiative}
              onSelect={(id) => openInitiative(id, drawer?.type === 'initiative' ? drawer.tab : 'details')}
              onOpenComments={(id) => openInitiative(id, 'comments')}
            />
          )}
          {view === 'graph' && (
            <DependencyGraph
              nodes={nodes}
              edges={edges}
              highlight={highlight}
              onNodeClick={onNodeClick}
              depsByKey={depsByKey}
              innerIds={runIds}
              order={order}
              focusId={initiative || undefined}
              caption={filtering ? `showing ${edges.length} of ${total} dependencies` : undefined}
            />
          )}
          {(view === 'dependencies' || view === 'risks') && (
            <SidePanel
              analysis={analysis}
              deps={deps}
              risks={risks}
              initiative={initiative}
              hiddenNoChange={hiddenNoChange}
              onShowNoChange={() => setChangesOnly(false)}
              activeRiskId={activeRisk?.id ?? null}
              onSelectRisk={(id) => setDrawer({ type: 'risk', id })}
              flags={flags}
              labelOf={labelOf}
              tab={view === 'risks' ? 'Risks' : depViewOnly.includes(depTab) ? depTab : 'Dependencies'}
              onTab={setDepTab}
              only={view === 'risks' ? ['Risks'] : depViewOnly}
            />
          )}
        </div>

        {activeRisk && (
          <ReasoningDrawer
            key={activeRisk.id}
            risk={activeRisk}
            flagged={flags.includes(activeRisk.id)}
            onToggleFlag={() => onToggleFlag(activeRisk.id)}
            onClose={() => setDrawer(null)}
            onPrev={() => stepRisk(-1)}
            onNext={() => stepRisk(1)}
          />
        )}
        {activeNode && (
          <NodeDrawer
            node={activeNode}
            deps={focusDeps}
            risks={allRisks.filter((r) => r.highlightNodes.includes(activeNode.id))}
            inRun={runIds.has(activeNode.id)}
            onClose={() => setDrawer(null)}
            onOpenRisk={openRisk}
            labelOf={labelOf}
          />
        )}
        {drawer?.type === 'initiative' && activeIni && (
          <InitiativeDrawer
            key={activeIni}
            analysis={analysis}
            initiativeId={activeIni}
            tab={drawer.tab}
            onTab={(tab) => setDrawer({ type: 'initiative', id: activeIni, tab })}
            deps={focusDeps}
            risks={allRisks.filter((r) => r.initiativeIds.includes(activeIni) || r.highlightNodes.includes(activeIni))}
            commentCount={mineCount?.count ?? 0}
            openComments={mineCount?.open ?? 0}
            comments={{
              comments: mine,
              status: comments.status,
              updatedAt: comments.updatedAt,
              postingAs: comments.postingAs,
              onAdd: (type: CommentType, text: string) => comments.add(activeIni, type, text),
              onResolve: comments.resolve,
            }}
            onClose={() => setDrawer(null)}
            onOpenRisk={openRisk}
            onSelectInitiative={(id) => openInitiative(id)}
            labelOf={labelOf}
          />
        )}
      </div>
    </div>
  )
}
