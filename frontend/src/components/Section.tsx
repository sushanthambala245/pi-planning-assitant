import { useEffect, type ReactNode } from 'react'
import { useSections } from '../lib/sections'
import { InfoTip } from './Tip'

interface Props {
  id: string
  title: string
  icon: string
  /** Shown as a badge next to the title and in the side navigation. */
  count?: number | string
  /** An in-depth explanation behind the (i). */
  tip?: ReactNode
  /** A one-line subtitle under the title. */
  sub?: ReactNode
  defaultOpen?: boolean
  /** false: always open (still listed in the side navigation). */
  collapsible?: boolean
  actions?: ReactNode
  tone?: 'accent' | 'plain'
  className?: string
  children: ReactNode
}

/** A collapsible, anchored section. It lists itself in the side navigation while it is on screen. */
export function Section({ id, title, icon, count, tip, sub, defaultOpen = true, collapsible = true, actions, tone = 'plain', className, children }: Props) {
  const { register, unregister, isOpen, setOpen } = useSections()
  useEffect(() => { register({ id, title, icon, count }) }, [id, title, icon, count, register])
  useEffect(() => () => unregister(id), [id, unregister])
  const open = !collapsible || isOpen(id, defaultOpen)
  const head = (
    <>
      {collapsible && <i className={`ti ${open ? 'ti-chevron-down' : 'ti-chevron-right'} sec-chev`} aria-hidden="true" />}
      <span className="sec-icon"><i className={`ti ${icon}`} aria-hidden="true" /></span>
      <span className="sec-title">{title}</span>
      {count != null && <span className="sec-count">{count}</span>}
    </>
  )

  return (
    <section id={`sec-${id}`} className={`sec sec-${tone}${open ? ' open' : ''}${className ? ` ${className}` : ''}`}>
      <header className="sec-head">
        {collapsible
          ? <button className="sec-toggle" aria-expanded={open} aria-controls={`sec-body-${id}`} onClick={() => setOpen(id, !open)}>{head}</button>
          : <h2 className="sec-toggle static">{head}</h2>}
        {tip && <InfoTip content={tip} title={title} wide />}
        {actions && <div className="sec-actions">{actions}</div>}
      </header>
      {sub && open && <div className="sec-sub">{sub}</div>}
      {open && <div className="sec-body" id={`sec-body-${id}`}>{children}</div>}
    </section>
  )
}
