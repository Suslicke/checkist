import { useEffect, useId, useLayoutEffect, useRef } from 'react'
import type { MouseEvent, SyntheticEvent } from 'react'
import { createPortal } from 'react-dom'
import { usePlatform } from '../theme/platform'
import type { Platform } from '../theme/platform'
import { confirmParts } from './confirm-dialog'
import './ConfirmDialog.css'

export interface ConfirmDialogProps {
  open: boolean
  /** The question: «Удалить чек и фото?» — the heading of the Android dialog and the name of the dialog everywhere. */
  title: string
  /** What happens, in one or two sentences: «Фото и задания распознавания удалятся вместе с чеком». */
  message?: string
  /** The action by its verb: «Удалить чек и фото». */
  confirmLabel: string
  cancelLabel?: string
  /** An irreversible destruction: the action in the colour of an error. */
  danger?: boolean
  onConfirm: () => void
  /** «Отмена», Esc, the system «назад» of Android and a tap on the scrim. */
  onCancel: () => void
  /** The grammar; the platform of the page by default (a test or a preview passes it). */
  platform?: Platform
}

/**
 * The confirmation of an action that cannot be undone (docs/design-system/components/ConfirmDialog): deleting a receipt
 * with its photo, leaving the family. Everything that can be undone asks nothing and offers «Отменить» in a Snackbar.
 *
 * A modal `<dialog>` (`role="alertdialog"`) in the top layer, rendered into the body: the page behind is inert, the
 * focus starts on «Отмена» and returns to the control that opened it; Esc and the system «назад» of Android (the close
 * watcher of the dialog) cancel. iOS — the action sheet at the bottom, Android and a computer — the dialog in the middle.
 * A closed dialog renders nothing; a server render draws the markup in place.
 */
export default function ConfirmDialog({ open, title, message, confirmLabel, cancelLabel = 'Отмена', danger = false, onConfirm, onCancel, platform }: ConfirmDialogProps) {
  const page = usePlatform()
  const grammar = platform ?? page
  const titleId = useId()
  const messageId = useId()
  const dialog = useRef<HTMLDialogElement>(null)
  const cancelButton = useRef<HTMLButtonElement>(null)
  const cancel = useRef(onCancel)
  useEffect(() => { cancel.current = onCancel })

  useLayoutEffect(() => {
    if (!open) return
    const node = dialog.current
    const opener = document.activeElement instanceof HTMLElement && document.activeElement !== document.body ? document.activeElement : null
    try {
      if (node && !node.open) node.showModal()
    } catch {
      // A browser without the modal dialog still shows it in place (the `open` attribute below).
      node?.setAttribute('open', '')
    }
    cancelButton.current?.focus()
    return () => {
      try {
        if (node?.open) node.close()
      } catch {
        // Already gone.
      }
      if (opener?.isConnected) opener.focus()
    }
  }, [open])

  if (!open) return null

  const onNativeCancel = (event: SyntheticEvent<HTMLDialogElement>) => {
    // Esc and the system «назад»: the owner closes the dialog by `open`, never the browser by itself.
    event.preventDefault()
    cancel.current()
  }
  const onBackdrop = (event: MouseEvent<HTMLDialogElement>) => {
    // The dialog element is the scrim over the whole window; a press on it outside of the panel cancels.
    if (event.target === event.currentTarget) cancel.current()
  }
  const parts = {
    message: <div key="message" className="ck-confirm-text">
      <h2 className="ck-confirm-title" id={titleId}>{title}</h2>
      {message && <p className="ck-confirm-message" id={messageId}>{message}</p>}
    </div>,
    confirm: <button key="confirm" type="button" className={`ck-confirm-action${danger ? ' ck-confirm-danger' : ''}`} onClick={onConfirm}>{confirmLabel}</button>,
    cancel: <button key="cancel" type="button" className="ck-confirm-cancel" ref={cancelButton} onClick={() => cancel.current()}>{cancelLabel}</button>,
  }
  const view = (
    <dialog className="ck-confirm" data-platform={grammar} role="alertdialog" aria-modal="true" aria-labelledby={titleId}
      aria-describedby={message ? messageId : undefined} ref={dialog} onCancel={onNativeCancel} onClick={onBackdrop}>
      <div className="ck-confirm-panel">
        {confirmParts(grammar).groups.map((group, index) => <div key={index} className={`ck-confirm-group ck-confirm-group-${group.join('-')}`}>
          {group.map((part) => parts[part])}
        </div>)}
      </div>
    </dialog>
  )
  return typeof document === 'undefined' ? view : createPortal(view, document.body)
}
