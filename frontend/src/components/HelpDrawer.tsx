import { useEffect, useState } from 'react'
import type { Screen } from '../types'

type Tab = 'screens' | 'buttons' | 'data'

const screenInfo: Record<Screen, { title: string; icon: string; body: string }> = {
  intake: {
    title: '1 · Intake',
    icon: 'ti-upload',
    body: 'Load the initiatives you want to plan and the knowledge sources the AI should reason against. Upload CSV, JSON, Excel or ZIP files, or add initiatives by hand.',
  },
  pipeline: {
    title: '2 · Analysis',
    icon: 'ti-topology-star-3',
    body: 'Shows the agent workflow: each agent (analyser, dependency discovery, sequencing, risk, visualisation) with its status. Click any agent to see what it read, what it produced, and the findings it contributed. You can come back here at any time after a run.',
  },
  results: {
    title: '3 · Results',
    icon: 'ti-chart-dots',
    body: 'The outcome: summary numbers, a dependency graph, the risks, the recommended sequence and an AI summary. Click a node or a risk to open the reasoning drawer and see why the AI flagged it.',
  },
}

const buttons: { screen: Screen | 'all'; icon: string; name: string; what: string }[] = [
  { screen: 'all', icon: 'ti-circle-number-1', name: 'Step tabs (Intake · Analysis · Results)', what: 'Jump between screens. A tab is greyed out until it has something to show.' },
  { screen: 'all', icon: 'ti-palette', name: 'Colour theme', what: 'Switch the colour palette. Your choice is remembered in this browser.' },
  { screen: 'all', icon: 'ti-help', name: 'Help', what: 'Opens this guide.' },
  { screen: 'intake', icon: 'ti-upload', name: 'Upload area', what: 'Click or drop files: initiatives, knowledge-source CSVs, an analysis JSON, or a ZIP of them.' },
  { screen: 'intake', icon: 'ti-plus', name: 'Add initiative', what: 'Type a title and description to add one initiative manually.' },
  { screen: 'intake', icon: 'ti-x', name: 'Remove (✕)', what: 'Removes an initiative from the list for this session.' },
  { screen: 'intake', icon: 'ti-plus', name: 'Add knowledge source', what: 'Opens the file picker to register more source files.' },
  { screen: 'intake', icon: 'ti-player-play', name: 'Analyse initiatives', what: 'Starts the agent workflow and takes you to the Analysis screen.' },
  { screen: 'intake', icon: 'ti-device-floppy', name: 'Save draft', what: 'Not available yet (disabled).' },
  { screen: 'pipeline', icon: 'ti-circle-dot', name: 'Agent circles', what: 'Click an agent to see its summary, inputs, outputs, notes and findings.' },
  { screen: 'pipeline', icon: 'ti-refresh', name: 'Re-run analysis', what: 'Replays the workflow from the first agent.' },
  { screen: 'pipeline', icon: 'ti-chart-dots', name: 'View results', what: 'Goes to the Results screen once the run is complete.' },
  { screen: 'pipeline', icon: 'ti-arrow-left', name: 'Back to intake', what: 'Returns to Intake to change initiatives or sources.' },
  { screen: 'results', icon: 'ti-download', name: 'Export', what: 'Downloads the analysis as a JSON file.' },
  { screen: 'results', icon: 'ti-refresh', name: 'New analysis', what: 'Clears the current run and returns to Intake (your loaded data stays).' },
  { screen: 'results', icon: 'ti-click', name: 'Graph nodes', what: 'Click a system to open the reasoning for the first risk that involves it.' },
  { screen: 'results', icon: 'ti-list', name: 'Risks · Sequence · Dependencies tabs', what: 'Switch what the side panel lists. Click a risk to open its reasoning.' },
  { screen: 'results', icon: 'ti-chevron-down', name: 'Drawer ▲ ▼ ✕', what: 'Step through risks, or close the drawer.' },
  { screen: 'results', icon: 'ti-copy', name: 'Copy reasoning / Flag for PI planning', what: 'Copy the explanation to the clipboard, or mark the risk to raise in PI planning.' },
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
              <p className="help-intro">The app starts empty. Upload your data on the Intake screen — nothing is bundled with it.</p>
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
                  Until the analysis backend is connected, a JSON file with <code>agents</code>, <code>findings</code>, <code>graph</code>, <code>risks</code> and <code>sequence</code> drives the Analysis and Results screens. It can also carry <code>initiatives</code> and <code>knowledgeSources</code>. See <code>frontend/DATA_FORMAT.md</code> for the full format.
                </div>
              </div>
            </>
          )}
        </div>
      </aside>
    </div>
  )
}
