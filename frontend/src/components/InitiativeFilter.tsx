import type { InitiativeRef } from '../types'

interface Props {
  initiatives: InitiativeRef[]
  value: string
  onChange: (id: string) => void
}

/** "All initiatives" or one of the run's initiatives. Hidden when the analysis does not list them. */
export function InitiativeFilter({ initiatives, value, onChange }: Props) {
  if (initiatives.length < 2) return null
  return (
    <label className="filter-field">
      <i className="ti ti-filter" aria-hidden="true" />
      <select className="select" aria-label="Filter by initiative" value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">All initiatives ({initiatives.length})</option>
        {initiatives.map((i) => (
          <option key={i.id} value={i.id}>{i.title} ({i.id})</option>
        ))}
      </select>
      {value && (
        <button className="icon-btn" aria-label="Show all initiatives" onClick={() => onChange('')}>
          <i className="ti ti-x" aria-hidden="true" />
        </button>
      )}
    </label>
  )
}
