import { useEffect, useRef, useState } from 'react'
import { deleteReceipt } from '../../api/receipts'
import ConfirmDialog from '../../components/ConfirmDialog'
import { Link, navigate } from '../../navigation'
import { haptic } from '../../theme/platform'
import { nativeSwitch } from '../auth/switch'
import {
  askDelete, deletedNotice, deleteFailureMessage, deleteWords, setReceiptsNotice, toggleWithPhoto, withPhotoHint, withPhotoLabel,
} from './delete-receipt'
import type { ReceiptDeleteStep } from './delete-receipt'

/**
 * «Изменить» and «Удалить» of a photo receipt on its page. «Удалить» opens the choice under the actions — «Удалить и
 * фото», on by default — and its danger button asks once more in the shared ConfirmDialog (iOS — the action sheet,
 * Android — the dialog): the deletion cannot be undone. Never a browser dialog. After the deletion — «Траты» with a notice.
 */
export function ReceiptDeleteActions({ receiptId, initial = { kind: 'idle' }, initialDialog = false }: {
  receiptId: number; initial?: ReceiptDeleteStep
  /** A test or a preview opens the confirmation at once. */
  initialDialog?: boolean
}) {
  const [step, setStep] = useState<ReceiptDeleteStep>(initial)
  const [dialog, setDialog] = useState(initialDialog)
  const controller = useRef<AbortController | undefined>(undefined)
  const choice = useRef<HTMLInputElement>(null)
  useEffect(() => () => controller.current?.abort(), [])
  const asking = step.kind === 'confirm'
  useEffect(() => { if (asking) choice.current?.focus() }, [asking])

  // «Изменить» — та же форма траты, что у траты вручную (единая форма, 2026-10-13); фото остаётся рядом для сверки.
  const bar = <div className="receipt-actions receipt-delete-bar ck-action-bar">
    <Link className="action-link receipt-primary" to={`/receipts/${receiptId}/edit`}>Изменить</Link>
    <button type="button" className="receipt-secondary" aria-label="Удалить чек" aria-expanded={step.kind !== 'idle'}
      onClick={() => setStep(step.kind === 'idle' ? askDelete() : { kind: 'idle' })}>Удалить</button>
  </div>
  if (step.kind === 'idle') return bar

  const { withPhoto } = step
  const deleting = step.kind === 'deleting'
  const words = deleteWords(withPhoto)
  const remove = async () => {
    setDialog(false)
    setStep({ kind: 'deleting', withPhoto })
    const current = new AbortController()
    controller.current = current
    const result = await deleteReceipt(receiptId, { withPhoto }, { signal: current.signal })
    if (current.signal.aborted || result.kind === 'aborted') return
    if (result.kind === 'ok' || result.reason === 'not_found') {
      haptic()
      setReceiptsNotice(result.kind === 'ok' ? deletedNotice(withPhoto) : 'Чек уже удалён.')
      navigate('/receipts', { replace: true })  // «назад» must not open the deleted spend
      return
    }
    setStep({ kind: 'failed', withPhoto, message: deleteFailureMessage(result) })
  }
  const labelId = `receipt-delete-${receiptId}`
  return <>
    {bar}
    <div className="receipt-delete-choice" role="group" aria-labelledby={labelId}>
      <p id={labelId} className="receipt-visually-hidden">Удаление чека</p>
      <label className="ck-switch-row receipt-delete-photo">
        <span>{withPhotoLabel}</span>
        <input ref={choice} type="checkbox" role="switch" className="ck-switch" {...nativeSwitch} checked={withPhoto} disabled={deleting} aria-describedby={`${labelId}-hint`}
          onChange={(event) => setStep(toggleWithPhoto(step, event.target.checked))} />
      </label>
      <p className="receipt-note" id={`${labelId}-hint`}>{withPhotoHint}</p>
      {step.kind === 'failed' && <p className="expense-failure" role="alert">{step.message}</p>}
      <div className="receipt-actions">
        <button type="button" className="ck-button-danger" disabled={deleting} onClick={() => setDialog(true)}>
          {deleting ? 'Удаляем…' : words.action}</button>
        <button type="button" className="ck-button-ghost" disabled={deleting} onClick={() => setStep({ kind: 'idle' })}>Отмена</button>
      </div>
    </div>
    <ConfirmDialog open={dialog && !deleting} title={words.title} message={words.message} confirmLabel={words.action} danger
      onConfirm={() => { void remove() }} onCancel={() => setDialog(false)} />
  </>
}
