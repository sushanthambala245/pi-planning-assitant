import { useEffect, useState } from 'react'
import { AgentPipeline } from '../components/AgentPipeline'
import { FindingCard } from '../components/FindingCard'
import { StepBadge, TopBar } from '../components/TopBar'
import { agents as baseAgents, findings, sourcesUsed } from '../data/mock'
import type { Agent } from '../types'

const STEP_MS = 1400

interface Props {
  onComplete: () => void
}

/** Mock pipeline: advances one agent at a time until all are done, then calls onComplete. */
export function PipelineScreen({ onComplete }: Props) {
  const [current, setCurrent] = useState(2) // index of the running agent

  useEffect(() => {
    if (current >= baseAgents.length) {
      const t = setTimeout(onComplete, 600)
      return () => clearTimeout(t)
    }
    const t = setTimeout(() => setCurrent((c) => c + 1), STEP_MS)
    return () => clearTimeout(t)
  }, [current, onComplete])

  const agents: Agent[] = baseAgents.map((a, i) =>
    i < current
      ? { ...a, state: 'done', icon: 'ti-check' }
      : i === current
        ? { ...a, state: 'active', icon: 'ti-loader-2' }
        : { ...a, state: 'wait', icon: a.id === 'viz' ? 'ti-chart-dots' : 'ti-clock' },
  )
  const running = agents.find((a) => a.state === 'active')

  return (
    <div className="screen">
      <TopBar><StepBadge icon="ti-circle-number-2" label="Analysing" /></TopBar>
      <div className="s2-body">
        <AgentPipeline agents={agents} />
        <div className="findings-grid">
          <div>
            <div className="findings-label">Findings so far</div>
            {findings.map((f) => <FindingCard key={f.text} finding={f} />)}
          </div>
          <div>
            <div className="findings-label">Knowledge sources used</div>
            {sourcesUsed.map((s) => (
              <div className="finding-card" key={s.text}>
                <div className="kb-used"><i className={`ti ${s.icon}`} aria-hidden="true" />{s.text}</div>
              </div>
            ))}
            {running && (
              <div className="ai-note">{running.name} is working based on 5 dependencies found…</div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
