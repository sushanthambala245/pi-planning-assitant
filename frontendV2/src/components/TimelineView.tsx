import { Fragment, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { domainColor } from '../data/domains'
import type { CommentCounts } from '../hooks/useComments'
import type { Analysis, TShirt } from '../types'

export type GroupBy = 'step' | 'team' | 'art'

const GROUP_H = 28
const ROW_H = 30
const BAR_H = 18
/** The label column; the sprint lanes (and the link overlay) start after it. */
const LABEL_W = 280

interface Item {
  id: string
  title: string
  team: string
  art: string
  step: number
  start: number
  end: number
  sprints: number
  size?: TShirt
  sizeSource?: 'size' | 'points' | 'default'
  spills: boolean
  critical: boolean
  inCycle: boolean
  waitsFor: string[]
  targeted?: number
}

function buildItems(a: Analysis): Item[] {
  const refs = new Map(a.initiatives.map((i) => [i.id, i]))
  const stepOf = new Map<string, number>()
  for (const s of a.steps) for (const id of s.initiativeIds) stepOf.set(id, s.step)
  const base = (id: string) => {
    const r = refs.get(id)
    return { id, title: r?.title ?? id, team: r?.teamName || r?.team || 'No team', art: r?.art || 'Other', step: stepOf.get(id) ?? 1 }
  }
  if (a.schedule) {
    return a.schedule.rows.map((r) => ({
      ...base(r.initiativeId), start: r.start, end: r.end, sprints: r.sprints, size: r.size, sizeSource: r.sizeSource,
      spills: r.spillsPastPi, critical: r.critical, inCycle: r.inCycle, waitsFor: r.waitsFor, targeted: r.targetedSprint,
    }))
  }
  // No schedule (an older file, or the run has not reached sequencing): one column per step.
  return a.steps.flatMap((s) => s.initiativeIds.map((id) => ({
    ...base(id), start: s.step, end: s.step, sprints: 1, spills: false, critical: false, inCycle: s.inCycle, waitsFor: [],
  })))
}

const range = (xs: Item[]) => {
  const lo = Math.min(...xs.map((x) => x.start))
  const hi = Math.max(...xs.map((x) => x.end))
  return lo === hi ? `${lo}` : `${lo}–${hi}`
}

interface Props {
  analysis: Analysis
  groupBy: GroupBy
  /** Initiatives to show; null shows all of them. */
  visibleIds: Set<string> | null
  selectedId: string | null
  counts: Map<string, CommentCounts>
  onSelect: (id: string) => void
  onOpenComments: (id: string) => void
}

/** The delivery timeline: one chevron bar per initiative across the PI's sprints, grouped by step, team or ART. */
export function TimelineView({ analysis, groupBy, visibleIds, selectedId, counts, onSelect, onOpenComments }: Props) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [allLinks, setAllLinks] = useState(false)
  const [width, setWidth] = useState(0)
  const overlay = useRef<HTMLDivElement>(null)

  const sched = analysis.schedule
  const items = useMemo(() => buildItems(analysis), [analysis])
  const shown = useMemo(() => items.filter((i) => !visibleIds || visibleIds.has(i.id)), [items, visibleIds])
  const cols = Math.max(sched ? sched.piSprints : 1, ...items.map((i) => i.end), 1)
  const piEnd = sched ? sched.piSprints : cols

  const groups = useMemo(() => {
    const m = new Map<string, { key: string; label: string; items: Item[]; cycle: boolean }>()
    for (const it of shown) {
      const key = groupBy === 'step' ? String(it.step).padStart(3, '0') : groupBy === 'team' ? it.team : it.art
      const label = groupBy === 'step' ? `Step ${it.step}` : key
      const g = m.get(key) ?? { key, label, items: [], cycle: false }
      g.items.push(it)
      g.cycle ||= it.inCycle
      m.set(key, g)
    }
    return [...m.values()]
      .sort((a, b) => a.key.localeCompare(b.key))
      .map((g) => ({ ...g, items: [...g.items].sort((a, b) => a.start - b.start || a.title.localeCompare(b.title)) }))
  }, [shown, groupBy])

  // Row positions, so links can be drawn between bars.
  const layout = useMemo(() => {
    const y = new Map<string, number>()
    let at = 0
    for (const g of groups) {
      at += GROUP_H
      if (collapsed.has(g.key)) continue
      for (const it of g.items) { y.set(it.id, at + ROW_H / 2); at += ROW_H }
    }
    return { y, height: at }
  }, [groups, collapsed])

  useEffect(() => {
    const el = overlay.current
    if (!el) return
    setWidth(el.clientWidth)
    const ro = new ResizeObserver(() => setWidth(el.clientWidth))
    ro.observe(el)
    return () => ro.disconnect()
  }, [shown.length])

  const x = (unit: number) => (unit / cols) * width
  const links = useMemo(() => {
    const out: { key: string; a: Item; b: Item; kind: 'crit' | 'sel' | 'all' }[] = []
    const byId = new Map(shown.map((i) => [i.id, i]))
    for (const b of shown) {
      for (const p of b.waitsFor) {
        const a = byId.get(p)
        if (!a || !layout.y.has(a.id) || !layout.y.has(b.id)) continue
        const kind = a.critical && b.critical ? 'crit' : a.id === selectedId || b.id === selectedId ? 'sel' : allLinks ? 'all' : null
        if (kind) out.push({ key: `${a.id}>${b.id}`, a, b, kind })
      }
    }
    return out
  }, [shown, layout, selectedId, allLinks])

  if (!items.length) return <div className="list-empty">No initiatives to place on a timeline.</div>

  const toggle = (key: string) => setCollapsed((s) => { const n = new Set(s); n.has(key) ? n.delete(key) : n.add(key); return n })
  const arts = [...new Set(items.map((i) => i.art))]
  const style = { '--cols': cols, '--label-w': `${LABEL_W}px`, '--row-h': `${ROW_H}px`, '--group-h': `${GROUP_H}px` } as CSSProperties

  return (
    <div className="tl" style={style}>
      <div className="tl-head">
        <div className="tl-label-h">Initiative</div>
        <div className="tl-cols">
          {Array.from({ length: cols }, (_, i) => (
            <div key={i} className={`tl-col${sched && i + 1 > piEnd ? ' beyond' : ''}`}>
              {sched ? (i + 1 > piEnd ? 'Beyond PI' : `Sprint ${i + 1}`) : `Step ${i + 1}`}
            </div>
          ))}
        </div>
      </div>

      <div className="tl-body">
        {shown.length === 0 && <div className="list-empty" style={{ margin: '12px 0' }}>No initiatives match the filters.</div>}
        {groups.map((g) => {
          const closed = collapsed.has(g.key)
          return (
            <Fragment key={g.key}>
              <button className="tl-group" aria-expanded={!closed} onClick={() => toggle(g.key)}>
                <i className={`ti ${closed ? 'ti-chevron-right' : 'ti-chevron-down'}`} aria-hidden="true" />
                <b>{g.label}</b>
                <span>{g.items.length} initiative{g.items.length === 1 ? '' : 's'}{sched ? ` · sprint ${range(g.items)}` : ''}</span>
                {g.cycle && <span className="sev sev-h">cycle: break it first</span>}
              </button>
              {!closed && g.items.map((it) => {
                const c = counts.get(it.id)
                const color = domainColor(it.art)
                const sel = it.id === selectedId
                const tip = `${it.title}${it.size ? ` · size ${it.size}` : ''} · ${sched ? 'sprint' : 'step'} ${it.start === it.end ? it.start : `${it.start} to ${it.end}`}`
                return (
                  <div key={it.id} className={`tl-row${sel ? ' selected' : ''}`}>
                    <div className="tl-label" onClick={() => onSelect(it.id)}>
                      <button
                        className={`cm-bubble${c ? ' has' : ''}${c?.open ? ' open' : ''}`}
                        aria-label={c ? `${c.count} comment${c.count === 1 ? '' : 's'}, ${c.open} open: open them` : 'Add a comment'}
                        title={c ? `${c.count} comment${c.count === 1 ? '' : 's'} (${c.open} open)` : 'Add a comment'}
                        onClick={(e) => { e.stopPropagation(); onOpenComments(it.id) }}
                      >
                        {c ? c.count : '+'}
                      </button>
                      <span className="tl-title" title={it.title}>{it.title}</span>
                      {it.size && <span className="tl-size">{it.size}</span>}
                    </div>
                    <div className="tl-lane" onClick={() => onSelect(it.id)}>
                      {cols > piEnd && <div className="tl-beyond" style={{ left: `${(piEnd / cols) * 100}%` }} />}
                      {it.targeted && it.targeted !== it.start && (
                        <div className="tl-target" title={`Targeted for sprint ${it.targeted}`}
                          style={{ left: `${((it.targeted - 1) / cols) * 100}%`, width: `${(1 / cols) * 100}%` }} />
                      )}
                      <button
                        className={`tl-bar src-${it.sizeSource ?? 'size'}${it.spills ? ' spill' : ''}${sel ? ' selected' : ''}`}
                        style={{ left: `${((it.start - 1) / cols) * 100}%`, width: `${((it.end - it.start + 1) / cols) * 100}%`, '--bar': color } as CSSProperties}
                        title={tip}
                        aria-label={tip}
                        onClick={(e) => { e.stopPropagation(); onSelect(it.id) }}
                      >
                        <span>{it.size ?? ''}{it.sizeSource === 'default' ? '?' : ''}{it.spills ? ' !' : ''}</span>
                      </button>
                    </div>
                  </div>
                )
              })}
            </Fragment>
          )
        })}

        <div className="tl-links" ref={overlay} style={{ height: layout.height }} aria-hidden="true">
          {width > 0 && (
            <svg width={width} height={layout.height}>
              <defs>
                {(['crit', 'sel', 'all'] as const).map((k) => (
                  <marker key={k} id={`tl-arrow-${k}`} viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto">
                    <path d="M2 1L8 5L2 9" fill="none" stroke="context-stroke" strokeWidth="1.6" strokeLinecap="round" />
                  </marker>
                ))}
              </defs>
              {links.map(({ key, a, b, kind }) => {
                const ya = layout.y.get(a.id)!
                const yb = layout.y.get(b.id)!
                // From the end of the provider's bar down (or up) into the start of the dependant's bar.
                const down = yb > ya
                const xa = x(a.end) - 8
                const xs = x(b.start - 1) + 8
                const y1 = ya + (down ? BAR_H / 2 : -BAR_H / 2)
                const y2 = yb + (down ? -BAR_H / 2 : BAR_H / 2)
                const d = `M${xa} ${y1} V${(y1 + y2) / 2} H${xs} V${y2}`
                return <path key={key} className={`tl-link ${kind}`} d={d} markerEnd={`url(#tl-arrow-${kind})`} />
              })}
            </svg>
          )}
        </div>
      </div>

      <div className="tl-foot">
        <div className="tl-legend">
          {arts.map((a) => <span key={a}><i className="tl-chip" style={{ background: domainColor(a) }} />{a}</span>)}
          {sched && <span><i className="tl-line crit" />critical path</span>}
          {sched && <span><i className="tl-chip spill" />spills past PI</span>}
          {sched && <span><i className="tl-chip est" />size estimated</span>}
          {sched && <span><i className="tl-chip target" />targeted sprint</span>}
        </div>
        {sched && (
          <label className="toggle"><input type="checkbox" checked={allLinks} onChange={(e) => setAllLinks(e.target.checked)} /> All links</label>
        )}
      </div>

      {sched && sched.assumptions.length > 0 && (
        <details className="tl-basis">
          <summary>
            How this is scheduled · {Object.entries(sched.sizeSprints).map(([k, v]) => `${k} = ${v}`).join(' · ')} sprint{sched.sizeSprints.S === 1 ? '' : 's'}
          </summary>
          <ul>{sched.assumptions.map((t) => <li key={t}>{t}</li>)}</ul>
        </details>
      )}
      {!sched && <div className="tl-basis flat">No delivery schedule in this analysis: columns are the recommended steps, not sprints.</div>}
    </div>
  )
}
