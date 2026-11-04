import type { KnowledgeSource, SourceStatus } from '../types'

interface Props {
  sources: KnowledgeSource[]
  /** Sources come from the backend's data folder: they are listed, not added or removed here. */
  connected: boolean
  reloading: boolean
  onReload: () => void
  onRemove: (id: string) => void
  onPickFiles: () => void
}

const BADGE: Record<SourceStatus, { label: string; hint: string }> = {
  ready: { label: 'Ready', hint: 'Loaded; every row passed validation' },
  partial: { label: 'Partial', hint: 'Loaded, but some rows were rejected (see the row counts)' },
  invalid: { label: 'Invalid', hint: 'Not used: a required column is missing' },
  missing: { label: 'Missing', hint: 'Not in the data folder: checks that need it are reported as not checked' },
}

export function KnowledgeBaseList({ sources, connected, reloading, onReload, onRemove, onPickFiles }: Props) {
  const loaded = sources.filter((s) => !s.status || s.status === 'ready' || s.status === 'partial')
  const notLoaded = sources.filter((s) => s.status === 'invalid' || s.status === 'missing')

  return (
    <div className="s1-right">
      <div className="section-title"><i className="ti ti-database" aria-hidden="true" /> Knowledge base</div>
      <div className="section-sub">
        {connected
          ? `The agents reason against these sources from the backend's data folder: ${loaded.length} loaded${notLoaded.length ? `, ${notLoaded.length} not loaded` : ''}`
          : 'AI will reason against these sources'}
      </div>

      {sources.length === 0 && (
        <div className="list-empty">
          {connected
            ? 'The backend has no sources: put the case-study files in its data folder and reload.'
            : 'No knowledge sources yet. Upload CSV or Excel files (ownership map, application inventory, dependency docs…).'}
        </div>
      )}

      <div className="scroll-list">
        {[...loaded, ...notLoaded].map((s) => {
          const status = s.status ?? 'ready'
          return (
            <div className={`kb-item${status === 'missing' || status === 'invalid' ? ' off' : ''}`} key={s.id}>
              <div className={`kb-icon ${s.kind}`}><i className={`ti ${s.icon}`} aria-hidden="true" /></div>
              <div className="kb-text">
                <div className="kb-name">{s.name}</div>
                <div className="kb-meta" title={s.meta}>{s.meta}</div>
              </div>
              <span className={`kb-badge ${status}`} title={BADGE[status].hint}>{BADGE[status].label}</span>
              {!connected && (
                <button className="icon-btn" aria-label={`Remove ${s.name}`} onClick={() => onRemove(s.id)}>
                  <i className="ti ti-x" aria-hidden="true" />
                </button>
              )}
            </div>
          )
        })}
      </div>

      {connected ? (
        <button className="add-row" style={{ marginTop: 6 }} onClick={onReload} disabled={reloading}
          title="Re-read the backend's data folder after adding or changing files">
          <i className={`ti ${reloading ? 'ti-loader-2 spin' : 'ti-reload'}`} aria-hidden="true" /> {reloading ? 'Reloading…' : 'Reload from the data folder'}
        </button>
      ) : (
        <button className="add-row" style={{ marginTop: 6 }} onClick={onPickFiles}>
          <i className="ti ti-plus" aria-hidden="true" /> Add knowledge source
        </button>
      )}
    </div>
  )
}
