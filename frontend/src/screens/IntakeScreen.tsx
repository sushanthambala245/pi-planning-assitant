import { useRef } from 'react'
import { InitiativeList } from '../components/InitiativeList'
import { KnowledgeBaseList } from '../components/KnowledgeBaseList'
import type { Initiative, KnowledgeSource, Notice } from '../types'

interface Props {
  initiatives: Initiative[]
  selected: string[]
  limit: number
  uploadLimit: number
  /** Connected to the backend: Analyse runs the selected initiatives there. */
  connected: boolean
  /** A backend run is being started: Analyse is busy. */
  starting: boolean
  reloadingSources: boolean
  onReloadSources: () => void
  sources: KnowledgeSource[]
  notices: Notice[]
  onToggle: (id: string) => void
  onSelect: (ids: string[]) => void
  onClearSelection: () => void
  onRemoveAll: () => void
  onAdd: (title: string, description: string) => void
  onRemove: (id: string) => void
  onRemoveSource: (id: string) => void
  onFiles: (files: File[]) => void
  onDismissNotice: (id: number) => void
  onClearNotices: () => void
  onAnalyse: () => void
}

export function IntakeScreen({
  initiatives, selected, limit, uploadLimit, connected, starting, reloadingSources, onReloadSources, sources, notices,
  onToggle, onSelect, onClearSelection, onRemoveAll, onAdd, onRemove, onRemoveSource, onFiles, onDismissNotice,
  onClearNotices, onAnalyse,
}: Props) {
  const fileInput = useRef<HTMLInputElement>(null)
  const pick = () => fileInput.current?.click()
  const n = selected.length
  const canAnalyse = !starting && (connected ? n > 0 && n <= limit : initiatives.length > 0)
  const loadedSources = sources.filter((s) => !s.status || s.status === 'ready' || s.status === 'partial').length

  return (
    <>
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

      {notices.length > 0 && (
        <div className="notices-wrap">
          <div className="notices" aria-live="polite">
            {notices.map((n) => (
              <div key={n.id} className={`notice ${n.kind}`}>
                <i className={`ti ${n.kind === 'ok' ? 'ti-circle-check' : 'ti-alert-circle'}`} aria-hidden="true" />
                <span>{n.text}</span>
                <button className="icon-btn" aria-label="Dismiss" onClick={() => onDismissNotice(n.id)}>
                  <i className="ti ti-x" aria-hidden="true" />
                </button>
              </div>
            ))}
          </div>
          {notices.length > 1 && (
            <button className="link-btn notices-clear" onClick={onClearNotices}>
              <i className="ti ti-eraser" aria-hidden="true" /> Clear all messages
            </button>
          )}
        </div>
      )}

      <div className="s1-body">
        <InitiativeList
          initiatives={initiatives}
          selected={selected}
          limit={limit}
          uploadLimit={uploadLimit}
          onToggle={onToggle}
          onSelect={onSelect}
          onClearSelection={onClearSelection}
          onRemoveAll={onRemoveAll}
          onAdd={onAdd}
          onRemove={onRemove}
          onFilesDropped={onFiles}
          onPickFiles={pick}
        />
        <KnowledgeBaseList
          sources={sources}
          connected={connected}
          reloading={reloadingSources}
          onReload={onReloadSources}
          onRemove={onRemoveSource}
          onPickFiles={pick}
        />
      </div>

      <div className="cta-bar">
        <div className="cta-note">
          <b>{n}</b> of at most {limit} initiatives selected · {initiatives.length} in the list · {loadedSources} knowledge source{loadedSources === 1 ? '' : 's'} loaded
          {connected && n === 0 && initiatives.length > 0 && <span className="cta-hint"> · tick the initiatives to analyse</span>}
        </div>
        <div className="cta-actions">
          <button className="btn btn-ghost" disabled title="Not available yet">
            <i className="ti ti-device-floppy" aria-hidden="true" /> Save draft
          </button>
          <button
            className="btn btn-primary"
            onClick={onAnalyse}
            disabled={!canAnalyse}
            aria-busy={starting}
            title={starting ? 'Starting the analysis…' : canAnalyse ? undefined : n > limit ? `Select at most ${limit}` : 'Select at least one initiative'}
          >
            <i className={`ti ${starting ? 'ti-loader-2 spin' : 'ti-player-play'}`} aria-hidden="true" />
            {starting ? 'Starting…' : connected ? `Analyse ${n} initiative${n === 1 ? '' : 's'}` : 'Analyse initiatives'}
          </button>
        </div>
      </div>
    </>
  )
}
