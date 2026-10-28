import { useRef } from 'react'
import { InitiativeList } from '../components/InitiativeList'
import { KnowledgeBaseList } from '../components/KnowledgeBaseList'
import type { Initiative, KnowledgeSource, Notice } from '../types'

interface Props {
  initiatives: Initiative[]
  sources: KnowledgeSource[]
  notices: Notice[]
  onAdd: (title: string, description: string) => void
  onRemove: (id: string) => void
  onRemoveSource: (id: string) => void
  onFiles: (files: File[]) => void
  onDismissNotice: (id: number) => void
  onAnalyse: () => void
}

export function IntakeScreen({
  initiatives, sources, notices, onAdd, onRemove, onRemoveSource, onFiles, onDismissNotice, onAnalyse,
}: Props) {
  const fileInput = useRef<HTMLInputElement>(null)
  const pick = () => fileInput.current?.click()

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
      )}

      <div className="s1-body">
        <InitiativeList initiatives={initiatives} onAdd={onAdd} onRemove={onRemove} onFilesDropped={onFiles} onPickFiles={pick} />
        <KnowledgeBaseList sources={sources} onRemove={onRemoveSource} onPickFiles={pick} />
      </div>

      <div className="cta-bar">
        <div className="cta-note">
          {initiatives.length} initiative{initiatives.length === 1 ? '' : 's'} · {sources.length} knowledge source{sources.length === 1 ? '' : 's'} loaded
        </div>
        <div className="cta-actions">
          <button className="btn btn-ghost" disabled title="Not available yet">
            <i className="ti ti-device-floppy" aria-hidden="true" /> Save draft
          </button>
          <button className="btn btn-primary" onClick={onAnalyse} disabled={initiatives.length === 0}>
            <i className="ti ti-player-play" aria-hidden="true" /> Analyse initiatives
          </button>
        </div>
      </div>
    </>
  )
}
