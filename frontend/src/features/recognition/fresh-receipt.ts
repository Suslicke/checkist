/** «Печать чека» (Чекист 2.0, docs/design-system/README.md «Движение»): the slip of a receipt prints once, right after
 * the recognition saved it. The screens of recognition only leave a mark; the page of the receipt (features/receipts)
 * reads it, plays the print when the mark names the receipt it shows and removes it.
 *
 * The mark is set when a person opens a receipt the recognition saved while they were watching (a crop of the job page
 * that turned into a saved receipt) and when the confirmation of a crop in the spend form saves a new receipt. It lives
 * in `sessionStorage` (this tab only, gone with it); every access is guarded: a blocked storage plays nothing. */

export const freshReceiptKey = 'checkist.freshReceipt'

/** The receipt `id` prints once when its page opens next. */
export function markFreshReceipt(id: number): void {
  try {
    sessionStorage.setItem(freshReceiptKey, String(id))
  } catch {
    // No storage (a private window, a policy): the receipt simply opens without the print.
  }
}

/** Whether the page of receipt `id` should print it: true once, the mark is removed by the read. */
export function takeFreshReceipt(id: number): boolean {
  try {
    const marked = sessionStorage.getItem(freshReceiptKey)
    if (marked !== String(id)) return false
    sessionStorage.removeItem(freshReceiptKey)
    return true
  } catch {
    return false
  }
}
