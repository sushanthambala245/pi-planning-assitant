import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api } from '../api/client'
import type { Comment, CommentType } from '../types'

/** How often a backend run's comments are fetched while the page is visible. */
const POLL_MS = 5000
const MAX_BACKOFF_MS = 30000

export type CommentsStatus = 'live' | 'reconnecting' | 'local'

export interface CommentCounts {
  count: number
  open: number
}

interface Options {
  /** The backend run; without one the comments live in this browser (a replayed analysis file). */
  runId: string | null
  /** X-Demo-User for posts: the server looks up the name and role. */
  reviewerId?: string
  /** Name and role shown for a local comment. */
  localAuthor?: { name: string; role: string }
  /** Scopes the local copy, so two analysis files do not share comments. */
  localKey: string
  /** Poll only while the comments can be seen (the Results screen is open). */
  active: boolean
}

const storageKey = (k: string) => `pi-comments:${k}`

function readLocal(key: string): Comment[] {
  try {
    const raw = JSON.parse(localStorage.getItem(storageKey(key)) ?? '[]')
    return Array.isArray(raw) ? (raw as Comment[]) : []
  } catch {
    return []
  }
}

/** Comments for one analysis: polled from the backend every few seconds, or kept locally. */
export function useComments({ runId, reviewerId, localAuthor, localKey, active }: Options) {
  const [comments, setComments] = useState<Comment[]>([])
  const [status, setStatus] = useState<CommentsStatus>(runId ? 'live' : 'local')
  const [updatedAt, setUpdatedAt] = useState<number | null>(null)
  const rev = useRef<number | undefined>(undefined)

  // Backend: fetch now, then every POLL_MS while visible; back off when the server cannot be reached.
  useEffect(() => {
    if (!runId) return
    let stop = false
    let timer: ReturnType<typeof setTimeout> | undefined
    let delay = POLL_MS
    rev.current = undefined
    setComments([])
    if (!active) return
    const tick = async () => {
      clearTimeout(timer)
      if (!document.hidden) {
        try {
          const r = await api.comments(runId, rev.current)
          if (stop) return
          rev.current = r.rev
          if (!r.unchanged) setComments(r.comments)
          setUpdatedAt(Date.now())
          setStatus('live')
          delay = POLL_MS
        } catch {
          if (stop) return
          setStatus('reconnecting')
          delay = Math.min(delay * 2, MAX_BACKOFF_MS)
        }
      }
      timer = setTimeout(tick, delay)
    }
    const onVisible = () => { if (!document.hidden) void tick() }
    document.addEventListener('visibilitychange', onVisible)
    void tick()
    return () => {
      stop = true
      clearTimeout(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [runId, active])

  // No backend: this browser's copy for the analysis file.
  useEffect(() => {
    if (runId) return
    setComments(readLocal(localKey))
    setStatus('local')
  }, [runId, localKey])

  const saveLocal = useCallback((next: Comment[]) => {
    setComments(next)
    try {
      localStorage.setItem(storageKey(localKey), JSON.stringify(next))
    } catch {
      // storage full or blocked: the comments stay in memory for this session
    }
  }, [localKey])

  /** Rejects with the server's message (for example a 403 or a full comment limit). */
  const add = useCallback(async (initiativeId: string, type: CommentType, text: string) => {
    if (runId) {
      const r = await api.addComment(runId, { initiative_id: initiativeId, type, text }, reviewerId)
      rev.current = r.rev
      setComments(r.comments)
      setUpdatedAt(Date.now())
      return
    }
    saveLocal([...comments, {
      id: `local-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, initiativeId, type, text: text.trim(),
      author: localAuthor?.name ?? 'You', authorId: 'local', role: localAuthor?.role ?? 'Local',
      createdAt: new Date().toISOString(), resolved: false, resolvedBy: null, resolvedAt: null,
    }])
  }, [runId, reviewerId, localAuthor, comments, saveLocal])

  const resolve = useCallback(async (id: string, resolved: boolean) => {
    if (runId) {
      const r = await api.resolveComment(runId, id, resolved, reviewerId)
      rev.current = r.rev
      setComments(r.comments)
      setUpdatedAt(Date.now())
      return
    }
    const by = localAuthor?.name ?? 'You'
    saveLocal(comments.map((c) => c.id === id
      ? { ...c, resolved, resolvedBy: resolved ? by : null, resolvedAt: resolved ? new Date().toISOString() : null }
      : c))
  }, [runId, reviewerId, localAuthor, comments, saveLocal])

  const byInitiative = useMemo(() => {
    const m = new Map<string, CommentCounts>()
    for (const c of comments) {
      const e = m.get(c.initiativeId) ?? { count: 0, open: 0 }
      e.count += 1
      if (!c.resolved) e.open += 1
      m.set(c.initiativeId, e)
    }
    return m
  }, [comments])

  const openCount = useMemo(() => comments.filter((c) => !c.resolved).length, [comments])

  return { comments, byInitiative, openCount, status, updatedAt, add, resolve }
}
