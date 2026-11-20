import { useEffect, useRef, useState } from 'react'
import { deleteIncome } from '../../api/incomes'
import { deleteManualSpend } from '../../api/receipts'
import { Link, navigate } from '../../navigation'
import { setIncomeNotice } from '../incomes/incomes-state'
import { setReceiptsNotice } from '../receipts/delete-receipt'
import { saveMessage } from './labels'
import ConfirmDialog from '../../components/ConfirmDialog'
import Icon from '../../components/Icon'
import { haptic } from '../../theme/platform'
import './Expense.css'

export type DeleteStep = { kind: 'idle' } | { kind: 'confirm' } | { kind: 'deleting' } | { kind: 'failed'; message: string }

/** What is deleted: a spend (back to «Траты») or an income (back to «Доходы»). */
const SPEND = { remove: deleteManualSpend, notice: setReceiptsNotice, to: '/receipts', message: 'Трата исчезнет из списка и сумм. Отменить удаление нельзя.',
  button: 'Удалить трату', title: 'Удалить трату?', done: 'Трата удалена.', gone: 'Трата уже удалена.' }
const INCOME = { remove: deleteIncome, notice: setIncomeNotice, to: '/incomes', message: 'Доход исчезнет из списка и сумм. Отменить удаление нельзя.',
  button: 'Удалить доход', title: 'Удалить доход?', done: 'Доход удалён.', gone: 'Доход уже удалён.' }

/** The deletion of a manual spend: the step, the question and the request. Both the page of the spend («Удалить») and
 * its edit form («Удалить трату») ask the same way; an income — the same, with its words. Чекист 2.0: deleting cannot be
 * undone, so it asks in the shared ConfirmDialog (iOS — an action sheet, Android and a computer — a dialog), never with
 * a browser dialog. */
function useSpendDeletion(receiptId: number, initial: DeleteStep, what = SPEND) {
  const [step, setStep] = useState<DeleteStep>(initial)
  const controller = useRef<AbortController | undefined>(undefined)
  useEffect(() => () => controller.current?.abort(), [])

  const remove = async () => {
    setStep({ kind: 'deleting' })
    const current = new AbortController()
    controller.current = current
    const result = await what.remove(receiptId, { signal: current.signal })
    if (current.signal.aborted || result.kind === 'aborted') return
    if (result.kind === 'ok' || result.reason === 'not_found') {
      haptic()
      what.notice(result.kind === 'ok' ? what.done : what.gone)
      navigate(what.to, { replace: true })  // «назад» must not open the deleted spend
      return
    }
    setStep({ kind: 'failed', message: saveMessage(result) })
  }

  const asking = step.kind === 'confirm' || step.kind === 'deleting'
  const close = () => { if (step.kind !== 'deleting') setStep({ kind: 'idle' }) }
  const dialog = <ConfirmDialog open={asking} title={what.title} message={what.message}
    confirmLabel={step.kind === 'deleting' ? 'Удаляем…' : what.button} danger
    onConfirm={() => { if (step.kind !== 'deleting') void remove() }} onCancel={close} />
  return { step, setStep, dialog, what }
}

/** «Изменить», «Повторить» (a new spend like this one, dated today) and «Удалить» of a manual spend on its page. The
 * deletion asks in the shared confirmation dialog on every width (`narrow` is kept for the callers). */
export function ManualSpendActions({ receiptId, initial = { kind: 'idle' } }: { receiptId: number; initial?: DeleteStep; narrow?: boolean }) {
  const { step, setStep, dialog } = useSpendDeletion(receiptId, initial)
  return <>
    <div className="receipt-actions expense-manual-actions">
      <Link className="action-link receipt-primary" to={`/receipts/${receiptId}/edit`}>Изменить</Link>
      <Link className="action-link receipt-secondary expense-repeat" to={`/receipts/new?repeat=${receiptId}`}>Повторить</Link>
      <button type="button" className="receipt-secondary" onClick={() => setStep({ kind: 'confirm' })}>Удалить</button>
      {step.kind === 'failed' && <p className="expense-failure" role="alert">{step.message}</p>}
    </div>
    {dialog}
  </>
}

/** «Удалить трату» at the end of the edit form: a quiet danger button that asks in the confirmation dialog. Never submits
 * the form around it. */
export function DeleteSpend({ receiptId, initial = { kind: 'idle' }, income = false }: { receiptId: number; initial?: DeleteStep; narrow?: boolean; income?: boolean }) {
  const { step, setStep, dialog, what } = useSpendDeletion(receiptId, initial, income ? INCOME : SPEND)
  return <div className="expense-delete">
    <button type="button" className="ck-button-danger expense-delete-button" onClick={() => setStep({ kind: 'confirm' })}>
      <Icon name="trash" size={18} />{what.button}</button>
    {step.kind === 'failed' && <p className="expense-failure" role="alert">{step.message}</p>}
    {dialog}
  </div>
}
