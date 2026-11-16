import { useState } from 'react'
import { CHANGE, METHOD } from '../lib/deps'
import type { DependencyRow } from '../types'
import { LevelBadge, PathChain, VerdictBadge } from './Badges'

interface Props {
  dep: DependencyRow
  /** Label for another row's key, for "also found as". */
  labelOf?: (key: string) => string
  compact?: boolean
}

/**
 * Why a dependency is there, kept short: the headline reason, then the evidence and the related links
 * behind one click each. The row's own chips already show where it came from and what it asks for, so
 * they are not repeated here.
 */
export function DepDetail({ dep, labelOf, compact = false }: Props) {
  const [evidence, setEvidence] = useState(false)
  const [also, setAlso] = useState(false)
  const [way, setWay] = useState<string | null>(null)
  const mixed = new Set(dep.why.map((w) => w.changeType)).size > 1
  // Verdicts are per initiative and team: a link found only in data is confirmed by a stated one to the same team.
  const confirmedElsewhere = dep.verdict === 'confirmed' && !dep.methods.includes('explicit') && dep.alsoFoundAs.length > 0
  const hops = dep.path.length > 2 // initiative -> initiative needs no path: the row title says it
  const ways = dep.why.length
  const summary = [ways > 1 && `Found ${ways} ways`, `${dep.evidenceCount} evidence item${dep.evidenceCount === 1 ? '' : 's'}`].filter(Boolean).join(' · ')

  return (
    <div className="dep-detail">
      <div className="dep-detail-badges">
        <VerdictBadge verdict={dep.verdict} />
        {dep.level !== 'initiative' && <LevelBadge level={dep.level} />}
        {dep.status === 'low_confidence' && <span className="warn-text"><i className="ti ti-alert-triangle" aria-hidden="true" /> Low confidence</span>}
        {dep.inJira != null && <span className="dep-jira"><i className="ti ti-ticket" aria-hidden="true" /> {dep.inJira ? 'In Jira' : 'Not in Jira'}</span>}
        {compact && dep.toTeam && <span className="dep-jira"><i className="ti ti-users" aria-hidden="true" /> {dep.toTeam} team</span>}
      </div>

      {hops && <PathChain path={dep.path} />}
      <div className="dep-reason">{dep.reason}</div>
      {!compact && <div className="dep-sum">{summary}</div>}

      {!compact && (
        <>
          <button className="dep-toggle" aria-expanded={evidence} onClick={() => setEvidence((v) => !v)}>
            <i className={`ti ${evidence ? 'ti-chevron-down' : 'ti-chevron-right'}`} aria-hidden="true" /> Evidence
            <span className="dep-toggle-n">{dep.evidenceCount}</span>
          </button>
          {evidence && (
            <div className="dep-ev">
              {ways > 1 && dep.why.map((w) => {
                const k = w.method + w.text
                const on = way === k
                return (
                  <button className={`dep-ev-row${on ? ' open' : ''}`} key={k} aria-expanded={on} onClick={() => setWay(on ? null : k)}>
                    <span className="dep-method">{METHOD[w.method] ?? w.method}</span>
                    <span className={`dep-why-change chg-text-${w.changeType}`}>{CHANGE[w.changeType].short}</span>
                    <span className="dep-ev-t">{w.text}</span>
                    <i className={`ti ${on ? 'ti-chevron-down' : 'ti-chevron-right'}`} aria-hidden="true" />
                  </button>
                )
              })}
              {ways > 1 && mixed && <div className="dep-note">The ways disagree on what is needed; the link shows the biggest need ({CHANGE[dep.changeType].short.toLowerCase()}).</div>}
              {ways > 1 && dep.evidence.length > 0 && <div className="dep-detail-label">Sources</div>}
              {dep.evidence.map((e) => (
                <div className="sources-item" key={e.text}><i className={`ti ${e.icon}`} aria-hidden="true" />{e.text}</div>
              ))}
            </div>
          )}
        </>
      )}

      {dep.alsoFoundAs.length > 0 && labelOf && (
        <>
          <button className="dep-toggle" aria-expanded={also} onClick={() => setAlso((v) => !v)}>
            <i className={`ti ${also ? 'ti-chevron-down' : 'ti-chevron-right'}`} aria-hidden="true" /> Also found as
            <span className="dep-toggle-n">{dep.alsoFoundAs.length}</span>
          </button>
          {also && (
            <div className="dep-also">
              <i className="ti ti-link" aria-hidden="true" />
              <span>
                {confirmedElsewhere && 'Confirmed because a stated link lands on the same team: '}
                {dep.alsoFoundAs.map(labelOf).join('; ')}
              </span>
            </div>
          )}
        </>
      )}
    </div>
  )
}
