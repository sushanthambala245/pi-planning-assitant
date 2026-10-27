import { useRef, useState } from 'react'
import type { Initiative } from '../types'

interface Props {
  initiatives: Initiative[]
  onAdd: (title: string, description: string) => void
  onRemove: (id: number) => void
  onFilesDropped: (files: File[]) => void
}

export function InitiativeList({ initiatives, onAdd, onRemove, onFilesDropped }: Props) {
  const [adding, setAdding] = useState(false)
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [dragging, setDragging] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)

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
        onClick={() => fileInput.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault()
          setDragging(false)
          onFilesDropped(Array.from(e.dataTransfer.files))
        }}
      >
        <i className="ti ti-upload" aria-hidden="true" />
        <div className="upload-label">Drop Jira export, ADO export, or CSV</div>
        <div className="upload-sub">or paste initiative descriptions below</div>
        <input
          ref={fileInput}
          type="file"
          accept=".csv,.json,.xlsx"
          hidden
          onChange={(e) => onFilesDropped(Array.from(e.target.files ?? []))}
        />
      </div>

      <div className="or-div">or add manually</div>

      {initiatives.map((item, i) => (
        <div className="init-row" key={item.id}>
          <div className="init-num">{i + 1}</div>
          <div className="init-text">
            <div className="init-title">{item.title}</div>
            <div className="init-sub">{item.description}</div>
          </div>
          <button className="icon-btn" aria-label={`Remove ${item.title}`} onClick={() => onRemove(item.id)}>
            <i className="ti ti-x" aria-hidden="true" />
          </button>
        </div>
      ))}

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
