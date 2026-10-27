import { useState } from 'react'
import type { Initiative } from '../types'

interface Props {
  initiatives: Initiative[]
  onAdd: (title: string, description: string) => void
  onRemove: (id: string) => void
  onFilesDropped: (files: File[]) => void
  onPickFiles: () => void
}

export function InitiativeList({ initiatives, onAdd, onRemove, onFilesDropped, onPickFiles }: Props) {
  const [adding, setAdding] = useState(false)
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [dragging, setDragging] = useState(false)

  const submit = () => {
    if (!title.trim()) return
    onAdd(title.trim(), description.trim())
    setTitle('')
    setDescription('')
    setAdding(false)
  }

  return (
    <div className="s1-left">
      <div className="section-title"><i className="ti ti-file-description" aria-hidden="true" /> Initiatives</div>
      <div className="section-sub">Upload a file or enter manually</div>

      <div
        className={`upload-box${dragging ? ' dragging' : ''}`}
        role="button"
        tabIndex={0}
        onClick={onPickFiles}
        onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && onPickFiles()}
        onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault()
          setDragging(false)
          onFilesDropped(Array.from(e.dataTransfer.files))
        }}
      >
        <i className="ti ti-upload" aria-hidden="true" />
        <div className="upload-label">Drop or click to upload CSV, JSON, Excel or ZIP</div>
        <div className="upload-sub">Jira / ADO exports, initiatives, knowledge sources or an analysis result</div>
      </div>

      <div className="or-div">or add manually</div>

      {initiatives.length === 0 && !adding && (
        <div className="list-empty">No initiatives yet. Upload a file above or add one manually.</div>
      )}

      <div className="scroll-list">
        {initiatives.map((item, i) => (
          <div className="init-row" key={item.id}>
            <div className="init-num">{i + 1}</div>
            <div className="init-text">
              <div className="init-title">{item.title}</div>
              {item.description && <div className="init-sub">{item.description}</div>}
              {item.meta && <div className="init-meta">{item.id} · {item.meta}</div>}
            </div>
            <button className="icon-btn" aria-label={`Remove ${item.title}`} onClick={() => onRemove(item.id)}>
              <i className="ti ti-x" aria-hidden="true" />
            </button>
          </div>
        ))}
      </div>

      {adding ? (
        <div className="add-form">
          <input autoFocus placeholder="Initiative title" value={title} onChange={(e) => setTitle(e.target.value)} />
          <input
            placeholder="Short description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && submit()}
          />
          <div className="add-form-actions">
            <button className="btn btn-ghost btn-sm" onClick={() => setAdding(false)}>Cancel</button>
            <button className="btn btn-primary btn-sm" onClick={submit} disabled={!title.trim()}>Add</button>
          </div>
        </div>
      ) : (
        <button className="add-row" onClick={() => setAdding(true)}>
          <i className="ti ti-plus" aria-hidden="true" /> Add initiative
        </button>
      )}
    </div>
  )
}
