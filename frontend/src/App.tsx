import { useCallback, useEffect, useRef, useState } from 'react'
import { api, isLoaded, toInitiative, toSource, type ReviewBody, type RunStatus } from './api/client'
import { HelpDrawer } from './components/HelpDrawer'
import { Notices } from './components/Notices'
import { ReviewPanel } from './components/ReviewPanel'
import { SideNav } from './components/SideNav'
import { Tip } from './components/Tip'
import { TopBar } from './components/TopBar'
import { normalizeAnalysis } from './lib/analysis'
import { plural } from './lib/deps'
import { ingestFiles, notice } from './lib/ingest'
import { EMPTY_PLANNER, describeChanges, useStored, type Scale } from './lib/plan'
import { usePlannerApi, usePlannerState } from './lib/planner'
import { DEFAULT_READY, isReady } from './lib/readiness'
import { SectionsProvider } from './lib/sections'
import { DashboardScreen } from './screens/DashboardScreen'
import { IntakeScreen } from './screens/IntakeScreen'
import { PipelineScreen } from './screens/PipelineScreen'
import { ResultsScreen } from './screens/ResultsScreen'
import type { Analysis, Initiative, KnowledgeSource, Notice, PlannerInput, Reviewer, ReviewState, Run, Screen } from './types'

/** How long each agent "runs" while a loaded analysis is replayed. */
const STEP_MS = 1200
/** How often a backend run is polled for progress. */
const POLL_MS = 800
/** Defaults until the backend reports its own limits (backend/app/config.py). */
const DEFAULT_LIMITS = { perRun: 60, perUpload: 100 }
const NO_REVIEW: ReviewState = { approvals: [], constraints: [], exports: [] }

const mergeById = <T extends { id: string }>(prev: T[], next: T[]): T[] => {
  const map = new Map(prev.map((i) => [i.id, i]))
  for (const n of next) map.set(n.id, n)
  return [...map.values()]
}

const message = (e: unknown) => (e instanceof Error ? e.message : 'request failed')

function downloadJson(name: string, data: unknown) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }))
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  URL.revokeObjectURL(url)
}

/** "hidden 322 → 318 · conflicts 3 → 1": what a rerun changed, from the two plans' counts. */
function rerunDiff(before: Analysis | null, after: Analysis): string {
  const a = before?.plan?.counts
  const b = after.plan?.counts
  if (!a || !b) return ''
  const parts = ([
    ['declared', a.declared, b.declared],
    ['hidden', a.hidden, b.hidden],
    ['order-changing', a.ordering, b.ordering],
    ['conflicts', a.conflicts, b.conflicts],
    ['later quarter', a.laterQuarter, b.laterQuarter],
    ['spill', a.spill, b.spill],
    ['teams over', a.teamsOver, b.teamsOver],
  ] as const).filter(([, x, y]) => x !== y).map(([w, x, y]) => `${w} ${x} → ${y}`)
  return parts.length ? parts.join(' · ') : 'no change in the counts'
}

/** A rerun in flight: the results stay on screen until it finishes. */
interface Rerun {
  before: Analysis | null
  sent: PlannerInput
  describe: string
  /** Risks flagged on the previous run: flags live per run on the backend, so they are carried over. */
  flags: string[]
  reviewer: string
}

/** Flags the risks on a run one at a time (each call returns the run's full list). */
async function carryFlags(runId: string, ids: string[], reviewer: string): Promise<string[]> {
  let out: string[] = []
  for (const id of ids) out = await api.flag(runId, id, true, reviewer || undefined)
  return out
}

export default function App() {
  const [screen, setScreen] = useState<Screen>('intake')
  const [initiatives, setInitiatives] = useState<Initiative[]>([])
  const [sources, setSources] = useState<KnowledgeSource[]>([])
  const [analysis, setAnalysis] = useState<Analysis | null>(null)
  const [run, setRun] = useState<Run>({ status: 'idle', current: 0 })
  const [notices, setNotices] = useState<Notice[]>([])
  const [helpOpen, setHelpOpen] = useState(false)
  const [nav, setNav] = useStored('pi-sidenav', { collapsed: false })
  /** A backend answered: initiatives and sources come from it, and Analyse runs the agents there. */
  const [connected, setConnected] = useState(false)
  /** The current analysis comes from a backend run (polled while it runs), not a replayed file. */
  const [fromBackend, setFromBackend] = useState(false)
  const [liveRunId, setLiveRunId] = useState<string | null>(null)
  /** The backend run behind the current analysis; kept after it finishes, for review, flags and exports. */
  const [runId, setRunId] = useState<string | null>(null)
  const [runStatus, setRunStatus] = useState<RunStatus | null>(null)
  const [runSize, setRunSize] = useState(0)
  /** Analyse was clicked and the backend has not answered yet. */
  const [starting, setStarting] = useState(false)
  const [rerunning, setRerunning] = useState(false)
  const [reloadingSources, setReloadingSources] = useState(false)
  /** Initiatives ticked for the next analysis, at most limits.perRun. */
  const [selected, setSelected] = useState<string[]>([])
  const [limits, setLimits] = useState(DEFAULT_LIMITS)
  const [readyStatuses, setReadyStatuses] = useState<string[]>(DEFAULT_READY)
  const [scale, setScale] = useState<Scale | null>(null)
  const [review, setReview] = useState<ReviewState>(NO_REVIEW)
  const [reviewers, setReviewers] = useState<Reviewer[]>([])
  const [reviewerId, setReviewerId] = useState('')
  const [reviewError, setReviewError] = useState<string | null>(null)
  /** Risk ids flagged for PI planning (saved on the backend for a live run). */
  const [flags, setFlags] = useState<string[]>([])
  const [pending, setPending] = useState<'approve' | 'challenge' | null>(null)
  /** The planner's notes, sizes, placements and decisions, and what the current run was started with. */
  const plannerState = usePlannerState()
  const [sent, setSent] = useState<PlannerInput | null>(null)
  // Mirrors `selected` synchronously, so back-to-back uploads see each other's picks.
  const selectedRef = useRef<string[]>([])
  // Read by the poll loop, which must not restart when a review is sent.
  const pendingRef = useRef<'approve' | 'challenge' | null>(null)
  const rerunRef = useRef<Rerun | null>(null)
  const readyRef = useRef(readyStatuses)
  readyRef.current = readyStatuses
  const initiativesRef = useRef(initiatives)
  initiativesRef.current = initiatives

  const notify = useCallback((...next: Notice[]) => setNotices((prev) => [...next, ...prev].slice(0, 30)), [])
  // Intake lists every message; the other screens only the ones raised after leaving it (a rerun, an error).
  const [seenNotice, setSeenNotice] = useState(0)
  const prevScreen = useRef<Screen>('intake')
  const noticesRef = useRef(notices)
  noticesRef.current = notices

  const updateSelection = useCallback((fn: (prev: string[]) => string[]) => {
    const next = fn(selectedRef.current)
    selectedRef.current = next
    setSelected(next)
    return next
  }, [])

  /** Ticks new ready initiatives while there is room under the per-run limit; returns how many fit. */
  const autoSelect = useCallback((ids: string[], pool?: Initiative[]) => {
    const byId = new Map((pool ?? initiativesRef.current).map((i) => [i.id, i]))
    const ok = ids.filter((id) => { const i = byId.get(id); return !i || isReady(i, readyRef.current) })
    const before = selectedRef.current.length
    const after = updateSelection((prev) => {
      const room = Math.max(0, limits.perRun - prev.length)
      return [...prev, ...ok.filter((id) => !prev.includes(id)).slice(0, room)]
    })
    return after.length - before
  }, [limits.perRun, updateSelection])

  // Connects to the backend once; without one, the app works from uploaded files as before.
  useEffect(() => {
    let live = true // StrictMode runs effects twice in dev; only the last run applies
    Promise.all([api.health(), api.initiatives(), api.sources()])
      .then(([health, raw, reports]) => {
        if (!live) return
        const inis = raw.map(toInitiative)
        const used = reports.filter(isLoaded)
        const broken = reports.filter((r) => r.status === 'invalid' || r.status === 'missing').map((r) => r.id)
        const perRun = health.limits.max_initiatives_per_run
        const statuses = health.ready_statuses?.length ? health.ready_statuses : DEFAULT_READY
        const ready = inis.filter((i) => isReady(i, statuses))
        setConnected(true)
        setLimits({ perRun, perUpload: health.limits.max_upload_initiatives ?? DEFAULT_LIMITS.perUpload })
        setReadyStatuses(statuses)
        if (health.planning) setScale({ tshirt: Object.entries(health.planning.tshirt_points).map(([size, points]) => ({ size, points })) })
        setInitiatives(inis)
        // Every ready initiative is ticked when they fit in one run: hidden dependencies only show across the set.
        updateSelection(() => (ready.length <= perRun ? ready.map((i) => i.id) : []))
        setSources(reports.map(toSource))
        notify(notice('ok',
          `Connected: ${inis.length} initiatives, ${ready.length} ready for PI planning · knowledge base ${used.length} sources`
          + (broken.length ? ` (not loaded: ${broken.join(', ')})` : '')
          + (health.llm.enabled ? ` · LLM ${health.llm.model}` : ' · rule-based (no ANTHROPIC_API_KEY in backend/.env)')
          + (ready.length > perRun ? ` · tick up to ${perRun} initiatives to analyse` : '')))
        api.reviewers()
          .then((people) => {
            if (!live) return
            setReviewers(people)
            setReviewerId((people.find((p) => p.can_approve) ?? people[0])?.id ?? '')
          })
          .catch(() => undefined) // review stays unavailable; the rest of the app works
      })
      .catch(() => {
        if (live) notify(notice('error', 'Backend not reachable on port 8000: working from uploaded files only.'))
      })
    return () => { live = false }
  }, [notify, updateSelection])

  // A new screen starts at its top.
  useEffect(() => {
    window.scrollTo({ top: 0 })
    if (prevScreen.current === 'intake' && screen !== 'intake') setSeenNotice(Math.max(0, ...noticesRef.current.map((n) => n.id)))
    prevScreen.current = screen
  }, [screen])

  // Replays a loaded analysis file one agent at a time.
  useEffect(() => {
    if (fromBackend || run.status !== 'running' || !analysis) return
    if (run.current >= analysis.agents.length) {
      setRun({ status: 'done', current: analysis.agents.length })
      return
    }
    const t = setTimeout(() => setRun((r) => ({ ...r, current: r.current + 1 })), STEP_MS)
    return () => clearTimeout(t)
  }, [run, analysis, fromBackend])

  // Polls a backend run until it stops running: first the agents, then again after each review or rerun.
  useEffect(() => {
    if (!liveRunId) return
    let stop = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const endRerun = () => { rerunRef.current = null; setRerunning(false) }
    const tick = async () => {
      try {
        const view = await api.runAnalysis(liveRunId)
        if (stop) return
        const rerun = rerunRef.current
        // A rerun keeps the current results on screen until the new run has finished.
        if (rerun && view.status === 'running') { timer = setTimeout(tick, POLL_MS); return }
        const reviewing = pendingRef.current
        if (view.status === 'failed') {
          setLiveRunId(null)
          pendingRef.current = null
          setPending(null)
          notify(notice('error', `${rerun ? 'Rerun' : 'Analysis'} failed: ${view.error ?? 'unknown error'}`))
          if (rerun) { endRerun(); return } // the previous results stay
          if (!reviewing && view.analysis) {
            try { setAnalysis(normalizeAnalysis(view.analysis)) } catch { /* keep the last poll's view */ }
          }
          setRun({ status: 'idle', current: view.current, failed: true })
          setRunStatus(view.status)
          if (reviewing) setReviewError(`The run failed after the review: ${view.error ?? 'unknown error'}`)
          return
        }
        const next = normalizeAnalysis(view.analysis)
        setAnalysis(next)
        setRunStatus(view.status)
        setReview(view.review ?? NO_REVIEW)
        setFlags(view.flags ?? [])
        if (view.status !== 'running') {
          setRun({ status: 'done', current: next.agents.length })
          setLiveRunId(null)
          pendingRef.current = null
          setPending(null)
          if (rerun) {
            setRunId(liveRunId)
            setRunSize(view.initiative_ids.length)
            setSent(rerun.sent)
            // Risk ids are stable across runs: flag again the ones the new run still raises.
            const still = new Set(next.risks.map((r) => r.id))
            const carry = rerun.flags.filter((f) => still.has(f))
            if (carry.length) {
              setFlags(carry)
              carryFlags(liveRunId, carry, rerun.reviewer)
                .then(setFlags)
                .catch((e) => notify(notice('error', `Could not carry the flagged risks over to the rerun: ${message(e)}`)))
            }
            const flagged = rerun.flags.length
              ? ` · ${carry.length} of ${plural(rerun.flags.length, 'flagged risk')} carried over` : ''
            notify(notice('ok', `Rerun complete${rerun.describe ? ` with ${rerun.describe}` : ''}: ${rerunDiff(rerun.before, next)}${flagged}`))
            endRerun()
          }
          return
        }
        // While a review is acted on, the results stay open; only a first run shows progress.
        if (!reviewing) setRun({ status: 'running', current: view.current })
      } catch (e) {
        if (stop) return
        if (rerunRef.current) endRerun()
        else setRun((r) => ({ ...r, status: r.status === 'running' ? 'idle' : r.status }))
        setLiveRunId(null)
        pendingRef.current = null
        setPending(null)
        notify(notice('error', `Lost the analysis run: ${message(e)}`))
        return
      }
      timer = setTimeout(tick, POLL_MS)
    }
    tick()
    return () => { stop = true; clearTimeout(timer) }
  }, [liveRunId, notify])

  const startRun = useCallback(() => {
    setRun({ status: 'running', current: 0 })
    setScreen('pipeline')
  }, [])

  /** The initiatives of the current run, else the ticked ones in list order. */
  const runIds = () => (analysis?.initiatives.length && fromBackend
    ? analysis.initiatives.map((i) => i.id)
    : initiatives.map((i) => i.id).filter((id) => selected.includes(id)))

  /**
   * Starts a backend run with the planner's input. `show` opens the Analysis screen and follows the
   * agents; `rerun` keeps the current results on screen and swaps them in when the new run is done.
   */
  const startBackendRun = async (ids: string[], mode: 'show' | 'rerun' = 'show') => {
    if (starting || rerunning) return // one click, one run
    const input = plannerState.input
    if (mode === 'rerun') setRerunning(true)
    else setStarting(true)
    try {
      const id = await api.startRun(ids, input)
      if (mode === 'rerun') {
        rerunRef.current = { before: analysis, sent: input, describe: describeChanges(input, sent ?? EMPTY_PLANNER),
                             flags, reviewer: reviewerId }
        setLiveRunId(id)
        return
      }
      const first = await api.runAnalysis(id) // so the Analysis screen opens with the agents listed
      setAnalysis(normalizeAnalysis(first.analysis))
      setFromBackend(true)
      setRunId(id)
      setRunStatus(first.status)
      setReview(first.review ?? NO_REVIEW)
      setFlags(first.flags ?? [])
      setReviewError(null)
      setSent(input)
      setRunSize(first.initiative_ids.length || ids.length) // the first poll can come before the run has state
      setRun({ status: 'running', current: first.current })
      setLiveRunId(id)
      setScreen('pipeline')
    } catch (e) {
      if (mode === 'rerun') setRerunning(false)
      notify(notice('error', `Could not start the ${mode === 'rerun' ? 'rerun' : 'analysis'}: ${message(e)}`))
    } finally {
      setStarting(false)
    }
  }

  // One stable callback, so the planner API (and every screen using it) is not rebuilt each render.
  const rerunNow = useRef<() => void>(() => {})
  rerunNow.current = () => { void startBackendRun(runIds(), 'rerun') }
  const rerun = useCallback(() => rerunNow.current(), [])
  const planner = usePlannerApi(plannerState, fromBackend ? sent : null, {
    canRerun: connected && fromBackend && !!runId && !liveRunId,
    rerunning,
    rerun,
  })

  const loadAnalysisFile = (loaded: Analysis) => {
    setAnalysis(loaded)
    setFromBackend(false)
    setLiveRunId(null)
    setRunId(null)
    setRunStatus(null)
    setReview(NO_REVIEW)
    setFlags([])
    // loaded from the Analysis screen -> run it straight away
    if (screen === 'pipeline') {
      setRun({ status: 'running', current: 0 })
    } else setRun({ status: 'idle', current: 0 })
  }

  /** Approve exports the proposals; a challenge re-sequences with the reviewer's constraint. Either way, poll again. */
  const submitReview = async (body: ReviewBody) => {
    if (!runId) return
    setReviewError(null)
    try {
      await api.review(runId, reviewerId, body)
      pendingRef.current = body.action
      setPending(body.action)
      setRunStatus('running')
      setLiveRunId(runId)
    } catch (e) {
      setReviewError(message(e))
    }
  }

  const toggleFlag = (id: string) => {
    const on = !flags.includes(id)
    setFlags((f) => (on ? [...f, id] : f.filter((x) => x !== id)))
    if (!fromBackend || !runId) return // a replayed file: the flag lives in this page and in Export
    api.flag(runId, id, on, reviewerId || undefined)
      .then(setFlags)
      .catch((e) => {
        setFlags((f) => (on ? f.filter((x) => x !== id) : [...f, id]))
        setReviewError(`Could not save the flag: ${message(e)}`)
      })
  }

  const reloadSources = async () => {
    setReloadingSources(true)
    try {
      const [reports, raw] = await Promise.all([api.reloadSources(), api.initiatives()])
      const inis = raw.map(toInitiative)
      setSources(reports.map(toSource))
      setInitiatives(inis)
      const ok = new Set(inis.filter((i) => isReady(i, readyStatuses)).map((i) => i.id))
      updateSelection((s) => s.filter((id) => ok.has(id)))
      notify(notice('ok', `Reloaded the data folder: ${inis.length} initiatives (${ok.size} ready), ${reports.filter(isLoaded).length} sources in the knowledge base`))
    } catch (e) {
      notify(notice('error', `Could not reload the sources: ${message(e)}`))
    } finally {
      setReloadingSources(false)
    }
  }

  /** Tells the user how many new initiatives were ticked and how many wait for room. */
  const selectionNotice = (name: string, list: Initiative[]) => {
    const ready = list.filter((i) => isReady(i, readyStatuses))
    const fitted = autoSelect(ready.map((i) => i.id), [...initiatives, ...list])
    if (fitted < ready.length) {
      notify(notice('error', `${name}: ${fitted} of ${ready.length} new ready initiatives selected; one analysis takes at most ${limits.perRun}.`))
    }
    if (ready.length < list.length) {
      notify(notice('ok', `${name}: ${list.length - ready.length} initiatives are not ready for PI planning (Proposed or In Discovery) and are listed for reference only`))
    }
  }

  const loadFiles = async (files: File[]) => {
    if (!files.length) return
    if (!connected) {
      const result = await ingestFiles(files, { maxInitiativesPerFile: limits.perUpload })
      setInitiatives((prev) => mergeById(prev, result.initiatives))
      setSources((prev) => mergeById(prev, result.sources))
      notify(...result.notices)
      if (result.initiatives.length) selectionNotice('Upload', result.initiatives)
      if (result.analysis) loadAnalysisFile(result.analysis)
      return
    }
    // Connected: an initiatives CSV is added on the backend so it can be analysed, an analysis
    // JSON is replayed as before, and knowledge sources come from the backend's data folder.
    for (const f of files) {
      const local = await ingestFiles([f])
      if (f.name.toLowerCase().endsWith('.csv') && local.initiatives.length) {
        try {
          const res = await api.uploadInitiatives(f)
          const added = res.added.map(toInitiative)
          setInitiatives((prev) => mergeById(prev, added))
          notify(res.skipped
            ? notice('error', `${f.name}: added the first ${added.length} initiatives; ${res.skipped} skipped (limit ${res.limit} per file)`)
            : notice('ok', `${f.name}: added ${added.length} initiatives on the backend`))
          selectionNotice(f.name, added)
        } catch (e) {
          notify(notice('error', `${f.name}: ${message(e)}`))
        }
      } else if (local.analysis) {
        loadAnalysisFile(local.analysis)
        notify(...local.notices)
      } else {
        notify(notice('error', `${f.name}: not loaded. The backend reads knowledge sources from its data folder: put the file there and use "Reload from the data folder".`))
      }
    }
  }

  const addInitiative = async (title: string, description: string) => {
    if (!connected) {
      const id = `manual-${Date.now()}`
      const added: Initiative = { id, title, description }
      setInitiatives((list) => [...list, added])
      selectionNotice(title, [added])
      return
    }
    try {
      const added = toInitiative(await api.addInitiative(title, description))
      setInitiatives((list) => [...list, added])
      selectionNotice(title, [added])
    } catch (e) {
      notify(notice('error', `Could not add "${title}": ${message(e)}`))
    }
  }

  // In list order, so the run reads the same way as the Intake screen.
  const runIdsFromSelection = () => initiatives.map((i) => i.id).filter((id) => selected.includes(id))
  const analyse = () => (connected ? startBackendRun(runIdsFromSelection()) : analysis ? startRun() : setScreen('pipeline'))

  const enabled: Record<Screen, boolean> = {
    intake: true,
    pipeline: initiatives.length > 0 || analysis !== null,
    results: run.status === 'done',
    dashboard: run.status === 'done' && !!analysis?.plan,
  }
  const analysedCount = fromBackend ? runSize : analysis?.initiatives.length || initiatives.length

  const toggle = (id: string) => updateSelection((prev) => {
    if (prev.includes(id)) return prev.filter((x) => x !== id)
    const ini = initiatives.find((i) => i.id === id)
    if (ini && !isReady(ini, readyStatuses)) return prev // not ready for PI planning: cannot be analysed
    return prev.length < limits.perRun ? [...prev, id] : prev
  })
  const remove = (ids: string[]) => {
    setInitiatives((l) => l.filter((i) => !ids.includes(i.id)))
    updateSelection((s) => s.filter((id) => !ids.includes(id)))
  }

  /** The analysed initiatives (not the whole intake list), the flagged risks, the planner input and the results. */
  const exportAnalysis = () => {
    const ids = new Set(analysis?.initiatives.map((i) => i.id) ?? [])
    downloadJson('pi-analysis.json', {
      runId,
      initiatives: ids.size ? initiatives.filter((i) => ids.has(i.id)) : initiatives,
      flaggedRisks: flags,
      planner: plannerState.input,
      analysis,
    })
  }

  const actions =
    screen === 'results' ? (
      <>
        <Tip title="Export the analysis" content="Downloads the analysed initiatives, flagged risks, your notes and the results as one JSON file. Upload it on the Intake screen to replay this analysis without the backend.">
          <button className="btn btn-ghost btn-sm" onClick={exportAnalysis}>
            <i className="ti ti-download" aria-hidden="true" /> Export
          </button>
        </Tip>
        <button
          className="btn btn-ghost btn-sm"
          onClick={() => { setRun({ status: 'idle', current: 0 }); setScreen('intake') }}
        >
          <i className="ti ti-refresh" aria-hidden="true" /> New analysis
        </button>
      </>
    ) : null

  const reviewPanel = fromBackend && runId ? (
    <>
      <ReviewPanel
        runId={runId}
        status={runStatus}
        pending={pending}
        review={review}
        reviewers={reviewers}
        reviewerId={reviewerId}
        onReviewer={setReviewerId}
        initiatives={analysis?.initiatives ?? []}
        onApprove={(note) => submitReview({ action: 'approve', note })}
        onChallenge={(first, then, note) => submitReview({ action: 'challenge', constraint: { first, then, note } })}
      />
      {reviewError && (
        <div className="notice error review-error" role="alert">
          <i className="ti ti-alert-circle" aria-hidden="true" /><span>{reviewError}</span>
          <button className="icon-btn" aria-label="Dismiss" onClick={() => setReviewError(null)}><i className="ti ti-x" aria-hidden="true" /></button>
        </div>
      )}
    </>
  ) : undefined

  return (
    <SectionsProvider>
      <div className={`page${nav.collapsed ? ' nav-collapsed' : ''}`}>
        <SideNav screen={screen} enabled={enabled} onNavigate={setScreen} collapsed={nav.collapsed}
          onToggle={() => setNav((n) => ({ ...n, collapsed: !n.collapsed }))} />
        <div className="screen">
          <TopBar current={screen} enabled={enabled} onNavigate={setScreen} onHelp={() => setHelpOpen(true)}>
            {actions}
          </TopBar>
          <Notices notices={screen === 'intake' ? notices : notices.filter((n) => n.id > seenNotice).slice(0, 3)}
            onDismiss={(id) => setNotices((l) => l.filter((n) => n.id !== id))} onClear={() => setNotices([])} />

          {screen === 'intake' && (
            <IntakeScreen
              initiatives={initiatives}
              selected={selected}
              limit={limits.perRun}
              uploadLimit={limits.perUpload}
              readyStatuses={readyStatuses}
              scale={scale}
              connected={connected}
              starting={starting}
              reloadingSources={reloadingSources}
              onReloadSources={reloadSources}
              sources={sources}
              plannerSummary={describeChanges(plannerState.input, EMPTY_PLANNER)}
              onToggle={toggle}
              onSelect={(ids) => autoSelect(ids)}
              onClearSelection={() => updateSelection(() => [])}
              onRemoveAll={() => remove(initiatives.map((i) => i.id))}
              onAdd={addInitiative}
              onRemove={(id) => remove([id])}
              onRemoveSource={(id) => setSources((l) => l.filter((s) => s.id !== id))}
              onFiles={loadFiles}
              onAnalyse={analyse}
            />
          )}
          {screen === 'pipeline' && (
            <PipelineScreen
              analysis={analysis}
              run={run}
              initiativeCount={analysedCount}
              onFiles={loadFiles}
              live={fromBackend}
              starting={starting}
              onStart={fromBackend ? () => { void startBackendRun(runIds()) } : startRun}
              onViewResults={() => setScreen('results')}
              onBack={() => setScreen('intake')}
              onHelp={() => setHelpOpen(true)}
            />
          )}
          {screen === 'results' && (
            <ResultsScreen
              analysis={analysis}
              initiativeCount={analysedCount}
              onViewAnalysis={() => setScreen('pipeline')}
              onOpenDashboard={() => setScreen('dashboard')}
              onBack={() => setScreen('intake')}
              flags={flags}
              onToggleFlag={toggleFlag}
              review={reviewPanel}
              planner={planner}
            />
          )}
          {screen === 'dashboard' && (
            <DashboardScreen
              analysis={analysis}
              planner={planner}
              onBackToResults={() => setScreen('results')}
              onBack={() => setScreen('intake')}
            />
          )}
        </div>
      </div>

      {helpOpen && <HelpDrawer screen={screen} onClose={() => setHelpOpen(false)} />}
    </SectionsProvider>
  )
}
