import { useEffect, useState } from 'react'
import type { Impact, Plan, PlanItem, PlannerInput, PlanTeam, Provenance, SizeSource } from '../types'

/**
 * Words and explanations for the planning views: where a dependency came from, what it does to the
 * plan, T-shirt sizes and team velocity, the quarter buckets of the decision dashboard and the checks
 * it runs on a placement. The long `hint` texts are shown in tooltips, so each explains the rule
 * behind the number it sits on.
 */

export const PROVENANCE: Record<Provenance, { label: string; icon: string; hint: string; hidden: boolean }> = {
  declared: {
    label: 'Declared', icon: 'ti-clipboard-check', hidden: false,
    hint: 'User-defined. The initiative lists this system in its own dependency column ("Upstream: …; Downstream: …"). Upstream means the initiative consumes the system; downstream means the system consumes what the initiative produces. The owning team comes from the ownership lookup.',
  },
  planner: {
    label: 'Planner', icon: 'ti-user-edit', hidden: false,
    hint: 'User-defined by a planner after a run: written in a planner note ("blocked on INIT-005"), or kept with "Keep" on a hidden dependency. From the next run on it counts as declared.',
  },
  stated: {
    label: 'In the text', icon: 'ti-quote', hidden: true,
    hint: 'Hidden. The initiative’s description says it ("requires …", "blocked on …", or it names another team) but its dependency column does not declare it. The quote is checked word for word against the description.',
  },
  inferred: {
    label: 'Inferred', icon: 'ti-git-fork', hidden: true,
    hint: 'Hidden. Nobody wrote it down. The agents found it in the GitHub manifests (a repo of its team calls a repo of the other team, and the initiative builds on that team’s systems or the other one changes an interface; or a shared library it changes), or because two initiatives touch the same system and one of them owns it.',
  },
}

export const IMPACT: Record<Impact, { label: string; icon: string; hint: string; rank: number }> = {
  orders: {
    label: 'Changes the order', icon: 'ti-arrows-sort', rank: 0,
    hint: 'The target must land first. Either the text states it ("blocked on", "requires" another initiative), or the team that owns a shared system changes it in its own initiative while this one consumes it. The sequence and the quarter plan respect it: the consumer starts the sprint after the provider finishes.',
  },
  soft: {
    label: 'Should go first', icon: 'ti-arrow-big-up-lines', rank: 1,
    hint: 'A GitHub code link onto an API, contract or library repo of a team whose initiative changes an interface (its text says API, schema, version, migrate …). Better done first, but it does not move the plan: re-test after it lands.',
  },
  coordinate: {
    label: 'Coordinate', icon: 'ti-arrows-exchange', rank: 2,
    hint: 'No order is forced, but the teams must agree something before PI planning: a code change, an interface or a data flow on a system both touch.',
  },
  retest: {
    label: 'Re-test', icon: 'ti-test-pipe', rank: 3,
    hint: 'Nothing to build or agree, but a regression test is needed after the other change lands (a code call, a read-only consumer, a shared library).',
  },
  aware: {
    label: 'Awareness', icon: 'ti-eye', rank: 4,
    hint: 'Nothing to build, agree or re-test: for example both only read the system, or the system belongs to the initiative’s own team. Listed so nothing is a surprise at PI planning.',
  },
}
export const IMPACT_ORDER: Impact[] = ['orders', 'soft', 'coordinate', 'retest', 'aware']

/** How a dependency was found, by method (DependencyRow.methods). */
export const FOUND_BY: Record<string, { label: string; icon: string; hint: string }> = {
  declared: { label: 'Dependency column', icon: 'ti-clipboard-list', hint: 'The initiative’s own dependency column in the initiatives file (S1): what its team declared.' },
  explicit: { label: 'Description', icon: 'ti-quote', hint: 'Read from the initiative’s description or a planner note: a "blocked on / requires / waiting for" statement, or another team named in it. With an API key the LLM also reads who needs whom; without one a rule-based reader is used (and labelled).' },
  ownership: { label: 'Shared system', icon: 'ti-sitemap', hint: 'Two initiatives touch the same system, and the ownership lookup says which team owns it; or the text names a system another team owns without declaring it.' },
  code: { label: 'GitHub code', icon: 'ti-brand-github', hint: 'A repository of this initiative’s team declares an internal dependency on a repository of the other initiative’s team (GitHub repos: declared_internal_repo_ids), and either this initiative builds on a system that team owns, or the other initiative changes an interface on an api or contracts repo. Team-level couplings without either are not counted.' },
  library: { label: 'Shared library', icon: 'ti-package', hint: 'The initiative changes a shared library (its text names it with an interface word); every other team whose repositories declare that library has to re-test (GitHub repos: declared_shared_libraries).' },
  constraint: { label: 'Reviewer', icon: 'ti-user-check', hint: 'A reviewer said which initiative must come first.' },
}

export const SIZES = ['XS', 'S', 'M', 'L', 'XL', 'XXL'] as const
export const PRIORITY_RANK: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 }
export const prioClass = (p: string) => `prio prio-${(p || 'none').toLowerCase()}`

export const PRIORITY_HINT = 'Priority from the initiatives file. When two initiatives compete for the same team’s capacity, the higher priority is scheduled first; it does not override a dependency.'

/** The T-shirt scale (backend TSHIRT_POINTS): a run's plan, or the scale /api/health reports. */
export type Scale = Pick<Plan, 'tshirt'>

/** The T-shirt scale in words. */
export function tshirtHint(plan?: Scale | null): string {
  const scale = plan?.tshirt.length ? plan.tshirt : [{ size: 'XS', points: 3 }, { size: 'S', points: 5 }, { size: 'M', points: 8 }, { size: 'L', points: 13 }, { size: 'XL', points: 21 }, { size: 'XXL', points: 34 }]
  return `T-shirt size from the initiatives file ("T-Shirt Sizing"). Each size is worth story points, the unit of team capacity: ${scale.map((s) => `${s.size} = ${s.points}`).join(', ')}. The same size takes a bigger share of a slow team’s quarter than of a fast one’s. A planner can change the size; the next run uses the new points.`
}

export const SIZE_SOURCE: Record<SizeSource, string> = {
  tshirt: 'From the initiatives file.',
  planner: 'Set by a planner for this run.',
  estimate: 'From the story points in an older export.',
  assumed: 'Not sized in the data: scheduled at the default size until someone sets one. Size it before PI planning.',
  none: 'No size: assumed to fit in one sprint.',
}

/** A team's velocity tier and capacity in words. */
export function velocityHint(team: Pick<PlanTeam, 'name' | 'quarterCapacity' | 'average' | 'tier'>, plan?: Pick<Plan, 'tshirt' | 'velocityTiers' | 'sprintsPerPi'> | null): string {
  const tiers = plan?.velocityTiers.length ? plan.velocityTiers : [{ tier: 'S', upTo: 24 }, { tier: 'M', upTo: 32 }, { tier: 'L', upTo: 40 }, { tier: 'XL', upTo: null }]
  const scale = tiers.map((t) => (t.upTo == null ? `${t.tier} above` : `${t.tier} up to ${t.upTo}`)).join(', ')
  return `${team.name} can deliver ${team.quarterCapacity} story points a quarter (team capacity file), about ${team.average} a sprint over ${plan?.sprintsPerPi ?? 5} sprints. Velocity tier ${team.tier ?? '—'} names that capacity as a T-shirt size so teams compare at a glance (${scale}). A size L (${pointsOf('L', plan)} points) takes ${team.quarterCapacity ? Math.round((100 * pointsOf('L', plan)) / team.quarterCapacity) : '—'}% of this team’s quarter.`
}

export function pointsOf(size: string, plan?: Scale | null): number {
  const row = plan?.tshirt.find((t) => t.size === size)
  return row?.points ?? ({ XS: 3, S: 5, M: 8, L: 13, XL: 21, XXL: 34 } as Record<string, number>)[size] ?? 0
}

// -- planner input, kept in the browser between runs --------------------------------------------

const PLANNER_KEY = 'pi-planner-v2'
export const EMPTY_PLANNER: PlannerInput = { initiativeNotes: {}, sizes: {}, quarters: {}, dependencyNotes: {}, dependencyDecisions: {} }

export function loadPlanner(): PlannerInput {
  try {
    const raw = JSON.parse(localStorage.getItem(PLANNER_KEY) ?? 'null')
    return raw && typeof raw === 'object' ? { ...EMPTY_PLANNER, ...raw } : EMPTY_PLANNER
  } catch {
    return EMPTY_PLANNER
  }
}

export const savePlanner = (p: PlannerInput) => localStorage.setItem(PLANNER_KEY, JSON.stringify(p))

const FIELDS = ['initiativeNotes', 'sizes', 'quarters', 'dependencyNotes', 'dependencyDecisions'] as const

/** Planner entries that differ between two inputs (what a rerun would change), per field. */
export function plannerDiff(now: PlannerInput, sent: PlannerInput): Record<(typeof FIELDS)[number], number> {
  const out = { initiativeNotes: 0, sizes: 0, quarters: 0, dependencyNotes: 0, dependencyDecisions: 0 }
  for (const k of FIELDS) {
    const a = (now[k] ?? {}) as Record<string, string>
    const b = (sent[k] ?? {}) as Record<string, string>
    for (const id of new Set([...Object.keys(a), ...Object.keys(b)])) {
      if ((a[id] ?? '').trim() !== (b[id] ?? '').trim()) out[k]++
    }
  }
  return out
}

export const plannerChanges = (now: PlannerInput, sent: PlannerInput) =>
  Object.values(plannerDiff(now, sent)).reduce((s, n) => s + n, 0)

/** "2 notes, 1 quarter move": what a rerun would send that the current run did not have. */
export function describeChanges(now: PlannerInput, sent: PlannerInput): string {
  const d = plannerDiff(now, sent)
  const parts = [
    [d.initiativeNotes + d.dependencyNotes, 'note'],
    [d.dependencyDecisions, 'keep / dismiss decision'],
    [d.sizes, 'size change'],
    [d.quarters, 'quarter placement'],
  ] as const
  return parts.filter(([n]) => n).map(([n, w]) => `${n} ${w}${n === 1 ? '' : 's'}`).join(', ')
}

/** useState backed by localStorage (JSON). */
export function useStored<T>(key: string, initial: T): [T, (v: T | ((prev: T) => T)) => void] {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key)
      return raw == null ? initial : { ...initial, ...(JSON.parse(raw) as T) }
    } catch {
      return initial
    }
  })
  useEffect(() => {
    localStorage.setItem(key, JSON.stringify(value))
  }, [key, value])
  return [value, setValue]
}

// -- quarter buckets --------------------------------------------------------------------------------

export const LATER = 'later'
export const bucketLabel = (key: string) => (key === LATER ? 'Later' : key)

/** The decision dashboard's buckets: the planning horizon (Q1..Q4), then Later. */
export function buckets(plan: Plan): string[] {
  const horizon = plan.horizon.length ? plan.horizon : plan.pis.filter((p) => !p.assumed).map((p) => p.id).slice(0, 4)
  return [...horizon, LATER]
}

const inHorizon = (q: string, plan: Plan) => (buckets(plan).includes(q) ? q : LATER)

/** Where the recommended plan starts an initiative. */
export const recommendedBucket = (item: PlanItem, plan: Plan) => inHorizon(item.pi, plan)
/** Where the team targeted it (the plan as written); no target: where it is recommended. */
export const targetBucket = (item: PlanItem, plan: Plan) => (item.targetQuarter ? inHorizon(item.targetQuarter, plan) : recommendedBucket(item, plan))

export type StartFrom = 'recommended' | 'targeted'

/** The bucket a card sits in: the planner's decision, else the chosen starting point. */
export function placementOf(item: PlanItem, plan: Plan, planner: PlannerInput, from: StartFrom): string {
  const decided = planner.quarters?.[item.id]
  if (decided && buckets(plan).includes(decided)) return decided
  return from === 'recommended' ? recommendedBucket(item, plan) : targetBucket(item, plan)
}

// -- checks on a placement --------------------------------------------------------------------------

export interface PlacementIssue {
  id: string
  kind: 'order' | 'soft' | 'tight' | 'capacity'
  severity: 'High' | 'Medium' | 'Low'
  /** Initiatives the issue is about (the first is the one to move). */
  ids: string[]
  title: string
  text: string
  /** A one-click fix: move this initiative to that bucket. */
  fix?: { id: string; to: string; label: string }
}

export interface TeamLoad {
  team: PlanTeam
  points: number
  capacity: number
  ids: string[]
}

export interface PlacementCheck {
  issues: PlacementIssue[]
  byItem: Record<string, PlacementIssue[]>
  /** team id -> bucket -> load */
  load: Record<string, Record<string, TeamLoad>>
  /** bucket -> points, count, teams over capacity */
  totals: Record<string, { points: number; count: number; over: number }>
}

const perSprint = (team: PlanTeam | undefined, plan: Plan) =>
  team && team.quarterCapacity ? team.quarterCapacity / Math.max(1, plan.sprintsPerPi) : 0

/** Sprints an initiative takes at its team's velocity with nothing else on. */
export function sprintsFor(item: PlanItem, plan: Plan): number {
  const team = plan.teams.find((t) => t.id === item.team)
  const per = perSprint(team, plan)
  return per ? Math.max(1, Math.ceil(item.points / per - 1e-9)) : 1
}

/**
 * The checks the dashboard runs whenever a card moves. They mirror the backend's plan-as-written rules
 * at quarter level: a consumer placed before its provider; a provider still running in its consumer's
 * quarter (placed there too, or spilling into it from an earlier one) when, at the two teams' velocity,
 * the rest of the provider and then the consumer do not fit in its sprints; a team whose initiatives in a
 * quarter add up to more story points than it can deliver there.
 */
export function checkPlacement(plan: Plan, place: (item: PlanItem) => string): PlacementCheck {
  const order = buckets(plan)
  const idx = (b: string) => order.indexOf(b)
  const items = new Map(plan.items.map((i) => [i.id, i]))
  const where = new Map(plan.items.map((i) => [i.id, place(i)]))
  const issues: PlacementIssue[] = []
  const title = (id: string) => items.get(id)?.title ?? id

  for (const l of plan.links) {
    const p = items.get(l.provider)
    const c = items.get(l.consumer)
    if (!p || !c) continue
    const bp = where.get(p.id)!
    const bc = where.get(c.id)!
    if (idx(bp) > idx(bc)) {
      issues.push({
        id: `order:${p.id}:${c.id}`, kind: l.strength === 'orders' ? 'order' : 'soft',
        severity: l.strength === 'orders' ? 'High' : 'Low', ids: [c.id, p.id],
        title: l.strength === 'orders' ? `${title(c.id)} is placed before what it waits for` : `${title(c.id)} is placed before a code change it uses`,
        text: `${title(c.id)} (${bucketLabel(bc)}) ${l.strength === 'orders' ? 'waits for' : 'should follow'} ${title(p.id)}, placed in ${bucketLabel(bp)}${l.declared ? ' (a declared dependency)' : ' (a hidden dependency)'}. ${l.reason}`,
        fix: { id: c.id, to: bp, label: `Move ${title(c.id)} to ${bucketLabel(bp)}` },
      })
    } else if (bc !== LATER && l.strength === 'orders') {
      // The provider's sprints inside the consumer's quarter: all of them when both are placed there,
      // the part that spills into it when the provider is placed in an earlier quarter.
      const ps = sprintsFor(p, plan)
      const cs = sprintsFor(c, plan)
      const inside = ps - plan.sprintsPerPi * (idx(bc) - idx(bp))
      if (inside > 0 && inside + cs > plan.sprintsPerPi) {
        const next = order[Math.min(idx(bc) + 1, order.length - 1)]
        issues.push({
          id: `tight:${p.id}:${c.id}`, kind: 'tight', severity: 'Medium', ids: [c.id, p.id],
          title: bp === bc
            ? `${bucketLabel(bc)} is too tight for ${title(p.id)} and then ${title(c.id)}`
            : `${title(p.id)} spills into ${bucketLabel(bc)}, leaving too little of it for ${title(c.id)}`,
          text: bp === bc
            ? `${title(c.id)} waits for ${title(p.id)}. At the two teams’ velocity the provider takes about ${ps} sprints and the consumer ${cs} more: ${inside + cs} sprints in a ${plan.sprintsPerPi}-sprint quarter.`
            : `${title(c.id)} (${bucketLabel(bc)}) waits for ${title(p.id)}, placed in ${bucketLabel(bp)}. At its team’s velocity the provider takes about ${ps} sprints, ${inside} of them in ${bucketLabel(bc)}, and the consumer needs ${cs} more after it: ${inside + cs} sprints in a ${plan.sprintsPerPi}-sprint quarter.`,
          fix: { id: c.id, to: next, label: `Move ${title(c.id)} to ${bucketLabel(next)}` },
        })
      }
    }
  }

  const load: PlacementCheck['load'] = {}
  for (const team of plan.teams) {
    load[team.id] = {}
    for (const b of order) {
      if (b === LATER) continue
      const ids = plan.items.filter((i) => i.team === team.id && where.get(i.id) === b).map((i) => i.id)
      const points = ids.reduce((s, id) => s + (items.get(id)?.points ?? 0), 0)
      const capacity = team.capacityByPi[b] ?? team.quarterCapacity
      load[team.id][b] = { team, points, capacity, ids }
      if (capacity && points > capacity) {
        const victim = [...ids].sort((x, y) => (PRIORITY_RANK[(items.get(y)?.priority ?? '').toLowerCase()] ?? 4)
          - (PRIORITY_RANK[(items.get(x)?.priority ?? '').toLowerCase()] ?? 4))[0]
        const next = order[Math.min(idx(b) + 1, order.length - 1)]
        issues.push({
          id: `cap:${team.id}:${b}`, kind: 'capacity', severity: points > capacity * 1.3 ? 'High' : 'Medium', ids,
          title: `${team.name} is over capacity in ${b}`,
          text: `${team.name} has ${points} story points placed in ${b} (${ids.map(title).join(', ')}) against ${capacity} it can deliver: ${Math.round((100 * points) / capacity)}%.`,
          fix: victim ? { id: victim, to: next, label: `Move ${title(victim)} (lowest priority) to ${bucketLabel(next)}` } : undefined,
        })
      }
    }
  }

  const byItem: Record<string, PlacementIssue[]> = {}
  for (const i of issues) for (const id of i.ids) (byItem[id] ??= []).push(i)
  const totals: PlacementCheck['totals'] = {}
  for (const b of order) {
    const inB = plan.items.filter((i) => where.get(i.id) === b)
    totals[b] = {
      points: inB.reduce((s, i) => s + i.points, 0), count: inB.length,
      over: plan.teams.filter((t) => { const l = load[t.id]?.[b]; return l && l.capacity && l.points > l.capacity }).length,
    }
  }
  const sev = { High: 0, Medium: 1, Low: 2 }
  issues.sort((a, b) => sev[a.severity] - sev[b.severity] || a.title.localeCompare(b.title))
  return { issues, byItem, load, totals }
}

/** The decisions as CSV, one row per initiative. */
export function decisionsCsv(plan: Plan, place: (item: PlanItem) => string, check: PlacementCheck): string {
  const esc = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`
  const head = ['initiative_id', 'initiative_name', 'team', 'size', 'points', 'priority', 'targeted_quarter', 'recommended_quarter', 'decided_quarter', 'issues']
  const rows = plan.items.map((i) => [i.id, i.title, i.teamName, i.size ?? '', i.points, i.priority, i.targetQuarter || '', recommendedBucket(i, plan), bucketLabel(place(i)),
    (check.byItem[i.id] ?? []).map((x) => x.title).join('; ')])
  return [head, ...rows].map((r) => r.map(esc).join(',')).join('\n')
}

export function download(name: string, text: string, type = 'text/csv') {
  const url = URL.createObjectURL(new Blob([text], { type }))
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  URL.revokeObjectURL(url)
}

/** Where an initiative lands against its target quarter, as a short label with its explanation. */
export function planStatus(i: PlanItem): { cls: 'bad' | 'warn' | 'info' | 'ok'; label: string; hint: string } {
  if (i.inCycle) return { cls: 'bad', label: 'Cycle', hint: 'Part of a dependency cycle: no order satisfies every dependency. Break the cycle (split the scope or re-plan an interface).' }
  if (i.targetQuarter && i.pi !== i.targetQuarter) return { cls: 'bad', label: `Moves to ${i.pi}`, hint: `Targeted at ${i.targetQuarter}, but it cannot start before ${i.startLabel}: see the reasons.` }
  if (i.spills) return { cls: 'warn', label: `Spills into ${i.finishPi}`, hint: `Starts in its target quarter but its points do not fit before ${i.targetQuarter} ends: it finishes in ${i.finishLabel}.` }
  if (i.movedBy) return { cls: 'info', label: 'Later in quarter', hint: `Still in ${i.pi}, but it starts ${i.movedBy} sprint${i.movedBy === 1 ? '' : 's'} into it (${i.startLabel}) because it waits for another initiative or its team is busy.` }
  return { cls: 'ok', label: 'On track', hint: 'Starts in its target quarter and finishes inside it.' }
}

/**
 * The longest chain of waits in the plan: from the initiative that finishes last among those that
 * wait for something, back through the provider each one waited longest for. A slip anywhere on it
 * moves that last finish. Empty when nothing waits for anything.
 */
export function criticalChain(plan: Plan): Set<string> {
  const byId = new Map(plan.items.map((i) => [i.id, i]))
  const waiting = plan.items.filter((i) => i.waitsFor.some((w) => byId.has(w)))
  if (!waiting.length) return new Set()
  let at: PlanItem | undefined = waiting.reduce((a, b) => (b.finish > a.finish ? b : a))
  const out = new Set<string>()
  while (at && !out.has(at.id)) {
    out.add(at.id)
    const providers: PlanItem[] = at.waitsFor.map((w) => byId.get(w)).filter((p): p is PlanItem => !!p)
    at = providers.length ? providers.reduce((a, b) => (b.finish > a.finish ? b : a)) : undefined
  }
  return out
}
