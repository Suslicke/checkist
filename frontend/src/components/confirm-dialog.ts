import type { Platform } from '../theme/platform'

/** A part of the confirmation (ConfirmDialog.tsx): the question with its explanation, the action, «Отмена». */
export type ConfirmPart = 'message' | 'confirm' | 'cancel'

/** The order of the parts of the dialog: iOS — the action sheet, the explanation and the action in one group and
 * «Отмена» apart under it; Android and a computer — the dialog of Material 3, «Отмена» before the action at the right
 * of one row. The order of Tab is the order on the screen. */
export function confirmParts(platform: Platform): { groups: ConfirmPart[][] } {
  return platform === 'ios'
    ? { groups: [['message', 'confirm'], ['cancel']] }
    : { groups: [['message'], ['cancel', 'confirm']] }
}
