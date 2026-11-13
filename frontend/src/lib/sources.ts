import type { SourceStatus } from '../types'

/**
 * What each knowledge source is for and which of its columns the agents read, shown in the Intake
 * tooltips. Mirrors backend/context/sources.py (the column contract is in data/README.md): keep the
 * two in step when a source or a mapping changes.
 */
export interface SourceInfo {
  role: string
  /** [column, what it is used for] */
  columns: [string, string][]
  /** Columns that are present but deliberately not read, and why. */
  ignored?: string
}

export const SOURCE_INFO: Record<string, SourceInfo> = {
  S1: {
    role: 'The initiatives to plan, with the dependencies and the sequence their teams defined (use case 1).',
    columns: [
      ['status', 'Only Ready for PI Planning is analysed; Proposed and In Discovery are left out.'],
      ['dependency', 'The declared dependencies: "Upstream: …" systems it consumes, "Downstream: …" systems that consume its output.'],
      ['target_pi (Q1, Q2 …)', 'The target quarter: the sequence the team planned, checked against every dependency.'],
      ['T-Shirt Sizing', 'S / M / L / XL, converted to story points and weighed against the team’s capacity.'],
      ['priority', 'When a team is full, the higher priority is scheduled first.'],
      ['description', 'Read for dependencies nobody declared ("requires …", "blocked on …", another team named).'],
      ['owning_team · art', 'Who does the work (joins team capacity and the directory) and the release train.'],
      ['initiative_name · business_outcome', 'Shown with the initiative.'],
    ],
  },
  S4: {
    role: 'Hidden code dependencies between teams (use case 2): one team’s repository depending on another’s.',
    columns: [
      ['declared_internal_repo_ids', 'A repo of one team declares a dependency on a repo of another team that has an initiative in the plan. It becomes a code link between two initiatives only when something ties it to them: the initiative builds on a system the other team owns, or the other initiative changes an interface. Otherwise the coupling is only between the teams, and is noted on the Analysis screen but not counted.'],
      ['declared_shared_libraries', 'When an initiative changes a shared library, every team whose repos use it has to re-test.'],
      ['repo_type', 'A code link onto an api or contracts repo of a team changing an interface should go first.'],
      ['lifecycle_status', 'A Deprecated repository something still depends on raises a risk (DRI-X-004).'],
      ['team_id · repo_name · repo_id', 'Who owns the repo, and how other repos refer to it.'],
    ],
  },
  S5: {
    role: 'Team velocity: how many story points each team can deliver in a quarter (use case 3).',
    columns: [
      ['available_story_points', 'Capacity per quarter, spread over its sprints. Sets each team’s velocity tier (S / M / L / XL) and how long a T-shirt size takes that team.'],
      ['team_id', 'Joins the capacity to the initiatives’ owning team.'],
    ],
  },
  S6: {
    role: 'Team names and release trains, so team ids read as names and dependencies land on real teams.',
    columns: [
      ['team_id · team_name', 'The id every other file uses, and the name shown.'],
      ['art', 'The release train the team belongs to (grouping and colour).'],
      ['team_status', 'Shown with the team.'],
    ],
  },
  S7: {
    role: 'A lookup: which team owns each named system, so a declared or mentioned system becomes the team to talk to.',
    columns: [
      ['service_name · service_type', 'The systems the dependency column and the descriptions name (service, API, dataset …).'],
      ['owning_team_id · ownership_status', 'The team that owns the system; none means a dependency on an unowned system (DRI-X-002).'],
      ['lifecycle_status', 'A Deprecated system an initiative depends on raises a risk (DRI-X-004).'],
      ['interface_contract_status', 'A Missing or Draft interface contract raises a risk (DRI-X-005).'],
    ],
    ignored: 'related_initiative_ids and the upstream / downstream initiative id columns are not read: they would hand the agents the answer instead of letting them find the dependencies.',
  },
}

export const KB_ORDER = ['S1', 'S4', 'S6', 'S5', 'S7']

export const SOURCE_BADGE: Record<SourceStatus, { label: string; hint: string }> = {
  ready: { label: 'Ready', hint: 'Loaded; every row passed validation.' },
  partial: { label: 'Partial', hint: 'Loaded, but some rows were rejected (see the row counts).' },
  invalid: { label: 'Invalid', hint: 'Not used: a required column is missing.' },
  missing: { label: 'Missing', hint: 'Not in the data folder: the checks that need it are reported as not checked.' },
  off: {
    label: 'Off',
    hint: 'Not part of the knowledge base, so the agents do not read it, whether or not the file is in the data folder. The knowledge base is the initiatives, GitHub repos, team directory and team capacity, plus the ownership map as a lookup (ACTIVE_SOURCES in backend/.env; set it to "all" to read every source).',
  },
}
