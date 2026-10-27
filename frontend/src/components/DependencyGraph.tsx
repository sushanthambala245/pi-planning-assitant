import { domainColor } from '../data/mock'
import type { Domain, GraphEdge, GraphNode } from '../types'

interface Props {
  nodes: GraphNode[]
  edges: GraphEdge[]
  highlight: string[]
  onNodeClick: (id: string) => void
}

const legend: Domain[] = ['Platform', 'Compliance', 'Product', 'Data']

export function DependencyGraph({ nodes, edges, highlight, onNodeClick }: Props) {
  const byId = Object.fromEntries(nodes.map((n) => [n.id, n]))
  const dimming = highlight.length > 0
  const isLit = (id: string) => !dimming || highlight.includes(id)

  return (
    <div className="graph-area">
      <div className="graph-title">
        <span>Dependency graph</span>
        <div className="graph-legend">
          {legend.map((d) => (
            <div className="leg-item" key={d}>
              <div className="leg-dot" style={{ background: domainColor[d] }} />
              {d}
            </div>
          ))}
        </div>
      </div>
      <div className="graph-box">
        <svg width="100%" viewBox="0 0 420 240" style={{ display: 'block' }}>
          <defs>
            <marker id="arr" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
              <path d="M2 1L8 5L2 9" fill="none" stroke="context-stroke" strokeWidth="1.5" strokeLinecap="round" />
            </marker>
          </defs>

          {edges.map((e) => {
            const a = byId[e.from]
            const b = byId[e.to]
            const lit = isLit(e.from) && isLit(e.to)
            // stop the line at the node edge so the arrowhead is visible
            const dx = b.x - a.x
            const dy = b.y - a.y
            const len = Math.hypot(dx, dy)
            const x2 = b.x - (dx / len) * 26
            const y2 = b.y - (dy / len) * 26
            const x1 = a.x + (dx / len) * 26
            const y1 = a.y + (dy / len) * 26
            return (
              <line
                key={`${e.from}-${e.to}`}
                x1={x1} y1={y1} x2={x2} y2={y2}
                stroke={e.inferred ? '#378ADD' : '#9e9d97'}
                strokeWidth={e.inferred ? 1.5 : 1}
                strokeDasharray={e.inferred ? '4 3' : undefined}
                markerEnd="url(#arr)"
                opacity={lit ? (e.inferred ? 0.85 : 0.5) : 0.2}
              />
            )
          })}

          {nodes.map((n) => {
            const color = domainColor[n.domain]
            const lit = isLit(n.id)
            const focused = dimming && lit
            return (
              <g
                key={n.id}
                className="graph-node"
                role="button"
                tabIndex={0}
                aria-label={`${n.label.join(' ')} — open reasoning`}
                opacity={lit ? 1 : 0.35}
                onClick={() => onNodeClick(n.id)}
                onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && onNodeClick(n.id)}
              >
                <circle cx={n.x} cy={n.y} r={focused ? 30 : 26} fill={color} opacity={0.18} stroke={color} strokeWidth={focused ? 2 : 1.5} />
                <circle cx={n.x} cy={n.y} r={21} fill={color} />
                <text x={n.x} y={n.y - 4} textAnchor="middle" fontSize="8.5" fontWeight="600" fill="#fff">{n.label[0]}</text>
                <text x={n.x} y={n.y + 8} textAnchor="middle" fontSize="8" fill="rgba(255,255,255,.85)">{n.label[1]}</text>
              </g>
            )
          })}

          <line x1="12" y1="200" x2="36" y2="200" stroke="#9e9d97" strokeWidth="1" />
          <text x="40" y="204" fontSize="9" fill="#9e9d97">explicit</text>
          <line x1="12" y1="214" x2="36" y2="214" stroke="#378ADD" strokeWidth="1.5" strokeDasharray="4 3" />
          <text x="40" y="218" fontSize="9" fill="#9e9d97">inferred by AI</text>
        </svg>
      </div>
      <div className="graph-hint">
        <i className="ti ti-click" aria-hidden="true" /> Click any node to open AI reasoning drawer
      </div>
    </div>
  )
}
