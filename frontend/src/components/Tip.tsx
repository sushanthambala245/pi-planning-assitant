import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

interface Props {
  /** The explanation: plain text or rich content. */
  content: ReactNode
  /** A bold first line. */
  title?: string
  children: ReactNode
  className?: string
  /** Make the wrapper reachable with Tab (for content that is not already focusable). */
  focusable?: boolean
  wide?: boolean
  as?: 'span' | 'div'
}

const GAP = 8

/**
 * A tooltip that explains a number, a badge or a control in depth. It opens on hover (after a short
 * delay) and on keyboard focus, closes on leave, blur or Escape, and is rendered in a portal with
 * fixed positioning so scrolling containers and overflow never clip it.
 */
export function Tip({ content, title, children, className, focusable, wide, as = 'span' }: Props) {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState<{ top: number; left: number; above: boolean } | null>(null)
  const anchor = useRef<HTMLElement | null>(null)
  const bubble = useRef<HTMLDivElement | null>(null)
  const timer = useRef<number | undefined>(undefined)
  const id = useId()

  const show = () => {
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => setOpen(true), 280)
  }
  const hide = () => {
    window.clearTimeout(timer.current)
    setOpen(false)
    setPos(null)
  }

  useEffect(() => () => window.clearTimeout(timer.current), [])

  useEffect(() => {
    if (!open) return
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && hide()
    const away = () => hide()
    document.addEventListener('keydown', esc)
    window.addEventListener('scroll', away, true)
    return () => {
      document.removeEventListener('keydown', esc)
      window.removeEventListener('scroll', away, true)
    }
  }, [open])

  useLayoutEffect(() => {
    if (!open || !anchor.current || !bubble.current) return
    const a = anchor.current.getBoundingClientRect()
    const b = bubble.current.getBoundingClientRect()
    const above = a.bottom + GAP + b.height > window.innerHeight && a.top - GAP - b.height > 0
    const top = above ? a.top - GAP - b.height : a.bottom + GAP
    const left = Math.min(Math.max(8, a.left + a.width / 2 - b.width / 2), window.innerWidth - b.width - 8)
    setPos({ top, left, above })
  }, [open])

  if (!content) return <>{children}</>
  const Tag = as
  return (
    <>
      <Tag
        ref={(el: HTMLElement | null) => { anchor.current = el }}
        className={`tip-anchor${className ? ` ${className}` : ''}`}
        tabIndex={focusable ? 0 : undefined}
        aria-describedby={open ? id : undefined}
        onMouseEnter={show}
        onMouseLeave={hide}
        onFocus={show}
        onBlur={hide}
      >
        {children}
      </Tag>
      {open && createPortal(
        <div
          ref={bubble}
          id={id}
          role="tooltip"
          className={`tip${wide ? ' wide' : ''}${pos?.above ? ' above' : ''}`}
          style={pos ? { top: pos.top, left: pos.left } : { top: -9999, left: -9999 }}
        >
          {title && <div className="tip-title">{title}</div>}
          <div className="tip-body">{content}</div>
        </div>,
        document.body,
      )}
    </>
  )
}

/** A small (i) that explains the thing next to it. */
export function InfoTip({ content, title, wide }: { content: ReactNode; title?: string; wide?: boolean }) {
  return (
    <Tip content={content} title={title} wide={wide} className="info-tip" focusable>
      <i className="ti ti-info-circle" aria-label={title ? `About ${title}` : 'More information'} />
    </Tip>
  )
}
