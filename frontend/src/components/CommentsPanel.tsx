import { useEffect, useState } from 'react'
import type { CommentsStatus } from '../hooks/useComments'
import type { Comment, CommentType } from '../types'
import { Tip } from './Tip'

export const MAX_COMMENT = 1000

export const COMMENT_TYPES: { id: CommentType; label: string; hint: string }[] = [
  { id: 'concern', label: 'Concern', hint: 'Something that could go wrong or needs attention' },
  { id: 'question', label: 'Question', hint: 'Something nobody has answered yet' },
  { id: 'decision', label: 'Decision', hint: 'Something the group agreed' },
  { id: 'action', label: 'Action', hint: 'Something somebody has to do' },
]

const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase()).join('') || '?'

function ago(ms: number | null, now: number) {
  if (ms === null) return 'connecting…'
  const s = Math.max(0, Math.round((now - ms) / 1000))
  return s < 5 ? 'just now' : s < 60 ? `${s}s ago` : `${Math.round(s / 60)} min ago`
}

const clock = (iso: string) => {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

interface Props {
  initiativeTitle: string
  comments: Comment[]
  status: CommentsStatus
  updatedAt: number | null
  /** "Presenter (RTE)": who a new comment will be posted as. */
  postingAs: string
  onAdd: (type: CommentType, text: string) => Promise<void>
  onResolve: (id: string, resolved: boolean) => Promise<void>
}

/** Live feedback on one initiative: the thread, a Resolve checkbox per comment, and a composer. */
export function CommentsPanel({ initiativeTitle, comments, status, updatedAt, postingAs, onAdd, onResolve }: Props) {
  const [openOnly, setOpenOnly] = useState(false)
  const [type, setType] = useState<CommentType>('concern')
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])

  const shown = openOnly ? comments.filter((c) => !c.resolved) : comments
  const post = async () => {
    if (!text.trim() || busy) return
    setBusy(true)
    setError(null)
    try {
      await onAdd(type, text)
      setText('')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not post the comment')
    } finally {
      setBusy(false)
    }
  }
  const resolve = async (c: Comment) => {
    setError(null)
    try {
      await onResolve(c.id, !c.resolved)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not update the comment')
    }
  }

  return (
    <div className="comments">
      <div className="comments-live">
        {status === 'local' ? (
          <Tip title="Saved on this device" content="There is no backend run behind this analysis (a replayed file), so the comments are kept in this browser only. Export includes them."><span><i className="ti ti-device-desktop" aria-hidden="true" /> Saved on this device</span></Tip>
        ) : status === 'reconnecting' ? (
          <span className="warn"><i className="ti ti-plug-connected-x" aria-hidden="true" /> Reconnecting…</span>
        ) : (
          <Tip title="Live" content="Comments are saved with the backend run and fetched every few seconds, so everyone looking at this run sees the same thread. A rerun carries them over."><span><i className="live-dot" aria-hidden="true" /> Live · updated {ago(updatedAt, now)}</span></Tip>
        )}
        <label className="toggle"><input type="checkbox" checked={openOnly} onChange={(e) => setOpenOnly(e.target.checked)} /> Open only</label>
      </div>

      <div className="comments-list" aria-live="polite">
        {shown.length === 0 && (
          <div className="list-empty">
            {comments.length ? 'No open comments.' : `No comments on ${initiativeTitle} yet. Add the first one below.`}
          </div>
        )}
        {shown.map((c) => (
          <article key={c.id} className={`comment${c.resolved ? ' resolved' : ''}`}>
            <header>
              <span className="avatar" aria-hidden="true">{initials(c.author)}</span>
              <b>{c.author}</b>
              <span className="comment-role">{c.role} · {clock(c.createdAt)}</span>
            </header>
            <div>
              <span className={`ctype ct-${c.type}`}>{COMMENT_TYPES.find((t) => t.id === c.type)?.label ?? c.type}</span>
              <span className="comment-text">{c.text}</span>
            </div>
            <footer>
              <label className="toggle">
                <input type="checkbox" checked={c.resolved} onChange={() => resolve(c)} />
                {c.resolved ? `Resolved${c.resolvedBy ? ` by ${c.resolvedBy}` : ''}` : 'Resolve'}
              </label>
            </footer>
          </article>
        ))}
      </div>

      <div className="composer">
        <div className="composer-types" role="radiogroup" aria-label="Comment type">
          {COMMENT_TYPES.map((t) => (
            <Tip key={t.id} title={t.label} content={t.hint}>
              <button role="radio" aria-checked={type === t.id}
                className={`ctype ct-${t.id}${type === t.id ? ' on' : ''}`} onClick={() => setType(t.id)}>
                {t.label}
              </button>
            </Tip>
          ))}
        </div>
        <textarea
          value={text}
          maxLength={MAX_COMMENT}
          placeholder={`Add feedback for ${initiativeTitle}…`}
          aria-label="Comment"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) void post() }}
        />
        {error && <div className="composer-error" role="alert">{error}</div>}
        <div className="composer-foot">
          <span>Posting as {postingAs} · Ctrl+Enter posts{text.length > MAX_COMMENT - 100 ? ` · ${text.length}/${MAX_COMMENT}` : ''}</span>
          <button className="btn btn-primary btn-sm" onClick={post} disabled={!text.trim() || busy} aria-keyshortcuts="Control+Enter">
            {busy ? 'Posting…' : 'Post'}
          </button>
        </div>
      </div>
    </div>
  )
}
