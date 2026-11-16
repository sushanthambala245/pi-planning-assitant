import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'

/** Which collapsible sections are open, remembered in this browser. */
interface SectionsApi {
  isOpen: (id: string, fallback: boolean) => boolean
  setOpen: (id: string, open: boolean) => void
}

const Ctx = createContext<SectionsApi | null>(null)
// v2: sections now start collapsed, so an old saved "open" state must not carry over.
const KEY = 'pi-sections-open-v2'

function readOpen(): Record<string, boolean> {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '{}')
    return raw && typeof raw === 'object' ? raw : {}
  } catch {
    return {}
  }
}

export function SectionsProvider({ children }: { children: ReactNode }) {
  const [open, setOpenMap] = useState<Record<string, boolean>>(readOpen)
  const setOpen = useCallback((id: string, value: boolean) => {
    setOpenMap((prev) => {
      const next = { ...prev, [id]: value }
      localStorage.setItem(KEY, JSON.stringify(next))
      return next
    })
  }, [])
  const isOpen = useCallback((id: string, fallback: boolean) => open[id] ?? fallback, [open])
  const api = useMemo(() => ({ isOpen, setOpen }), [isOpen, setOpen])
  return <Ctx.Provider value={api}>{children}</Ctx.Provider>
}

export function useSections(): SectionsApi {
  const api = useContext(Ctx)
  if (!api) throw new Error('useSections needs a SectionsProvider')
  return api
}
