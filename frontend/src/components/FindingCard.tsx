import type { Finding } from '../types'

export function FindingCard({ finding }: { finding: Finding }) {
  return (
    <div className={`finding-card${finding.highlight ? ' hi' : ''}`}>
      <span className={`ftag ${finding.tag}`}>{finding.tagLabel}</span>
      <div className="ftext">{finding.text}</div>
      {finding.note && <div className="fsub">{finding.note}</div>}
    </div>
  )
}
