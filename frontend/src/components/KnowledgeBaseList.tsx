import type { KnowledgeSource } from '../types'

interface Props {
  sources: KnowledgeSource[]
  onRemove: (id: string) => void
  onPickFiles: () => void
}

export function KnowledgeBaseList({ sources, onRemove, onPickFiles }: Props) {
  return (
    <div className="s1-right">
      <div className="section-title"><i className="ti ti-database" aria-hidden="true" /> Knowledge base</div>
      <div className="section-sub">AI will reason against these sources</div>

      {sources.length === 0 && (
        <div className="list-empty">No knowledge sources yet. Upload CSV or Excel files (ownership map, application inventory, dependency docs…).</div>
      )}

      <div className="scroll-list">
        {sources.map((s) => (
          <div className="kb-item" key={s.id}>
            <div className={`kb-icon ${s.kind}`}><i className={`ti ${s.icon}`} aria-hidden="true" /></div>
            <div className="kb-text">
              <div className="kb-name">{s.name}</div>
              <div className="kb-meta">{s.meta}</div>
            </div>
            <span className="kb-badge">Ready</span>
            <button className="icon-btn" aria-label={`Remove ${s.name}`} onClick={() => onRemove(s.id)}>
              <i className="ti ti-x" aria-hidden="true" />
            </button>
          </div>
        ))}
      </div>

      <button className="add-row" style={{ marginTop: 6 }} onClick={onPickFiles}>
        <i className="ti ti-plus" aria-hidden="true" /> Add knowledge source
      </button>
    </div>
  )
}
