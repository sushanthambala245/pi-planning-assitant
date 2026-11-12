import { useCallback, useEffect, useRef, useState } from 'react'
import { api, commentsCsvUrl, isLoaded, toInitiative, toSource, type ReviewBody, type RunStatus } from './api/client'
import { HelpDrawer } from './components/HelpDrawer'
import { ReviewPanel } from './components/ReviewPanel'
import { TopBar } from './components/TopBar'
import { useComments } from './hooks/useComments'
import { normalizeAnalysis } from './lib/analysis'
import { ingestFiles, notice } from './lib/ingest'
import { IntakeScreen } from './screens/IntakeScreen'
import { PipelineScreen } from './screens/PipelineScreen'
import { ResultsScreen } from './screens/ResultsScreen'
import type { Analysis, Initiative, KnowledgeSource, Notice, Reviewer, ReviewState, Run, Screen } from './types'

/** How long each agent "runs" while a loaded analysis is replayed. */
const STEP_MS = 1200
/** How often a backend run is polled for progress. */
const POLL_MS = 800
/** Defaults until the backend reports its own limits (backend/app/config.py). */
const DEFAULT_LIMITS = { perRun: 15, perUpload: 100 }
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

export default function App() {
  const [screen, setScreen] = useState<Screen>('intake')
  const [initiatives, setInitiatives] = useState<Initiative[]>([])
  const [sources, setSources] = useState<KnowledgeSource[]>([])
  const [analysis, setAnalysis] = useState<Analysis | null>(null)
  const [run, setRun] = useState<Run>({ status: 'idle', current: 0 })
  const [notices, setNotices] = useState<Notice[]>([])
  const [helpOpen, setHelpOpen] = useState(false)
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
  const [reloadingSources, setReloadingSources] = useState(false)
  /** Initiatives ticked for the next analysis, at most limits.perRun. */
  const [selected, setSelected] = useState<string[]>([])
  const [limits, setLimits] = useState(DEFAULT_LIMITS)
  const [review, setReview] = useState<ReviewState>(NO_REVIEW)
  const [reviewers, setReviewers] = useState<Reviewer[]>([])
  const [reviewerId, setReviewerId] = useState('')
  const [reviewError, setReviewError] = useState<string | null>(null)
  /** Risk ids flagged for PI planning (saved on the backend for a live run). */
  const [flags, setFlags] = useState<string[]>([])
  const [pending, setPending] = useState<'approve' | 'challenge' | null>(null)
  const [llmStatus, setLlmStatus] = useState<{ enabled: boolean; provider: string; model: string } | null>(null)
  // Mirrors `selected` synchronously, so back-to-back uploads see each other's picks.
  const selectedRef = useRef<string[]>([])
  // Read by the poll loop, which must not restart when a review is sent.
  const pendingRef = useRef<'approve' | 'challenge' | null>(null)

  // Live feedback per initiative: polled from the backend run, or kept in this browser for a replayed file.
  const who = reviewers.find((r) => r.id === reviewerId)
  const comments = useComments({
    runId: fromBackend ? runId : null,
    reviewerId: reviewerId || undefined,
    localAuthor: { name: 'You', role: 'Local' },
    localKey: analysis ? analysis.initiatives.map((i) => i.id).sort().join(',') || 'analysis' : 'none',
    active: screen === 'results',
  })
  const postingAs = fromBackend && who ? `${who.name} (${who.role})` : 'you, on this device'

  const notify = useCallback((...next: Notice[]) => setNotices((prev) => [...next, ...prev].slice(0, 30)), [])

  const updateSelection = useCallback((fn: (prev: string[]) => string[]) => {
    const next = fn(selectedRef.current)
    selectedRef.current = next
    setSelected(next)
    return next
  }, [])

  /** Ticks new initiatives while there is room under the per-run limit; returns how many fit. */
  const autoSelect = useCallback((ids: string[]) => {
    const before = selectedRef.current.length
    const after = updateSelection((prev) => {
      const room = Math.max(0, limits.perRun - prev.length)
      return [...prev, ...ids.filter((id) => !prev.includes(id)).slice(0, room)]
    })
    return after.length - before
  }, [limits.perRun, updateSelection])

  // Connects to the backend once; without one, the app works from uploaded files as before.
  useEffect(() => {
    let live = true // StrictMode runs effects twice in dev; only the last run applies
    Promise.all([api.health(), api.initiatives(), api.sources()])
      .then(([health, inis, reports]) => {
        if (!live) return
        const notLoaded = reports.filter((r) => !isLoaded(r)).map((r) => r.id)
        const perRun = health.limits.max_initiatives_per_run
        setConnected(true)
        setLlmStatus(health.llm)
        setLimits({ perRun, perUpload: health.limits.max_upload_initiatives ?? DEFAULT_LIMITS.perUpload })
        setInitiatives(inis.map(toInitiative))
        // A short list is ticked for you; a long one waits for you to choose.
        updateSelection(() => (inis.length <= perRun ? inis.map((i) => i.id) : []))
        setSources(reports.map(toSource))
        const loaded = reports.length - notLoaded.length
        notify(notice('ok',
          `Connected · ${inis.length} initiatives · ${loaded}/${reports.length} sources`
          + (notLoaded.length ? ` · ${notLoaded.length} missing` : '')))
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

  // Polls a backend run until it stops running: first the agents, then again after each review.
  useEffect(() => {
    if (!liveRunId) return
    let stop = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const tick = async () => {
      try {
        const view = await api.runAnalysis(liveRunId)
        if (stop) return
        const next = normalizeAnalysis(view.analysis)
        const reviewing = pendingRef.current
        setAnalysis(next)
        setRunStatus(view.status)
        if (view.review) setReview(view.review)
        if (view.flags) setFlags(view.flags)
        if (view.status === 'failed') {
          setRun({ status: 'idle', current: view.current })
          setLiveRunId(null)
          pendingRef.current = null
          setPending(null)
          notify(notice('error', `Analysis failed: ${view.error ?? 'unknown error'}`))
          if (reviewing) setReviewError(`The run failed after the review: ${view.error ?? 'unknown error'}`)
          return
        }
        if (view.status !== 'running') {
          setRun({ status: 'done', current: next.agents.length })
          setLiveRunId(null)
          pendingRef.current = null
          setPending(null)
          return
        }
        // While a review is acted on, the results stay open; only a first run shows progress.
        if (!reviewing) setRun({ status: 'running', current: view.current })
      } catch (e) {
        if (stop) return
        setRun((r) => ({ ...r, status: r.status === 'running' ? 'idle' : r.status }))
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

  const startBackendRun = async () => {
    if (starting) return // one click, one run
    // In list order, so the run reads the same way as the Intake screen.
    const ids = initiatives.map((i) => i.id).filter((id) => selected.includes(id))
    setStarting(true)
    try {
      const id = await api.startRun(ids)
      const first = await api.runAnalysis(id) // so the Analysis screen opens with the agents listed
      setAnalysis(normalizeAnalysis(first.analysis))
      setFromBackend(true)
      setRunId(id)
      setRunStatus(first.status)
      setReview(first.review ?? NO_REVIEW)
      setFlags(first.flags ?? [])
      setReviewError(null)
      setRunSize(first.initiative_ids.length || ids.length) // the first poll can come before the run has state
      setRun({ status: 'running', current: first.current })
      setLiveRunId(id)
      setScreen('pipeline')
    } catch (e) {
      notify(notice('error', `Could not start the analysis: ${message(e)}`))
    } finally {
      setStarting(false)
    }
  }

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
      const [reports, inis] = await Promise.all([api.reloadSources(), api.initiatives()])
      setSources(reports.map(toSource))
      setInitiatives(inis.map(toInitiative))
      const ids = new Set(inis.map((i) => i.id))
      updateSelection((s) => s.filter((id) => ids.has(id)))
      notify(notice('ok', `Reloaded the data folder: ${inis.length} initiatives, ${reports.filter(isLoaded).length} of ${reports.length} sources loaded`))
    } catch (e) {
      notify(notice('error', `Could not reload the sources: ${message(e)}`))
    } finally {
      setReloadingSources(false)
    }
  }

  /** Tells the user how many new initiatives were ticked and how many wait for room. */
  const selectionNotice = (name: string, ids: string[]) => {
    const fitted = autoSelect(ids)
    if (fitted < ids.length) {
      notify(notice('error', `${name}: ${fitted} of ${ids.length} new initiatives selected; one analysis takes at most ${limits.perRun}. Tick the rest after clearing some.`))
    }
  }

  const loadFiles = async (files: File[]) => {
    if (!files.length) return
    if (!connected) {
      const result = await ingestFiles(files, { maxInitiativesPerFile: limits.perUpload })
      setInitiatives((prev) => mergeById(prev, result.initiatives))
      setSources((prev) => mergeById(prev, result.sources))
      notify(...result.notices)
      if (result.initiatives.length) selectionNotice('Upload', result.initiatives.map((i) => i.id))
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
          selectionNotice(f.name, added.map((i) => i.id))
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
      setInitiatives((list) => [...list, { id, title, description }])
      selectionNotice(title, [id])
      return
    }
    try {
      const added = toInitiative(await api.addInitiative(title, description))
      setInitiatives((list) => [...list, added])
      selectionNotice(title, [added.id])
    } catch (e) {
      notify(notice('error', `Could not add "${title}": ${message(e)}`))
    }
  }

  const analyse = () => (connected ? startBackendRun() : analysis ? startRun() : setScreen('pipeline'))

  const enabled: Record<Screen, boolean> = {
    intake: true,
    pipeline: initiatives.length > 0 || analysis !== null,
    results: run.status === 'done',
  }
  const analysedCount = fromBackend ? runSize : analysis?.initiatives.length || initiatives.length

  const toggle = (id: string) =>
    updateSelection((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : prev.length < limits.perRun ? [...prev, id] : prev))
  const remove = (ids: string[]) => {
    setInitiatives((l) => l.filter((i) => !ids.includes(i.id)))
    updateSelection((s) => s.filter((id) => !ids.includes(id)))
  }

  /** The analysed initiatives (not the whole intake list), the flagged risks and the results. */
  const exportAnalysis = () => {
    const ids = new Set(analysis?.initiatives.map((i) => i.id) ?? [])
    downloadJson('pi-analysis.json', {
      runId,
      initiatives: ids.size ? initiatives.filter((i) => ids.has(i.id)) : initiatives,
      flaggedRisks: flags,
      comments: comments.comments,
      analysis,
    })
  }

  const actions =
    screen === 'results' ? (
      <>
        <button className="btn btn-ghost btn-sm" onClick={exportAnalysis} title="Download the analysed initiatives, flagged risks and results as JSON (it can be uploaded again to replay)">
          <i className="ti ti-download" aria-hidden="true" /> Export
        </button>
        {fromBackend && runId && comments.comments.length > 0 && (
          <a className="btn btn-ghost btn-sm" href={commentsCsvUrl(runId)} download title="Download every comment on this run as a spreadsheet">
            <i className="ti ti-message-down" aria-hidden="true" /> Comments
          </a>
        )}
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
    <div className="page">
      <div className="screen">
        <TopBar current={screen} enabled={enabled} onNavigate={setScreen} onHelp={() => setHelpOpen(true)} llmStatus={llmStatus} connected={connected}>
          {actions}
        </TopBar>

        {screen === 'intake' && (
          <IntakeScreen
            initiatives={initiatives}
            selected={selected}
            limit={limits.perRun}
            uploadLimit={limits.perUpload}
            connected={connected}
            starting={starting}
            reloadingSources={reloadingSources}
            onReloadSources={reloadSources}
            sources={sources}
            notices={notices}
            onToggle={toggle}
            onSelect={autoSelect}
            onClearSelection={() => updateSelection(() => [])}
            onRemoveAll={() => remove(initiatives.map((i) => i.id))}
            onAdd={addInitiative}
            onRemove={(id) => remove([id])}
            onRemoveSource={(id) => setSources((l) => l.filter((s) => s.id !== id))}
            onFiles={loadFiles}
            onDismissNotice={(id) => setNotices((l) => l.filter((n) => n.id !== id))}
            onClearNotices={() => setNotices([])}
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
            connected={connected}
            starting={starting}
            onStart={fromBackend ? startBackendRun : startRun}
            onViewResults={() => setScreen('results')}
            onBack={() => setScreen('intake')}
            onHelp={() => setHelpOpen(true)}
          />
        )}
        {screen === 'results' && (
          <ResultsScreen
            analysis={analysis}
            comments={{ ...comments, postingAs }}
            onViewAnalysis={() => setScreen('pipeline')}
            onBack={() => setScreen('intake')}
            flags={flags}
            onToggleFlag={toggleFlag}
            review={reviewPanel}
          />
        )}
      </div>

      {helpOpen && <HelpDrawer screen={screen} onClose={() => setHelpOpen(false)} />}
    </div>
  )
}
