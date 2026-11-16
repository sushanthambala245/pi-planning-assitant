import { useState } from 'react'
import { countBy, plural, risksByRule } from '../lib/deps'
import type { NotChecked, Risk } from '../types'
import { Tip } from './Tip'

const SEV_HINT = {
  High: 'High: blocks PI planning until it is resolved (for example a consumer targeted before its provider, or a team far over capacity). The DRI rule decides the severity; a model only explains it.',
  Medium: 'Medium: resolve or accept it explicitly before PI planning.',
  Low: 'Low: worth knowing; no action required.',
}

/** Risks grouped by the rule that raised them, worst first; each opens its reasoning. */
export function RiskGroups({ risks, notChecked, flags, onOpen }: { risks: Risk[]; notChecked: NotChecked[]; flags: string[]; onOpen: (id: string) => void }) {
  const groups = risksByRule(risks)
  const [open, setOpen] = useState<Record<string, boolean>>({})
  return (
    <div className="rg">
      {groups.length === 0 && <div className="list-empty">No risk flags from the checks that ran.</div>}
      {groups.map((g) => {
        const sev = countBy(g.risks, (r) => r.severity)
        const isOpen = open[g.rule] ?? g.worst === 0
        return (
          <section className={`rg-group${isOpen ? ' open' : ''}`} key={g.rule}>
            <button className="rg-head" aria-expanded={isOpen} onClick={() => setOpen((o) => ({ ...o, [g.rule]: !isOpen }))}>
              <i className={`ti ${isOpen ? 'ti-chevron-down' : 'ti-chevron-right'}`} aria-hidden="true" />
              <span className="rg-rule">{g.rule}</span>
              <span className="rg-code">{g.risks[0].ruleCode}</span>
              <span className="rg-sev">
                {(['High', 'Medium', 'Low'] as const).filter((s) => sev[s]).map((s) => (
                  <span key={s} className={`sev sev-${s[0].toLowerCase()}`}>{sev[s]} {s.toLowerCase()}</span>
                ))}
              </span>
            </button>
            {isOpen && g.risks.map((r) => (
              <button key={r.id} className="rg-item" onClick={() => onOpen(r.id)}>
                <Tip title={`${r.severity} risk`} content={SEV_HINT[r.severity]}>
                  <span className={`sev sev-${r.severity[0].toLowerCase()}`}>{r.severity}</span>
                </Tip>
                <span className="rg-title">
                  {flags.includes(r.id) && <i className="ti ti-flag-check flag-mark" aria-label="Flagged for PI planning" />}
                  {r.title.split(' — ')[1] ?? r.title}
                </span>
                <span className="rg-desc">{r.description}</span>
                <i className="ti ti-chevron-right rg-go" aria-hidden="true" />
              </button>
            ))}
          </section>
        )
      })}
      {notChecked.length > 0 && (
        <div className="rg-gaps">
          <div className="rg-gaps-head"><i className="ti ti-eye-off" aria-hidden="true" /> {plural(notChecked.length, 'check')} not run or only partly run: no flag there does not mean no risk</div>
          {notChecked.map((n) => (
            <div key={n.code} className="rg-gap"><b>{n.code}</b> {n.name}{n.partial ? ' (partly checked)' : ''}: {n.reason}.</div>
          ))}
        </div>
      )}
    </div>
  )
}
