import type { Agent } from '../types'

const statusLabel = { done: 'Complete', active: 'Running…', wait: 'Waiting' } as const

interface Props {
  agents: Agent[]
}

export function AgentPipeline({ agents }: Props) {
  const done = agents.filter((a) => a.state === 'done').length
  const active = agents.some((a) => a.state === 'active') ? 0.5 : 0
  const pct = Math.round(((done + active) / agents.length) * 100)

  return (
    <>
      <div className="pipeline">
        {agents.map((a) => (
          <div className="agent-col" key={a.id}>
            <div className={`agent-circle ${a.state}`}><i className={`ti ${a.icon}`} aria-hidden="true" /></div>
            <div className="agent-name">{a.name}</div>
            <div className={`agent-status ${a.state}`}>{statusLabel[a.state]}</div>
          </div>
        ))}
      </div>
      <div className="progress-bar" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
        <div className="progress-fill" style={{ width: `${pct}%` }} />
      </div>
    </>
  )
}
