import type { Failure } from './state'
import { errorMessage } from './state'

/** The deletion of a photo receipt: the choice under its actions (`withPhoto` — the «Удалить и фото» switch, on by
 * default), then the confirmation of the irreversible step in the shared ConfirmDialog. */
export type ReceiptDeleteStep =
  | { kind: 'idle' }
  | { kind: 'confirm'; withPhoto: boolean }
  | { kind: 'deleting'; withPhoto: boolean }
  | { kind: 'failed'; withPhoto: boolean; message: string }

export const withPhotoLabel = 'Удалить и фото'
export const withPhotoHint = 'Вместе с фото удалятся задания распознавания и вырезки. Без отметки они останутся в «Обработке».'

/** The words of the step: the danger button of the choice and the dialog that confirms it (title, explanation, action). */
export function deleteWords(withPhoto: boolean): { title: string; message: string; action: string } {
  return withPhoto
    ? { title: 'Удалить чек и фото?', action: 'Удалить чек и фото',
      message: 'Строки чека, фото, задания распознавания и вырезки удалятся. Отменить удаление нельзя.' }
    : { title: 'Удалить чек?', action: 'Удалить чек',
      message: 'Строки чека удалятся, фото и его задание останутся в «Обработке». Отменить удаление нельзя.' }
}

export function askDelete(): ReceiptDeleteStep {
  return { kind: 'confirm', withPhoto: true }
}

/** The checkbox changes only the confirmation being asked; a running deletion keeps its choice. */
export function toggleWithPhoto(step: ReceiptDeleteStep, withPhoto: boolean): ReceiptDeleteStep {
  return step.kind === 'confirm' || step.kind === 'failed' ? { kind: 'confirm', withPhoto } : step
}

/** Text of a refused deletion; the texts of the server never reach the screen. */
export function deleteFailureMessage(failure: Failure): string {
  switch (failure.reason) {
    case 'job_active': return 'Фото этого чека ещё распознаётся. Дождитесь окончания задания или отмените его в «Обработке».'
    case 'photo_shared': return 'Из этого фото есть и другой чек. Снимите отметку «Удалить и фото», чтобы удалить только этот чек.'
    case 'csrf_failed': return 'Сессия обновилась. Повторите действие ещё раз.'
    default: return errorMessage(failure)
  }
}

/** The notice of «Чеки» after the deletion. */
export function deletedNotice(withPhoto: boolean): string {
  return withPhoto ? 'Чек удалён вместе с фото.' : 'Чек удалён. Фото и его задание остались в «Обработке».'
}

// One notice for the next visit of «Чеки», like the notice of a saved spend.
let notice: string | undefined
export function setReceiptsNotice(message: string) { notice = message }
export function getReceiptsNotice(): string | undefined { return notice }
export function clearReceiptsNotice() { notice = undefined }
