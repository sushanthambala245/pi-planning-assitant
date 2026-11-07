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
      <div className="section-title">
        <i className="ti ti-database" aria-hidden="true" /> Knowledge base
        {sources.length > 0 && (
          <span className="init-pill" style={{ marginLeft: 'auto', fontWeight: 400 }}>
            {loaded.length} loaded{notLoaded.length ? ` · ${notLoaded.length} missing` : ''}
          </span>
        )}
      </div>

      {sources.length === 0 && (
        <div className="list-empty">
          <i className="ti ti-database-off" aria-hidden="true" />
          <div className="list-empty-label">{connected ? 'No sources found' : 'No sources yet'}</div>
          <div className="list-empty-sub">
            {connected ? 'Add data files to the backend data folder and reload' : 'Upload CSV or Excel files'}
          </div>
        </div>
      )}

      <div className="scroll-list">
        {[...loaded, ...notLoaded].map((s) => {
          const status = s.status ?? 'ready'
          return (
            <div className={`kb-item${status === 'missing' || status === 'invalid' ? ' off' : ''}`} key={s.id}>
              <div className={`kb-icon ${s.kind}`}><i className={`ti ${s.icon}`} aria-hidden="true" /></div>
              <div className="kb-text">
                <div className="kb-name">{s.name.replace(/\s*\([^)]+\)$/, '')}</div>
                <div className="kb-meta">{s.meta.split(' · ')[0]}</div>
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
