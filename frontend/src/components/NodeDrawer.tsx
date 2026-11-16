import { useState } from 'react'
import { CHANGE, CHANGE_ORDER, LEVEL, needsChange, plural } from '../lib/deps'
import type { DependencyRow, DepLevel, GraphNode, Risk } from '../types'
import { DepRow } from './SidePanel'

interface Props {
  node: GraphNode
  /** Every dependency with this node on either end. */
  deps: DependencyRow[]
  risks: Risk[]
  /** The node is one of the initiatives in the run (not something they depend on). */
  inRun: boolean
  onClose: () => void
  onOpenRisk: (id: string) => void
  labelOf: (key: string) => string
}

const levelOf = (n: GraphNode, inRun: boolean): DepLevel =>
  n.kind ?? (inRun ? 'initiative' : n.id.startsWith('team:') ? 'team' : n.id.startsWith('service:') ? 'system' : 'initiative')

/** Why a node is in the graph: the dependencies that pulled it in, what each one needs, and its risks. */
export function NodeDrawer({ node, deps, risks, inRun, onClose, onOpenRisk, labelOf }: Props) {
  const [open, setOpen] = useState<string | null>(null)
  const level = LEVEL[levelOf(node, inRun)]
  const outgoing = deps.filter((d) => d.from === node.id)
  const incoming = deps.filter((d) => d.to === node.id)
  const sources = [...new Set(incoming.map((d) => d.fromLabel))]

  const list = (rows: DependencyRow[]) =>
    CHANGE_ORDER.flatMap((c) => rows.filter((d) => d.changeType === c)).map((d) => (
      <DepRow key={d.key} dep={d} open={open === d.key} onToggle={() => setOpen((o) => (o === d.key ? null : d.key))} labelOf={labelOf} />
    ))

  const changeSummary = (rows: DependencyRow[]) => {
    const n = rows.filter((d) => needsChange(d.changeType)).length
    return n ? `${n} need${n === 1 ? 's' : ''} a change` : 'none needs a change'
  }

  return (
    <aside className="drawer" aria-label={`Why ${node.label} is here`}>
      <div className="drawer-topbar">
        <div className="drawer-title"><i className="ti ti-route" aria-hidden="true" /> Why is this here?</div>
        <button className="drawer-close" aria-label="Close" onClick={onClose}><i className="ti ti-x" aria-hidden="true" /></button>
      </div>

      <div className="drawer-body">
        <span className="node-badge" title={level.hint}>
          <i className={`ti ${level.icon}`} aria-hidden="true" /> {level.label} · {node.label}
        </span>

        <div className="reasoning-box node-why">
          {inRun ? (
            <>You selected this initiative. It depends on {plural(outgoing.length, 'thing')} ({changeSummary(outgoing)})
              {incoming.length > 0 && <>, and {plural(incoming.length, 'other initiative')} in this run depend{incoming.length === 1 ? 's' : ''} on it</>}.</>
          ) : incoming.length ? (
            <>Pulled in because {sources.length === 1 ? sources[0] : `${sources.length} selected initiatives`} depend{sources.length === 1 ? 's' : ''} on
              it: {plural(incoming.length, 'dependency', 'dependencies')}, {changeSummary(incoming)}. Expand one to see the hops that lead here.</>
          ) : (
            <>No dependency in this analysis points here.</>
          )}
        </div>

        {incoming.length > 0 && (
          <div className="drawer-section">
            <div className="drawer-section-label">{inRun ? 'Initiatives that depend on it' : 'What depends on it'}</div>
            {list(incoming)}
          </div>
        )}
        {outgoing.length > 0 && (
          <div className="drawer-section">
            <div className="drawer-section-label">What it depends on</div>
            {list(outgoing)}
          </div>
        )}

        {risks.length > 0 && (
          <div className="drawer-section">
            <div className="drawer-section-label">Risks involving it</div>
            {risks.map((r) => (
              <button key={r.id} className="node-risk" onClick={() => onOpenRisk(r.id)}>
                <i className="ti ti-alert-triangle" aria-hidden="true" />
                <span>{r.title}</span>
                <span className={`sev sev-${r.severity === 'High' ? 'h' : r.severity === 'Medium' ? 'm' : 'l'}`}>{r.severity}</span>
              </button>
            ))}
          </div>
        )}

        <div className="drawer-section">
          <div className="drawer-section-label">How to read the change types</div>
          {CHANGE_ORDER.map((c) => (
            <div className="legend-row" key={c}>
              <span className={`chg chg-${c}`}><i className={`ti ${CHANGE[c].icon}`} aria-hidden="true" /> {CHANGE[c].short}</span>
              <span>{CHANGE[c].hint}</span>
            </div>
          ))}
        </div>
      </div>
    </aside>
  )
}
