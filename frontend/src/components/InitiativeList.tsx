import { useMemo, useState } from 'react'
import type { Initiative } from '../types'

interface Props {
  initiatives: Initiative[]
  selected: string[]
  /** Most initiatives one analysis can take. */
  limit: number
  /** Most initiatives read from one uploaded file. */
  uploadLimit: number
  onToggle: (id: string) => void
  onSelect: (ids: string[]) => void
  onClearSelection: () => void
  onRemoveAll: () => void
  onAdd: (title: string, description: string) => void
  onRemove: (id: string) => void
  onFilesDropped: (files: File[]) => void
  onPickFiles: () => void
}

const distinct = (values: (string | undefined)[]) => [...new Set(values.filter((v): v is string => !!v))].sort()

export function InitiativeList({
  initiatives, selected, limit, uploadLimit, onToggle, onSelect, onClearSelection, onRemoveAll, onAdd, onRemove,
  onFilesDropped, onPickFiles,
}: Props) {
  const [adding, setAdding] = useState(false)
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [dragging, setDragging] = useState(false)
  const [query, setQuery] = useState('')
  const [team, setTeam] = useState('')
  const [pi, setPi] = useState('')
  const [onlySelected, setOnlySelected] = useState(false)

  const teams = useMemo(() => distinct(initiatives.map((i) => i.team)), [initiatives])
  const pis = useMemo(() => distinct(initiatives.map((i) => i.pi)), [initiatives])
  const chosen = new Set(selected)
  const full = selected.length >= limit

  const q = query.trim().toLowerCase()
  const visible = initiatives.filter((i) =>
    (!q || [i.title, i.description, i.id, i.meta].some((v) => v?.toLowerCase().includes(q))) &&
    (!team || i.team === team) &&
    (!pi || i.pi === pi) &&
    (!onlySelected || chosen.has(i.id)))
  const filtered = q !== '' || team !== '' || pi !== '' || onlySelected
  const addable = visible.filter((i) => !chosen.has(i.id)).slice(0, Math.max(0, limit - selected.length))
  const hiddenSelected = selected.filter((id) => !visible.some((i) => i.id === id)).length

  const clearFilters = () => { setQuery(''); setTeam(''); setPi(''); setOnlySelected(false) }

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
      <div className="section-sub">Upload a file or add one manually, then tick the initiatives to analyse</div>

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
        <div className="upload-limits">
          <span><i className="ti ti-file-upload" aria-hidden="true" /> Up to {uploadLimit} initiatives per file</span>
          <span><i className="ti ti-player-play" aria-hidden="true" /> Analyse up to {limit} at a time</span>
        </div>
      </div>

      {initiatives.length > 0 && (
        <>
          <div className="filter-bar">
            <label className="search-box">
              <i className="ti ti-search" aria-hidden="true" />
              <input
                type="text"
                placeholder="Search title, description or id"
                aria-label="Search initiatives"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              {query && (
                <button className="icon-btn" aria-label="Clear search" onClick={() => setQuery('')}>
                  <i className="ti ti-x" aria-hidden="true" />
                </button>
              )}
            </label>
            {teams.length > 1 && (
              <select className="select" aria-label="Filter by team" value={team} onChange={(e) => setTeam(e.target.value)}>
                <option value="">All teams</option>
                {teams.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            )}
            {pis.length > 1 && (
              <select className="select" aria-label="Filter by PI" value={pi} onChange={(e) => setPi(e.target.value)}>
                <option value="">All PIs</option>
                {pis.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            )}
          </div>

          <div className="select-bar">
            <span className={`limit-pill${full ? ' full' : ''}`} title={`One analysis takes at most ${limit} initiatives`}>
              <i className={`ti ${full ? 'ti-alert-circle' : 'ti-square-check'}`} aria-hidden="true" />
              {selected.length} / {limit} selected
            </span>
            <button
              className="btn btn-ghost btn-sm"
              disabled={!addable.length}
              title={full ? `Limit of ${limit} reached` : 'Tick the initiatives shown, up to the limit'}
              onClick={() => onSelect(addable.map((i) => i.id))}
            >
              <i className="ti ti-checkbox" aria-hidden="true" /> Select shown{addable.length ? ` (${addable.length})` : ''}
            </button>
            <button className="btn btn-ghost btn-sm" disabled={!selected.length} onClick={onClearSelection}>
              <i className="ti ti-eraser" aria-hidden="true" /> Clear selection
            </button>
            <label className="toggle">
              <input type="checkbox" checked={onlySelected} onChange={(e) => setOnlySelected(e.target.checked)} />
              Selected only
            </label>
            <button className="btn btn-ghost btn-sm danger" onClick={onRemoveAll} title="Remove every initiative from this list">
              <i className="ti ti-trash" aria-hidden="true" /> Remove all
            </button>
          </div>

          <div className="list-count">
            {filtered ? `Showing ${visible.length} of ${initiatives.length}` : `${initiatives.length} initiatives`}
            {hiddenSelected > 0 && ` · ${hiddenSelected} selected hidden by the filter`}
            {filtered && <button className="link-btn" onClick={clearFilters}>Clear filters</button>}
          </div>
        </>
      )}

      {initiatives.length === 0 && !adding && (
        <div className="list-empty">No initiatives yet. Upload a file above or add one manually.</div>
      )}
      {initiatives.length > 0 && visible.length === 0 && (
        <div className="list-empty">No initiative matches the filter.</div>
      )}

      <div className="scroll-list">
        {visible.map((item) => {
          const on = chosen.has(item.id)
          const blocked = !on && full
          return (
            <div className={`init-row${on ? ' selected' : ''}`} key={item.id}>
              <input
                type="checkbox"
                className="init-check"
                checked={on}
                disabled={blocked}
                aria-label={`Analyse ${item.title}`}
                title={blocked ? `Limit of ${limit} reached: clear one first` : on ? 'Remove from the analysis' : 'Add to the analysis'}
                onChange={() => onToggle(item.id)}
              />
              <div
                className={`init-text${blocked ? ' blocked' : ''}`}
                onClick={() => !blocked && onToggle(item.id)}
              >
                <div className="init-title">{item.title}</div>
                {item.description && <div className="init-sub">{item.description}</div>}
                <div className="init-meta">{item.id}{item.meta && ` · ${item.meta}`}</div>
              </div>
              <button className="icon-btn" aria-label={`Remove ${item.title}`} title="Remove from the list" onClick={() => onRemove(item.id)}>
                <i className="ti ti-x" aria-hidden="true" />
              </button>
            </div>
          )
        })}
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
