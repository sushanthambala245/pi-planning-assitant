import type { Analysis, ChangeType, DependencyRow, DepLevel, Finding, PathHop, Verdict } from '../types'

/** What each change class asks of people. Order = most to least work. */
export const CHANGE: Record<ChangeType, { label: string; short: string; icon: string; hint: string }> = {
  code: { label: 'Code change', short: 'Code change', icon: 'ti-code', hint: 'Someone must change code before or alongside this initiative' },
  flow: { label: 'Flow / integration change', short: 'Flow change', icon: 'ti-arrows-exchange', hint: 'An integration, data flow or interface contract must be agreed' },
  regression: { label: 'Regression testing', short: 'Retest', icon: 'ti-test-pipe', hint: 'Nothing to build, but something must be re-tested after the change' },
  none: { label: 'No change needed', short: 'No change', icon: 'ti-eye', hint: 'Awareness only: nothing to build, agree or re-test' },
}
export const CHANGE_ORDER: ChangeType[] = ['code', 'flow', 'regression', 'none']
export const needsChange = (c: ChangeType | undefined) => c !== undefined && c !== 'none'

/** Levels of abstraction: what a dependency is on, and the hops in between. */
export const LEVEL: Record<DepLevel | PathHop['level'], { label: string; icon: string; hint: string }> = {
  initiative: { label: 'Initiative', icon: 'ti-target', hint: 'Another initiative planned in this PI: the work must be sequenced' },
  team: { label: 'Team', icon: 'ti-users', hint: 'Another team: their people, capacity or approval are needed' },
  system: { label: 'System', icon: 'ti-server', hint: 'A shared service, API or dataset' },
  repo: { label: 'Repository', icon: 'ti-brand-git', hint: 'A code repository (from the repo manifests)' },
}
export const LEVEL_ORDER: DepLevel[] = ['initiative', 'team', 'system']

/**
 * How sure we are, in three words used everywhere: *stated* = written down in Jira, Confluence
 * or Slack; *inferred* = found in code manifests or the ownership map; *confirmed* = both.
 * Verdicts are per initiative and owning team, so a link can be confirmed by a related link.
 */
export const VERDICT: Record<Verdict, { label: string; icon: string; hint: string }> = {
  confirmed: { label: 'Confirmed', icon: 'ti-circle-check', hint: 'Written down (stated), and the code or ownership data points the same way for this team' },
  stated_only: { label: 'Stated only', icon: 'ti-quote', hint: 'Written in Jira / Confluence / Slack, but not visible in code or ownership data' },
  inferred_only: { label: 'Inferred only', icon: 'ti-git-fork', hint: 'Inferred from code manifests or the ownership map, but nobody has written it down: confirm it with the team' },
}

export const METHOD: Record<string, string> = {
  explicit: 'Stated in text',
  code: 'Code manifest',
  ownership: 'Ownership map',
  constraint: 'Reviewer',
}

export const SYSTEM_TYPE: Record<string, { label: string; one: string; many: string; icon: string }> = {
  service: { label: 'Services', one: 'service', many: 'services', icon: 'ti-server' },
  api: { label: 'APIs', one: 'API', many: 'APIs', icon: 'ti-api' },
  dataset: { label: 'Datasets', one: 'dataset', many: 'datasets', icon: 'ti-database' },
  capability: { label: 'Ledger capabilities', one: 'ledger capability', many: 'ledger capabilities', icon: 'ti-stack-2' },
}
export const SYSTEM_ORDER = ['api', 'service', 'capability', 'dataset']

export const ACCESS: Record<string, string> = {
  changes: 'changes it',
  writes: 'writes to it',
  reads: 'reads from it',
  unclear: 'access not stated',
}

/** Finding filter chips on the Analysis screen, keyed by the agent's finding kind. */
export const FINDING_KIND: Record<string, string> = {
  systems: 'Systems',
  explicit: 'Stated',
  inferred: 'Inferred',
  rejected: 'Rejected',
  sequence: 'Sequence',
  risk: 'Risks',
}

/** Initiatives a finding is about. Older analysis files carry no ids, so fall back to names in the text. */
export function findingInitiatives(f: Finding, analysis: Analysis): string[] {
  if (f.initiativeIds) return f.initiativeIds
  return analysis.initiatives
    .filter((i) => new RegExp(`\\b${i.id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(f.text) || f.text.includes(i.title))
    .map((i) => i.id)
}

/** Dependencies an initiative is on either end of. */
export const touches = (d: DependencyRow, id: string) => d.from === id || d.to === id

/** "Run A → Posting Engine (team)": the level tells apart a team and a system with the same name. */
export const depLabel = (d: DependencyRow) => `${d.fromLabel} → ${d.toLabel} (${LEVEL[d.level].label.toLowerCase()})`

/** The team a dependency asks something of; empty when the target has no owner in the data. */
export const askedTeam = (d: DependencyRow) => d.toTeam || (d.level === 'team' ? d.toLabel : '')

/** "Posting Engine team", unless the name already says so. */
export const teamName = (name: string) => (/\bteam$/i.test(name) ? name : `${name} team`)

const RANK: Record<ChangeType, number> = { code: 3, flow: 2, regression: 1, none: 0 }

/** Dependencies grouped by the team they ask something of, the teams with the most work first. */
export function byTeam(deps: DependencyRow[]): { team: string; deps: DependencyRow[] }[] {
  const groups = new Map<string, DependencyRow[]>()
  for (const d of deps) groups.set(askedTeam(d), [...(groups.get(askedTeam(d)) ?? []), d])
  const weight = (rows: DependencyRow[]) => rows.reduce((s, d) => s + RANK[d.changeType] * 10 + 1, 0)
  return [...groups.entries()]
    .map(([team, rows]) => ({ team, deps: [...rows].sort((a, b) => RANK[b.changeType] - RANK[a.changeType]) }))
    .sort((a, b) => Number(!a.team) - Number(!b.team) || weight(b.deps) - weight(a.deps) || a.team.localeCompare(b.team))
}

export function countBy<T, K extends string>(items: T[], key: (t: T) => K): Record<K, number> {
  const out = {} as Record<K, number>
  for (const t of items) out[key(t)] = (out[key(t)] ?? 0) + 1
  return out
}

export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

/** Risks grouped by the rule that raised them, most severe first: "2 × No owner for a shared service". */
export function risksByRule(risks: Analysis['risks']) {
  const sevRank = { High: 0, Medium: 1, Low: 2 } as const
  const groups = new Map<string, Analysis['risks']>()
  for (const r of risks) {
    const rule = r.rule ?? r.title.split(' — ')[0]
    groups.set(rule, [...(groups.get(rule) ?? []), r])
  }
  return [...groups.entries()]
    .map(([rule, rs]) => ({ rule, risks: rs, worst: Math.min(...rs.map((r) => sevRank[r.severity])) }))
    .sort((a, b) => a.worst - b.worst || b.risks.length - a.risks.length)
}
