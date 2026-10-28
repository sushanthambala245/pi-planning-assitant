import { useCallback, useEffect, useState } from 'react'
import { HelpDrawer } from './components/HelpDrawer'
import { TopBar } from './components/TopBar'
import { ingestFiles } from './lib/ingest'
import { IntakeScreen } from './screens/IntakeScreen'
import { PipelineScreen } from './screens/PipelineScreen'
import { ResultsScreen } from './screens/ResultsScreen'
import type { Analysis, Initiative, KnowledgeSource, Notice, Run, Screen } from './types'

/** How long each agent "runs" while a loaded analysis is replayed. */
const STEP_MS = 1200

const mergeById = <T extends { id: string }>(prev: T[], next: T[]): T[] => {
  const map = new Map(prev.map((i) => [i.id, i]))
  for (const n of next) map.set(n.id, n)
  return [...map.values()]
}

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

  // Replays the loaded analysis one agent at a time.
  useEffect(() => {
    if (run.status !== 'running' || !analysis) return
    if (run.current >= analysis.agents.length) {
      setRun({ status: 'done', current: analysis.agents.length })
      return
    }
    const t = setTimeout(() => setRun((r) => ({ ...r, current: r.current + 1 })), STEP_MS)
    return () => clearTimeout(t)
  }, [run, analysis])

  const startRun = useCallback(() => {
    setRun({ status: 'running', current: 0 })
    setScreen('pipeline')
  }, [])

  const loadFiles = async (files: File[]) => {
    if (!files.length) return
    const result = await ingestFiles(files)
    setInitiatives((prev) => mergeById(prev, result.initiatives))
    setSources((prev) => mergeById(prev, result.sources))
    setNotices((prev) => [...result.notices, ...prev].slice(0, 30))
    if (result.analysis) {
      setAnalysis(result.analysis)
      // loaded from the Analysis screen -> run it straight away
      if (screen === 'pipeline') {
        setRun({ status: 'running', current: 0 })
      } else setRun({ status: 'idle', current: 0 })
    }
  }

  const addInitiative = (title: string, description: string) =>
    setInitiatives((list) => [...list, { id: `manual-${Date.now()}`, title, description }])

  const analyse = () => (analysis ? startRun() : setScreen('pipeline'))

  const enabled: Record<Screen, boolean> = {
    intake: true,
    pipeline: initiatives.length > 0 || analysis !== null,
    results: run.status === 'done',
  }

  const actions =
    screen === 'results' ? (
      <>
        <button
          className="btn btn-ghost btn-sm"
          onClick={() => downloadJson('pi-analysis.json', { initiatives, analysis })}
        >
          <i className="ti ti-download" aria-hidden="true" /> Export
        </button>
        <button
          className="btn btn-ghost btn-sm"
          onClick={() => { setRun({ status: 'idle', current: 0 }); setScreen('intake') }}
        >
          <i className="ti ti-refresh" aria-hidden="true" /> New analysis
        </button>
      </>
    ) : null

  return (
    <div className="page">
      <div className="screen">
        <TopBar current={screen} enabled={enabled} onNavigate={setScreen} onHelp={() => setHelpOpen(true)}>
          {actions}
        </TopBar>

        {screen === 'intake' && (
          <IntakeScreen
            initiatives={initiatives}
            sources={sources}
            notices={notices}
            onAdd={addInitiative}
            onRemove={(id) => setInitiatives((l) => l.filter((i) => i.id !== id))}
            onRemoveSource={(id) => setSources((l) => l.filter((s) => s.id !== id))}
            onFiles={loadFiles}
            onDismissNotice={(id) => setNotices((l) => l.filter((n) => n.id !== id))}
            onAnalyse={analyse}
          />
        )}
        {screen === 'pipeline' && (
          <PipelineScreen
            analysis={analysis}
            run={run}
            initiativeCount={initiatives.length}
            onFiles={loadFiles}
            onStart={startRun}
            onViewResults={() => setScreen('results')}
            onBack={() => setScreen('intake')}
            onHelp={() => setHelpOpen(true)}
          />
        )}
        {screen === 'results' && (
          <ResultsScreen
            analysis={analysis}
            initiativeCount={initiatives.length}
            onViewAnalysis={() => setScreen('pipeline')}
            onBack={() => setScreen('intake')}
          />
        )}
      </div>

      {helpOpen && <HelpDrawer screen={screen} onClose={() => setHelpOpen(false)} />}
    </div>
  )
}
