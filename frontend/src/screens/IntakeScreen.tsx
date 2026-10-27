import { InitiativeList } from '../components/InitiativeList'
import { KnowledgeBaseList } from '../components/KnowledgeBaseList'
import { StepBadge, TopBar } from '../components/TopBar'
import { knowledgeSources } from '../data/mock'
import type { Initiative } from '../types'

interface Props {
  initiatives: Initiative[]
  onAdd: (title: string, description: string) => void
  onRemove: (id: number) => void
  onFilesDropped: (files: File[]) => void
  onAnalyse: () => void
}

export function IntakeScreen({ initiatives, onAdd, onRemove, onFilesDropped, onAnalyse }: Props) {
  return (
    <div className="screen">
      <TopBar><StepBadge icon="ti-circle-number-1" label="Intake" /></TopBar>
      <div className="s1-body">
        <InitiativeList initiatives={initiatives} onAdd={onAdd} onRemove={onRemove} onFilesDropped={onFilesDropped} />
        <KnowledgeBaseList sources={knowledgeSources} />
      </div>
      <div className="cta-bar">
        <div className="cta-note">
          {initiatives.length} initiative{initiatives.length === 1 ? '' : 's'} · {knowledgeSources.length} knowledge sources ready
        </div>
        <div className="cta-actions">
          <button className="btn btn-ghost"><i className="ti ti-device-floppy" aria-hidden="true" /> Save draft</button>
          <button className="btn btn-primary" onClick={onAnalyse} disabled={initiatives.length === 0}>
            <i className="ti ti-player-play" aria-hidden="true" /> Analyse initiatives
          </button>
        </div>
      </div>
    </div>
  )
}
