import { useRef, useState } from 'react'
import { AgentDetail } from '../components/AgentDetail'
import { AgentPipeline, type AgentWithState } from '../components/AgentPipeline'
import { EmptyState } from '../components/EmptyState'
import { FindingCard } from '../components/FindingCard'
import type { Analysis, Run } from '../types'

interface Props {
  analysis: Analysis | null
  run: Run
  initiativeCount: number
  onFiles: (files: File[]) => void
  onStart: () => void
  onViewResults: () => void
  onBack: () => void
  onHelp: () => void
}

export function PipelineScreen({ analysis, run, initiativeCount, onFiles, onStart, onViewResults, onBack, onHelp }: Props) {
  const [selected, setSelected] = useState<string | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)

  if (!analysis) {
    return (
      <EmptyState
        icon="ti-plug-connected-x"
        title="No analysis result loaded"
        actions={
          <>
            <button className="btn btn-primary" onClick={() => fileInput.current?.click()}>
              <i className="ti ti-upload" aria-hidden="true" /> Upload analysis file
            </button>
            <button className="btn btn-ghost" onClick={onHelp}><i className="ti ti-help" aria-hidden="true" /> File format help</button>
            <button className="btn btn-ghost" onClick={onBack}><i className="ti ti-arrow-left" aria-hidden="true" /> Back to intake</button>
          </>
        }
      >
        {initiativeCount} initiative{initiativeCount === 1 ? ' is' : 's are'} ready, but the analysis engine isn’t connected yet.
        Upload an analysis result (.json) to see the agent workflow and results.
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

  const visibleFindings =
    run.status === 'done' ? analysis.findings : analysis.findings.slice(0, Math.ceil((analysis.findings.length * run.current) / Math.max(total, 1)))
  const totalMs = analysis.agents.reduce((s, a) => s + (a.durationMs ?? 0), 0)
  const running = run.status === 'running'

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
          <button className="btn btn-ghost" onClick={onStart} disabled={running}>
            <i className={`ti ${run.status === 'idle' ? 'ti-player-play' : 'ti-refresh'}`} aria-hidden="true" /> {run.status === 'idle' ? 'Start analysis' : 'Re-run analysis'}
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
              <div className="findings-label">{run.status === 'done' ? 'Findings' : 'Findings so far'}</div>
              {visibleFindings.length === 0 && <div className="list-empty">{running ? 'Waiting for the first findings…' : 'No findings yet.'}</div>}
              {visibleFindings.map((f) => <FindingCard key={f.text} finding={f} />)}

              {analysis.sourcesUsed.length > 0 && run.current > 0 && (
                <>
                  <div className="findings-label" style={{ marginTop: 14 }}>Knowledge sources used</div>
                  {analysis.sourcesUsed.map((s) => (
                    <div className="finding-card" key={s.text}>
                      <div className="kb-used"><i className={`ti ${s.icon}`} aria-hidden="true" />{s.text}</div>
                    </div>
                  ))}
                </>
              )}
            </div>
            <div>
              <div className="findings-label">Agent details</div>
              {focus && <AgentDetail agent={focus} findings={analysis.findings.filter((f) => f.agentId === focus.id)} />}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
