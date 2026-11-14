import { useEffect, useState } from 'react'
import type { Screen } from '../types'

type Tab = 'screens' | 'buttons' | 'data'

const screenInfo: Record<Screen, { title: string; icon: string; body: string }> = {
  intake: {
    title: '1 · Intake',
    icon: 'ti-upload',
    body: 'The initiatives and the knowledge base the agents reason against: initiatives, GitHub repositories, team directory and team capacity, plus the service ownership map as a lookup of who owns each system. Only initiatives that are Ready for PI Planning can be analysed (In Discovery and Proposed are shown for reference). Tick them all: hidden dependencies only show across the whole set. Hover any chip, source or number for what it means.',
  },
  pipeline: {
    title: '2 · Analysis',
    icon: 'ti-topology-star-3',
    body: 'The agents at work, in collapsible sections. Agent workflow: click an agent for what it read, found and decided. By initiative: one card per initiative, grouped by release train, with the systems it touches, what it needs from other teams and its risks. All findings: every finding, filterable by kind.',
  },
  results: {
    title: '3 · Results',
    icon: 'ti-chart-dots',
    body: 'At a glance gives the three use cases in numbers and what to resolve before PI planning; click a tile or an item to jump to its section. 1 · Declared: the dependencies the teams wrote down and the target-quarter conflicts. 2 · Hidden: the ones nobody declared, grouped by what they do to the plan; Keep or Dismiss each one and add a note. 3 · Delivery timeline: status chips (what moved, teams over capacity, unsized work, risks, open comments, checks not run, what was left out) open their detail on click; below them, the Timeline, Graph and Risks views. Click a bar for why it lands where it does, to change its size or add a note for the rerun, and to comment on it. Rerun with updates sends your input back to the agents.',
  },
  dashboard: {
    title: '4 · Decisions',
    icon: 'ti-layout-kanban',
    body: 'Place each initiative in a quarter bucket (Q1–Q4, or Later): drag the card or use its Move to list. Cards start where the recommended plan puts them (or where the teams targeted them). Every placement is checked as you go: a dependency out of order, a quarter too tight for a provider and then its consumer, a team over capacity. Each issue has a one-click fix. Export the decisions as CSV, or rerun so the agents schedule against them.',
  },
}

const buttons: { screen: Screen | 'all'; icon: string; name: string; what: string }[] = [
  { screen: 'all', icon: 'ti-layout-sidebar-left-collapse', name: 'Left pane', what: 'Jump to another screen or to a section of this one. Collapse it to a strip of icons; your choice is remembered.' },
  { screen: 'all', icon: 'ti-circle-number-1', name: 'Step tabs (Intake · Analysis · Results · Decisions)', what: 'Move between the four screens. A tab is greyed out until it has something to show.' },
  { screen: 'all', icon: 'ti-chevron-down', name: 'Section headers', what: 'Click a header to collapse or expand that section. The (i) next to it explains the section in depth.' },
  { screen: 'all', icon: 'ti-info-circle', name: 'Tooltips', what: 'Hover (or focus with Tab) any number, chip or badge for how it is worked out and where the data comes from.' },
  { screen: 'all', icon: 'ti-palette', name: 'Colour theme', what: 'Switch the palette: Accenture (default), Accenture dark and others. Remembered in this browser.' },
  { screen: 'all', icon: 'ti-help', name: 'Help', what: 'Opens this guide.' },
  { screen: 'intake', icon: 'ti-circle-check', name: 'Ready · Proposed · In Discovery', what: 'Filter the list by status. Only Ready for PI Planning initiatives can be ticked and analysed.' },
  { screen: 'intake', icon: 'ti-search', name: 'Search · ART · team · quarter filters', what: 'Narrow the list. The count shows how many match and how many ticked ones are hidden.' },
  { screen: 'intake', icon: 'ti-square-check', name: 'Tick boxes · Select shown · Select all ready', what: 'Choose the initiatives to analyse, up to the limit shown.' },
  { screen: 'intake', icon: 'ti-upload', name: 'Upload area', what: 'Click or drop files: initiatives, knowledge-source CSVs, an analysis JSON, or a ZIP of them.' },
  { screen: 'intake', icon: 'ti-plus', name: 'Add initiative', what: 'Type a title and description to add one initiative by hand.' },
  { screen: 'intake', icon: 'ti-reload', name: 'Reload from the data folder', what: 'With the backend, sources come from its data folder: drop in updated files, then reload. Without it, Add knowledge source registers uploaded files.' },
  { screen: 'intake', icon: 'ti-player-play', name: 'Analyse', what: 'Starts the agents for the ticked initiatives (with any notes you saved) and opens the Analysis screen.' },
  { screen: 'pipeline', icon: 'ti-circle-dot', name: 'Agent circles', what: 'Hover for what the agent does; click for its inputs, outputs, notes and findings.' },
  { screen: 'pipeline', icon: 'ti-filter', name: 'Initiative filter · kind chips', what: 'Show one initiative, or only some kinds of finding (systems, stated, inferred, risks…).' },
  { screen: 'pipeline', icon: 'ti-refresh', name: 'Run again · Replay', what: 'For a backend run, starts a new run of the same initiatives with your latest input. For an uploaded file, replays it.' },
  { screen: 'results', icon: 'ti-layout-dashboard', name: 'At a glance tiles · Before PI planning', what: 'The three use cases in numbers, and the short list of what to resolve. Click to jump to the section, or to open the matching status chip on the timeline.' },
  { screen: 'results', icon: 'ti-check', name: 'Keep · Dismiss (on a dependency)', what: 'Keep a hidden dependency the teams confirm (it becomes user-defined) or dismiss one that is not real. The next run uses your call.' },
  { screen: 'results', icon: 'ti-notes', name: 'Notes · size', what: 'Open a dependency, or click a bar on the timeline, to add a note or change the T-shirt size. A note like “blocked on INIT-005” adds a dependency on the next run.' },
  { screen: 'results', icon: 'ti-timeline', name: 'Timeline · Graph · Risks', what: 'The views under the status chips. The timeline has one bar per initiative across the quarters’ sprints: the dashed box is its targeted quarter, a red edge means it ends after it, a hatched bar is not sized from the data, an outlined one is on the longest chain of waits. Group it by quarter, dependency step, team or ART; the corner button shows it full screen.' },
  { screen: 'results', icon: 'ti-message-circle', name: 'Comments (bubble on each row)', what: 'Live feedback on an initiative: a concern, question, decision or action, with who raised it. Everyone on the same run sees the thread (it refreshes every few seconds); resolve a comment when it is handled. A rerun carries the comments over. Comments are for discussion; the agents read only the notes.' },
  { screen: 'results', icon: 'ti-refresh', name: 'Rerun with updates', what: 'Starts a new run of the same initiatives with your notes, sizes, quarter placements and keep / dismiss decisions. The current results stay until it finishes.' },
  { screen: 'results', icon: 'ti-layout-kanban', name: 'Decide quarters', what: 'Opens the decision dashboard.' },
  { screen: 'results', icon: 'ti-user-check', name: 'Review and approve', what: 'A reviewer (RTE, EM or Architect) approves the order, then downloads the Jira link proposals (CSV), the sequence note and the audit trail; or challenges it with a constraint and the sequence is worked out again.' },
  { screen: 'results', icon: 'ti-download', name: 'Export', what: 'Downloads the analysed initiatives, flagged risks, your notes, the comments and the results as JSON (it can be uploaded again to replay). The open-comments chip downloads the comments alone as CSV.' },
  { screen: 'results', icon: 'ti-click', name: 'Graph nodes and lines', what: 'Hover a line for why that dependency exists; click a node for what touches it.' },
  { screen: 'dashboard', icon: 'ti-drag-drop', name: 'Drag a card · Move to', what: 'Place an initiative in a quarter. A dashed card is a suggestion; a solid one is your decision.' },
  { screen: 'dashboard', icon: 'ti-arrows-exchange', name: 'Recommended · As targeted', what: 'Where undecided cards start: the recommended plan, or the quarters the teams targeted.' },
  { screen: 'dashboard', icon: 'ti-wand', name: 'Fix (on a placement check)', what: 'Moves the initiative that solves the issue.' },
  { screen: 'dashboard', icon: 'ti-checks', name: 'Accept all · Reset', what: 'Turn every suggestion into a decision, or clear your decisions.' },
  { screen: 'dashboard', icon: 'ti-file-spreadsheet', name: 'Export CSV', what: 'One row per initiative: targeted, recommended and decided quarter, size, points, priority and issues.' },
]

interface Props {
  screen: Screen
  onClose: () => void
}

export function HelpDrawer({ screen, onClose }: Props) {
  const [tab, setTab] = useState<Tab>('screens')

  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', esc)
    return () => document.removeEventListener('keydown', esc)
  }, [onClose])

  const tabs: { id: Tab; label: string }[] = [
    { id: 'screens', label: 'Screens' },
    { id: 'buttons', label: 'Buttons' },
    { id: 'data', label: 'Data files' },
  ]

  const ordered = [...buttons].sort((a, b) => Number(b.screen === screen || b.screen === 'all') - Number(a.screen === screen || a.screen === 'all'))

  return (
    <div className="overlay" onMouseDown={onClose}>
      <aside className="help-drawer" role="dialog" aria-label="Help" onMouseDown={(e) => e.stopPropagation()}>
        <div className="drawer-topbar">
          <div className="drawer-title"><i className="ti ti-help" aria-hidden="true" /> Help &amp; navigation</div>
          <button className="drawer-close" aria-label="Close help" onClick={onClose}><i className="ti ti-x" aria-hidden="true" /></button>
        </div>

        <div className="side-tabs" role="tablist">
          {tabs.map((t) => (
            <button key={t.id} role="tab" aria-selected={tab === t.id} className={`side-tab${tab === t.id ? ' active' : ''}`} onClick={() => setTab(t.id)}>
              {t.label}
            </button>
          ))}
        </div>

        <div className="drawer-body">
          {tab === 'screens' && (
            <>
              <p className="help-intro">
                The assistant works in four steps. Use the numbered tabs in the header or the left pane to move between them at any time.
              </p>
              {(Object.keys(screenInfo) as Screen[]).map((id) => (
                <div key={id} className={`help-card${id === screen ? ' here' : ''}`}>
                  <div className="help-card-title">
                    <i className={`ti ${screenInfo[id].icon}`} aria-hidden="true" /> {screenInfo[id].title}
                    {id === screen && <span className="here-badge">You are here</span>}
                  </div>
                  <div className="help-card-body">{screenInfo[id].body}</div>
                </div>
              ))}
            </>
          )}

          {tab === 'buttons' && (
            <>
              <p className="help-intro">Buttons for the screen you’re on are listed first.</p>
              {ordered.map((b) => (
                <div key={`${b.screen}-${b.name}`} className="help-row">
                  <i className={`ti ${b.icon}`} aria-hidden="true" />
                  <div>
                    <div className="help-row-name">
                      {b.name}
                      <span className="help-scope">{b.screen === 'all' ? 'Everywhere' : screenInfo[b.screen].title.slice(4)}</span>
                    </div>
                    <div className="help-row-text">{b.what}</div>
                  </div>
                </div>
              ))}
            </>
          )}

          {tab === 'data' && (
            <>
              <p className="help-intro">With the backend running, initiatives and knowledge sources come from its data folder (see <code>data/README.md</code>). Without it, the app starts empty: upload your data on the Intake screen.</p>
              <div className="help-card">
                <div className="help-card-title"><i className="ti ti-database" aria-hidden="true" /> The knowledge base</div>
                <div className="help-card-body">
                  <b>Initiatives</b> (status, dependency column, target quarter, T-shirt size, priority, description), <b>GitHub repositories</b> (repo-to-repo and shared-library dependencies, repo type, lifecycle), <b>team directory</b> (names, ART) and <b>team capacity</b> (story points per quarter: each team’s velocity). The <b>service ownership map</b> is read as a lookup of who owns each system, its lifecycle and its contract status. Other files in the folder are switched off.
                </div>
              </div>
              <div className="help-card">
                <div className="help-card-title"><i className="ti ti-file-spreadsheet" aria-hidden="true" /> CSV files</div>
                <div className="help-card-body">
                  A CSV with <code>initiative_id</code> and <code>initiative_name</code> (or <code>title</code>) columns is read as <b>initiatives</b>; <code>status</code>, <code>T-Shirt Sizing</code>, <code>dependency</code>, the target quarter, <code>owning_team</code>, <code>art</code> and <code>priority</code> are shown when present. Any other CSV is registered as a <b>knowledge source</b>.
                </div>
              </div>
              <div className="help-card">
                <div className="help-card-title"><i className="ti ti-file-zip" aria-hidden="true" /> ZIP, Excel</div>
                <div className="help-card-body">A ZIP is unpacked and each CSV/JSON inside is handled as above. Excel workbooks are listed as knowledge sources but not parsed.</div>
              </div>
              <div className="help-card">
                <div className="help-card-title"><i className="ti ti-braces" aria-hidden="true" /> JSON analysis result</div>
                <div className="help-card-body">
                  Without the backend, a JSON file with <code>agents</code>, <code>findings</code>, <code>graph</code>, <code>risks</code> and <code>sequence</code> (for example one saved with Export) is replayed on the Analysis, Results and Decisions screens. See <code>frontend/DATA_FORMAT.md</code> for the full format.
                </div>
              </div>
            </>
          )}
        </div>
      </aside>
    </div>
  )
}
