import { useEffect, useState, type ComponentProps } from 'react'
import { domainColor } from '../data/domains'
import { plural } from '../lib/deps'
import type { Analysis, DependencyRow, Risk } from '../types'
import { CommentsPanel } from './CommentsPanel'
import { DepRow } from './SidePanel'

export type DrawerTab = 'details' | 'comments'

interface Props {
  analysis: Analysis
  initiativeId: string
  tab: DrawerTab
  onTab: (t: DrawerTab) => void
  /** Dependencies with this initiative on either end. */
  deps: DependencyRow[]
  risks: Risk[]
  commentCount: number
  openComments: number
  comments: Omit<ComponentProps<typeof CommentsPanel>, 'initiativeTitle'>
  onClose: () => void
  onOpenRisk: (id: string) => void
  onSelectInitiative: (id: string) => void
  labelOf: (key: string) => string
}

/** One initiative: when it runs and why, its dependencies and risks, and the live comments about it. */
export function InitiativeDrawer({ analysis, initiativeId, tab, onTab, deps, risks, commentCount, openComments, comments, onClose, onOpenRisk, onSelectInitiative, labelOf }: Props) {
  const [openDep, setOpenDep] = useState<string | null>(null)
  useEffect(() => setOpenDep(null), [initiativeId])

  const ref = analysis.initiatives.find((i) => i.id === initiativeId)
  const title = ref?.title ?? initiativeId
  const row = analysis.schedule?.rows.find((r) => r.initiativeId === initiativeId)
  const name = (id: string) => analysis.initiatives.find((i) => i.id === id)?.title ?? id
  const blocks = analysis.schedule?.rows.filter((r) => r.waitsFor.includes(initiativeId)) ?? []
  const step = analysis.steps.find((s) => s.initiativeIds.includes(initiativeId))
  const sizeNote = row?.sizeSource === 'points' ? 'estimated from story points' : row?.sizeSource === 'default' ? 'assumed: no size in the data' : ''

  return (
    <aside className="drawer" aria-label={title}>
      <div className="drawer-topbar">
        <div className="drawer-title" title={title}>
          <span className="art-dot" style={{ background: domainColor(ref?.art || 'Other') }} aria-hidden="true" />
          <span className="drawer-title-text">{title}</span>
        </div>
        <button className="drawer-close" aria-label="Close" onClick={onClose}><i className="ti ti-x" aria-hidden="true" /></button>
      </div>

      <div className="tabs" role="tablist">
        <button role="tab" aria-selected={tab === 'details'} className={`tab${tab === 'details' ? ' active' : ''}`} onClick={() => onTab('details')}>Details</button>
        <button role="tab" aria-selected={tab === 'comments'} className={`tab${tab === 'comments' ? ' active' : ''}`} onClick={() => onTab('comments')}>
          Comments <span className={`tab-n${openComments ? ' open' : ''}`}>{commentCount}</span>
        </button>
      </div>

      {tab === 'comments' ? (
        <div className="drawer-body"><CommentsPanel initiativeTitle={title} {...comments} /></div>
      ) : (
        <div className="drawer-body">
          <div className="init-facts">
            {ref?.art && <span>{ref.art}</span>}
            {ref?.teamName && <span>{ref.teamName}</span>}
            {ref?.pi && <span>{ref.pi}</span>}
            {step && <span>Step {step.step}</span>}
          </div>

          {row ? (
            <div className="drawer-section">
              <div className="drawer-section-label">Schedule</div>
              <div className="reasoning-box">
                <b>Sprint {row.start === row.end ? row.start : `${row.start} to ${row.end}`}</b> · size {row.size} ({plural(row.sprints, 'sprint')}){sizeNote && ` · ${sizeNote}`}
                {row.waitsFor.length > 0
                  ? <> Starts after <b>{row.waitsFor.map(name).join(', ')}</b>, which {row.waitsFor.length === 1 ? 'ends' : 'end'} before it can begin.</>
                  : <> Waits for nothing in this run, so it starts in sprint 1.</>}
                {row.critical && <> It is on the critical path: the longest chain, so a slip here moves the end date.</>}
                {row.spillsPastPi && <> It finishes after sprint {analysis.schedule?.piSprints}, the end of the PI.</>}
                {row.inCycle && <> It depends on initiatives that depend on it: break the cycle before PI planning.</>}
                {row.targetedSprint && row.targetedSprint !== row.start && <> The roadmap targets sprint {row.targetedSprint}.</>}
              </div>
            </div>
          ) : (
            <div className="drawer-section">
              <div className="ai-note">{step ? `Recommended in step ${step.step}. ` : ''}This analysis has no sprint schedule.</div>
            </div>
          )}

          {blocks.length > 0 && (
            <div className="drawer-section">
              <div className="drawer-section-label">Unblocks</div>
              {blocks.map((b) => (
                <button key={b.initiativeId} className="node-risk" onClick={() => onSelectInitiative(b.initiativeId)}>
                  <i className="ti ti-arrow-right" aria-hidden="true" /><span>{name(b.initiativeId)}</span>
                  <span className="hint">sprint {b.start}</span>
                </button>
              ))}
            </div>
          )}

          {risks.length > 0 && (
            <div className="drawer-section">
              <div className="drawer-section-label">Risks involving it</div>
              {risks.map((r) => (
                <button key={r.id} className="node-risk" onClick={() => onOpenRisk(r.id)}>
                  <i className="ti ti-alert-triangle" aria-hidden="true" /><span>{r.title}</span>
                  <span className={`sev sev-${r.severity === 'High' ? 'h' : r.severity === 'Medium' ? 'm' : 'l'}`}>{r.severity}</span>
                </button>
              ))}
            </div>
          )}

          {deps.length > 0 && (
            <div className="drawer-section">
              <div className="drawer-section-label">Dependencies ({deps.length})</div>
              {deps.map((d) => (
                <DepRow key={d.key} dep={d} open={openDep === d.key} onToggle={() => setOpenDep((o) => (o === d.key ? null : d.key))} labelOf={labelOf} />
              ))}
            </div>
          )}
        </div>
      )}
    </aside>
  )
}
