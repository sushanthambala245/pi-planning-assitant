import { CHANGE, LEVEL, VERDICT } from '../lib/deps'
import type { ChangeType, DepLevel, PathHop, Verdict } from '../types'

export function ChangeBadge({ type, short = false }: { type: ChangeType; short?: boolean }) {
  const c = CHANGE[type]
  return (
    <span className={`chg chg-${type}`} title={c.hint}>
      <i className={`ti ${c.icon}`} aria-hidden="true" /> {short ? c.short : c.label}
    </span>
  )
}

export function LevelBadge({ level }: { level: DepLevel }) {
  const l = LEVEL[level]
  return (
    <span className="lvl" title={l.hint}>
      <i className={`ti ${l.icon}`} aria-hidden="true" /> {l.label}
    </span>
  )
}

export function VerdictBadge({ verdict }: { verdict: Verdict }) {
  const v = VERDICT[verdict]
  return (
    <span className={`vrd vrd-${verdict}`} title={v.hint}>
      <i className={`ti ${v.icon}`} aria-hidden="true" /> {v.label}
    </span>
  )
}

/** The hops from an initiative to what it depends on, each labelled with its level. */
export function PathChain({ path }: { path: PathHop[] }) {
  return (
    <div className="path-chain" aria-label="How this dependency was reached">
      {path.map((h, i) => (
        <span className="path-hop-wrap" key={`${i}-${h.id}`}>
          {i > 0 && <i className="ti ti-arrow-right path-arrow" aria-hidden="true" />}
          <span className={`path-hop hop-${h.level}`} title={LEVEL[h.level].hint}>
            <i className={`ti ${LEVEL[h.level].icon}`} aria-hidden="true" />
            <span className="path-hop-level">{LEVEL[h.level].label}</span>
            {h.label}
          </span>
        </span>
      ))}
    </div>
  )
}
