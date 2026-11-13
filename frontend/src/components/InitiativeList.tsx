import { useMemo, useState } from 'react'
import { isReady, parseDeclared } from '../lib/readiness'
import type { Scale } from '../lib/plan'
import type { Initiative } from '../types'
import { PriorityChip, QuarterChip, SizeChip, StatusChip } from './Chips'
import { Tip } from './Tip'

interface Props {
  initiatives: Initiative[]
  selected: string[]
  /** Most initiatives one analysis can take. */
  limit: number
  /** Most initiatives read from one uploaded file. */
  uploadLimit: number
  /** The statuses that count as ready (backend READY_STATUSES). */
  readyStatuses: string[]
  /** The T-shirt scale, for the size tooltips. */
  scale: Scale | null
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
const READY = 'ready'
const ALL = 'all'

function DeclaredChip({ text }: { text?: string }) {
  const d = parseDeclared(text)
  const n = d.upstream.length + d.downstream.length
  if (!n) return null
  return (
    <Tip title={`${n} declared ${n === 1 ? 'dependency' : 'dependencies'}`} wide content={<>
      <p>From the initiative’s own dependency column: what its team wrote down (use case 1).</p>
      {d.upstream.length > 0 && <p><b>Upstream</b> (it consumes them): {d.upstream.join(', ')}</p>}
      {d.downstream.length > 0 && <p><b>Downstream</b> (they consume its output): {d.downstream.join(', ')}</p>}
      <p className="tip-foot">The analysis looks up the owner of each system and checks the order against its team’s initiatives. It also looks for the ones nobody declared.</p>
    </>}>
      <span className="decl-chip"><i className="ti ti-clipboard-list" aria-hidden="true" /> {n}</span>
    </Tip>
  )
}

export function InitiativeList({
  initiatives, selected, limit, uploadLimit, readyStatuses, scale, onToggle, onSelect, onClearSelection, onRemoveAll,
  onAdd, onRemove, onFilesDropped, onPickFiles,
}: Props) {
  const [adding, setAdding] = useState(false)
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [dragging, setDragging] = useState(false)
  const [query, setQuery] = useState('')
  const [team, setTeam] = useState('')
  const [art, setArt] = useState('')
  const [pi, setPi] = useState('')
  const [onlySelected, setOnlySelected] = useState(false)
  const ready = (i: Initiative) => isReady(i, readyStatuses)
  const anyNotReady = initiatives.some((i) => !ready(i))
  const [status, setStatus] = useState<string>(READY)
  const statusNow = anyNotReady ? status : ALL

  const teams = useMemo(() => {
    const names = new Map(initiatives.filter((i) => i.team).map((i) => [i.team!, i.teamName || i.team!]))
    return [...names.entries()].sort((a, b) => a[1].localeCompare(b[1]))
  }, [initiatives])
  const arts = useMemo(() => distinct(initiatives.map((i) => i.art)), [initiatives])
  const pis = useMemo(() => distinct(initiatives.map((i) => i.pi)), [initiatives])
  const statuses = useMemo(() => {
    const counts = new Map<string, number>()
    for (const i of initiatives) if (!ready(i)) counts.set(i.status || 'No status', (counts.get(i.status || 'No status') ?? 0) + 1)
    return [...counts.entries()]
  }, [initiatives, readyStatuses])
  const readyCount = initiatives.filter(ready).length
  const chosen = new Set(selected)
  const full = selected.length >= limit

  const q = query.trim().toLowerCase()
  const visible = initiatives.filter((i) =>
    (!q || [i.title, i.description, i.id, i.meta, i.teamName, i.art, i.dependencyText].some((v) => v?.toLowerCase().includes(q))) &&
    (!team || i.team === team) &&
    (!art || i.art === art) &&
    (!pi || i.pi === pi) &&
    (statusNow === ALL || (statusNow === READY ? ready(i) : !ready(i) && (i.status || 'No status') === statusNow)) &&
    (!onlySelected || chosen.has(i.id)))
  const filtered = q !== '' || team !== '' || art !== '' || pi !== '' || onlySelected
  const addable = visible.filter((i) => ready(i) && !chosen.has(i.id)).slice(0, Math.max(0, limit - selected.length))
  const hiddenSelected = selected.filter((id) => !visible.some((i) => i.id === id)).length

  const clearFilters = () => { setQuery(''); setTeam(''); setArt(''); setPi(''); setOnlySelected(false) }

  const submit = () => {
    if (!title.trim()) return
    onAdd(title.trim(), description.trim())
    setTitle('')
    setDescription('')
    setAdding(false)
  }

  return (
    <>
      <div className="section-sub">Only initiatives that are ready for PI planning can be analysed. Analyse them all together: hidden dependencies only show across the whole set.</div>

      <div
        className={`upload-box${dragging ? ' dragging' : ''}${initiatives.length ? ' compact' : ''}`}
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
        {!initiatives.length && <div className="upload-sub">Jira / ADO exports, initiatives, knowledge sources or an analysis result</div>}
        <div className="upload-limits">
          <span><i className="ti ti-file-upload" aria-hidden="true" /> Up to {uploadLimit} initiatives per file</span>
          <span><i className="ti ti-player-play" aria-hidden="true" /> Analyse up to {limit} at a time</span>
        </div>
      </div>

      {initiatives.length > 0 && (
        <>
          {anyNotReady && (
            <div className="seg status-seg" role="group" aria-label="Filter by readiness">
              <Tip title={`${readyStatuses.join(' / ')}: ${readyCount}`} content="Confirmed initiatives that are ready to plan. Only these can be analysed, sequenced and placed in quarters.">
                <button className={`seg-btn${statusNow === READY ? ' active' : ''}`} aria-pressed={statusNow === READY} onClick={() => setStatus(READY)}>
                  <i className="ti ti-circle-check" aria-hidden="true" /> Ready <span className="chip-n">{readyCount}</span>
                </button>
              </Tip>
              {statuses.map(([s, n]) => (
                <Tip key={s} title={`${s}: ${n}`} content={s === 'In Discovery'
                  ? 'The team is still working out whether this is an initiative at all, so it cannot be ready for PI planning. Shown for reference; it cannot be analysed.'
                  : s === 'Proposed' ? 'Suggested but not accepted yet. Shown for reference; it cannot be analysed until it is Ready for PI Planning.'
                    : 'Not a ready status, so it cannot be analysed.'}>
                  <button className={`seg-btn${statusNow === s ? ' active' : ''}`} aria-pressed={statusNow === s} onClick={() => setStatus(s)}>
                    {s} <span className="chip-n">{n}</span>
                  </button>
                </Tip>
              ))}
              <button className={`seg-btn${statusNow === ALL ? ' active' : ''}`} aria-pressed={statusNow === ALL} onClick={() => setStatus(ALL)}>
                All <span className="chip-n">{initiatives.length}</span>
              </button>
            </div>
          )}

          <div className="filter-bar">
            <label className="search-box">
              <i className="ti ti-search" aria-hidden="true" />
              <input
                type="text"
                placeholder="Search title, description, team, system or id"
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
            {arts.length > 1 && (
              <select className="select" aria-label="Filter by ART" value={art} onChange={(e) => setArt(e.target.value)}>
                <option value="">All ARTs</option>
                {arts.map((a) => <option key={a} value={a}>{a}</option>)}
              </select>
            )}
            {teams.length > 1 && (
              <select className="select" aria-label="Filter by team" value={team} onChange={(e) => setTeam(e.target.value)}>
                <option value="">All teams</option>
                {teams.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
              </select>
            )}
            {pis.length > 1 && (
              <select className="select" aria-label="Filter by target quarter" value={pi} onChange={(e) => setPi(e.target.value)}>
                <option value="">All quarters</option>
                {pis.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            )}
          </div>

          <div className="select-bar">
            <Tip title={`${selected.length} of at most ${limit}`} content={`One analysis takes at most ${limit} initiatives (MAX_INITIATIVES_PER_RUN in backend/.env).`}>
              <span className={`limit-pill${full ? ' full' : ''}`}>
                <i className={`ti ${full ? 'ti-alert-circle' : 'ti-square-check'}`} aria-hidden="true" />
                {selected.length} / {limit} selected
              </span>
            </Tip>
            <Tip title="Select shown" content="Ticks every ready initiative the filters show, up to the limit. Initiatives that are not ready are never ticked.">
              <button className="btn btn-ghost btn-sm" disabled={!addable.length} onClick={() => onSelect(addable.map((i) => i.id))}>
                <i className="ti ti-checkbox" aria-hidden="true" /> Select shown{addable.length ? ` (${addable.length})` : ''}
              </button>
            </Tip>
            <button className="btn btn-ghost btn-sm" disabled={!selected.length} onClick={onClearSelection}>
              <i className="ti ti-eraser" aria-hidden="true" /> Clear selection
            </button>
            <label className="toggle">
              <input type="checkbox" checked={onlySelected} onChange={(e) => setOnlySelected(e.target.checked)} />
              Selected only
            </label>
            <Tip title="Remove all" content="Removes every initiative from this list for this session. With the backend, reloading the data folder brings them back.">
              <button className="btn btn-ghost btn-sm danger" onClick={onRemoveAll}>
                <i className="ti ti-trash" aria-hidden="true" /> Remove all
              </button>
            </Tip>
          </div>

          <div className="list-count">
            {filtered || statusNow !== ALL ? `Showing ${visible.length} of ${initiatives.length}` : `${initiatives.length} initiatives`}
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
          const notReady = !ready(item)
          const blocked = notReady || (!on && full)
          const why = notReady
            ? `${item.status || 'No status'}: only ${readyStatuses.join(' / ')} initiatives can be analysed.`
            : blocked ? `Limit of ${limit} reached: clear one first.` : on ? 'Remove from the analysis' : 'Add to the analysis'
          return (
            <div className={`init-row${on ? ' selected' : ''}${notReady ? ' not-ready' : ''}`} key={item.id}>
              <Tip content={why}>
                <input
                  type="checkbox"
                  className="init-check"
                  checked={on}
                  disabled={blocked && !on}
                  aria-label={`Analyse ${item.title}`}
                  onChange={() => onToggle(item.id)}
                />
              </Tip>
              <div className={`init-text${blocked && !on ? ' blocked' : ''}`} onClick={() => !(blocked && !on) && onToggle(item.id)}>
                <div className="init-title">{item.title}</div>
                {item.description && <div className="init-sub">{item.description}</div>}
                <div className="init-meta">
                  {item.id}{item.teamName || item.team ? ` · ${item.teamName || item.team}` : ''}{item.art ? ` · ${item.art}` : ''}
                </div>
              </div>
              <div className="init-chips" onClick={(e) => e.stopPropagation()}>
                {notReady && <StatusChip status={item.status} />}
                {item.pi && <QuarterChip quarter={item.pi} kind="target" />}
                {(item.size || item.status) && <SizeChip size={item.size} source={item.size ? 'tshirt' : 'assumed'} plan={scale} />}
                {item.priority && <PriorityChip priority={item.priority} />}
                <DeclaredChip text={item.dependencyText} />
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
            placeholder="Short description (name the systems or teams it needs)"
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
        <Tip title="Add initiative" content="Adds one initiative by hand. It counts as ready for PI planning (you added it to plan it) and has no size until you set one after the run.">
          <button className="add-row" onClick={() => setAdding(true)}>
            <i className="ti ti-plus" aria-hidden="true" /> Add initiative
          </button>
        </Tip>
      )}
    </>
  )
}
