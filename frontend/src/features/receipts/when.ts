/** The moment of a spend in words (docs/design-system README «Голос»: «сегодня, 19:42», «20 ноября»). Pure. */
import type { ISODate } from '../../api/types'
import { NBSP } from '../../lib/text'
import { localToday, previousDay } from './spends'
import { unknown } from './state'

const months = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря']

/** «17 ноября», another year than today's — «17 ноября 2025»; «сегодня», «вчера». The parts are glued: a date never breaks. */
export function dayWords(day: ISODate, today: ISODate = localToday()): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day)
  if (!match) return unknown
  if (day === today) return 'сегодня'
  if (day === previousDay(today)) return 'вчера'
  const words = `${Number(match[3])}${NBSP}${months[Number(match[2]) - 1]}`
  return match[1] === today.slice(0, 4) ? words : `${words}${NBSP}${match[1]}`
}

/**
 * The day of a purchase in words and, for a receipt, its time on the clock of the store: «сегодня, 19:42»,
 * «17 ноября 2025, 08:05 UTC». `observed` — `formatObservedAt` of the moment («17.11.2026, 19:42», «… UTC» without the
 * zone of the store); without a readable time only the day.
 */
export function whenText(day: ISODate, observed?: string, today: ISODate = localToday()): string {
  const words = dayWords(day, today)
  const time = /(\d{2}:\d{2})(\s*UTC)?$/u.exec(observed ?? '')
  return time ? `${words},${NBSP}${time[1]}${time[2] ? `${NBSP}UTC` : ''}` : words
}
