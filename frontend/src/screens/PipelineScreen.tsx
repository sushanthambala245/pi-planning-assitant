import { useMemo, useRef, useState } from 'react'
import { AgentDetail } from '../components/AgentDetail'
import { AgentPipeline, type AgentWithState } from '../components/AgentPipeline'
import { EmptyState } from '../components/EmptyState'
import { InitiativeAnalysisPanel } from '../components/InitiativeAnalysisPanel'
import { InitiativeFilter } from '../components/InitiativeFilter'
import { InitiativeSummary } from '../components/InitiativeSummary'
import { Section } from '../components/Section'
import { Tip } from '../components/Tip'
import { depLabel, needsChange, plural } from '../lib/deps'
import type { Analysis, Run } from '../types'

interface Props {
  analysis: Analysis | null
  run: Run
  initiativeCount: number
  onFiles: (files: File[]) => void
  /** The analysis comes from a backend run: running it again starts a new run. */
  live: boolean
  /** A new backend run is being started. */
  starting?: boolean
  onStart: () => void
  onViewResults: () => void
  onBack: () => void
  onHelp: () => void
}

export function PipelineScreen({ analysis, run, initiativeCount, onFiles, live, starting = false, onStart, onViewResults, onBack, onHelp }: Props) {
  const [selected, setSelected] = useState<string | null>(null)
  const [initiative, setInitiative] = useState('')
  const [panel, setPanel] = useState<string | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)

  const depsByKey = useMemo(() => new Map((analysis?.dependencies ?? []).map((d) => [d.key, d])), [analysis])

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
        {initiativeCount} initiative{initiativeCount === 1 ? ' is' : 's are'} ready, but the backend is not reachable, so the agents cannot run here.
        Start the backend (see the README) and reload the page, or upload a saved analysis result (.json) to replay it.
        <input ref={fileInput} type="file" accept=".json,.zip" hidden onChange={(e) => { onFiles(Array.from(e.target.files ?? [])); e.target.value = '' }} />
      </EmptyState>
    )
  }

  const total = analysis.agents.length
  const agents: AgentWithState[] = analysis.agents.map((a, i) => ({
    ...a,
    state: run.status === 'done' || i < run.current ? 'done'
      : i === run.current && run.status === 'running' ? 'active' : i === run.current && run.failed ? 'failed' : 'wait',
  }))
  const done = agents.filter((a) => a.state === 'done').length
  // While it runs, follow the active agent; once done, show a detail only for the agent the user picks.
  const focus =
    agents.find((a) => a.id === selected) ??
    agents.find((a) => a.state === 'active' || a.state === 'failed') ??
    (run.status === 'done' ? undefined : [...agents].reverse().find((a) => a.state === 'done') ?? agents[0])

  // A replayed file reveals its findings in step with the agents; a live run already does.
  const revealed =
    run.status === 'done' ? analysis.findings : analysis.findings.slice(0, Math.ceil((analysis.findings.length * run.current) / Math.max(total, 1)))
  const totalMs = analysis.agents.reduce((s, a) => s + (a.durationMs ?? 0), 0)
  const running = run.status === 'running'

  const initiatives = initiative ? analysis.initiatives.filter((i) => i.id === initiative) : analysis.initiatives
  const labelOf = (key: string) => {
    const d = depsByKey.get(key)
    return d ? depLabel(d) : key
  }

  // One line for the closed "By initiative" section: what the run found, counted once.
  const deps = analysis.dependencies
  const systemCount = new Set(analysis.findings.flatMap((f) => f.systems ?? []).map((s) => s.name)).size
  const needChange = deps.filter((d) => needsChange(d.changeType)).length
  const byInitiativeSummary = `${plural(systemCount, 'system')} · ${plural(deps.length, 'link')}, ${needChange} need a change · ${plural(analysis.risks.length, 'risk')}`

  return (
    <div className="s2-body">
      <div className="run-bar">
        <div>
          <div className="run-title">
            {running ? 'Analysing initiatives…' : run.status === 'done' ? 'Analysis complete'
              : run.failed ? `Analysis failed at ${analysis.agents[run.current]?.name ?? 'an agent'}` : 'Ready to analyse'}
          </div>
          <div className="run-sub">
            {initiativeCount} initiative{initiativeCount === 1 ? '' : 's'} · {total} agents
            {run.status === 'done' && totalMs > 0 && ` · ${(totalMs / 1000).toFixed(1)}s total`}
          </div>
        </div>
        <div className="cta-actions">
          <InitiativeFilter initiatives={analysis.initiatives} value={initiative} onChange={setInitiative} />
          <button className="btn btn-ghost" onClick={onBack}><i className="ti ti-arrow-left" aria-hidden="true" /> Back to intake</button>
          <Tip title={live ? 'Run again' : 'Replay'} content={live
            ? 'Starts a new backend run of the same initiatives with the data as it is now, and with your notes, sizes, quarter placements and keep / dismiss decisions. It uses LLM calls again when a key is set.'
            : 'Replays the loaded analysis file from the first agent.'}>
            <button className="btn btn-ghost" onClick={onStart} disabled={running || starting}>
              <i className={`ti ${starting ? 'ti-loader-2 spin' : run.status === 'idle' ? 'ti-player-play' : 'ti-refresh'}`} aria-hidden="true" />
              {starting ? 'Starting…' : run.status === 'idle' ? 'Start analysis' : live ? 'Run again' : 'Replay'}
            </button>
          </Tip>
          <button className="btn btn-primary" onClick={onViewResults} disabled={run.status !== 'done'}>
            <i className="ti ti-chart-dots" aria-hidden="true" /> View results
          </button>
        </div>
      </div>

      {total === 0 ? (
        <div className="list-empty">The analysis file doesn’t describe any agents.</div>
      ) : (
        <>
          <Section id="agents" title="Agent workflow" icon="ti-topology-star-3" count={`${done}/${total}`} tone="accent"
            tip="The agents run in order: the analyser maps each initiative to the systems it touches; discovery reads the declared dependencies, the descriptions, GitHub and the ownership lookup; the verifier checks the evidence; sequencing schedules by quarter at each team’s velocity; the risk agent applies the Dependency Risk Index rules. Click an agent for what it read, found and decided.">
            <AgentPipeline agents={agents} selectedId={focus?.id ?? null} onSelect={setSelected} />
            {!focus && <div className="agent-hint">Select an agent to see what it read, found and how long it took.</div>}
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
          </Section>

          <Section id="by-initiative" title="By initiative" icon="ti-layout-grid" count={initiatives.length} defaultOpen={false}
            summary={byInitiativeSummary}
            tip="One card per initiative, grouped by release train (ART). Open a release train to see its initiatives, and click one for the systems it touches and who owns them, everything the agents found about it, and its risks.">
            <InitiativeSummary analysis={analysis} initiatives={initiatives} onOpen={setPanel} />
          </Section>

          {analysis.sourcesUsed.length > 0 && run.current > 0 && (
            <Section id="sources-used" title="Knowledge sources used" icon="ti-database" count={analysis.sourcesUsed.length} defaultOpen={false}
              summary={analysis.sourcesUsed.map((s) => s.text.split(' — ')[0]).slice(0, 4).join(', ') + (analysis.sourcesUsed.length > 4 ? ', …' : '')}
              tip="The files this run read, with their row counts.">
              {analysis.sourcesUsed.map((s) => (
                <div className="finding-card" key={s.text}>
                  <div className="kb-used"><i className={`ti ${s.icon}`} aria-hidden="true" />{s.text}</div>
                </div>
              ))}
            </Section>
          )}
        </>
      )}

      {panel && (
        <InitiativeAnalysisPanel analysis={analysis} initiativeId={panel} findings={revealed} depsByKey={depsByKey} labelOf={labelOf}
          onClose={() => setPanel(null)} />
      )}
    </div>
  )
}
