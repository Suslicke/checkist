/** A message with no action stays no longer than this (docs/design-system/components/Snackbar: «сообщение без действия
 * дольше 4 с» is not allowed). */
export const SNACKBAR_PLAIN_MS = 4000

/** How long a snackbar stands before it asks to close (Snackbar.tsx): the countdown of its action, 4 s for a plain
 * message; `undefined` — an action without a countdown waits until the owner removes it. */
export function snackbarLifetime(countdownMs: number | undefined, hasAction: boolean): number | undefined {
  if (countdownMs !== undefined && Number.isFinite(countdownMs) && countdownMs > 0) return countdownMs
  return hasAction ? undefined : SNACKBAR_PLAIN_MS
}
