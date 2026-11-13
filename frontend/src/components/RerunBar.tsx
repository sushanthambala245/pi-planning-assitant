import type { PlannerApi } from '../lib/planner'
import { Tip } from './Tip'

/**
 * The loop back to the agents: notes, sizes, quarter placements and keep / dismiss decisions are
 * saved in this browser as they are made; Rerun starts a new backend run of the same initiatives
 * with them, so the declared and hidden dependencies and the sequence are worked out again.
 */
export function RerunBar({ planner }: { planner: PlannerApi }) {
  const n = planner.changes
  if (!n && !planner.rerunning) {
    return (
      <div className="rerun-bar quiet">
        <i className="ti ti-notes" aria-hidden="true" />
        <span>Add notes, sizes, quarter placements or keep / dismiss decisions on any initiative or dependency, then rerun with them.</span>
      </div>
    )
  }
  return (
    <div className="rerun-bar" role="status">
      <i className="ti ti-pencil" aria-hidden="true" />
      <span><b>{n} {n === 1 ? 'update' : 'updates'}</b> since this run: {planner.describe}.</span>
      <span className="rerun-actions">
        <Tip title="Clear your input" content="Removes every note, size, placement and decision you added in this browser. The current results stay as they are.">
          <button className="btn btn-ghost btn-sm" onClick={() => window.confirm('Clear every note, size, placement and decision you added?') && planner.clearAll()}>
            <i className="ti ti-eraser" aria-hidden="true" /> Clear
          </button>
        </Tip>
        <Tip title="Rerun with updated information" wide
          content={planner.canRerun
            ? 'Starts a new run of the same initiatives with your input: notes are read like descriptions (a stated dependency in one becomes planner-defined), kept links become user-defined, dismissed ones are rejected, sizes and quarter placements change the schedule. The current run stays available until the new one finishes.'
            : 'Needs the backend: a replayed analysis file cannot be rerun. Start the backend and run the analysis from Intake.'}>
          <button className="btn btn-primary btn-sm" disabled={!planner.canRerun || planner.rerunning} onClick={planner.rerun}>
            <i className={`ti ${planner.rerunning ? 'ti-loader-2 spin' : 'ti-refresh'}`} aria-hidden="true" />
            {planner.rerunning ? 'Rerunning…' : 'Rerun with updates'}
          </button>
        </Tip>
      </span>
    </div>
  )
}
