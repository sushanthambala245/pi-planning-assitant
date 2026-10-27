import type { Analysis } from '../types'

interface Stat {
  label: string
  value: number
  sub: string
  tone?: 'accent' | 'danger'
}

export function StatRow({ analysis, initiativeCount }: { analysis: Analysis; initiativeCount: number }) {
  const { edges } = analysis.graph
  const inferred = edges.filter((e) => e.inferred).length
  const high = analysis.risks.filter((r) => r.severity === 'High').length
  const medium = analysis.risks.filter((r) => r.severity === 'Medium').length
  const low = analysis.risks.length - high - medium

  const stats: Stat[] = [
    { label: 'Initiatives analysed', value: initiativeCount, sub: 'loaded in intake' },
    { label: 'Dependencies found', value: edges.length, sub: `${inferred} inferred by AI`, tone: 'accent' },
    {
      label: 'Risk flags',
      value: analysis.risks.length,
      sub: `${high} high · ${medium} medium${low ? ` · ${low} low` : ''}`,
      tone: high ? 'danger' : undefined,
    },
    { label: 'Recommended sequence', value: analysis.sequence.length, sub: 'steps with reasoning' },
  ]

  return (
    <div className="stat-row">
      {stats.map((s) => (
        <div className="stat-card" key={s.label}>
          <div className="stat-label">{s.label}</div>
          <div className={`stat-val${s.tone ? ` ${s.tone}` : ''}`}>{s.value}</div>
          <div className="stat-sub">{s.sub}</div>
        </div>
      ))}
    </div>
  )
}
