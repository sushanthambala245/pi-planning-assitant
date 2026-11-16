import { useCallback, useMemo, useState } from 'react'
import type { PlannerInput } from '../types'
import { EMPTY_PLANNER, describeChanges, loadPlanner, plannerChanges, savePlanner } from './plan'

/** Everything a screen needs to read or change the planner's input, and to rerun with it. */
export interface PlannerApi {
  input: PlannerInput
  /** What the current run was started with (null: no backend run yet). */
  sent: PlannerInput | null
  setNote: (id: string, text: string) => void
  setSize: (id: string, size: string) => void
  setQuarter: (id: string, quarter: string) => void
  setQuarters: (quarters: Record<string, string>) => void
  setDepNote: (key: string, text: string) => void
  setDecision: (key: string, decision: '' | 'confirmed' | 'dismissed') => void
  /** Entries that differ from what the current run had. */
  changes: number
  describe: string
  /** A rerun is possible (connected to the backend and a run exists). */
  canRerun: boolean
  rerunning: boolean
  rerun: () => void
  clearAll: () => void
}

type Field = keyof PlannerInput

/** The planner's input, saved in this browser so notes survive a reload and are sent with the next run. */
export function usePlannerState() {
  const [input, setInput] = useState<PlannerInput>(loadPlanner)
  const update = useCallback((field: Field, key: string, value: string) => {
    setInput((prev) => {
      const map = { ...(prev[field] as Record<string, string>) }
      if (value && value.trim()) map[key] = value
      else delete map[key]
      const next = { ...prev, [field]: map }
      savePlanner(next)
      return next
    })
  }, [])
  const replace = useCallback((next: PlannerInput) => {
    savePlanner(next)
    setInput(next)
  }, [])
  return { input, update, replace }
}

export function usePlannerApi(
  state: ReturnType<typeof usePlannerState>,
  sent: PlannerInput | null,
  opts: { canRerun: boolean; rerunning: boolean; rerun: () => void },
): PlannerApi {
  const { input, update, replace } = state
  const setQuarters = useCallback((quarters: Record<string, string>) => replace({ ...input, quarters }), [input, replace])
  const clearAll = useCallback(() => replace(EMPTY_PLANNER), [replace])
  return useMemo(() => ({
    input,
    sent,
    setNote: (id, text) => update('initiativeNotes', id, text),
    setSize: (id, size) => update('sizes', id, size),
    setQuarter: (id, q) => update('quarters', id, q),
    setQuarters,
    setDepNote: (key, text) => update('dependencyNotes', key, text),
    setDecision: (key, d) => update('dependencyDecisions', key, d),
    changes: plannerChanges(input, sent ?? EMPTY_PLANNER),
    describe: describeChanges(input, sent ?? EMPTY_PLANNER),
    canRerun: opts.canRerun,
    rerunning: opts.rerunning,
    rerun: opts.rerun,
    clearAll,
  }), [input, sent, update, setQuarters, clearAll, opts.canRerun, opts.rerunning, opts.rerun])
}
