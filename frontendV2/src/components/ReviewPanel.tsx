import { useState } from 'react'
import { exportUrl, type RunStatus } from '../api/client'
import type { InitiativeRef, Reviewer, ReviewState } from '../types'

const EXPORT_LABEL: Record<string, { label: string; icon: string }> = {
  'jira_link_proposals.csv': { label: 'Jira link proposals (CSV)', icon: 'ti-file-spreadsheet' },
  'sequence_note.md': { label: 'Sequence note (Markdown)', icon: 'ti-file-text' },
  'audit.json': { label: 'Audit trail (JSON)', icon: 'ti-file-code' },
}

interface Props {
  runId: string
  status: RunStatus | null
  /** A review was sent and the run is acting on it. */
  pending: 'approve' | 'challenge' | null
  review: ReviewState
  reviewers: Reviewer[]
  reviewerId: string
  onReviewer: (id: string) => void
  initiatives: InitiativeRef[]
  onApprove: (note: string) => void
  onChallenge: (first: string, then: string, note: string) => void
}

/** The human gate: a reviewer approves the sequence (and the proposals are exported) or challenges the order. */
export function ReviewPanel({ runId, status, pending, review, reviewers, reviewerId, onReviewer, initiatives, onApprove, onChallenge }: Props) {
  const [challenging, setChallenging] = useState(false)
  const [first, setFirst] = useState('')
  const [then, setThen] = useState('')
  const [note, setNote] = useState('')
  const title = (id: string) => initiatives.find((i) => i.id === id)?.title ?? id
  const who = reviewers.find((r) => r.id === reviewerId)
  const approved = review.approvals.filter((a) => a.action === 'approve').pop()
  const busy = pending !== null || status === 'running'

  return (
    <div className="review">
      <div className="review-head">
        <i className="ti ti-user-check" aria-hidden="true" /> Review and export
      </div>

      {review.constraints.length > 0 && (
        <div className="review-constraints">
          {review.constraints.map((c, i) => (
            <div key={i}><i className="ti ti-arrows-sort" aria-hidden="true" /> Reviewer constraint: {title(c.first)} before {title(c.then)}{c.note && ` — ${c.note}`}</div>
          ))}
        </div>
      )}

      {status === 'approved' && approved ? (
        <>
          <div className="review-done">
            <i className="ti ti-circle-check" aria-hidden="true" /> Approved by {approved.reviewer} ({approved.role}). Proposals only: nothing was written to Jira.
          </div>
          <div className="review-files">
            {review.exports.map((name) => (
              <a key={name} className="btn btn-ghost btn-sm" href={exportUrl(runId, name)} download={name}>
                <i className={`ti ${EXPORT_LABEL[name]?.icon ?? 'ti-download'}`} aria-hidden="true" /> {EXPORT_LABEL[name]?.label ?? name}
              </a>
            ))}
          </div>
        </>
      ) : busy ? (
        <div className="review-busy">
          <i className="ti ti-loader-2 spin" aria-hidden="true" />
          {pending === 'challenge' || (status === 'running' && pending !== 'approve')
            ? 'Re-sequencing with the reviewer constraint…'
            : 'Approving and writing the exports…'}
        </div>
      ) : status === 'awaiting_review' ? (
        <>
          <div className="review-text">
            A release train engineer, engineering manager or architect approves the order before the Jira link proposals are exported.
          </div>
          <div className="review-row">
            <label className="filter-field">
              <span className="review-lbl">Reviewer</span>
              <select className="select" value={reviewerId} onChange={(e) => onReviewer(e.target.value)} aria-label="Reviewer">
                {reviewers.map((r) => (
                  <option key={r.id} value={r.id}>{r.name} ({r.role}){r.can_approve ? '' : ': view only'}</option>
                ))}
              </select>
            </label>
          </div>
          {!challenging ? (
            <div className="review-row">
              <button className="btn btn-primary btn-sm" disabled={!who?.can_approve} onClick={() => onApprove('')}
                title={who?.can_approve ? 'Approve the order and export the proposals' : 'Only an RTE, EM or Architect can approve'}>
                <i className="ti ti-check" aria-hidden="true" /> Approve and export
              </button>
              <button className="btn btn-ghost btn-sm" disabled={!who?.can_approve || initiatives.length < 2} onClick={() => setChallenging(true)}
                title={initiatives.length < 2 ? 'A challenge needs two initiatives' : 'Say which initiative must come first; the order is worked out again'}>
                <i className="ti ti-arrows-sort" aria-hidden="true" /> Challenge the order…
              </button>
            </div>
          ) : (
            <div className="review-form">
              <div className="review-row">
                <select className="select" value={first} onChange={(e) => setFirst(e.target.value)} aria-label="Initiative that must come first">
                  <option value="">Choose an initiative…</option>
                  {initiatives.map((i) => <option key={i.id} value={i.id}>{i.title}</option>)}
                </select>
                <span className="review-lbl">must come before</span>
                <select className="select" value={then} onChange={(e) => setThen(e.target.value)} aria-label="Initiative that comes after">
                  <option value="">Choose an initiative…</option>
                  {initiatives.filter((i) => i.id !== first).map((i) => <option key={i.id} value={i.id}>{i.title}</option>)}
                </select>
              </div>
              <input className="review-note" placeholder="Why (optional)" value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} />
              <div className="review-row">
                <button className="btn btn-primary btn-sm" disabled={!first || !then || first === then}
                  onClick={() => { onChallenge(first, then, note); setChallenging(false); setNote('') }}>
                  <i className="ti ti-refresh" aria-hidden="true" /> Re-sequence
                </button>
                <button className="btn btn-ghost btn-sm" onClick={() => setChallenging(false)}>Cancel</button>
              </div>
            </div>
          )}
        </>
      ) : (
        <div className="review-text">{status === 'failed' ? 'The run failed, so it cannot be reviewed.' : 'The run is not ready for review yet.'}</div>
      )}
    </div>
  )
}
