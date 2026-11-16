import { useState } from 'react'
import { FINDING_KIND, countBy, findingInitiatives } from '../lib/deps'
import type { Analysis, DependencyRow, Finding, InitiativeRef } from '../types'
import { FindingRow } from './FindingRow'

interface Props {
  analysis: Analysis
  findings: Finding[]
  initiatives: InitiativeRef[]
  /** Show the findings that span the whole run (e.g. the sequence) in their own group. */
  showShared: boolean
  expanded: Set<string>
  onToggle: (text: string) => void
  depsByKey: Map<string, DependencyRow>
  labelOf: (key: string) => string
}

/** Findings grouped under the initiative they are about; a finding about two initiatives shows under both. */
export function FindingGroups({ analysis, findings, initiatives, showShared, expanded, onToggle, depsByKey, labelOf }: Props) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const ids = new Map(findings.map((f) => [f.text, findingInitiatives(f, analysis)]))
  const groups = initiatives.map((ini) => ({ ini, items: findings.filter((f) => ids.get(f.text)?.includes(ini.id)) }))
  const shared = findings.filter((f) => !ids.get(f.text)?.length)

  const flip = (id: string) =>
    setCollapsed((s) => {
      const n = new Set(s)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })

  const rows = (items: Finding[]) =>
    items.map((f) => (
      <FindingRow
        key={f.text}
        finding={f}
        dep={f.depKey ? depsByKey.get(f.depKey) : undefined}
        expanded={expanded.has(f.text)}
        onToggle={() => onToggle(f.text)}
        labelOf={labelOf}
      />
    ))

  // Older analysis files do not list initiatives: fall back to one flat list.
  if (!initiatives.length) return <>{rows(findings)}</>

  return (
    <>
      {groups.map(({ ini, items }) => {
        const open = !collapsed.has(ini.id)
        const kinds = countBy(items, (f) => f.kind || 'other')
        return (
          <section className="fgroup" key={ini.id}>
            <button className="fgroup-head" aria-expanded={open} onClick={() => flip(ini.id)}>
              <i className={`ti ${open ? 'ti-chevron-down' : 'ti-chevron-right'}`} aria-hidden="true" />
              <span className="fgroup-title">{ini.title}</span>
              <span className="fgroup-meta">{ini.id}{ini.teamName && ` · ${ini.teamName}`}</span>
              <span className="fgroup-counts">
                {items.length === 0 ? 'no findings shown' : Object.entries(kinds).map(([k, n]) => `${FINDING_KIND[k] ?? k} ${n}`).join(' · ')}
              </span>
            </button>
            {open && <div className="fgroup-body">{items.length ? rows(items) : <div className="fgroup-empty">Nothing matches the current filter.</div>}</div>}
          </section>
        )
      })}
      {showShared && shared.length > 0 && (
        <section className="fgroup">
          <button className="fgroup-head" aria-expanded={!collapsed.has('*')} onClick={() => flip('*')}>
            <i className={`ti ${collapsed.has('*') ? 'ti-chevron-right' : 'ti-chevron-down'}`} aria-hidden="true" />
            <span className="fgroup-title">Across initiatives</span>
            <span className="fgroup-counts">{shared.length} finding{shared.length === 1 ? '' : 's'}</span>
          </button>
          {!collapsed.has('*') && <div className="fgroup-body">{rows(shared)}</div>}
        </section>
      )}
    </>
  )
}
