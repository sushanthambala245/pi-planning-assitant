import { domainColor } from '../data/domains'
import type { GraphEdge, GraphNode } from '../types'

interface Props {
  nodes: GraphNode[]
  edges: GraphEdge[]
  highlight: string[]
  onNodeClick: (id: string) => void
}

type Placed = GraphNode & { x: number; y: number }

const W = 420
const H = 240

/** Nodes without explicit coordinates are spread on an ellipse. */
function place(nodes: GraphNode[]): Placed[] {
  return nodes.map((n, i) => ({
    ...n,
    x: n.x ?? W / 2 + Math.cos((2 * Math.PI * i) / nodes.length - Math.PI / 2) * (nodes.length > 1 ? 150 : 0),
    y: n.y ?? H / 2 + Math.sin((2 * Math.PI * i) / nodes.length - Math.PI / 2) * (nodes.length > 1 ? 85 : 0),
  }))
}

const truncate = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s)

/** Splits a label over two lines at the space nearest its middle. */
function twoLines(label: string): [string, string] {
  if (!label.includes(' ')) return [truncate(label, 11), '']
  const mid = label.length / 2
  const spaces = [...label].flatMap((c, i) => (c === ' ' ? [i] : []))
  const at = spaces.reduce((best, i) => (Math.abs(i - mid) < Math.abs(best - mid) ? i : best), spaces[0])
  return [truncate(label.slice(0, at), 11), truncate(label.slice(at + 1), 11)]
}

export function DependencyGraph({ nodes, edges, highlight, onNodeClick }: Props) {
  const placed = place(nodes)
  const byId = Object.fromEntries(placed.map((n) => [n.id, n]))
  const dimming = highlight.length > 0
  const isLit = (id: string) => !dimming || highlight.includes(id)

  const compact = placed.length > 6 // many nodes: small dots with labels underneath
  const r = compact ? 9 : 21
  const domains = [...new Set(nodes.map((n) => n.domain))]

  return (
    <div className="graph-area">
      <div className="graph-title">
        <span>Dependency graph</span>
        <div className="graph-legend">
          {domains.map((d) => (
            <div className="leg-item" key={d}>
              <div className="leg-dot" style={{ background: domainColor(d) }} />
              {d}
            </div>
          ))}
        </div>
      </div>
      <div className="graph-box">
        {placed.length === 0 ? (
          <div className="graph-empty">No dependency graph in this analysis.</div>
        ) : (
          <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{ display: 'block' }}>
            <defs>
              <marker id="arr" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
                <path d="M2 1L8 5L2 9" fill="none" stroke="context-stroke" strokeWidth="1.5" strokeLinecap="round" />
              </marker>
            </defs>

            {edges.map((e) => {
              const a = byId[e.from]
              const b = byId[e.to]
              if (!a || !b) return null
              const lit = isLit(e.from) && isLit(e.to)
              const dx = b.x - a.x
              const dy = b.y - a.y
              const len = Math.hypot(dx, dy) || 1
              const pad = r + 5
              return (
                <line
                  key={`${e.from}-${e.to}`}
                  x1={a.x + (dx / len) * pad} y1={a.y + (dy / len) * pad}
                  x2={b.x - (dx / len) * pad} y2={b.y - (dy / len) * pad}
                  stroke={e.inferred ? '#378ADD' : '#9e9d97'}
                  strokeWidth={e.inferred ? 1.5 : 1}
                  strokeDasharray={e.inferred ? '4 3' : undefined}
                  markerEnd="url(#arr)"
                  opacity={lit ? (e.inferred ? 0.85 : 0.5) : 0.15}
                />
              )
            })}

            {placed.map((n) => {
              const color = domainColor(n.domain)
              const lit = isLit(n.id)
              const focused = dimming && lit
              const [l1, l2] = twoLines(n.label)
              return (
                <g
                  key={n.id}
                  className="graph-node"
                  role="button"
                  tabIndex={0}
                  aria-label={`${n.label} — open reasoning`}
                  opacity={lit ? 1 : 0.35}
                  onClick={() => onNodeClick(n.id)}
                  onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && onNodeClick(n.id)}
                >
                  <circle cx={n.x} cy={n.y} r={r + (focused ? 9 : 5)} fill={color} opacity={0.18} stroke={color} strokeWidth={focused ? 2 : 1.2} />
                  <circle cx={n.x} cy={n.y} r={r} fill={color} />
                  {compact ? (
                    <text x={n.x} y={n.y + r + 13} textAnchor="middle" fontSize="8" className="graph-label">{truncate(n.label, 16)}</text>
                  ) : (
                    <>
                      <text x={n.x} y={n.y + (l2 ? -3 : 3)} textAnchor="middle" fontSize="8.5" fontWeight="600" fill="#fff">{l1}</text>
                      {l2 && <text x={n.x} y={n.y + 8} textAnchor="middle" fontSize="8" fill="rgba(255,255,255,.88)">{l2}</text>}
                    </>
                  )}
                </g>
              )
            })}

            <line x1="12" y1="212" x2="36" y2="212" stroke="#9e9d97" strokeWidth="1" />
            <text x="40" y="215" fontSize="9" className="graph-label">explicit</text>
            <line x1="12" y1="226" x2="36" y2="226" stroke="#378ADD" strokeWidth="1.5" strokeDasharray="4 3" />
            <text x="40" y="229" fontSize="9" className="graph-label">inferred by AI</text>
          </svg>
        )}
      </div>
      <div className="graph-hint">
        <i className="ti ti-click" aria-hidden="true" /> Click a system to open the AI reasoning drawer
      </div>
    </div>
  )
}
