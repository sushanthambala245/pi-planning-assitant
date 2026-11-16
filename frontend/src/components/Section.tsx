import type { ReactNode } from 'react'
import { useSections } from '../lib/sections'
import { InfoTip } from './Tip'

interface Props {
  id: string
  title: string
  icon: string
  /** A badge next to the title. */
  count?: number | string
  /** One line shown beside the title while closed, so a closed section still says what is inside. */
  summary?: ReactNode
  /** A one-line subtitle under the title while open. */
  sub?: ReactNode
  /** An in-depth explanation behind the (i). */
  tip?: ReactNode
  defaultOpen?: boolean
  /** false: always open. */
  collapsible?: boolean
  actions?: ReactNode
  tone?: 'accent' | 'plain'
  className?: string
  children: ReactNode
}

/** A collapsible section; give it a `summary` and `defaultOpen={false}` to keep a closed section informative. */
export function Section({ id, title, icon, count, summary, sub, tip, defaultOpen = true, collapsible = true, actions, tone = 'plain', className, children }: Props) {
  const { isOpen, setOpen } = useSections()
  const open = !collapsible || isOpen(id, defaultOpen)
  const head = (
    <>
      {collapsible && <i className={`ti ${open ? 'ti-chevron-down' : 'ti-chevron-right'} sec-chev`} aria-hidden="true" />}
      <span className="sec-icon"><i className={`ti ${icon}`} aria-hidden="true" /></span>
      <span className="sec-title">{title}</span>
      {count != null && <span className="sec-count">{count}</span>}
      {summary && !open && <span className="sec-summary">{summary}</span>}
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
