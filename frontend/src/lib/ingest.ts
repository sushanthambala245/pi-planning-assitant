import { strFromU8, unzipSync } from 'fflate'
import { normalizeAnalysis, normalizeInitiatives } from './analysis'
import { parseCsvTable } from './csv'
import type { Analysis, Initiative, KbKind, KnowledgeSource, Notice } from '../types'

export interface IngestResult {
  initiatives: Initiative[]
  sources: KnowledgeSource[]
  analysis: Analysis | null
  notices: Notice[]
}

let noticeSeq = 0
export const notice = (kind: Notice['kind'], text: string): Notice => ({ id: ++noticeSeq, kind, text })

const baseName = (path: string) => path.split(/[\\/]/).pop() ?? path

const prettify = (file: string) => {
  const s = file.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim()
  return s.charAt(0).toUpperCase() + s.slice(1)
}

/** Picks an icon/colour for a knowledge-source file from keywords in its name. */
export function classify(file: string): { kind: KbKind; icon: string } {
  const n = file.toLowerCase()
  if (/team|ownership|director|capacity/.test(n)) return { kind: 'team', icon: 'ti-users' }
  if (/depend|link/.test(n)) return { kind: 'inv', icon: 'ti-file-code' }
  if (/repo|github|service|inventory/.test(n)) return { kind: 'arch', icon: 'ti-sitemap' }
  if (/kpi|outcome|benchmark|dictionary/.test(n)) return { kind: 'conf', icon: 'ti-chart-bar' }
  return { kind: 'conf', icon: 'ti-notes' }
}

export interface IngestOptions {
  /** Initiatives read from one file; the remaining rows are skipped and reported. */
  maxInitiativesPerFile?: number
}

function ingestCsv(file: string, text: string, out: IngestResult, opts: IngestOptions) {
  const { headers, records } = parseCsvTable(text)
  if (!headers.length) {
    out.notices.push(notice('error', `${file}: empty or unreadable CSV`))
    return
  }

  const isInitiatives =
    headers.includes('initiative_id') &&
    (headers.includes('initiative_name') || headers.includes('title') || headers.includes('name')) &&
    !headers.includes('statement_id') &&
    !headers.includes('epic_id')

  if (isInitiatives) {
    const all = records.filter((r) => r.initiative_id)
    const limit = opts.maxInitiativesPerFile ?? all.length
    // Headers are lower-cased with spaces as "_", so "T-Shirt Sizing" is t-shirt_sizing and the target
    // quarter may carry a note ("target_pi-explicitly Q1/Q2.."): match those by prefix, as the backend does.
    const col = (...prefixes: string[]) => headers.find((h) => prefixes.some((p) => h === p || h.startsWith(p)))
    const sizeCol = col('t-shirt', 'tshirt', 't_shirt', 'size')
    const piCol = col('target_pi', 'target_quarter', 'quarter', 'pi')
    const list = all.slice(0, limit).map<Initiative>((r) => {
      const size = sizeCol ? (r[sizeCol] ?? '').trim().toUpperCase() : ''
      const pi = piCol ? (r[piCol] ?? '').trim() : ''
      return {
        id: r.initiative_id,
        title: r.initiative_name || r.title || r.name || r.initiative_id,
        description: r.description ?? '',
        meta: [r.owning_team, r.priority, pi].filter(Boolean).join(' · ') || undefined,
        team: r.owning_team || undefined,
        pi: pi || undefined,
        priority: r.priority || undefined,
        status: r.status || undefined,
        size: size || undefined,
        art: r.art || undefined,
        outcome: r.business_outcome || undefined,
        dependencyText: r.dependency || r.dependencies || undefined,
      }
    })
    out.initiatives.push(...list)
    const skipped = all.length - list.length
    out.notices.push(skipped
      ? notice('error', `${file}: loaded the first ${list.length} initiatives; ${skipped} skipped (limit ${limit} per file)`)
      : notice('ok', `${file}: loaded ${list.length} initiatives`))
    return
  }

  out.sources.push({
    id: `src-${file}`,
    ...classify(file),
    name: prettify(file),
    meta: `${records.length} rows · ${headers.length} columns · ${file}`,
  })
  out.notices.push(notice('ok', `${file}: registered as knowledge source (${records.length} rows)`))
}

function ingestJson(file: string, text: string, out: IngestResult) {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    out.notices.push(notice('error', `${file}: not valid JSON`))
    return
  }

  const obj = (typeof raw === 'object' && raw !== null && !Array.isArray(raw) ? raw : {}) as Record<string, unknown>
  // An analysis lists its own initiatives too, so its fields decide before `initiatives` does.
  const isAnalysis = !('analysis' in obj) && ['agents', 'findings', 'graph', 'risks'].some((k) => k in obj)
  const isBundle = !isAnalysis && ('initiatives' in obj || 'knowledgeSources' in obj || 'analysis' in obj)

  try {
    if (Array.isArray(raw)) {
      const list = normalizeInitiatives(raw)
      out.initiatives.push(...list)
      out.notices.push(notice('ok', `${file}: loaded ${list.length} initiatives`))
      return
    }
    if (isBundle) {
      if (obj.initiatives) {
        const list = normalizeInitiatives(obj.initiatives)
        out.initiatives.push(...list)
        out.notices.push(notice('ok', `${file}: loaded ${list.length} initiatives`))
      }
      if (Array.isArray(obj.knowledgeSources)) {
        for (const [i, s] of obj.knowledgeSources.entries()) {
          const o = (s ?? {}) as Record<string, unknown>
          const name = String(o.name ?? `Source ${i + 1}`)
          out.sources.push({
            id: `src-${file}-${i}`,
            ...classify(name),
            name,
            meta: String(o.meta ?? ''),
          })
        }
        out.notices.push(notice('ok', `${file}: registered ${obj.knowledgeSources.length} knowledge sources`))
      }
      if (obj.analysis) {
        out.analysis = normalizeAnalysis(obj.analysis)
        out.notices.push(notice('ok', `${file}: analysis result loaded`))
      }
      return
    }
    out.analysis = normalizeAnalysis(obj)
    out.notices.push(notice('ok', `${file}: analysis result loaded`))
  } catch (e) {
    out.notices.push(notice('error', `${file}: ${e instanceof Error ? e.message : 'could not be read'}`))
  }
}

function ingestEntry(path: string, bytes: Uint8Array, out: IngestResult, opts: IngestOptions) {
  const file = baseName(path)
  if (!file || file.startsWith('.') || file.startsWith('~$')) return
  const ext = file.split('.').pop()?.toLowerCase()

  if (ext === 'csv') ingestCsv(file, strFromU8(bytes), out, opts)
  else if (ext === 'json') ingestJson(file, strFromU8(bytes), out)
  else if (ext === 'xlsx' || ext === 'xls') {
    out.sources.push({
      id: `src-${file}`,
      ...classify(file),
      name: prettify(file),
      meta: `Excel workbook · ${file} (listed only, not parsed in the browser)`,
    })
    out.notices.push(notice('ok', `${file}: registered as knowledge source (not parsed)`))
  } else out.notices.push(notice('error', `${file}: unsupported file type (use .csv, .json, .xlsx or .zip)`))
}

/** Reads uploaded CSV / JSON / XLSX / ZIP files and sorts them into initiatives, knowledge sources and analysis. */
export async function ingestFiles(files: File[], opts: IngestOptions = {}): Promise<IngestResult> {
  const out: IngestResult = { initiatives: [], sources: [], analysis: null, notices: [] }

  for (const f of files) {
    try {
      const bytes = new Uint8Array(await f.arrayBuffer())
      if (f.name.toLowerCase().endsWith('.zip')) {
        const entries = unzipSync(bytes)
        const names = Object.keys(entries).filter((p) => !p.endsWith('/') && !p.startsWith('__MACOSX'))
        if (!names.length) out.notices.push(notice('error', `${f.name}: archive is empty`))
        for (const p of names) ingestEntry(p, entries[p], out, opts)
      } else ingestEntry(f.name, bytes, out, opts)
    } catch {
      out.notices.push(notice('error', `${f.name}: could not be read`))
    }
  }
  return out
}
