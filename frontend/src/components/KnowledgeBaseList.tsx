import { useState } from 'react'
import { KB_ORDER, SOURCE_BADGE, SOURCE_INFO } from '../lib/sources'
import type { KnowledgeSource } from '../types'
import { Tip } from './Tip'

interface Props {
  sources: KnowledgeSource[]
  /** Sources come from the backend's data folder: they are listed, not added or removed here. */
  connected: boolean
  reloading: boolean
  onReload: () => void
  onRemove: (id: string) => void
  onPickFiles: () => void
}

const isUsed = (s: KnowledgeSource) => !s.status || s.status === 'ready' || s.status === 'partial'

/** What a source is for and the columns the agents read, for its tooltip. */
function SourceTip({ source }: { source: KnowledgeSource }) {
  const info = SOURCE_INFO[source.id]
  const badge = SOURCE_BADGE[source.status ?? 'ready']
  return (
    <>
      {info ? <p>{info.role}</p> : <p>{source.meta}</p>}
      {info && (
        <ul className="tip-cols">
          {info.columns.map(([col, use]) => <li key={col}><code>{col}</code> {use}</li>)}
        </ul>
      )}
      {info?.ignored && <p className="tip-foot">{info.ignored}</p>}
      <p className="tip-foot"><b>{badge.label}:</b> {badge.hint}</p>
    </>
  )
}

function SourceRow({ s, connected, onRemove }: { s: KnowledgeSource; connected: boolean; onRemove: (id: string) => void }) {
  const status = s.status ?? 'ready'
  const lookup = s.id === 'S7'
  return (
    <div className={`kb-item${isUsed(s) ? '' : ' off'}`}>
      <div className={`kb-icon ${s.kind}`}><i className={`ti ${s.icon}`} aria-hidden="true" /></div>
      <Tip title={s.name} content={<SourceTip source={s} />} wide as="div" className="kb-text" focusable>
        <div className="kb-name">{s.name}{lookup && <span className="kb-role">lookup</span>}</div>
        <div className="kb-meta">{s.meta}</div>
      </Tip>
      <Tip title={SOURCE_BADGE[status].label} content={SOURCE_BADGE[status].hint}>
        <span className={`kb-badge ${status}`}>{SOURCE_BADGE[status].label}</span>
      </Tip>
      {!connected && (
        <button className="icon-btn" aria-label={`Remove ${s.name}`} onClick={() => onRemove(s.id)}>
          <i className="ti ti-x" aria-hidden="true" />
        </button>
      )}
    </div>
  )
}

export function KnowledgeBaseList({ sources, connected, reloading, onReload, onRemove, onPickFiles }: Props) {
  const [showOff, setShowOff] = useState(false)
  const rank = (s: KnowledgeSource) => (KB_ORDER.includes(s.id) ? KB_ORDER.indexOf(s.id) : KB_ORDER.length)
  const used = sources.filter(isUsed).sort((a, b) => rank(a) - rank(b))
  const broken = sources.filter((s) => s.status === 'invalid' || s.status === 'missing')
  const off = sources.filter((s) => s.status === 'off')

  return (
    <>
      <div className="section-sub">
        {connected
          ? `The agents read ${used.length} source${used.length === 1 ? '' : 's'} from the backend's data folder${broken.length ? `; ${broken.length} could not be loaded` : ''}. Hover one for what it contributes and which columns are used.`
          : 'The AI reasons against these sources. Hover one for what it contributes.'}
      </div>

      {sources.length === 0 && (
        <div className="list-empty">
          {connected
            ? 'The backend has no sources: put the case-study files in its data folder and reload.'
            : 'No knowledge sources yet. Upload the initiatives, GitHub repos, team directory and team capacity files (CSV, Excel or a ZIP).'}
        </div>
      )}

      <div className="scroll-list">
        {[...used, ...broken].map((s) => <SourceRow key={s.id} s={s} connected={connected} onRemove={onRemove} />)}
        {off.length > 0 && (
          <div className="kb-off">
            <button className="link-btn" aria-expanded={showOff} onClick={() => setShowOff((v) => !v)}>
              <i className={`ti ${showOff ? 'ti-chevron-down' : 'ti-chevron-right'}`} aria-hidden="true" />
              {off.length} source{off.length === 1 ? '' : 's'} switched off
            </button>
            <Tip title="Switched-off sources" content={SOURCE_BADGE.off.hint} wide className="info-tip" focusable>
              <i className="ti ti-info-circle" aria-label="About switched-off sources" />
            </Tip>
            {showOff && off.map((s) => <SourceRow key={s.id} s={s} connected={connected} onRemove={onRemove} />)}
          </div>
        )}
      </div>

      {connected ? (
        <Tip title="Reload from the data folder" content="Re-reads every file in the backend's data folder, for example after you drop in an updated CSV. With several versions of one file (initiatives_updated_v1.csv, _v2 …) the most recently saved one is read. The next analysis uses the reloaded data.">
          <button className="add-row" style={{ marginTop: 6 }} onClick={onReload} disabled={reloading}>
            <i className={`ti ${reloading ? 'ti-loader-2 spin' : 'ti-reload'}`} aria-hidden="true" /> {reloading ? 'Reloading…' : 'Reload from the data folder'}
          </button>
        </Tip>
      ) : (
        <button className="add-row" style={{ marginTop: 6 }} onClick={onPickFiles}>
          <i className="ti ti-plus" aria-hidden="true" /> Add knowledge source
        </button>
      )}
    </>
  )
}
