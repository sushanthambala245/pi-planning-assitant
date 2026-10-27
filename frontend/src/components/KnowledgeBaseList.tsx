import type { KnowledgeSource } from '../types'

interface Props {
  sources: KnowledgeSource[]
}

export function KnowledgeBaseList({ sources }: Props) {
  return (
    <div className="s1-right">
      <div className="section-title"><i className="ti ti-database" aria-hidden="true" /> Knowledge base</div>
      <div className="section-sub">AI will reason against these sources</div>
      {sources.map((s) => (
        <div className="kb-item" key={s.id}>
          <div className={`kb-icon ${s.kind}`}><i className={`ti ${s.icon}`} aria-hidden="true" /></div>
          <div className="kb-text">
            <div className="kb-name">{s.name}</div>
            <div className="kb-meta">{s.meta}</div>
          </div>
          <span className="kb-badge">{s.status}</span>
        </div>
      ))}
      <button className="add-row" style={{ marginTop: 6 }}>
        <i className="ti ti-plus" aria-hidden="true" /> Add knowledge source
      </button>
    </div>
  )
}
