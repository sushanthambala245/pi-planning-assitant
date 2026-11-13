import { useEffect, useState } from 'react'
import { useSections } from '../lib/sections'
import type { Screen } from '../types'
import { Tip } from './Tip'

export const SCREENS: { id: Screen; label: string; icon: string; hint: string }[] = [
  { id: 'intake', label: 'Intake', icon: 'ti-upload', hint: 'Choose the initiatives that are ready for PI planning and check the knowledge base.' },
  { id: 'pipeline', label: 'Analysis', icon: 'ti-topology-star-3', hint: 'Watch the agents work: what each one read, found and decided.' },
  { id: 'results', label: 'Results', icon: 'ti-chart-dots', hint: 'Declared dependencies, the hidden ones the agents found, and the recommended sequence, with notes and a rerun.' },
  { id: 'dashboard', label: 'Decisions', icon: 'ti-layout-kanban', hint: 'Place initiatives into quarter buckets; the board warns when a placement breaks a dependency or a team’s capacity.' },
]

interface Props {
  screen: Screen
  enabled: Record<Screen, boolean>
  onNavigate: (s: Screen) => void
  collapsed: boolean
  onToggle: () => void
}

/** The collapsible left pane: the screens, and the sections of the current screen to jump to. */
export function SideNav({ screen, enabled, onNavigate, collapsed, onToggle }: Props) {
  const { sections, jump } = useSections()
  const [active, setActive] = useState<string | null>(null)

  // Highlight the section being read: the last one whose top has scrolled past the header.
  useEffect(() => {
    const spy = () => {
      let current: string | null = null
      for (const s of sections) {
        const el = document.getElementById(`sec-${s.id}`)
        if (el && el.getBoundingClientRect().top < 140) current = s.id
      }
      setActive(current ?? sections[0]?.id ?? null)
    }
    spy()
    window.addEventListener('scroll', spy, { passive: true })
    return () => window.removeEventListener('scroll', spy)
  }, [sections])

  return (
    <aside className={`sidenav${collapsed ? ' collapsed' : ''}`} aria-label="Navigation">
      <button className="sidenav-toggle" onClick={onToggle} aria-expanded={!collapsed}
        title={collapsed ? 'Expand the navigation pane' : 'Collapse the navigation pane'}>
        <i className={`ti ${collapsed ? 'ti-layout-sidebar-left-expand' : 'ti-layout-sidebar-left-collapse'}`} aria-hidden="true" />
        {!collapsed && <span>Collapse</span>}
      </button>

      {!collapsed && <div className="sidenav-label">Screens</div>}
      <nav className="sidenav-list">
        {SCREENS.map((s, i) => (
          <Tip key={s.id} content={enabled[s.id] ? s.hint : `${s.hint} Not available yet: load initiatives and run an analysis first.`}
            title={`${i + 1} · ${s.label}`} as="div">
            <button
              className={`sidenav-item${s.id === screen ? ' current' : ''}`}
              disabled={!enabled[s.id]}
              aria-current={s.id === screen ? 'page' : undefined}
              onClick={() => onNavigate(s.id)}
            >
              <i className={`ti ${s.icon}`} aria-hidden="true" />
              {!collapsed && <span className="sidenav-text">{s.label}</span>}
              {!collapsed && <span className="sidenav-num">{i + 1}</span>}
            </button>
          </Tip>
        ))}
      </nav>

      {sections.length > 0 && (
        <>
          {!collapsed && <div className="sidenav-label">On this page</div>}
          {collapsed && <div className="sidenav-sep" />}
          <nav className="sidenav-list">
            {sections.map((s) => (
              <Tip key={s.id} content={collapsed ? s.title : undefined} as="div">
                <button className={`sidenav-item sub${active === s.id ? ' current' : ''}`} onClick={() => jump(s.id)}>
                  <i className={`ti ${s.icon}`} aria-hidden="true" />
                  {!collapsed && <span className="sidenav-text">{s.title}</span>}
                  {!collapsed && s.count != null && <span className="sidenav-count">{s.count}</span>}
                </button>
              </Tip>
            ))}
          </nav>
        </>
      )}
    </aside>
  )
}
