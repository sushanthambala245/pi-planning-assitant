import { useState } from 'react'
import { CHANGE, CHANGE_ORDER, VERDICT, byTeam, countBy, needsChange, plural, teamName } from '../lib/deps'
import type { Analysis, DependencyRow, Risk } from '../types'
import { ChangeBadge, LevelBadge } from './Badges'
import { DepDetail } from './DepDetail'

export type SideTab = 'Dependencies' | 'Teams' | 'Risks' | 'Sequence'
const tabs: SideTab[] = ['Dependencies', 'Teams', 'Risks', 'Sequence']

const sevClass = { High: 'sev-h', Medium: 'sev-m', Low: 'sev-l' } as const
const sevColor = { High: 'var(--danger)', Medium: 'var(--warn)', Low: 'var(--success)' } as const

interface Props {
  analysis: Analysis
  /** Dependency rows after the screen's filters. */
  deps: DependencyRow[]
  risks: Risk[]
  /** The initiative the screen is filtered to, if any. */
  initiative: string
  /** Rows hidden because they need no change; offers to show them. */
  hiddenNoChange: number
  onShowNoChange: () => void
  activeRiskId: string | null
  onSelectRisk: (id: string) => void
  /** Risk ids flagged for PI planning. */
  flags: string[]
  labelOf: (key: string) => string
  tab: SideTab
  onTab: (tab: SideTab) => void
  /** Which tabs this panel offers (default: all); a single tab hides the tab bar. */
  only?: SideTab[]
}

export function DepRow({ dep, open, onToggle, labelOf }: { dep: DependencyRow; open: boolean; onToggle: () => void; labelOf: (k: string) => string }) {
  return (
    <div className={`dep-row${open ? ' open' : ''}`}>
      <button className="dep-row-head" aria-expanded={open} onClick={onToggle} title={open ? undefined : dep.reason}>
        <div className="dep-row-line">
          <i className={`ti ${open ? 'ti-chevron-down' : 'ti-chevron-right'} dep-row-chev`} aria-hidden="true" />
          <span className="dep-row-names">
            {dep.fromLabel} <i className="ti ti-arrow-right" aria-hidden="true" /> {dep.toLabel}
          </span>
          <LevelBadge level={dep.level} />
          <i className={`ti ${VERDICT[dep.verdict].icon} vrd-icon vrd-${dep.verdict}`} title={VERDICT[dep.verdict].label} aria-label={VERDICT[dep.verdict].label} />
        </div>
        <div className="dep-row-reason">{dep.reason}</div>
      </button>
      {open && <div className="dep-row-body"><DepDetail dep={dep} labelOf={labelOf} /></div>}
    </div>
  )
}

function HiddenNote({ n, onShow }: { n: number; onShow: () => void }) {
  if (n <= 0) return null
  return (
    <div className="hidden-note">
      <i className="ti ti-eye-off" aria-hidden="true" />
      {n} more dependenc{n === 1 ? 'y needs' : 'ies need'} no change (links to be aware of).
      <button className="link-btn" onClick={onShow}>Show them</button>
    </div>
  )
}

export function SidePanel({ analysis, deps, risks, initiative, hiddenNoChange, onShowNoChange, activeRiskId, onSelectRisk, flags, labelOf, tab, onTab, only }: Props) {
  const [open, setOpen] = useState<string | null>(null)
  const { sequence, steps, graph } = analysis
  const label = (id: string) => graph.nodes.find((n) => n.id === id)?.label ?? id
  const legacy = analysis.dependencies.length === 0 // an older analysis file: edges only, unclassified
  const teams = byTeam(deps)
  const counts: Record<SideTab, number> = {
    Dependencies: legacy ? graph.edges.length : deps.length,
    Teams: teams.filter((t) => t.team).length,
    Risks: risks.length,
    Sequence: steps.length || sequence.length,
  }
  const shown = (legacy ? tabs.filter((t) => t !== 'Teams') : tabs).filter((t) => !only || only.includes(t))
  const row = (d: DependencyRow) => (
    <DepRow key={d.key} dep={d} open={open === d.key} onToggle={() => setOpen((o) => (o === d.key ? null : d.key))} labelOf={labelOf} />
  )
  // Shared-system links between two initiatives of the same step: no order, but the teams must agree.
  const coordinate = (ids: string[]) =>
    analysis.dependencies.filter((d) => d.level === 'initiative' && needsChange(d.changeType) && ids.includes(d.from) && ids.includes(d.to))

  return (
    <div className="side-panel">
      {shown.length > 1 && <div className="side-tabs" role="tablist">
        {shown.map((t) => (
          <button
            key={t}
            role="tab"
            aria-selected={tab === t}
            className={`side-tab${tab === t ? ' active' : ''}`}
            onClick={() => onTab(t)}
          >
            {t} <span className="tab-n">{counts[t]}</span>
          </button>
        ))}
      </div>}
      <div className="side-content">
        {tab === 'Dependencies' && legacy && (graph.edges.length === 0
          ? <div className="list-empty">No dependencies were found.</div>
          : graph.edges.map((e) => (
              <div className="dep-item" key={`${e.from}-${e.to}`}>
                <span>{label(e.from)} → {label(e.to)}</span>
                <span className={`dep-tag${e.inferred ? ' inferred' : ''}`}>{e.inferred ? 'inferred' : 'stated'}</span>
              </div>
            )))}

        {tab === 'Dependencies' && !legacy && (
          <>
            {deps.length === 0 && <div className="list-empty">No dependency matches the current filter.</div>}
            {CHANGE_ORDER.map((c) => {
              const rows = deps.filter((d) => d.changeType === c)
              if (!rows.length) return null
              return (
                <section className="dep-section" key={c}>
                  <div className={`dep-section-head chg-text-${c}`} title={CHANGE[c].hint}>
                    <i className={`ti ${CHANGE[c].icon}`} aria-hidden="true" /> {CHANGE[c].label}
                    <span className="dep-section-n">{rows.length}</span>
                  </div>
                  <div className="dep-section-hint">{CHANGE[c].hint}</div>
                  {rows.map(row)}
                </section>
              )
            })}
            <HiddenNote n={hiddenNoChange} onShow={onShowNoChange} />
          </>
        )}

        {tab === 'Teams' && (
          <>
            <div className="tab-intro">Who to talk to before PI planning, and what each team is asked for.</div>
            {teams.length === 0 && <div className="list-empty">No dependency matches the current filter.</div>}
            {teams.map(({ team, deps: rows }) => {
              const by = countBy(rows, (d) => d.changeType)
              const from = new Set(rows.map((d) => d.from)).size
              return (
                <section className={`team-group${team ? '' : ' no-owner'}`} key={team || '-'}>
                  <div className="team-head">
                    <i className={`ti ${team ? 'ti-users' : 'ti-user-question'}`} aria-hidden="true" />
                    <span className="team-name">{team ? teamName(team) : 'No owning team in the data'}</span>
                    <span className="team-sub">{plural(from, 'initiative')} need{from === 1 ? 's' : ''} them</span>
                  </div>
                  <div className="team-badges">
                    {CHANGE_ORDER.filter((c) => by[c]).map((c) => (
                      <span key={c} className="team-badge"><ChangeBadge type={c} short /> × {by[c]}</span>
                    ))}
                  </div>
                  {!team && <div className="team-warn">Nobody is named as owner: find one before PI planning.</div>}
                  {rows.map(row)}
                </section>
              )
            })}
            <HiddenNote n={hiddenNoChange} onShow={onShowNoChange} />
          </>
        )}

        {tab === 'Risks' && (risks.length === 0
          ? <div className="list-empty">{initiative ? 'No risks flagged for this initiative.' : 'No risks were flagged.'}</div>
          : risks.map((r) => {
              const active = r.id === activeRiskId
              return (
                <button key={r.id} className={`risk-item${active ? ' active-row' : ''}`} onClick={() => onSelectRisk(r.id)}>
                  <div className="risk-dot" style={{ background: sevColor[r.severity] }} />
                  <div style={{ flex: 1 }}>
                    <div className="risk-head">
                      <div className="risk-title">
                        {flags.includes(r.id) && <i className="ti ti-flag-check flag-mark" title="Flagged for PI planning" aria-label="Flagged" />}
                        {r.title}
                      </div>
                      <span className={`sev ${sevClass[r.severity]}`}>{r.severity}</span>
                    </div>
                    <div className="risk-desc">{r.description}</div>
                    <div className="click-hint">
                      <i className={`ti ${active ? 'ti-arrow-right' : 'ti-chevron-right'}`} aria-hidden="true" />
                      {active ? 'Reasoning open' : 'Click to see why it was flagged'}
                    </div>
                  </div>
                </button>
              )
            }))}

        {tab === 'Sequence' && (steps.length > 0
          ? steps.map((s) => (
              <div className={`seq-step${initiative && s.initiativeIds.includes(initiative) ? ' here' : ''}`} key={s.step}>
                <div className="init-num">{s.step}</div>
                <div>
                  <div className="seq-label">{s.label}{s.inCycle && <span className="sev sev-h" style={{ marginLeft: 6 }}>cycle</span>}</div>
                  {s.why && <div className="seq-why">{s.why}</div>}
                  {coordinate(s.initiativeIds).map((d) => (
                    <div className="seq-coord" key={d.key} title={d.reason}>
                      <i className="ti ti-arrows-exchange" aria-hidden="true" />
                      <span>Coordinate in this step: {d.fromLabel} ↔ {d.toLabel}</span>
                      <ChangeBadge type={d.changeType} short />
                    </div>
                  ))}
                </div>
              </div>
            ))
          : sequence.length === 0
            ? <div className="list-empty">No sequence was recommended.</div>
            : sequence.map((s, i) => (
                <div className="seq-item" key={`${i}-${s}`}>
                  <div className="init-num">{i + 1}</div>
                  {s}
                </div>
              )))}
      </div>
    </div>
  )
}
