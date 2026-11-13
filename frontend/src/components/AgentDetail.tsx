import { useState } from 'react'
import { findingInitiatives } from '../lib/deps'
import type { Analysis, DependencyRow, Finding } from '../types'
import type { AgentWithState } from './AgentPipeline'
import { FindingRow } from './FindingRow'

const stateText = { done: 'Complete', active: 'Running…', wait: 'Not started yet', failed: 'Failed: the run stopped here' } as const
const FIRST = 8

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

interface Props {
  agent: AgentWithState
  findings: Finding[]
  analysis: Analysis
  depsByKey: Map<string, DependencyRow>
  labelOf: (key: string) => string
}

export function AgentDetail({ agent, findings, analysis, depsByKey, labelOf }: Props) {
  const [open, setOpen] = useState<string | null>(null)
  const [all, setAll] = useState(false)
  const started = agent.state !== 'wait'
  const titleOf = (f: Finding) => {
    const ids = findingInitiatives(f, analysis)
    return ids.length === 1 ? analysis.initiatives.find((i) => i.id === ids[0])?.title : undefined
  }
  return (
    <div className="agent-detail">
      <div className="agent-detail-head">
        <div className={`agent-circle small ${agent.state}`}>
          <i className={`ti ${agent.state === 'done' ? 'ti-check' : agent.state === 'active' ? 'ti-loader-2' : agent.state === 'failed' ? 'ti-alert-triangle' : agent.icon}`} aria-hidden="true" />
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
              <div className="findings-label">Findings from this agent ({findings.length})</div>
              {(all ? findings : findings.slice(0, FIRST)).map((f) => (
                <FindingRow
                  key={f.text}
                  finding={f}
                  dep={f.depKey ? depsByKey.get(f.depKey) : undefined}
                  expanded={open === f.text}
                  onToggle={() => setOpen((o) => (o === f.text ? null : f.text))}
                  labelOf={labelOf}
                  prefix={titleOf(f)}
                />
              ))}
              {findings.length > FIRST && (
                <button className="link-btn" onClick={() => setAll((a) => !a)}>
                  {all ? 'Show fewer' : `Show all ${findings.length}`}
                </button>
              )}
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
