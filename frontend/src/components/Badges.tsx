import { CHANGE, LEVEL, VERDICT } from '../lib/deps'
import type { ChangeType, DepLevel, PathHop, Verdict } from '../types'
import { Tip } from './Tip'

export function ChangeBadge({ type, short = false }: { type: ChangeType; short?: boolean }) {
  const c = CHANGE[type]
  return (
    <Tip title={c.label} content={c.hint}>
      <span className={`chg chg-${type}`}>
        <i className={`ti ${c.icon}`} aria-hidden="true" /> {short ? c.short : c.label}
      </span>
    </Tip>
  )
}

export function LevelBadge({ level }: { level: DepLevel }) {
  const l = LEVEL[level]
  return (
    <Tip title={`Level: ${l.label}`} content={l.hint}>
      <span className="lvl">
        <i className={`ti ${l.icon}`} aria-hidden="true" /> {l.label}
      </span>
    </Tip>
  )
}

export function VerdictBadge({ verdict }: { verdict: Verdict }) {
  const v = VERDICT[verdict]
  return (
    <Tip title={v.label} content={v.hint}>
      <span className={`vrd vrd-${verdict}`}>
        <i className={`ti ${v.icon}`} aria-hidden="true" /> {v.label}
      </span>
    </Tip>
  )
}

/** The hops from an initiative to what it depends on, each labelled with its level. */
export function PathChain({ path }: { path: PathHop[] }) {
  return (
    <div className="path-chain" aria-label="How this dependency was reached">
      {path.map((h, i) => (
        <span className="path-hop-wrap" key={`${i}-${h.id}`}>
          {i > 0 && <i className="ti ti-arrow-right path-arrow" aria-hidden="true" />}
          <Tip title={LEVEL[h.level].label} content={LEVEL[h.level].hint}>
            <span className={`path-hop hop-${h.level}`}>
              <i className={`ti ${LEVEL[h.level].icon}`} aria-hidden="true" />
              <span className="path-hop-level">{LEVEL[h.level].label}</span>
              {h.label}
            </span>
          </Tip>
        </span>
      ))}
    </div>
  )
}
