import type { Screen } from '../types'

export const SCREENS: { id: Screen; label: string; icon: string; hint: string }[] = [
  { id: 'intake', label: 'Intake', icon: 'ti-upload', hint: 'Choose the initiatives that are ready for PI planning and check the knowledge base.' },
  { id: 'pipeline', label: 'Analysis', icon: 'ti-topology-star-3', hint: 'Watch the agents work: what each one read, found and decided.' },
  { id: 'results', label: 'Results', icon: 'ti-chart-dots', hint: 'Declared dependencies, the hidden ones the agents found, and the recommended sequence, with notes and a rerun.' },
  { id: 'dashboard', label: 'Decisions', icon: 'ti-layout-kanban', hint: 'Place initiatives into quarter buckets; the board warns when a placement breaks a dependency or a team’s capacity.' },
]
