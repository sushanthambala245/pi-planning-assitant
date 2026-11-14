import { useEffect, useState, type ComponentProps } from 'react'
import { domainColor } from '../data/domains'
import { plural } from '../lib/deps'
import { planStatus } from '../lib/plan'
import type { PlannerApi } from '../lib/planner'
import type { Analysis, DependencyRow, Plan, Risk } from '../types'
import { NoteField, PriorityChip, QuarterChip, SizeChip, SizeSelect } from './Chips'
import { CommentsPanel } from './CommentsPanel'
import { DepRow } from './SidePanel'
import { Tip } from './Tip'

export type DrawerTab = 'details' | 'comments'

interface Props {
  analysis: Analysis
  plan?: Plan
  initiativeId: string
  tab: DrawerTab
  onTab: (t: DrawerTab) => void
  /** Dependencies with this initiative on either end. */
  deps: DependencyRow[]
  risks: Risk[]
  /** On the longest chain of waits in the plan. */
  critical: boolean
  commentCount: number
  openComments: number
  comments: Omit<ComponentProps<typeof CommentsPanel>, 'initiativeTitle'>
  planner: PlannerApi
  onClose: () => void
  onOpenRisk: (id: string) => void
  onSelectInitiative: (id: string) => void
  labelOf: (key: string) => string
}

/**
 * One initiative (after Bhasker Rao's InitiativeDrawer, results-timeline-comments): when it runs in the
 * quarter plan and why, what it waits for and unblocks, its dependencies and risks, the planner's input
 * for the next run, and the live comments about it.
 */
export function InitiativeDrawer({ analysis, plan, initiativeId, tab, onTab, deps, risks, critical, commentCount, openComments, comments, planner, onClose, onOpenRisk, onSelectInitiative, labelOf }: Props) {
  const [openDep, setOpenDep] = useState<string | null>(null)
  useEffect(() => setOpenDep(null), [initiativeId])

  const ref = analysis.initiatives.find((i) => i.id === initiativeId)
  const item = plan?.items.find((i) => i.id === initiativeId)
  const title = item?.title ?? ref?.title ?? initiativeId
  const art = item?.art || ref?.art || 'Other'
  const byId = new Map((plan?.items ?? []).map((i) => [i.id, i]))
  const name = (id: string) => byId.get(id)?.title ?? analysis.initiatives.find((i) => i.id === id)?.title ?? id
  const unblocks = (plan?.items ?? []).filter((i) => i.waitsFor.includes(initiativeId))
  const step = analysis.steps.find((s) => s.initiativeIds.includes(initiativeId))
  const st = item ? planStatus(item) : null
  const sizeNow = planner.input.sizes[initiativeId] ?? ''
  const note = planner.input.initiativeNotes[initiativeId] ?? ''

  return (
    <aside className="drawer" aria-label={title}>
      <div className="drawer-topbar">
        <div className="drawer-title">
          <span className="art-dot" style={{ background: domainColor(art) }} aria-hidden="true" />
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
            <span>{initiativeId}</span>
            <span>{art}</span>
            {(item?.teamName || ref?.teamName) && <span>{item?.teamName || ref?.teamName}</span>}
            {step && <Tip title={`Dependency step ${step.step}`} content="The ordering links alone, as steps: an initiative in step 2 waits for one in step 1. The quarter plan adds sizes and team capacity on top of this order."><span>Step {step.step}</span></Tip>}
          </div>

          {item && st ? (
            <div className="drawer-section">
              <div className="drawer-section-label">When, and why</div>
              <div className="init-chips">
                <SizeChip size={item.size} points={item.points} source={item.sizeSource} plan={plan} />
                <PriorityChip priority={item.priority} />
                <QuarterChip quarter={item.targetQuarter} kind={item.targetSource === 'planner' ? 'planner' : 'target'} />
                <i className="ti ti-arrow-right" aria-hidden="true" />
                <QuarterChip quarter={item.pi} kind="recommended" note={`${item.startLabel} to ${item.finishLabel}.`} />
                <Tip title={st.label} content={st.hint}><span className={`dt-status s-${st.cls}`}>{st.label}</span></Tip>
              </div>
              <div className="reasoning-box">
                <b>{item.startLabel}{item.finish !== item.start ? ` → ${item.finishLabel}` : ''}</b>
                <ul className="pt-reasons">{item.reasons.map((r) => <li key={r}>{r}</li>)}</ul>
                {critical && <div>On the longest chain of waits in the plan: a slip here moves the last finish.</div>}
              </div>
            </div>
          ) : (
            <div className="drawer-section">
              <div className="ai-note">{step ? `Recommended in step ${step.step}. ` : ''}This analysis has no quarter plan.</div>
            </div>
          )}

          {item && item.waitsFor.length > 0 && (
            <div className="drawer-section">
              <div className="drawer-section-label">Waits for</div>
              {item.waitsFor.map((w) => (
                <button key={w} className="node-risk" onClick={() => onSelectInitiative(w)}>
                  <i className="ti ti-hourglass" aria-hidden="true" /><span>{name(w)}</span>
                  <span className="hint">ends {byId.get(w)?.finishLabel ?? ''}</span>
                </button>
              ))}
            </div>
          )}

          {unblocks.length > 0 && (
            <div className="drawer-section">
              <div className="drawer-section-label">Unblocks</div>
              {unblocks.map((b) => (
                <button key={b.id} className="node-risk" onClick={() => onSelectInitiative(b.id)}>
                  <i className="ti ti-arrow-right" aria-hidden="true" /><span>{b.title}</span>
                  <span className="hint">starts {b.startLabel}</span>
                </button>
              ))}
            </div>
          )}

          {item && (item.declaredUpstream.length > 0 || item.declaredDownstream.length > 0) && (
            <div className="drawer-section">
              <Tip title="Declared in the dependency column" content="Upstream systems are ones this initiative consumes; downstream systems consume what it produces (the initiatives file’s data dictionary).">
                <div className="drawer-section-label">Declared</div>
              </Tip>
              <div className="pt-declared">
                {item.declaredUpstream.length > 0 && <span>Upstream: {item.declaredUpstream.join(', ')}</span>}
                {item.declaredDownstream.length > 0 && <span>Downstream: {item.declaredDownstream.join(', ')}</span>}
              </div>
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
              <div className="drawer-section-label">Dependencies ({deps.length}{item ? ` · ${item.declaredLinks} declared, ${item.hiddenLinks} hidden` : ''})</div>
              {deps.map((d) => (
                <DepRow key={d.key} dep={d} open={openDep === d.key} onToggle={() => setOpenDep((o) => (o === d.key ? null : d.key))} labelOf={labelOf} />
              ))}
            </div>
          )}

          <div className="drawer-section pt-planner">
            <Tip title="Your input for the next run" content="Saved in this browser and sent with “Rerun with updates”. A size replaces the T-shirt size; the note is read like the description, so a stated dependency in it becomes a planner-defined one. To discuss the initiative with others, use Comments.">
              <div className="drawer-section-label">Your input for the next run</div>
            </Tip>
            <label className="pt-field"><span>T-shirt size</span>
              <SizeSelect value={sizeNow} dataSize={item?.dataSize} onChange={(v) => planner.setSize(initiativeId, v)} />
            </label>
            <NoteField value={note} onChange={(t) => planner.setNote(initiativeId, t)}
              placeholder="What changed, who agreed what. Write “blocked on INIT-005” or “requires Account Ledger” to add a dependency."
              hint="The rerun reads the note like the description: a stated dependency in it becomes a planner-defined one." />
          </div>

          {item?.description && (
            <div className="drawer-section">
              <div className="drawer-section-label">Description</div>
              <div className="pt-desc">{item.description}{item.outcome ? ` Outcome: ${item.outcome}` : ''}</div>
            </div>
          )}
          <div className="init-foot">{plural(commentCount, 'comment')} · <button className="link-btn" onClick={() => onTab('comments')}>open the thread</button></div>
        </div>
      )}
    </aside>
  )
}
