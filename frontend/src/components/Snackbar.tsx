import { useEffect, useRef } from 'react'
import type { CSSProperties } from 'react'
import { snackbarLifetime } from './snackbar-time'
import './Snackbar.css'

export interface SnackbarProps {
  /** What happened, in the past tense, by the word of the button: «Трата удалена». */
  message: string
  /** One action, «Отменить». */
  action?: { label: string; onClick: () => void }
  /** The time the action waits (5 s for an undo): the bar under the toast of iOS runs it down, and the snackbar asks to
   * close when it is over. Without it a message with no action closes after 4 s, one with an action waits for the owner. */
  countdownMs?: number
  /** The snackbar asks to go: its time is over. The owner removes it (and does what the action no longer undoes). */
  onClose: () => void
}

/**
 * The message after an action with a way to undo it (docs/design-system/components/Snackbar): iOS — a toast of ink with
 * the corner 16 over the tab bar and the bar of the countdown; Android and a computer — the Material 3 snackbar over the
 * navigation, the FAB rising over it, no bar. One at a time, at the bottom of the window above the bars
 * (`--ck-bottom-occupied`); `role="status"`: the screen reader says the message without moving the focus.
 */
export default function Snackbar({ message, action, countdownMs, onClose }: SnackbarProps) {
  const close = useRef(onClose)
  useEffect(() => { close.current = onClose })
  const lifetime = snackbarLifetime(countdownMs, action !== undefined)
  useEffect(() => {
    if (lifetime === undefined) return
    const timer = setTimeout(() => close.current(), lifetime)
    return () => clearTimeout(timer)
  }, [lifetime, message])

  const counting = countdownMs !== undefined && lifetime === countdownMs
  return (
    <div className="ck-snackbar" role="status" aria-live="polite" aria-atomic="true">
      <span className="ck-snackbar-message">{message}</span>
      {action && <button type="button" className="ck-snackbar-action" onClick={action.onClick}>{action.label}</button>}
      {counting && <span className="ck-snackbar-count" aria-hidden="true" style={{ '--ck-snackbar-countdown': `${countdownMs}ms` } as CSSProperties} />}
    </div>
  )
}
