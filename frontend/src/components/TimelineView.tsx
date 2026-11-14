import { Fragment, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { domainColor } from '../data/domains'
import type { CommentCounts } from '../hooks/useComments'
import { plural } from '../lib/deps'
import { LATER, PRIORITY_RANK, criticalChain, planStatus } from '../lib/plan'
import type { Analysis, Plan, PlanItem, SizeSource } from '../types'
import { Tip } from './Tip'

// The delivery timeline (after Bhasker Rao's TimelineView, results-timeline-comments), drawn from the
// quarter plan: one chevron bar per initiative across the quarters' sprints, at its T-shirt size
// against its team's velocity, after what it waits for.

export type GroupBy = 'quarter' | 'step' | 'team' | 'art'

export const GROUP_LABEL: Record<GroupBy, string> = { quarter: 'Quarter', step: 'Dependency step', team: 'Team', art: 'ART' }

const SIZE_FROM: Record<SizeSource, string> = {
  tshirt: 'size from the data', planner: 'size set by a planner', estimate: 'size estimated from story points',
  assumed: 'not sized: default size assumed', none: 'no size',
}

const GROUP_H = 28
const ROW_H = 30
const BAR_H = 18
/** The label column; the sprint lanes (and the link overlay) start after it. */
const LABEL_W = 300

interface Row {
  item: PlanItem
  step: number
  critical: boolean
}

interface Props {
  analysis: Analysis
  plan: Plan
  groupBy: GroupBy
  /** Initiatives to show; null shows all of them. */
  visibleIds: Set<string> | null
  selectedId: string | null
  counts: Map<string, CommentCounts>
  onSelect: (id: string) => void
  onOpenComments: (id: string) => void
}

export function TimelineView({ analysis, plan, groupBy, visibleIds, selectedId, counts, onSelect, onOpenComments }: Props) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [allLinks, setAllLinks] = useState(false)
  const [width, setWidth] = useState(0)
  const overlay = useRef<HTMLDivElement>(null)

  const rows = useMemo<Row[]>(() => {
    const stepOf = new Map<string, number>()
    for (const s of analysis.steps) for (const id of s.initiativeIds) stepOf.set(id, s.step)
    const crit = criticalChain(plan)
    return plan.items.map((item) => ({ item, step: stepOf.get(item.id) ?? 1, critical: crit.size > 1 && crit.has(item.id) }))
  }, [analysis, plan])
  const shown = useMemo(() => rows.filter((r) => !visibleIds || visibleIds.has(r.item.id)), [rows, visibleIds])

  // Columns: every sprint up to the end of the last quarter any work reaches (at least one quarter).
  const lastFinish = Math.max(0, ...plan.items.map((i) => i.finish))
  const lastPi = plan.sprints[lastFinish]?.pi
  const cols = Math.max(plan.sprintsPerPi, lastPi ? Math.max(...plan.sprints.filter((s) => s.pi === lastPi).map((s) => s.index)) + 1 : lastFinish + 1)
  const sprintAt = (k: number) => plan.sprints[k]
  const quarters = useMemo(() => {
    const out: { pi: string; from: number; to: number; assumed: boolean }[] = []
    for (let k = 0; k < cols; k++) {
      const pi = sprintAt(k)?.pi ?? LATER
      const last = out[out.length - 1]
      if (last && last.pi === pi) last.to = k
      else out.push({ pi, from: k, to: k, assumed: !!sprintAt(k)?.assumed || !plan.horizon.includes(pi) })
    }
    return out
  }, [cols, plan]) // eslint-disable-line react-hooks/exhaustive-deps

  const groups = useMemo(() => {
    const m = new Map<string, { key: string; sort: string; label: string; rows: Row[]; cycle: boolean }>()
    for (const r of shown) {
      const i = r.item
      const key = groupBy === 'quarter' ? i.pi || LATER : groupBy === 'step' ? `step-${r.step}` : groupBy === 'team' ? i.teamName || i.team : i.art || 'Other'
      const sort = groupBy === 'quarter' ? String(i.start).padStart(4, '0') : groupBy === 'step' ? String(r.step).padStart(3, '0') : key
      const label = groupBy === 'step' ? `Step ${r.step}` : key
      const g = m.get(key) ?? { key, sort, label, rows: [], cycle: false }
      g.rows.push(r)
      g.cycle ||= i.inCycle
      if (sort < g.sort) g.sort = sort
      m.set(key, g)
    }
    const prio = (i: PlanItem) => PRIORITY_RANK[i.priority.toLowerCase()] ?? 4
    return [...m.values()]
      .sort((a, b) => a.sort.localeCompare(b.sort))
      .map((g) => ({ ...g, rows: [...g.rows].sort((a, b) => a.item.start - b.item.start || prio(a.item) - prio(b.item) || a.item.title.localeCompare(b.item.title)) }))
  }, [shown, groupBy])

  // Row positions, so links can be drawn between bars.
  const layout = useMemo(() => {
    const y = new Map<string, number>()
    let at = 0
    for (const g of groups) {
      at += GROUP_H
      if (collapsed.has(g.key)) continue
      for (const r of g.rows) { y.set(r.item.id, at + ROW_H / 2); at += ROW_H }
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
    const out: { key: string; a: Row; b: Row; kind: 'crit' | 'sel' | 'all' }[] = []
    const byId = new Map(shown.map((r) => [r.item.id, r]))
    for (const b of shown) {
      for (const p of b.item.waitsFor) {
        const a = byId.get(p)
        if (!a || !layout.y.has(a.item.id) || !layout.y.has(b.item.id)) continue
        const kind = a.critical && b.critical ? 'crit' : a.item.id === selectedId || b.item.id === selectedId ? 'sel' : allLinks ? 'all' : null
        if (kind) out.push({ key: `${a.item.id}>${b.item.id}`, a, b, kind })
      }
    }
    return out
  }, [shown, layout, selectedId, allLinks])

  if (!rows.length) return <div className="list-empty">No initiatives to place on a timeline.</div>

  const toggle = (key: string) => setCollapsed((s) => { const n = new Set(s); if (n.has(key)) n.delete(key); else n.add(key); return n })
  const arts = [...new Set(rows.map((r) => r.item.art || 'Other'))]
  const pct = (n: number) => `${(Math.max(0, n) / cols) * 100}%`
  const style = { '--cols': cols, '--label-w': `${LABEL_W}px`, '--row-h': `${ROW_H}px`, '--group-h': `${GROUP_H}px` } as CSSProperties
  const span = (g: { rows: Row[] }) => {
    const lo = Math.min(...g.rows.map((r) => r.item.start))
    const hi = Math.max(...g.rows.map((r) => r.item.finish))
    return lo === hi ? sprintAt(lo)?.short ?? '' : `${sprintAt(lo)?.short ?? lo} – ${sprintAt(hi)?.short ?? hi}`
  }

  return (
    <div className="dt" style={style}>
      <div className="dt-head">
        <div className="dt-label-h">Initiative</div>
        <div className="dt-cols">
          <div className="dt-quarters">
            {quarters.map((q) => (
              <div key={q.pi + q.from} className={`dt-q${q.assumed ? ' beyond' : ''}`} style={{ gridColumn: `${q.from + 1} / ${q.to + 2}` }}>
                {q.assumed ? `${q.pi} (after the horizon)` : q.pi}
              </div>
            ))}
          </div>
          <div className="dt-sprints">
            {Array.from({ length: cols }, (_, k) => {
              const s = sprintAt(k)
              return <div key={k} className="dt-s">{s ? s.short.replace(`${s.pi} `, '') : `+${k}`}</div>
            })}
          </div>
        </div>
      </div>

      <div className="dt-body">
        {shown.length === 0 && <div className="list-empty" style={{ margin: '12px 0' }}>No initiatives match the filters.</div>}
        {groups.map((g) => {
          const closed = collapsed.has(g.key)
          const pts = g.rows.reduce((s, r) => s + r.item.points, 0)
          return (
            <Fragment key={g.key}>
              <button className="dt-group" aria-expanded={!closed} onClick={() => toggle(g.key)}>
                <i className={`ti ${closed ? 'ti-chevron-right' : 'ti-chevron-down'}`} aria-hidden="true" />
                <b>{g.label}</b>
                <span>{plural(g.rows.length, 'initiative')} · {pts} pts · {span(g)}</span>
                {g.cycle && <span className="sev sev-h">cycle: break it first</span>}
              </button>
              {!closed && g.rows.map(({ item: it, critical }) => {
                const c = counts.get(it.id)
                const sel = it.id === selectedId
                const st = planStatus(it)
                const late = it.deadline !== null && it.deadline !== undefined && it.finish > it.deadline
                const hasTarget = it.plannedIndex !== null && it.plannedIndex !== undefined && it.deadline !== null && it.deadline !== undefined
                return (
                  <div key={it.id} className={`dt-row${sel ? ' selected' : ''}`}>
                    <div className="dt-label" onClick={() => onSelect(it.id)}>
                      <Tip title={c ? plural(c.count, 'comment') : 'Comments'} content={c ? `${c.open} open. Click to read the thread or add to it.` : 'No comments yet. Click to add the first one.'}>
                        <button
                          className={`cm-bubble${c ? ' has' : ''}${c?.open ? ' open' : ''}`}
                          aria-label={c ? `${c.count} comment${c.count === 1 ? '' : 's'}, ${c.open} open: open them` : 'Add a comment'}
                          onClick={(e) => { e.stopPropagation(); onOpenComments(it.id) }}
                        >
                          {c ? c.count : '+'}
                        </button>
                      </Tip>
                      <span className="dt-title">{it.title}</span>
                      <span className={`dt-status s-${st.cls}`}>{st.label}</span>
                    </div>
                    <div className="dt-lane" onClick={() => onSelect(it.id)}>
                      {hasTarget && (
                        <div className="dt-target" style={{ left: pct(it.plannedIndex!), width: pct(Math.min(it.deadline!, cols - 1) - it.plannedIndex! + 1) }} />
                      )}
                      <Tip as="div" className="dt-bar-wrap" wide
                        style={{ left: pct(it.start), width: pct(it.finish - it.start + 1) }}
                        title={`${it.title} · ${it.startLabel}${it.finish !== it.start ? ` → ${it.finishLabel}` : ''}`}
                        content={<>
                          <div>{it.teamName} · size {it.size ?? '?'} ({it.points} pts, {SIZE_FROM[it.sizeSource]}) · targeted at {it.targetQuarter || 'no quarter'} · <b>{st.label}</b></div>
                          <ul className="tip-list">{it.reasons.map((r) => <li key={r}>{r}</li>)}</ul>
                          {critical && <div>On the longest chain of waits: a slip here moves the last finish.</div>}
                        </>}>
                        <button
                          className={`dt-bar src-${it.sizeSource}${late ? ' late' : ''}${critical ? ' crit' : ''}${sel ? ' selected' : ''}`}
                          style={{ '--bar': domainColor(it.art || 'Other') } as CSSProperties}
                          aria-label={`${it.title}: ${it.startLabel} to ${it.finishLabel}, ${st.label}`}
                          onClick={(e) => { e.stopPropagation(); onSelect(it.id) }}
                        >
                          <span>{it.size ?? ''}{it.sizeSource === 'assumed' ? '?' : ''}{late ? ' !' : ''}</span>
                        </button>
                      </Tip>
                    </div>
                  </div>
                )
              })}
            </Fragment>
          )
        })}

        <div className="dt-links" ref={overlay} style={{ height: layout.height }} aria-hidden="true">
          {width > 0 && (
            <svg width={width} height={layout.height}>
              <defs>
                {(['crit', 'sel', 'all'] as const).map((k) => (
                  <marker key={k} id={`dt-arrow-${k}`} viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto">
                    <path d="M2 1L8 5L2 9" fill="none" stroke="context-stroke" strokeWidth="1.6" strokeLinecap="round" />
                  </marker>
                ))}
              </defs>
              {links.map(({ key, a, b, kind }) => {
                const ya = layout.y.get(a.item.id)!
                const yb = layout.y.get(b.item.id)!
                // From the end of the provider's bar down (or up) into the start of the dependant's bar.
                const down = yb > ya
                const xa = x(a.item.finish + 1) - 8
                const xs = x(b.item.start) + 8
                const y1 = ya + (down ? BAR_H / 2 : -BAR_H / 2)
                const y2 = yb + (down ? -BAR_H / 2 : BAR_H / 2)
                const d = `M${xa} ${y1} V${(y1 + y2) / 2} H${xs} V${y2}`
                return <path key={key} className={`dt-link ${kind}`} d={d} markerEnd={`url(#dt-arrow-${kind})`} />
              })}
            </svg>
          )}
        </div>
      </div>

      <div className="dt-foot">
        <div className="dt-legend">
          {arts.map((a) => <span key={a}><i className="dt-chip" style={{ background: domainColor(a) }} />{a}</span>)}
          <Tip title="Targeted quarter" content="The quarter the team targeted in the initiatives file (or the one you placed it in on the Decisions screen). A bar outside its box starts or ends outside that quarter."><span><i className="dt-chip target" />targeted quarter</span></Tip>
          <Tip title="After the target" content="The work finishes after its targeted quarter ends: it waits for something that lands late, its team has no room, or its size does not fit at the team’s velocity."><span><i className="dt-chip late" />after the target</span></Tip>
          <Tip title="Size not from the data" content="Hatched: the size was estimated from story points (an older export) or assumed (no T-shirt size: scheduled as the default until someone sizes it)."><span><i className="dt-chip est" />size estimated or assumed</span></Tip>
          <Tip title="Longest chain of waits" content="From the initiative that finishes last among those that wait for something, back through the provider each one waits for longest. A slip anywhere on it moves that last finish."><span><i className="dt-line crit" />longest chain</span></Tip>
        </div>
        <label className="toggle"><input type="checkbox" checked={allLinks} onChange={(e) => setAllLinks(e.target.checked)} /> Show every wait as a line</label>
      </div>

      <details className="dt-basis">
        <summary>How this is scheduled · {plan.sprintsPerPi} sprints a quarter · {plan.tshirt.map((t) => `${t.size} = ${t.points}`).join(' · ')} pts</summary>
        <ul>
          <li>Each initiative starts no earlier than its target quarter and the sprint after everything it waits for has finished.</li>
          <li>Its T-shirt size in story points fills its team’s capacity sprint by sprint (the team capacity file), so the same size takes longer for a slower team; higher priority goes first when a team is full.</li>
          <li>Without a size it is scheduled as {plan.defaultSize} and hatched until someone sizes it (in the initiative’s details, then rerun).</li>
        </ul>
      </details>
    </div>
  )
}
