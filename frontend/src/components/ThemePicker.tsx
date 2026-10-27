import { useEffect, useRef, useState } from 'react'
import { THEMES, applyTheme, getStoredTheme } from '../lib/theme'

export function ThemePicker() {
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(getStoredTheme)
  const root = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false)
    }
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', esc)
    return () => {
      document.removeEventListener('mousedown', close)
      document.removeEventListener('keydown', esc)
    }
  }, [open])

  const choose = (id: string) => {
    applyTheme(id)
    setActive(id)
  }

  return (
    <div className="theme-picker" ref={root}>
      <button
        className="icon-circle"
        aria-label="Colour theme"
        aria-expanded={open}
        title="Change colour theme"
        onClick={() => setOpen((o) => !o)}
      >
        <i className="ti ti-palette" aria-hidden="true" />
      </button>
      {open && (
        <div className="popover" role="menu">
          <div className="popover-title">Colour theme</div>
          {THEMES.map((t) => (
            <button
              key={t.id}
              role="menuitemradio"
              aria-checked={t.id === active}
              className={`theme-option${t.id === active ? ' selected' : ''}`}
              onClick={() => choose(t.id)}
            >
              <span className="swatches">
                {t.swatches.map((c) => <span key={c} style={{ background: c }} />)}
              </span>
              <span className="theme-text">
                <span className="theme-name">{t.name}</span>
                <span className="theme-tag">{t.tagline}</span>
              </span>
              {t.id === active && <i className="ti ti-check" aria-hidden="true" />}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
