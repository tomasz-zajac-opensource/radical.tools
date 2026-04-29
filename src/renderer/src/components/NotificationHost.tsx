import React, { useEffect, useRef, useState } from 'react'
import { useDiagramStore } from '../store/diagramStore'

const TOAST_DURATION_MS = 5000

const ICONS = {
  error: (
    <svg viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      <circle cx="10" cy="10" r="8" />
      <path d="M10 6v4.5" />
      <circle cx="10" cy="13.5" r="0.6" fill="currentColor" stroke="none" />
    </svg>
  ),
  warning: (
    <svg viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      <path d="M10 2.5 18 17H2L10 2.5Z" />
      <path d="M10 8v4" />
      <circle cx="10" cy="14.5" r="0.6" fill="currentColor" stroke="none" />
    </svg>
  ),
  info: (
    <svg viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      <circle cx="10" cy="10" r="8" />
      <path d="M10 9v5" />
      <circle cx="10" cy="6.5" r="0.6" fill="currentColor" stroke="none" />
    </svg>
  ),
} as const

const TITLES = {
  error: 'Action blocked',
  warning: 'Warning',
  info: 'Notice',
} as const

interface ToastItemProps {
  id: string
  severity: 'error' | 'warning' | 'info'
  message: string
}

function ToastItem({ id, severity, message }: ToastItemProps): React.ReactElement {
  const dismiss = useDiagramStore((s) => s.dismissNotification)
  const [leaving, setLeaving] = useState(false)
  const [paused, setPaused] = useState(false)
  const startedRef = useRef(performance.now())
  const elapsedRef = useRef(0)

  useEffect(() => {
    let raf = 0
    const tick = () => {
      if (!paused) {
        const now = performance.now()
        elapsedRef.current += now - startedRef.current
        startedRef.current = now
        if (elapsedRef.current >= TOAST_DURATION_MS) {
          setLeaving(true)
          window.setTimeout(() => dismiss(id), 200)
          return
        }
      } else {
        startedRef.current = performance.now()
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [id, dismiss, paused])

  return (
    <div
      className={`toast toast-${severity}${leaving ? ' toast-leaving' : ''}`}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      role={severity === 'error' ? 'alert' : 'status'}
    >
      <div className="toast-icon-wrap" aria-hidden>{ICONS[severity]}</div>
      <div className="toast-body">
        <div className="toast-title">{TITLES[severity]}</div>
        <div className="toast-message">{message}</div>
      </div>
      <button
        type="button"
        className="toast-close"
        onClick={() => {
          setLeaving(true)
          window.setTimeout(() => dismiss(id), 200)
        }}
        aria-label="Dismiss notification"
      >
        <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round">
          <path d="M4 4l8 8M12 4l-8 8" />
        </svg>
      </button>
      <div
        className="toast-progress"
        style={{
          animationDuration: `${TOAST_DURATION_MS}ms`,
          animationPlayState: paused ? 'paused' : 'running',
        }}
      />
    </div>
  )
}

/**
 * Renders transient toast notifications (metamodel violations etc.)
 * in the bottom-right corner. Each toast shows an animated countdown
 * bar; hovering pauses the auto-dismiss timer.
 */
export function NotificationHost(): React.ReactElement | null {
  const notifications = useDiagramStore((s) => s.notifications)
  if (notifications.length === 0) return null
  return (
    <div className="toast-host" role="region" aria-label="Notifications">
      {notifications.map((n) => (
        <ToastItem key={n.id} id={n.id} severity={n.severity} message={n.message} />
      ))}
    </div>
  )
}
