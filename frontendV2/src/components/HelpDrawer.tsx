import { useEffect, useState } from 'react'
import type { Screen } from '../types'

type Tab = 'screens' | 'buttons' | 'data'

const screenInfo: Record<Screen, { title: string; icon: string; body: string }> = {
  intake: {
    title: '1 · Intake',
    icon: 'ti-upload',
    body: 'Load the initiatives you want to plan and the knowledge sources the AI should reason against. Search or filter the list, then tick the initiatives to analyse: one analysis takes up to 15, and one uploaded file adds up to 100.',
  },
  pipeline: {
    title: '2 · Analysis',
    icon: 'ti-topology-star-3',
    body: 'Summary shows one card per initiative: the systems it touches (APIs apart from services, with their owning teams), how many of its dependencies need a change, its risks and its step in the sequence. Findings by initiative lists every finding grouped under its initiative: hover one for a preview, double-click it to keep the details open.',
  },
  results: {
    title: '3 · Results',
    icon: 'ti-chart-dots',
    body: 'One sentence says what to start with and what spills past the PI; the chips under it open the detail (links not in Jira, checks that did not run, links to confirm, open comments). The Timeline shows when each initiative runs across the PI’s sprints, sized by T-shirt size and placed after what it waits for. Click an initiative for its schedule, dependencies and risks, or its comments. Graph, Dependencies and Risks are the other views: dependencies are sorted by what they ask of people (a code change, a flow / integration change, regression testing, or nothing). Stated means written down in Jira, Confluence or Slack; inferred means found in code or the ownership map; confirmed means both.',
  },
}

const buttons: { screen: Screen | 'all'; icon: string; name: string; what: string }[] = [
  { screen: 'all', icon: 'ti-circle-number-1', name: 'Step tabs (Intake · Analysis · Results)', what: 'Jump between screens. A tab is greyed out until it has something to show.' },
  { screen: 'all', icon: 'ti-palette', name: 'Colour theme', what: 'Switch the colour palette. Your choice is remembered in this browser.' },
  { screen: 'all', icon: 'ti-help', name: 'Help', what: 'Opens this guide.' },
  { screen: 'intake', icon: 'ti-upload', name: 'Upload area', what: 'Click or drop files: initiatives, knowledge-source CSVs, an analysis JSON, or a ZIP of them.' },
  { screen: 'intake', icon: 'ti-plus', name: 'Add initiative', what: 'Type a title and description to add one initiative manually.' },
  { screen: 'intake', icon: 'ti-search', name: 'Search · team · PI filters', what: 'Narrow the list. The count shows how many match and how many ticked ones are hidden.' },
  { screen: 'intake', icon: 'ti-square-check', name: 'Tick boxes · Select shown', what: 'Choose the initiatives to analyse. Select shown ticks the filtered ones up to the limit; at the limit the other boxes are disabled.' },
  { screen: 'intake', icon: 'ti-eraser', name: 'Clear selection · Remove all · Clear all messages', what: 'Quick clear: untick everything, empty the list, or dismiss every message.' },
  { screen: 'intake', icon: 'ti-x', name: 'Remove (✕)', what: 'Removes an initiative from the list for this session.' },
  { screen: 'intake', icon: 'ti-reload', name: 'Reload from the data folder · Add knowledge source', what: 'With the backend, sources come from its data folder: add or change files there, then reload. Without it, Add knowledge source registers uploaded files.' },
  { screen: 'intake', icon: 'ti-player-play', name: 'Analyse', what: 'Starts the agent workflow for the ticked initiatives and takes you to the Analysis screen.' },
  { screen: 'intake', icon: 'ti-device-floppy', name: 'Save draft', what: 'Not available yet (disabled).' },
  { screen: 'pipeline', icon: 'ti-layout-grid', name: 'Summary · Findings by initiative', what: 'Switch between one card per initiative and the full list of findings grouped by initiative.' },
  { screen: 'pipeline', icon: 'ti-filter', name: 'Initiative filter · type chips', what: 'Show one initiative, or only some kinds of finding (systems, stated, inferred, risks…).' },
  { screen: 'pipeline', icon: 'ti-eye-off', name: 'Hide no-change links', what: 'Hides dependencies that need nobody to build, agree or re-test anything (on by default).' },
  { screen: 'pipeline', icon: 'ti-hand-click', name: 'Hover · double-click a finding', what: 'Hover for a preview of its details; double-click, the chevron or Enter keeps them open.' },
  { screen: 'pipeline', icon: 'ti-circle-dot', name: 'Agent circles', what: 'Click an agent to see its summary, inputs, outputs, notes and findings.' },
  { screen: 'pipeline', icon: 'ti-refresh', name: 'Run again · Replay', what: 'For a backend run, starts a new run of the same initiatives (it uses LLM calls again). For an uploaded analysis file, replays it from the first agent.' },
  { screen: 'pipeline', icon: 'ti-chart-dots', name: 'View results', what: 'Goes to the Results screen once the run is complete.' },
  { screen: 'pipeline', icon: 'ti-arrow-left', name: 'Back to intake', what: 'Returns to Intake to change initiatives or sources.' },
  { screen: 'results', icon: 'ti-download', name: 'Export', what: 'Downloads the analysed initiatives, the flagged risks and the results as JSON. Upload it again to replay it.' },
  { screen: 'results', icon: 'ti-user-check', name: 'Review and approve', what: 'A reviewer (RTE, EM or Architect) approves the order, then downloads the Jira link proposals (CSV), the sequence note and the audit trail. Nothing is written to Jira. Or challenge the order: say which initiative must come first and the sequence is worked out again.' },
  { screen: 'results', icon: 'ti-alert-triangle', name: 'Status chips', what: 'Spills past the PI, risk flags, open comments, links not in Jira, checks not run, links to confirm. Click one for the detail; “Why this order?” gives the summary and each step’s reason.' },
  { screen: 'results', icon: 'ti-timeline', name: 'Timeline · Graph · Dependencies · Risks', what: 'Switch the view. The timeline is the default: one chevron bar per initiative, grouped by step, team or ART.' },
  { screen: 'results', icon: 'ti-arrows-maximize', name: 'Full screen', what: 'Gives the view the whole window; press Esc to leave.' },
  { screen: 'results', icon: 'ti-message-circle', name: 'Comment bubble', what: 'On each timeline row: the number of comments, with a red dot when some are still open. Click it to read and add comments for that initiative (Concern, Question, Decision or Action). Comments from other reviewers appear within a few seconds; tick Resolve when one is dealt with. Saved on the backend with the run, or on this device when you replayed a file.' },
  { screen: 'results', icon: 'ti-chart-arrows-vertical', name: 'Timeline bars', what: 'Length = size (S 1, M 2, L 3, XL 4 sprints); a hatched bar was sized from story points; a red hatched bar and the Beyond PI column mean it finishes after the PI; the dashed box is the sprint the roadmap targeted; dark lines are the critical path.' },
  { screen: 'results', icon: 'ti-refresh', name: 'New analysis', what: 'Clears the current run and returns to Intake (your loaded data stays).' },
  { screen: 'results', icon: 'ti-filter', name: 'Initiative · needs a change · level filters', what: 'One set of filters for the graph and the lists. Levels: Initiative (circle), Team (square), System (diamond).' },
  { screen: 'results', icon: 'ti-click', name: 'Graph nodes and lines', what: 'Hover a line for why that dependency exists; click a node to see why it is in the graph and what depends on it.' },
  { screen: 'results', icon: 'ti-list', name: 'Dependencies · Teams · Risks · Sequence tabs', what: 'Dependencies are grouped by the change they need; Teams groups them by the team they ask something of. Click one for its hops and evidence. Click a risk to open its reasoning. Sequence gives each step’s reason and what must be coordinated within a step.' },
  { screen: 'results', icon: 'ti-chevron-down', name: 'Drawer ▲ ▼ ✕', what: 'Step through risks, or close the drawer.' },
  { screen: 'results', icon: 'ti-copy', name: 'Copy reasoning / Flag for PI planning', what: 'Copy the explanation to the clipboard, or mark the risk to raise in PI planning. Flags are saved with a backend run and included in Export.' },
  { screen: 'results', icon: 'ti-topology-star-3', name: 'How was this analysed?', what: 'Opens the Analysis screen with every agent’s details.' },
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
                The assistant works in three steps. Use the numbered tabs in the header to move between them at any time.
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
                <div className="help-card-title"><i className="ti ti-file-spreadsheet" aria-hidden="true" /> CSV files</div>
                <div className="help-card-body">
                  A CSV with <code>initiative_id</code> and <code>initiative_name</code> (or <code>title</code>) columns is read as <b>initiatives</b>; <code>description</code>, <code>owning_team</code> and <code>priority</code> are shown if present. Any other CSV is registered as a <b>knowledge source</b>.
                </div>
              </div>
              <div className="help-card">
                <div className="help-card-title"><i className="ti ti-file-zip" aria-hidden="true" /> ZIP, Excel</div>
                <div className="help-card-body">A ZIP is unpacked and each CSV/JSON inside is handled as above. Excel workbooks are listed as knowledge sources but not parsed.</div>
              </div>
              <div className="help-card">
                <div className="help-card-title"><i className="ti ti-braces" aria-hidden="true" /> JSON analysis result</div>
                <div className="help-card-body">
                  Without the backend, a JSON file with <code>agents</code>, <code>findings</code>, <code>graph</code>, <code>risks</code> and <code>sequence</code> (for example one saved with Export) is replayed on the Analysis and Results screens. It can also carry <code>initiatives</code> and <code>knowledgeSources</code>. See <code>frontend/DATA_FORMAT.md</code> for the full format.
                </div>
              </div>
            </>
          )}
        </div>
      </aside>
    </div>
  )
}
