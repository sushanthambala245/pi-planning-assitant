import type { Finding } from '../types'
import type { AgentWithState } from './AgentPipeline'
import { FindingCard } from './FindingCard'

const stateText = { done: 'Complete', active: 'Running…', wait: 'Not started yet' } as const

function List({ label, items, icon }: { label: string; items: string[]; icon: string }) {
  if (!items.length) return null
  return (
    <div className="detail-block">
      <div className="findings-label">{label}</div>
      {items.map((t) => (
        <div className="detail-item" key={t}><i className={`ti ${icon}`} aria-hidden="true" />{t}</div>
      ))}
    </div>
  )
}

export function AgentDetail({ agent, findings }: { agent: AgentWithState; findings: Finding[] }) {
  const started = agent.state !== 'wait'
  return (
    <div className="agent-detail">
      <div className="agent-detail-head">
        <div className={`agent-circle small ${agent.state}`}>
          <i className={`ti ${agent.state === 'done' ? 'ti-check' : agent.state === 'active' ? 'ti-loader-2' : agent.icon}`} aria-hidden="true" />
        </div>
        <div>
          <div className="agent-detail-name">{agent.name}</div>
          <div className={`agent-status ${agent.state}`} style={{ textAlign: 'left' }}>
            {stateText[agent.state]}
            {agent.state === 'done' && agent.durationMs != null && ` · ${(agent.durationMs / 1000).toFixed(1)}s`}
          </div>
        </div>
      </div>

      {!started ? (
        <div className="ai-note">This agent hasn’t started yet. It runs after the previous agent finishes.</div>
      ) : (
        <>
          {agent.summary && <div className="reasoning-box">{agent.summary}</div>}
          <List label="Inputs" items={agent.inputs} icon="ti-arrow-down-right" />
          <List label="Outputs" items={agent.outputs} icon="ti-arrow-up-right" />
          <List label="Notes" items={agent.notes} icon="ti-info-circle" />
          {findings.length > 0 && (
            <div className="detail-block">
              <div className="findings-label">Findings from this agent</div>
              {findings.map((f) => <FindingCard key={f.text} finding={f} />)}
            </div>
          )}
          {!agent.summary && !agent.inputs.length && !agent.outputs.length && !agent.notes.length && !findings.length && (
            <div className="ai-note">No further detail was provided for this agent.</div>
          )}
        </>
      )}
    </div>
  )
}
