/** The pulse of the month (2026-10-26): one bar per day of the month. Heights are per cent of the biggest day; a past
 * day without spends keeps a small foot so the row reads as a calendar; a day after today is a flat mark of the track.
 * The average day is a dashed line at its height. Pure: the values come as numbers of cents. */

export type PulseState = 'off' | 'on' | 'today' | 'future'
export interface PulseBar { day: string; state: PulseState; /** 0–100, of the biggest day. */ height: number }
export interface Pulse {
  bars: PulseBar[]
  /** The height of the dashed line of the average day, 0–100; null without a positive average or any spends. */
  average: number | null
}

/** The height of a past day without spends: visible, lower than any day with spends. */
export const EMPTY_HEIGHT = 4

/** `days` in the order of the month; `today` — the date of the device (none for a past month: every day is past). */
export function pulse(days: readonly { day: string; spent: number }[], today: string | undefined, averageDay: number): Pulse {
  const largest = Math.max(0, ...days.map((item) => (Number.isFinite(item.spent) ? item.spent : 0)))
  const percent = (value: number) => (largest > 0 ? Math.round((Math.max(0, value) / largest) * 100) : 0)
  const bars = days.map((item) => {
    const spent = Number.isFinite(item.spent) ? item.spent : 0
    if (today !== undefined && item.day > today) return { day: item.day, state: 'future' as const, height: 0 }
    const height = spent > 0 ? Math.max(EMPTY_HEIGHT + 1, percent(spent)) : EMPTY_HEIGHT
    const state: PulseState = item.day === today ? 'today' : spent > 0 ? 'on' : 'off'
    return { day: item.day, state, height }
  })
  const average = largest > 0 && Number.isFinite(averageDay) && averageDay > 0 ? Math.min(100, percent(averageDay)) : null
  return { bars, average }
}
