import type { Initiative } from '../types'

/** The default ready status (backend READY_STATUSES) until /api/health says otherwise. */
export const DEFAULT_READY = ['Ready for PI Planning']

/**
 * Only initiatives ready for PI planning are analysed: one still In Discovery is not yet known to be
 * an initiative, and a Proposed one is not accepted yet. The backend's verdict (`ready`) wins; without
 * one (an uploaded file), the status decides, and no status counts as ready (it was added to be
 * planned). Mirrors backend/tools/planning.py `is_ready`.
 */
export function isReady(i: Pick<Initiative, 'ready' | 'status'>, readyStatuses: string[] = DEFAULT_READY): boolean {
  if (typeof i.ready === 'boolean') return i.ready
  const s = (i.status ?? '').trim().toLowerCase()
  return !s || readyStatuses.some((r) => r.toLowerCase() === s)
}

const UP = /\bup(?:stream)?\b/i
const DOWN = /\bdown(?:stream)?\b/i

/**
 * The initiatives file's dependency column, "Upstream: A, B; Downstream: C", as lists. Upstream systems
 * are ones the initiative consumes; downstream systems consume its output. A part without a label counts
 * as upstream. Mirrors backend/tools/planning.py `parse_dependency_text`.
 */
export function parseDeclared(text?: string): { upstream: string[]; downstream: string[] } {
  const upstream: string[] = []
  const downstream: string[] = []
  for (const part of (text ?? '').split(/[;\n]/)) {
    const at = part.indexOf(':')
    const label = at >= 0 ? part.slice(0, at) : ''
    const names = at >= 0 ? part.slice(at + 1) : part
    const target = DOWN.test(label) && !UP.test(label) ? downstream : upstream
    for (const raw of names.split(/,|\|/)) {
      const n = raw.trim().replace(/^\.+|\.+$/g, '')
      if (n && !target.includes(n)) target.push(n)
    }
  }
  return { upstream, downstream }
}
