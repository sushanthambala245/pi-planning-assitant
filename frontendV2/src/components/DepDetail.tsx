import { CHANGE, METHOD } from '../lib/deps'
import type { DependencyRow } from '../types'
import { ChangeBadge, LevelBadge, PathChain, VerdictBadge } from './Badges'

interface Props {
  dep: DependencyRow
  /** Label for another row's key, for "also found as". */
  labelOf?: (key: string) => string
  compact?: boolean
}

/** Why a dependency is there, what it asks for, and how sure we are. */
export function DepDetail({ dep, labelOf, compact = false }: Props) {
  const mixed = new Set(dep.why.map((w) => w.changeType)).size > 1
  // Verdicts are per initiative and team: a link found only in data is confirmed by a stated one to the same team.
  const confirmedElsewhere = dep.verdict === 'confirmed' && !dep.methods.includes('explicit') && dep.alsoFoundAs.length > 0
  return (
    <div className="dep-detail">
      <div className="dep-detail-badges">
        <ChangeBadge type={dep.changeType} />
        <LevelBadge level={dep.level} />
        <VerdictBadge verdict={dep.verdict} />
      </div>

      <div className="dep-detail-label">Why it is here</div>
      <PathChain path={dep.path} />
      <div className="dep-reason">{dep.reason}</div>

      {!compact && dep.why.length > 1 && (
        <>
          <div className="dep-detail-label">Found {dep.why.length} ways</div>
          {dep.why.map((w) => (
            <div className="dep-why" key={w.method + w.text}>
              <span className="dep-method">{METHOD[w.method] ?? w.method}</span>
              <span className={`dep-why-change chg-text-${w.changeType}`}>{CHANGE[w.changeType].short}</span>
              <span>{w.text}</span>
            </div>
          ))}
          {mixed && <div className="dep-note">The ways disagree on what is needed; the link shows the biggest need ({CHANGE[dep.changeType].short.toLowerCase()}).</div>}
        </>
      )}

      <div className="dep-facts">
        <span title="Where the evidence came from">
          <i className="ti ti-search" aria-hidden="true" /> {dep.methods.map((m) => METHOD[m] ?? m).join(' + ')}
        </span>
        <span title="Evidence items behind this dependency"><i className="ti ti-file-text" aria-hidden="true" /> {dep.evidenceCount} evidence item{dep.evidenceCount === 1 ? '' : 's'}</span>
        {dep.toTeam && <span title="The team this lands on"><i className="ti ti-users" aria-hidden="true" /> {dep.toTeam} team</span>}
        {dep.inJira != null && <span><i className="ti ti-ticket" aria-hidden="true" /> {dep.inJira ? 'Already linked in Jira' : 'Not linked in Jira'}</span>}
        {dep.status === 'low_confidence' && <span className="warn-text"><i className="ti ti-alert-triangle" aria-hidden="true" /> Low confidence</span>}
      </div>

      {dep.alsoFoundAs.length > 0 && labelOf && (
        <div className="dep-also">
          <i className="ti ti-link" aria-hidden="true" />
          {confirmedElsewhere
            ? `Confirmed because a stated link lands on the same team: ${dep.alsoFoundAs.map(labelOf).join('; ')}`
            : `Same team, also found as: ${dep.alsoFoundAs.map(labelOf).join('; ')}`}
        </div>
      )}

      {!compact && dep.evidence.length > 0 && (
        <>
          <div className="dep-detail-label">Evidence</div>
          {dep.evidence.map((e) => (
            <div className="sources-item" key={e.text}><i className={`ti ${e.icon}`} aria-hidden="true" />{e.text}</div>
          ))}
        </>
      )}
    </div>
  )
}
