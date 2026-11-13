import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'

/** A collapsible section of the current screen, listed in the side navigation. */
export interface SectionMeta {
  id: string
  title: string
  icon: string
  count?: number | string
}

interface SectionsApi {
  sections: SectionMeta[]
  register: (meta: SectionMeta) => void
  unregister: (id: string) => void
  isOpen: (id: string, fallback: boolean) => boolean
  setOpen: (id: string, open: boolean) => void
  /** Open a section and scroll it into view. */
  jump: (id: string) => void
}

const Ctx = createContext<SectionsApi | null>(null)
const KEY = 'pi-sections-open'

function readOpen(): Record<string, boolean> {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '{}')
    return raw && typeof raw === 'object' ? raw : {}
  } catch {
    return {}
  }
}

export function SectionsProvider({ children }: { children: ReactNode }) {
  const [map, setMap] = useState<Map<string, SectionMeta>>(new Map())
  const [open, setOpenMap] = useState<Record<string, boolean>>(readOpen)

  const register = useCallback((meta: SectionMeta) => {
    setMap((prev) => {
      const cur = prev.get(meta.id)
      if (cur && cur.title === meta.title && cur.icon === meta.icon && cur.count === meta.count) return prev
      const next = new Map(prev)
      next.set(meta.id, meta) // an existing key keeps its place, so the order stays the page order
      return next
    })
  }, [])
  const unregister = useCallback((id: string) => {
    setMap((prev) => {
      if (!prev.has(id)) return prev
      const next = new Map(prev)
      next.delete(id)
      return next
    })
  }, [])
  const setOpen = useCallback((id: string, value: boolean) => {
    setOpenMap((prev) => {
      const next = { ...prev, [id]: value }
      localStorage.setItem(KEY, JSON.stringify(next))
      return next
    })
  }, [])
  const isOpen = useCallback((id: string, fallback: boolean) => open[id] ?? fallback, [open])
  const jump = useCallback((id: string) => {
    setOpen(id, true)
    window.setTimeout(() => document.getElementById(`sec-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 30)
  }, [setOpen])

  const api = useMemo(() => ({ sections: [...map.values()], register, unregister, isOpen, setOpen, jump }),
    [map, register, unregister, isOpen, setOpen, jump])
  return <Ctx.Provider value={api}>{children}</Ctx.Provider>
}

export function useSections(): SectionsApi {
  const api = useContext(Ctx)
  if (!api) throw new Error('useSections needs a SectionsProvider')
  return api
}
