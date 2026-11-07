import { ACCESS, SYSTEM_ORDER, SYSTEM_TYPE } from '../lib/deps'
import type { SystemItem } from '../types'

const order = (t: string) => (SYSTEM_ORDER.includes(t) ? SYSTEM_ORDER.indexOf(t) : SYSTEM_ORDER.length)

/** One-line count, e.g. "6 systems: 2 APIs · 4 services · 3 owning teams". */
export function systemsSummary(systems: SystemItem[]): string {
  const types = [...new Set(systems.map((s) => s.type))].sort((a, b) => order(a) - order(b))
  const parts = types.map((t) => {
    const n = systems.filter((s) => s.type === t).length
    return `${n} ${SYSTEM_TYPE[t] ? SYSTEM_TYPE[t][n === 1 ? 'one' : 'many'] : t}`
  })
  const teams = new Set(systems.map((s) => s.team).filter(Boolean)).size
  return `${systems.length} shared system${systems.length === 1 ? '' : 's'}: ${parts.join(' · ')}${teams ? ` · ${teams} owning team${teams === 1 ? '' : 's'}` : ''}`
}

/** Systems split by type (APIs apart from services), each with its owning team; hover a chip for how it was found. */
export function SystemChips({ systems }: { systems: SystemItem[] }) {
  const types = [...new Set(systems.map((s) => s.type))].sort((a, b) => order(a) - order(b))
  return (
    <div className="sys-groups">
      {types.map((t) => (
        <div className="sys-group" key={t}>
          <div className="sys-group-label">
            <i className={`ti ${SYSTEM_TYPE[t]?.icon ?? 'ti-server'}`} aria-hidden="true" /> {SYSTEM_TYPE[t]?.label ?? t}
          </div>
          <div className="sys-chips">
            {systems.filter((s) => s.type === t).map((s) => (
              <span
                className={`sys-chip acc-${s.access}`}
                key={s.name}
                title={[
                  s.teamName ? `Owned by the ${s.teamName} team (${s.team})` : 'No owning team in the ownership map',
                  `This initiative ${ACCESS[s.access] ?? s.access}`,
                  s.method === 'llm' ? 'Found by the LLM from the documents' : 'Found by name match in the initiative text',
                  s.quote && `“${s.quote}”`,
                ].filter(Boolean).join('\n')}
              >
                <span className="sys-name">{s.name}</span>
                <span className={`sys-team${s.teamName ? '' : ' none'}`}>{s.teamName || 'no owner'}</span>
                <span className="sys-access">{ACCESS[s.access] ?? s.access}</span>
              </span>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
