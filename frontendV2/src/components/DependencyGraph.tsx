import type { SVGProps } from 'react'
import { domainColor } from '../data/domains'
import { CHANGE, LEVEL, teamName } from '../lib/deps'
import type { DependencyRow, DepLevel, GraphEdge, GraphNode } from '../types'

interface Props {
  nodes: GraphNode[]
  edges: GraphEdge[]
  highlight: string[]
  onNodeClick: (id: string) => void
  /** Dependency rows by key: edge tooltips say why each edge is there. */
  depsByKey: Map<string, DependencyRow>
  /** Initiatives in the run: listed in the left column. */
  innerIds: Set<string>
  /** Initiative ids in the order to list them (the recommended sequence). */
  order?: string[]
  /** The initiative the screen is filtered to. */
  focusId?: string
  /** e.g. "Showing 14 of 39 dependencies". */
  caption?: string
}

type Side = 'left' | 'right' | 'ring'
type Placed = GraphNode & { x: number; y: number; side: Side }

// Two columns: the selected initiatives on the left, what they depend on on the right. Labels sit
// beside the nodes, so they never overlap, and the graph grows in height instead of crowding.
const W = 690
const ROW = 26
const TOP = 34 // room for the column headings
const LX = 272
const RX = 430
const R = 7
const LABEL = 42

// Older analysis files without a list of initiatives keep the original ring layout.
const RW = 420
const RH = 240
const RCX = RW / 2
const RCY = 114

const KIND_ORDER: DepLevel[] = ['initiative', 'team', 'system']

const kindOf = (n: GraphNode, innerIds: Set<string>): DepLevel =>
  n.kind ?? (innerIds.has(n.id) ? 'initiative' : n.id.startsWith('team:') ? 'team' : n.id.startsWith('service:') ? 'system' : 'initiative')

const truncate = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s)

/** A team node reads "Posting Engine team", so it is not mistaken for the Posting Engine system. */
const display = (n: GraphNode, innerIds: Set<string>) => (kindOf(n, innerIds) === 'team' ? teamName(n.label) : n.label)

function columns(nodes: GraphNode[], innerIds: Set<string>, order: string[]): { placed: Placed[]; height: number } {
  const rank = new Map(order.map((id, i) => [id, i]))
  const left = nodes.filter((n) => innerIds.has(n.id))
    .sort((a, b) => (rank.get(a.id) ?? 1e6) - (rank.get(b.id) ?? 1e6) || a.label.localeCompare(b.label))
  const right = nodes.filter((n) => !innerIds.has(n.id))
    .sort((a, b) => KIND_ORDER.indexOf(kindOf(a, innerIds)) - KIND_ORDER.indexOf(kindOf(b, innerIds)) || a.label.localeCompare(b.label))
  const rows = Math.max(left.length, right.length, 1)
  const height = TOP + rows * ROW + 10
  const y = (i: number, n: number) => TOP + ((i + 0.5) * rows * ROW) / n
  return {
    height,
    placed: [
      ...left.map((n, i): Placed => ({ ...n, x: LX, y: y(i, left.length), side: 'left' })),
      ...right.map((n, i): Placed => ({ ...n, x: RX, y: y(i, right.length), side: 'right' })),
    ],
  }
}

function ringLayout(nodes: GraphNode[]): Placed[] {
  if (nodes.every((n) => n.x != null && n.y != null)) return nodes.map((n) => ({ ...n, x: n.x!, y: n.y!, side: 'ring' }))
  const k = nodes.length
  return nodes.map((n, i) => {
    const a = (2 * Math.PI * i) / Math.max(k, 1) - Math.PI / 2
    return { ...n, x: RCX + (k > 1 ? 160 : 0) * Math.cos(a), y: RCY + (k > 1 ? 82 : 0) * Math.sin(a), side: 'ring' }
  })
}

/** Left to right: an S-curve. Within a column: an arc beside it. Otherwise a straight line. */
function edgePath(a: Placed, b: Placed, r: number): string {
  if (a.side === 'left' && b.side === 'right') {
    const x1 = a.x + r + 3
    const x2 = b.x - r - 5
    const mx = (x1 + x2) / 2
    return `M${x1},${a.y} C${mx},${a.y} ${mx},${b.y} ${x2},${b.y}`
  }
  if (a.side === b.side && a.side !== 'ring') {
    const dir = a.side === 'left' ? 1 : -1
    const x = a.x + dir * (r + 3)
    const bend = a.x + dir * (r + 22 + Math.min(70, Math.abs(b.y - a.y) / 3))
    return `M${x},${a.y} C${bend},${a.y} ${bend},${b.y} ${x + dir * 2},${b.y}`
  }
  const dx = b.x - a.x
  const dy = b.y - a.y
  const len = Math.hypot(dx, dy) || 1
  const pad = r + 5
  return `M${a.x + (dx / len) * pad},${a.y + (dy / len) * pad} L${b.x - (dx / len) * pad},${b.y - (dy / len) * pad}`
}

/** The level is the shape: initiative = circle, team = rounded square, system = diamond. */
function Shape({ kind, x, y, r, ...rest }: { kind: DepLevel; x: number; y: number; r: number } & SVGProps<SVGElement>) {
  const p = rest as SVGProps<SVGRectElement> & SVGProps<SVGCircleElement>
  if (kind === 'team') return <rect x={x - r * 0.9} y={y - r * 0.9} width={r * 1.8} height={r * 1.8} rx={r * 0.35} {...p} />
  if (kind === 'system') {
    const s = r * 0.85
    return <rect x={x - s} y={y - s} width={s * 2} height={s * 2} rx={r * 0.15} transform={`rotate(45 ${x} ${y})`} {...p} />
  }
  return <circle cx={x} cy={y} r={r} {...p} />
}

function Key({ kind }: { kind: DepLevel }) {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
      <Shape kind={kind} x={7} y={7} r={5.5} fill="var(--muted)" />
    </svg>
  )
}

export function DependencyGraph({ nodes, edges, highlight, onNodeClick, depsByKey, innerIds, order = [], focusId, caption }: Props) {
  const cols = nodes.some((n) => innerIds.has(n.id))
  const { placed, height } = cols ? columns(nodes, innerIds, order) : { placed: ringLayout(nodes), height: RH }
  const width = cols ? W : RW
  const r = cols ? R : placed.length > 6 ? 9 : 21
  const byId = Object.fromEntries(placed.map((n) => [n.id, n]))
  const dimming = highlight.length > 0
  const isLit = (id: string) => !dimming || highlight.includes(id)
  const domains = [...new Set(nodes.map((n) => n.domain))]

  return (
    <div className="graph-area">
      <div className="graph-title">
        <span>Dependency graph{caption && <span className="graph-caption"> · {caption}</span>}</span>
        <div className="graph-legend" title="Node colour shows the agile release train (ART) or domain that owns it">
          <span className="leg-title">Colour = ART:</span>
          {domains.map((d) => (
            <div className="leg-item" key={d}>
              <div className="leg-dot" style={{ background: domainColor(d) }} />
              {d}
            </div>
          ))}
        </div>
      </div>
      <div className={`graph-box${cols ? ' cols' : ''}`}>
        {placed.length === 0 ? (
          <div className="graph-empty">Nothing to draw for the current filter.</div>
        ) : (
          <svg width="100%" viewBox={`0 0 ${width} ${height}`} style={{ display: 'block' }}>
            <defs>
              <marker id="arr" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
                <path d="M2 1L8 5L2 9" fill="none" stroke="context-stroke" strokeWidth="1.5" strokeLinecap="round" />
              </marker>
            </defs>

            {cols && (
              <>
                <text x={LX + R} y={16} textAnchor="end" className="graph-col-head">Selected initiatives (in sequence order)</text>
                <text x={RX - R} y={16} textAnchor="start" className="graph-col-head">What they depend on</text>
              </>
            )}

            {edges.map((e) => {
              const a = byId[e.from]
              const b = byId[e.to]
              if (!a || !b) return null
              const dep = e.key ? depsByKey.get(e.key) : undefined
              const change = e.changeType ?? dep?.changeType
              const quiet = change === 'none'
              const lit = isLit(e.from) && isLit(e.to)
              const d = edgePath(a, b, r)
              return (
                <g key={`${e.from}-${e.to}`} className="graph-edge">
                  <title>
                    {`${dep?.fromLabel ?? a.label} → ${dep?.toLabel ?? b.label}`}
                    {change && `\n${CHANGE[change].label}`}
                    {dep?.reason && `\n${dep.reason}`}
                  </title>
                  {/* a wide invisible stroke so the tooltip is easy to hit */}
                  <path d={d} fill="none" stroke="transparent" strokeWidth={8} />
                  <path
                    d={d}
                    fill="none"
                    stroke={e.inferred ? '#378ADD' : '#9e9d97'}
                    strokeWidth={quiet ? 0.8 : e.inferred ? 1.5 : 1.3}
                    strokeDasharray={e.inferred ? '4 3' : undefined}
                    markerEnd="url(#arr)"
                    opacity={!lit ? 0.1 : quiet ? 0.3 : e.inferred ? 0.85 : 0.7}
                  />
                </g>
              )
            })}

            {placed.map((n) => {
              const color = domainColor(n.domain)
              const lit = isLit(n.id)
              const focused = (dimming && lit) || n.id === focusId
              const kind = kindOf(n, innerIds)
              const label = display(n, innerIds)
              return (
                <g
                  key={n.id}
                  className="graph-node"
                  role="button"
                  tabIndex={0}
                  aria-label={`${LEVEL[kind].label} ${label} — why it is here`}
                  opacity={lit ? 1 : 0.3}
                  onClick={() => onNodeClick(n.id)}
                  onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && onNodeClick(n.id)}
                >
                  <title>{`${LEVEL[kind].label}: ${label}\nClick to see why it is in the graph`}</title>
                  <Shape kind={kind} x={n.x} y={n.y} r={r + (focused ? 6 : 3)} fill={color} opacity={0.18} stroke={color} strokeWidth={focused ? 2 : 1} />
                  <Shape kind={kind} x={n.x} y={n.y} r={r} fill={color} />
                  {n.side === 'left' && (
                    <text x={n.x - r - 8} y={n.y + 4} textAnchor="end" className="graph-label ini">{truncate(label, LABEL)}</text>
                  )}
                  {n.side === 'right' && (
                    <text x={n.x + r + 8} y={n.y + 4} textAnchor="start" className="graph-label">{truncate(label, LABEL)}</text>
                  )}
                  {n.side === 'ring' && (
                    <text x={n.x} y={n.y + r + 13} textAnchor="middle" fontSize="8" className="graph-label">{truncate(label, 16)}</text>
                  )}
                </g>
              )
            })}
          </svg>
        )}
      </div>
      <div className="graph-keys">
        {(['initiative', 'team', 'system'] as const).map((k) => (
          <span key={k} title={LEVEL[k].hint}><Key kind={k} /> {LEVEL[k].label}</span>
        ))}
        <span className="graph-keys-sep" />
        <span title="Written down in Jira, Confluence or Slack"><svg width="22" height="6" aria-hidden="true"><line x1="0" y1="3" x2="22" y2="3" stroke="#9e9d97" strokeWidth="1.5" /></svg> stated</span>
        <span title="Inferred from code manifests or the ownership map, not written down"><svg width="22" height="6" aria-hidden="true"><line x1="0" y1="3" x2="22" y2="3" stroke="#378ADD" strokeWidth="1.5" strokeDasharray="4 3" /></svg> inferred from code / ownership</span>
        <span><svg width="22" height="6" aria-hidden="true"><line x1="0" y1="3" x2="22" y2="3" stroke="#9e9d97" strokeWidth="1" opacity="0.35" /></svg> no change needed</span>
      </div>
      <div className="graph-hint">
        <i className="ti ti-click" aria-hidden="true" /> Hover a line for the reason · click a node to see why it is here
      </div>
    </div>
  )
}
