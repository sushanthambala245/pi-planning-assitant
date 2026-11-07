import { CHANGE, CHANGE_ORDER, countBy, needsChange } from '../lib/deps'
import type { Analysis } from '../types'

interface Stat {
  label: string
  value: number | string
  sub: string
  tone?: 'accent' | 'danger' | 'ok' | 'warn'
  hint?: string
}

export function StatRow({ analysis, initiativeCount }: { analysis: Analysis; initiativeCount: number }) {
  const { edges } = analysis.graph
  const deps = analysis.dependencies
  const high = analysis.risks.filter((r) => r.severity === 'High').length
  const medium = analysis.risks.filter((r) => r.severity === 'Medium').length
  const low = analysis.risks.length - high - medium
  const risk: Stat = {
    label: 'Risk flags',
    value: analysis.risks.length,
    sub: `${high} high · ${medium} medium${low ? ` · ${low} low` : ''}`,
    tone: high ? 'danger' : undefined,
  }

  let stats: Stat[]
  if (deps.length) {
    const change = deps.filter((d) => needsChange(d.changeType))
    const byType = countBy(change, (d) => d.changeType)
    const confirmed = deps.filter((d) => d.verdict === 'confirmed').length
    const inferredOnly = deps.filter((d) => d.verdict === 'inferred_only').length
    const known = deps.filter((d) => d.inJira != null)
    const notInJira = known.filter((d) => d.inJira === false).length
    const noChange = deps.length - change.length
    stats = [
      { label: 'Initiatives analysed', value: initiativeCount, sub: 'selected in intake' },
      {
        label: 'Dependencies needing a change',
        value: change.length,
        sub: [CHANGE_ORDER.filter((t) => byType[t]).map((t) => `${byType[t]} ${CHANGE[t].short.toLowerCase()}`).join(' · ') || 'nothing to build or re-test',
          noChange ? `${noChange} more need no change` : ''].filter(Boolean).join(' · '),
        tone: 'accent',
        hint: 'Code change, flow / integration change, or regression testing. Links that need no change are awareness only.',
      },
      known.length
        ? {
            label: 'Not in Jira yet',
            value: notInJira,
            sub: `of ${deps.length} links: record them before PI planning`,
            tone: notInJira ? 'warn' : 'ok',
            hint: 'No Jira "blocked by" link exists between the epics involved. Approving the run exports them as link proposals.',
          }
        : { label: 'Not in Jira yet', value: '—', sub: 'no Jira link export loaded (S10)', hint: 'Load jira_tagged_links.csv to check which links already exist' },
      risk,
      {
        label: 'Confirmed',
        value: confirmed,
        sub: `${inferredOnly} inferred only: confirm them with the teams`,
        tone: confirmed ? 'ok' : undefined,
        hint: 'Stated in text and also visible in code or ownership data',
      },
    ]
  } else {
    const inferred = edges.filter((e) => e.inferred).length
    stats = [
      { label: 'Initiatives analysed', value: initiativeCount, sub: 'loaded in intake' },
      { label: 'Dependencies found', value: edges.length, sub: `${inferred} inferred, not stated`, tone: 'accent' },
      risk,
      { label: 'Recommended sequence', value: analysis.sequence.length, sub: 'steps with reasoning' },
    ]
  }

  return (
    <div className={`stat-row${stats.length === 5 ? ' five' : ''}`}>
      {stats.map((s) => (
        <div className="stat-card" key={s.label} title={s.hint}>
          <div className="stat-label">{s.label}</div>
          <div className={`stat-val${s.tone ? ` ${s.tone}` : ''}`}>{s.value}</div>
          <div className="stat-sub">{s.sub}</div>
        </div>
      ))}
    </div>
  )
}
