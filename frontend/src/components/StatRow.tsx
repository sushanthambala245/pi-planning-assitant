interface Stat {
  label: string
  value: string
  sub: string
  tone?: 'accent' | 'danger'
}

export function StatRow({ stats }: { stats: Stat[] }) {
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
