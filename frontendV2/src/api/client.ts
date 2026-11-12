import { classify } from '../lib/ingest'
import type { Comment, CommentType, Initiative, KnowledgeSource, Reviewer, ReviewState } from '../types'

// Thin client over the FastAPI backend (backend/app/main.py). URLs are relative: in dev and
// preview, Vite forwards /api to http://localhost:8000 (vite.config.ts).

export interface Health {
  llm: { enabled: boolean; provider: string; model: string; reason: string }
  data: { ready_sources: number; total_sources: number; data_dir: string; fingerprint: string }
  limits: { max_initiatives_per_run: number; max_upload_initiatives?: number }
  warnings: string[]
}

interface BackendInitiative {
  id: string
  title: string
  description: string
  owning_team: string
  target_pi: string | null
  art: string | null
  origin: 'S1' | 'upload' | 'manual'
}

export interface SourceReport {
  id: string
  filename: string
  title: string
  mock: boolean
  status: 'ready' | 'partial' | 'invalid' | 'missing'
  rows: number
  rejected_rows: number
  errors: string[]
}

export type RunStatus = 'running' | 'awaiting_review' | 'approved' | 'failed'

export interface RunAnalysis {
  run_id: string
  status: RunStatus
  error: string | null
  /** Index of the first agent that is not done yet. */
  current: number
  initiative_ids: string[]
  analysis: unknown // the Analysis contract; normalised by the caller
  review?: ReviewState
  /** Risk ids flagged for PI planning. */
  flags?: string[]
}

export interface ReviewBody {
  action: 'approve' | 'challenge'
  /** For a challenge: `first` must be delivered before `then`. */
  constraint?: { first: string; then: string; note: string }
  note?: string
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, init)
  if (!res.ok) {
    const body = await res.json().catch(() => null)
    throw new Error(typeof body?.detail === 'string' ? body.detail : `${res.status} ${res.statusText}`)
  }
  return res.json() as Promise<T>
}

/** `as` is a reviewer id from /api/reviewers: the server looks up the role, the request cannot claim one. */
const post = (body: unknown, as?: string): RequestInit => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/json', ...(as ? { 'X-Demo-User': as } : {}) },
  body: JSON.stringify(body),
})

const run = (runId: string) => `/runs/${encodeURIComponent(runId)}`

export const api = {
  health: () => call<Health>('/health'),
  initiatives: () => call<{ initiatives: BackendInitiative[] }>('/initiatives').then((r) => r.initiatives),
  sources: () => call<{ sources: SourceReport[] }>('/sources').then((r) => r.sources),
  addInitiative: (title: string, description: string) =>
    call<BackendInitiative>('/initiatives', post({ title, description })),
  /** Rows past the backend's per-upload limit are skipped and counted, not added. */
  uploadInitiatives: (file: File) => {
    const form = new FormData()
    form.append('file', file)
    return call<{ added: BackendInitiative[]; skipped?: number; limit?: number }>('/initiatives/upload', { method: 'POST', body: form })
  },
  /** Re-reads the data folder; returns the new source reports. */
  reloadSources: () => call<{ sources: SourceReport[] }>('/sources/reload', { method: 'POST' }).then((r) => r.sources),
  startRun: (initiativeIds: string[]) =>
    call<{ run_id: string }>('/runs', post({ initiative_ids: initiativeIds })).then((r) => r.run_id),
  runAnalysis: (runId: string) => call<RunAnalysis>(`${run(runId)}/analysis`),
  reviewers: () => call<{ reviewers: Reviewer[] }>('/reviewers').then((r) => r.reviewers),
  /** Approve (exports the proposals) or challenge (re-sequences with a constraint); the run then resumes. */
  review: (runId: string, reviewerId: string, body: ReviewBody) => call<unknown>(`${run(runId)}/review`, post(body, reviewerId)),
  flag: (runId: string, itemId: string, flagged: boolean, reviewerId?: string) =>
    call<{ flags: string[] }>(`${run(runId)}/flags`, post({ item_id: itemId, flagged }, reviewerId)).then((r) => r.flags),
  /** Send the `rev` you last saw: the answer is `unchanged: true` (and no comments) when nothing moved. */
  comments: (runId: string, rev?: number) =>
    call<CommentsReply>(`${run(runId)}/comments${rev === undefined ? '' : `?rev=${rev}`}`),
  /** Author and role come from the reviewer id (X-Demo-User), not from the body. */
  addComment: (runId: string, body: { initiative_id: string; type: CommentType; text: string }, reviewerId?: string) =>
    call<CommentsReply>(`${run(runId)}/comments`, post(body, reviewerId)),
  resolveComment: (runId: string, commentId: string, resolved: boolean, reviewerId?: string) =>
    call<CommentsReply>(`${run(runId)}/comments/${encodeURIComponent(commentId)}/resolve`, post({ resolved }, reviewerId)),
}

export interface CommentsReply {
  rev: number
  unchanged?: boolean
  comments: Comment[]
}

/** All comments of a run as a spreadsheet-safe CSV. */
export const commentsCsvUrl = (runId: string) => `/api${run(runId)}/comments/export`

/** A file the run exported after approval (proposals CSV, sequence note, audit). */
export const exportUrl = (runId: string, name: string) => `/api${run(runId)}/export/${encodeURIComponent(name)}`

export const toInitiative = (b: BackendInitiative): Initiative => ({
  id: b.id,
  title: b.title,
  description: b.description,
  meta: [b.art && `ART: ${b.art}`, b.origin !== 'S1' && b.origin].filter(Boolean).join(' · ') || undefined,
  team: b.owning_team || undefined,
  pi: b.target_pi || undefined,
})

/** A source the backend loaded (some rows may have been rejected). */
export const isLoaded = (r: SourceReport) => r.status === 'ready' || r.status === 'partial'

/** Every source the backend knows, loaded or not, so the Intake screen can say what is missing. */
export const toSource = (r: SourceReport): KnowledgeSource => ({
  id: r.id,
  ...classify(r.filename),
  name: `${r.title} (${r.id})`,
  meta: isLoaded(r)
    ? `${r.rows} rows${r.rejected_rows ? `, ${r.rejected_rows} rejected` : ''} · ${r.filename}`
    : r.status === 'missing'
      ? `Not in the data folder: ${r.filename}${r.mock ? ' (mock source)' : ''}`
      : `Not loaded: ${r.errors[0] ?? 'invalid file'}`,
  status: r.status,
})
