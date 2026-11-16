import { useMemo, useRef, useState } from 'react'
import { AgentDetail } from '../components/AgentDetail'
import { AgentPipeline, type AgentWithState } from '../components/AgentPipeline'
import { EmptyState } from '../components/EmptyState'
import { FindingGroups } from '../components/FindingGroups'
import { InitiativeFilter } from '../components/InitiativeFilter'
import { InitiativeSummary } from '../components/InitiativeSummary'
import { FINDING_KIND, countBy, depLabel, findingInitiatives } from '../lib/deps'
import type { Analysis, Run } from '../types'

interface Props {
  analysis: Analysis | null
  run: Run
  initiativeCount: number
  onFiles: (files: File[]) => void
  /** The analysis comes from a backend run: running it again starts a new run. */
  live: boolean
  /** Backend is reachable. */
  connected?: boolean
  /** A new backend run is being started. */
  starting?: boolean
  onStart: () => void
  onViewResults: () => void
  onBack: () => void
  onHelp: () => void
}

type View = 'summary' | 'findings'

export function PipelineScreen({ analysis, run, initiativeCount, onFiles, live, connected = false, starting = false, onStart, onViewResults, onBack, onHelp }: Props) {
  const [selected, setSelected] = useState<string | null>(null)
  const [view, setView] = useState<View>('summary')
  const [initiative, setInitiative] = useState('')
  const [kinds, setKinds] = useState<Set<string>>(new Set())
  const [hideNoChange, setHideNoChange] = useState(true)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const fileInput = useRef<HTMLInputElement>(null)

  const depsByKey = useMemo(() => new Map((analysis?.dependencies ?? []).map((d) => [d.key, d])), [analysis])

  if (!analysis) {
    if (!connected) {
      return (
        <EmptyState
          icon="ti-plug-connected-x"
          title="Backend not reachable"
          actions={
            <>
              <button className="btn btn-primary" onClick={() => fileInput.current?.click()}>
                <i className="ti ti-upload" aria-hidden="true" /> Upload analysis file
              </button>
              <button className="btn btn-ghost" onClick={onHelp}><i className="ti ti-help" aria-hidden="true" /> How to start the backend</button>
            </>
          }
        >
          Start the backend on port 8000 and reload, or upload a saved analysis result (.json) to replay it.
          <input ref={fileInput} type="file" accept=".json,.zip" hidden onChange={(e) => { onFiles(Array.from(e.target.files ?? [])); e.target.value = '' }} />
        </EmptyState>
      )
    }
    return (
      <EmptyState
        icon="ti-player-play"
        title="Ready to analyse"
        actions={
          <>
            <button className="btn btn-primary" onClick={onBack}>
              <i className="ti ti-arrow-left" aria-hidden="true" /> Go to Intake
            </button>
            <button className="btn btn-ghost" onClick={() => fileInput.current?.click()}>
              <i className="ti ti-upload" aria-hidden="true" /> Upload analysis file
            </button>
          </>
        }
      >
        {initiativeCount > 0
          ? `${initiativeCount} initiative${initiativeCount === 1 ? ' is' : 's are'} loaded. Tick the ones to analyse and click Analyse.`
          : 'Go to Intake, select the initiatives to analyse, then click Analyse.'}
        <input ref={fileInput} type="file" accept=".json,.zip" hidden onChange={(e) => { onFiles(Array.from(e.target.files ?? [])); e.target.value = '' }} />
      </EmptyState>
    )
  }

  const total = analysis.agents.length
  const agents: AgentWithState[] = analysis.agents.map((a, i) => ({
    ...a,
    state: run.status === 'done' || i < run.current ? 'done' : i === run.current && run.status === 'running' ? 'active' : 'wait',
  }))
  const focus =
    agents.find((a) => a.id === selected) ??
    agents.find((a) => a.state === 'active') ??
    [...agents].reverse().find((a) => a.state === 'done') ??
    agents[0]

  // A replayed file reveals its findings in step with the agents; a live run already does.
  const revealed =
    run.status === 'done' ? analysis.findings : analysis.findings.slice(0, Math.ceil((analysis.findings.length * run.current) / Math.max(total, 1)))
  const totalMs = analysis.agents.reduce((s, a) => s + (a.durationMs ?? 0), 0)
  const running = run.status === 'running'

  const noChange = (f: (typeof revealed)[number]) => (f.changeType ?? (f.depKey ? depsByKey.get(f.depKey)?.changeType : undefined)) === 'none'
  const forInitiative = initiative ? revealed.filter((f) => findingInitiatives(f, analysis).includes(initiative)) : revealed
  const kindCounts = countBy(forInitiative, (f) => f.kind || 'other')
  const hiddenNoChange = hideNoChange ? forInitiative.filter(noChange).length : 0
  const shown = forInitiative.filter((f) => (!kinds.size || kinds.has(f.kind)) && !(hideNoChange && noChange(f)))
  const initiatives = initiative ? analysis.initiatives.filter((i) => i.id === initiative) : analysis.initiatives

  const flipKind = (k: string) => setKinds((s) => {
    const n = new Set(s)
    if (n.has(k)) n.delete(k)
    else n.add(k)
    return n
  })
  const toggle = (text: string) => setExpanded((s) => {
    const n = new Set(s)
    if (n.has(text)) n.delete(text)
    else n.add(text)
    return n
  })
  const labelOf = (key: string) => {
    const d = depsByKey.get(key)
    return d ? depLabel(d) : key
  }
  const openInitiative = (id: string) => { setInitiative(id); setView('findings') }

  return (
    <div className="s2-body">
      <div className="run-bar">
        <div>
          <div className="run-title">
            {running ? 'Analysing initiatives…' : run.status === 'done' ? 'Analysis complete' : 'Ready to analyse'}
          </div>
          <div className="run-sub">
            {initiativeCount} initiative{initiativeCount === 1 ? '' : 's'} · {total} agents
            {run.status === 'done' && totalMs > 0 && ` · ${(totalMs / 1000).toFixed(1)}s total`}
            {' · '}Click an agent to see its details
          </div>
        </div>
        <div className="cta-actions">
          <button className="btn btn-ghost" onClick={onBack}><i className="ti ti-arrow-left" aria-hidden="true" /> Back to intake</button>
          <button
            className="btn btn-ghost"
            onClick={onStart}
            disabled={running || starting}
            title={live ? 'Starts a new backend run for the same initiatives (it uses LLM calls again)' : 'Replays the loaded analysis from the first agent'}
          >
            <i className={`ti ${starting ? 'ti-loader-2 spin' : run.status === 'idle' ? 'ti-player-play' : 'ti-refresh'}`} aria-hidden="true" />
            {starting ? 'Starting…' : run.status === 'idle' ? 'Start analysis' : live ? 'Run again (new run)' : 'Replay'}
          </button>
          <button className="btn btn-primary" onClick={onViewResults} disabled={run.status !== 'done'}>
            <i className="ti ti-chart-dots" aria-hidden="true" /> View results
          </button>
        </div>
      </div>

      {total === 0 ? (
        <div className="list-empty">The analysis file doesn’t describe any agents.</div>
      ) : (
        <>
          <AgentPipeline agents={agents} selectedId={focus?.id ?? null} onSelect={setSelected} />

          <div className="findings-grid">
            <div>
              <div className="view-bar">
                <div className="seg" role="tablist" aria-label="How to show the findings">
                  <button role="tab" aria-selected={view === 'summary'} className={`seg-btn${view === 'summary' ? ' active' : ''}`} onClick={() => setView('summary')}>
                    <i className="ti ti-layout-grid" aria-hidden="true" /> Summary
                  </button>
                  <button role="tab" aria-selected={view === 'findings'} className={`seg-btn${view === 'findings' ? ' active' : ''}`} onClick={() => setView('findings')}>
                    <i className="ti ti-layout-list" aria-hidden="true" /> Findings by initiative
                  </button>
                </div>
                <InitiativeFilter initiatives={analysis.initiatives} value={initiative} onChange={setInitiative} />
              </div>

              {view === 'summary' ? (
                <InitiativeSummary analysis={analysis} initiatives={initiatives} onOpen={openInitiative} />
              ) : (
                <>
                  <div className="chip-bar">
                    {Object.keys(FINDING_KIND).filter((k) => kindCounts[k]).map((k) => (
                      <button key={k} className={`chip${kinds.has(k) ? ' on' : ''}`} aria-pressed={kinds.has(k)} onClick={() => flipKind(k)}>
                        {FINDING_KIND[k]} <span className="chip-n">{kindCounts[k]}</span>
                      </button>
                    ))}
                    {kinds.size > 0 && <button className="link-btn" onClick={() => setKinds(new Set())}>All types</button>}
                    <label className="toggle" title="Dependencies that need nobody to build, agree or re-test anything">
                      <input type="checkbox" checked={hideNoChange} onChange={(e) => setHideNoChange(e.target.checked)} />
                      Hide no-change links{hiddenNoChange > 0 && ` (${hiddenNoChange})`}
                    </label>
                    <span className="chip-bar-end">
                      <button className="link-btn" onClick={() => setExpanded(new Set(shown.map((f) => f.text)))}>
                        <i className="ti ti-arrows-maximize" aria-hidden="true" /> Expand all
                      </button>
                      <button className="link-btn" onClick={() => setExpanded(new Set())}>
                        <i className="ti ti-arrows-minimize" aria-hidden="true" /> Collapse all
                      </button>
                    </span>
                  </div>
                  <div className="findings-hint">
                    <i className="ti ti-hand-click" aria-hidden="true" /> Hover a finding for a preview; double-click it (or press Enter) to keep the details open.
                  </div>
                  {revealed.length === 0 && <div className="list-empty">{running ? 'Waiting for the first findings…' : 'No findings yet.'}</div>}
                  <FindingGroups
                    analysis={analysis}
                    findings={shown}
                    initiatives={initiatives}
                    showShared={!initiative}
                    expanded={expanded}
                    onToggle={toggle}
                    depsByKey={depsByKey}
                    labelOf={labelOf}
                  />
                </>
              )}

              {analysis.sourcesUsed.length > 0 && run.current > 0 && (
                <details className="sources-used">
                  <summary className="findings-label">Knowledge sources used ({analysis.sourcesUsed.length})</summary>
                  {analysis.sourcesUsed.map((s) => (
                    <div className="finding-card" key={s.text}>
                      <div className="kb-used"><i className={`ti ${s.icon}`} aria-hidden="true" />{s.text}</div>
                    </div>
                  ))}
                </details>
              )}
            </div>
            <div>
              <div className="findings-label">Agent details</div>
              {focus && (
                <AgentDetail
                  key={focus.id}
                  agent={focus}
                  findings={analysis.findings.filter((f) => f.agentId === focus.id)}
                  analysis={analysis}
                  depsByKey={depsByKey}
                  labelOf={labelOf}
                />
              )}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
