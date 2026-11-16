import type { AgentRun, AgentState } from '../types'
import { Tip } from './Tip'

const statusLabel: Record<AgentState, string> = { done: 'Complete', active: 'Running…', wait: 'Waiting', failed: 'Failed' }

export type AgentWithState = AgentRun & { state: AgentState }

interface Props {
  agents: AgentWithState[]
  selectedId: string | null
  onSelect: (id: string) => void
}

export function AgentPipeline({ agents, selectedId, onSelect }: Props) {
  const done = agents.filter((a) => a.state === 'done').length
  const running = agents.some((a) => a.state === 'active') ? 0.5 : 0
  const pct = agents.length ? Math.round(((done + running) / agents.length) * 100) : 0

  return (
    <>
      <div className="pipeline">
        {agents.map((a) => (
          <Tip key={a.id} as="div" className="agent-tip" title={`${a.name} · ${statusLabel[a.state].toLowerCase()}`} wide
            content={<>{a.summary}<div className="tip-foot">Click for what it read, found and decided.</div></>}>
            <button
              className={`agent-col${a.id === selectedId ? ' selected' : ''}`}
              aria-pressed={a.id === selectedId}
              onClick={() => onSelect(a.id)}
            >
              <div className={`agent-circle ${a.state}`}>
                <i className={`ti ${a.state === 'done' ? 'ti-check' : a.state === 'active' ? 'ti-loader-2' : a.state === 'failed' ? 'ti-alert-triangle' : a.icon}`} aria-hidden="true" />
              </div>
              <div className="agent-name">{a.name}</div>
              <div className={`agent-status ${a.state}`}>{a.state === 'done' ? ' ' : statusLabel[a.state]}</div>
            </button>
          </Tip>
        ))}
      </div>
      <div className="progress-bar" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
        <div className="progress-fill" style={{ width: `${pct}%` }} />
      </div>
    </>
  )
}
