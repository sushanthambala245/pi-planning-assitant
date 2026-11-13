import { useMemo, useRef, useState } from 'react'
import { AgentDetail } from '../components/AgentDetail'
import { AgentPipeline, type AgentWithState } from '../components/AgentPipeline'
import { EmptyState } from '../components/EmptyState'
import { FindingGroups } from '../components/FindingGroups'
import { InitiativeFilter } from '../components/InitiativeFilter'
import { InitiativeSummary } from '../components/InitiativeSummary'
import { Section } from '../components/Section'
import { Tip } from '../components/Tip'
import { FINDING_KIND, countBy, depLabel, findingInitiatives } from '../lib/deps'
import { useSections } from '../lib/sections'
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

const KIND_HINT: Record<string, string> = {
  systems: 'Which shared systems each initiative touches (declared in its dependency column or named in its text), and who owns them.',
  explicit: 'Dependencies stated in a description or a planner note, but not declared in the dependency column.',
  inferred: 'Dependencies nobody wrote down: found in the GitHub manifests or through a system two initiatives share.',
  rejected: 'Candidates the verifier dropped: too little evidence, a quote that is not in the source, or dismissed by a planner.',
  sequence: 'The order the sequencing agent worked out, and why initiatives moved.',
  risk: 'Risk flags from the Dependency Risk Index rules.',
}

export function PipelineScreen({ analysis, run, initiativeCount, onFiles, live, starting = false, onStart, onViewResults, onBack, onHelp }: Props) {
  const [selected, setSelected] = useState<string | null>(null)
  const [initiative, setInitiative] = useState('')
  const [kinds, setKinds] = useState<Set<string>>(new Set())
  const [hideNoChange, setHideNoChange] = useState(true)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const fileInput = useRef<HTMLInputElement>(null)
  const { jump } = useSections()

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
  const focus =
    agents.find((a) => a.id === selected) ??
    agents.find((a) => a.state === 'active' || a.state === 'failed') ??
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
  const openInitiative = (id: string) => { setInitiative(id); jump('findings') }

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

          <Section id="by-initiative" title="By initiative" icon="ti-layout-grid" count={initiatives.length}
            tip="One card per initiative, grouped by release train (ART): the systems it touches and who owns them, what its dependencies ask of other teams, how many are hidden, and its risks. Open a release train to see its initiatives.">
            <InitiativeSummary analysis={analysis} initiatives={initiatives} onOpen={openInitiative} />
          </Section>

          <Section id="findings" title="All findings" icon="ti-list-details" count={shown.length} defaultOpen={false}
            tip="Every finding the agents emitted, grouped under the initiative it is about. Filter by kind; hover a finding for a preview, double-click it (or press Enter) to keep the details open.">
            <div className="chip-bar">
              {Object.keys(FINDING_KIND).filter((k) => kindCounts[k]).map((k) => (
                <Tip key={k} title={FINDING_KIND[k]} content={KIND_HINT[k] ?? ''}>
                  <button className={`chip${kinds.has(k) ? ' on' : ''}`} aria-pressed={kinds.has(k)} onClick={() => flipKind(k)}>
                    {FINDING_KIND[k]} <span className="chip-n">{kindCounts[k]}</span>
                  </button>
                </Tip>
              ))}
              {kinds.size > 0 && <button className="link-btn" onClick={() => setKinds(new Set())}>All types</button>}
              <Tip title="Hide no-change links" content="Hides dependencies that need nobody to build, agree or re-test anything (awareness only).">
                <label className="toggle">
                  <input type="checkbox" checked={hideNoChange} onChange={(e) => setHideNoChange(e.target.checked)} />
                  Hide no-change links{hiddenNoChange > 0 && ` (${hiddenNoChange})`}
                </label>
              </Tip>
              <span className="chip-bar-end">
                <button className="link-btn" onClick={() => setExpanded(new Set(shown.map((f) => f.text)))}>
                  <i className="ti ti-arrows-maximize" aria-hidden="true" /> Expand all
                </button>
                <button className="link-btn" onClick={() => setExpanded(new Set())}>
                  <i className="ti ti-arrows-minimize" aria-hidden="true" /> Collapse all
                </button>
              </span>
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
          </Section>

          {analysis.sourcesUsed.length > 0 && run.current > 0 && (
            <Section id="sources-used" title="Knowledge sources used" icon="ti-database" count={analysis.sourcesUsed.length} defaultOpen={false}
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
    </div>
  )
}
