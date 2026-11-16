import { useRef } from 'react'
import { InitiativeList } from '../components/InitiativeList'
import { KnowledgeBaseList } from '../components/KnowledgeBaseList'
import { Section } from '../components/Section'
import { Tip } from '../components/Tip'
import type { Scale } from '../lib/plan'
import { isReady } from '../lib/readiness'
import type { Initiative, KnowledgeSource } from '../types'

interface Props {
  initiatives: Initiative[]
  selected: string[]
  limit: number
  uploadLimit: number
  readyStatuses: string[]
  scale: Scale | null
  /** Connected to the backend: Analyse runs the selected initiatives there. */
  connected: boolean
  /** A backend run is being started: Analyse is busy. */
  starting: boolean
  reloadingSources: boolean
  onReloadSources: () => void
  sources: KnowledgeSource[]
  /** "2 notes, 1 size change": planner input saved in this browser, sent with the run. */
  plannerSummary: string
  onToggle: (id: string) => void
  onSelect: (ids: string[]) => void
  onClearSelection: () => void
  onRemoveAll: () => void
  onAdd: (title: string, description: string) => void
  onRemove: (id: string) => void
  onRemoveSource: (id: string) => void
  onFiles: (files: File[]) => void
  onAnalyse: () => void
}

const USE_CASES = [
  { n: 1, icon: 'ti-clipboard-check', label: 'Declared dependencies checked', tip: 'The dependencies and target quarters the teams defined (the initiatives’ dependency column and target quarter) are checked against each other, the hidden dependencies and every team’s capacity: which target quarters cannot hold, and why.' },
  { n: 2, icon: 'ti-eye-search', label: 'Hidden dependencies found', tip: 'Dependencies nobody declared, found in the descriptions, in GitHub (code and shared-library links between teams) and through shared systems in the ownership lookup, counted and sorted by what they do to the plan.' },
  { n: 3, icon: 'ti-list-numbers', label: 'Sequenced by quarter', tip: 'Everything put in order: after what it waits for, at its T-shirt size against its team’s velocity, higher priority first. Then the decision dashboard lets you place each initiative in a quarter.' },
]

export function IntakeScreen({
  initiatives, selected, limit, uploadLimit, readyStatuses, scale, connected, starting, reloadingSources, onReloadSources,
  sources, plannerSummary, onToggle, onSelect, onClearSelection, onRemoveAll, onAdd, onRemove, onRemoveSource, onFiles,
  onAnalyse,
}: Props) {
  const fileInput = useRef<HTMLInputElement>(null)
  const pick = () => fileInput.current?.click()
  const n = selected.length
  const canAnalyse = !starting && (connected ? n > 0 && n <= limit : initiatives.length > 0)
  const loadedSources = sources.filter((s) => !s.status || s.status === 'ready' || s.status === 'partial').length
  const ready = initiatives.filter((i) => isReady(i, readyStatuses))
  const unticked = ready.filter((i) => !selected.includes(i.id))

  return (
    <div className="intake">
      <input
        ref={fileInput}
        type="file"
        multiple
        accept=".csv,.json,.xlsx,.xls,.zip"
        hidden
        onChange={(e) => {
          onFiles(Array.from(e.target.files ?? []))
          e.target.value = '' // allow re-selecting the same file
        }}
      />

      <div className="uc-strip" aria-label="What the analysis gives you">
        <span className="uc-strip-label">The analysis gives you</span>
        {USE_CASES.map((u) => (
          <Tip key={u.n} title={`Use case ${u.n} · ${u.label}`} content={u.tip} wide>
            <span className="uc-strip-item"><span className="uc-num">{u.n}</span><i className={`ti ${u.icon}`} aria-hidden="true" /> {u.label}</span>
          </Tip>
        ))}
      </div>

      <div className="s1-body">
        <div className="s1-left">
          <Section id="initiatives" title="Initiatives" icon="ti-file-description" collapsible={false}
            count={initiatives.length ? `${ready.length} ready` : undefined}
            tip="The roadmap initiatives from the initiatives file. Only Ready for PI Planning ones are analysed: In Discovery means the team is still working out whether it is an initiative, Proposed means it is not accepted yet. Each row shows its target quarter, T-shirt size, priority and the dependencies its team declared; hover any of them for what it means.">
            <InitiativeList
              initiatives={initiatives}
              selected={selected}
              limit={limit}
              uploadLimit={uploadLimit}
              readyStatuses={readyStatuses}
              scale={scale}
              onToggle={onToggle}
              onSelect={onSelect}
              onClearSelection={onClearSelection}
              onRemoveAll={onRemoveAll}
              onAdd={onAdd}
              onRemove={onRemove}
              onFilesDropped={onFiles}
              onPickFiles={pick}
            />
          </Section>
        </div>
        <div className="s1-right">
          <Section id="knowledge" title="Knowledge base" icon="ti-database" collapsible={false} count={sources.length ? `${loadedSources} in use` : undefined}
            tip="What the agents reason against: the initiatives, the GitHub repositories, the team directory and team capacity, plus the service ownership map as a lookup of who owns each system. Hover a source for the columns it contributes and what each one is used for.">
            <KnowledgeBaseList
              sources={sources}
              connected={connected}
              reloading={reloadingSources}
              onReload={onReloadSources}
              onRemove={onRemoveSource}
              onPickFiles={pick}
            />
          </Section>
        </div>
      </div>

      <div className="cta-bar">
        <div className="cta-note">
          <b>{n}</b> of at most {limit} selected · {ready.length} of {initiatives.length} ready · {loadedSources} knowledge source{loadedSources === 1 ? '' : 's'} in use
          {plannerSummary && (
            <Tip title="Your planner input" content={`Saved in this browser from an earlier run and sent with this one: ${plannerSummary}. Clear it from the Results screen.`}>
              <span className="cta-planner"> · <i className="ti ti-notes" aria-hidden="true" /> {plannerSummary}</span>
            </Tip>
          )}
          {connected && unticked.length > 0 && n < limit && (
            <button className="link-btn" onClick={() => onSelect(unticked.map((i) => i.id))}>
              Select all {ready.length} ready
            </button>
          )}
        </div>
        <div className="cta-actions">
          <button
            className="btn btn-primary"
            onClick={onAnalyse}
            disabled={!canAnalyse}
            aria-busy={starting}
            title={starting ? 'Starting the analysis…' : canAnalyse ? undefined : n > limit ? `Select at most ${limit}` : 'Select at least one ready initiative'}
          >
            <i className={`ti ${starting ? 'ti-loader-2 spin' : 'ti-player-play'}`} aria-hidden="true" />
            {starting ? 'Starting…' : connected ? `Analyse ${n} initiative${n === 1 ? '' : 's'}` : 'Analyse initiatives'}
          </button>
        </div>
      </div>
    </div>
  )
}
