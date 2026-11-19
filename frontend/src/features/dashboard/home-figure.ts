/** «Главное число» (Чекист 2.0, docs/design-system/README.md «Деньги»): which number leads «Главная». «Потрачено за
 * месяц» by default; the person may take «Осталось», «Свободно» or «В день» instead. A choice of the device, like
 * «Значки» (lib/list-icons.ts): `localStorage`, every access guarded, the open page keeps a choice storage refused. */
import { useCallback, useSyncExternalStore } from 'react'

export type HomeFigure = 'spent' | 'left' | 'free' | 'daily'

export const homeFigureStorageKey = 'checkist.homeFigure'

/** The four numbers in the order of the setting: the name of the option and a line of what it counts. */
export const HOME_FIGURES: { value: HomeFigure; label: string; note: string }[] = [
  { value: 'spent', label: 'Потрачено', note: 'Все траты месяца' },
  { value: 'left', label: 'Осталось', note: 'Бюджет месяца минус траты' },
  { value: 'free', label: 'Свободно', note: 'Доход минус траты, платежи и планы' },
  { value: 'daily', label: 'В день', note: 'Сколько можно тратить в день до конца месяца' },
]

export const defaultHomeFigure: HomeFigure = 'spent'

/** A stored value, or anything else read back: an unknown one is the default. */
export function parseHomeFigure(value: unknown): HomeFigure {
  return HOME_FIGURES.some((option) => option.value === value) ? value as HomeFigure : defaultHomeFigure
}

let current: HomeFigure | undefined
const listeners = new Set<() => void>()

function stored(): HomeFigure {
  try {
    return parseHomeFigure(globalThis.localStorage?.getItem(homeFigureStorageKey))
  } catch {
    // Blocked storage (or no browser): the default.
    return defaultHomeFigure
  }
}

/** The choice of this device: the one made in this page, else the stored one, else «Потрачено». */
export function readHomeFigure(): HomeFigure {
  current ??= stored()
  return current
}

/** Remembers the choice on the device and tells every screen that shows it. */
export function writeHomeFigure(figure: HomeFigure) {
  const next = parseHomeFigure(figure)
  try {
    globalThis.localStorage?.setItem(homeFigureStorageKey, next)
  } catch {
    // Without storage the choice lives until the page is closed.
  }
  if (current === next) return
  current = next
  for (const listener of [...listeners]) listener()
}

/** Forgets what this page has read: the next read goes to the storage again (the tests start from a clean device). */
export function resetHomeFigureForTests() {
  current = undefined
}

function subscribe(listener: () => void) {
  // Another tab changed the choice: followed here too.
  const onStorage = (event: StorageEvent) => {
    if (event.key !== homeFigureStorageKey && event.key !== null) return
    current = stored()
    listener()
  }
  listeners.add(listener)
  try {
    globalThis.addEventListener?.('storage', onStorage)
  } catch {
    // No window: nothing to follow.
  }
  return () => {
    listeners.delete(listener)
    try {
      globalThis.removeEventListener?.('storage', onStorage)
    } catch {
      // No window.
    }
  }
}

/** The choice and its setter; a render without a browser (the markup tests) reads the same store. */
export function useHomeFigure(): [HomeFigure, (figure: HomeFigure) => void] {
  const figure = useSyncExternalStore(subscribe, readHomeFigure, readHomeFigure)
  const set = useCallback((next: HomeFigure) => writeHomeFigure(next), [])
  return [figure, set]
}
