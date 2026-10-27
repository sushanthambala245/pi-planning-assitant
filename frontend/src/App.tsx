import { useCallback, useState } from 'react'
import { initiatives as seed } from './data/mock'
import { IntakeScreen } from './screens/IntakeScreen'
import { PipelineScreen } from './screens/PipelineScreen'
import { ResultsScreen } from './screens/ResultsScreen'
import type { Initiative, Screen } from './types'

export default function App() {
  const [screen, setScreen] = useState<Screen>('intake')
  const [initiatives, setInitiatives] = useState<Initiative[]>(seed)

  const add = (title: string, description: string) =>
    setInitiatives((list) => [...list, { id: Date.now(), title, description }])
  const remove = (id: number) => setInitiatives((list) => list.filter((i) => i.id !== id))

  // TODO: parse Jira/ADO/CSV exports once the FastAPI backend exists
  const onFilesDropped = (files: File[]) => console.info('Files selected', files.map((f) => f.name))

  const toResults = useCallback(() => setScreen('results'), [])

  return (
    <div className="page">
      {screen === 'intake' && (
        <IntakeScreen
          initiatives={initiatives}
          onAdd={add}
          onRemove={remove}
          onFilesDropped={onFilesDropped}
          onAnalyse={() => setScreen('pipeline')}
        />
      )}
      {screen === 'pipeline' && <PipelineScreen onComplete={toResults} />}
      {screen === 'results' && <ResultsScreen onRestart={() => setScreen('intake')} />}
    </div>
  )
}
