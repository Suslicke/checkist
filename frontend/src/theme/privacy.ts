import { useSyncExternalStore } from 'react'

/**
 * «Скрывать суммы» (Чекист 2.0, docs/plans/2026-11-20-design-2.md §2): `localStorage['checkist.privacy'] = '1'` puts
 * `data-privacy` on `<html>`, and every `.ck-money` is blurred (App.css) while a screen reader hears «сумма скрыта»
 * (components/Money.tsx). The inline script of index.html sets the attribute before the first paint; this module keeps it
 * in step afterwards. Storage and the document are optional: blocked storage keeps the choice for the open page only.
 */
export const privacyStorageKey = 'checkist.privacy'
export const privacyAttribute = 'data-privacy'

const listeners = new Set<() => void>()
/** The choice made in this page; `null` until the person (or another tab) chooses: the storage decides then. */
let chosen: boolean | null = null
let stopListening: (() => void) | undefined

function stored(): boolean {
  try {
    return globalThis.localStorage?.getItem(privacyStorageKey) === '1'
  } catch {
    return false
  }
}

/** Puts the attribute on `<html>` or takes it off; a missing document is no error. */
export function applyPrivacyToDocument(on: boolean) {
  try {
    const root = globalThis.document?.documentElement
    if (!root) return
    if (on) root.setAttribute(privacyAttribute, '')
    else root.removeAttribute(privacyAttribute)
  } catch {
    // No document (a server render, a test): nothing to show.
  }
}

export function isPrivate(): boolean {
  return chosen ?? stored()
}

/** The value the listeners saw last: a change of another tab is told only when it differs. */
let announced = false

function notify() {
  announced = isPrivate()
  for (const listener of [...listeners]) listener()
}

export function setPrivate(on: boolean) {
  const changed = isPrivate() !== on
  chosen = on
  try {
    if (on) globalThis.localStorage?.setItem(privacyStorageKey, '1')
    else globalThis.localStorage?.removeItem(privacyStorageKey)
  } catch {
    // Blocked storage: the choice lives in this page only.
  }
  applyPrivacyToDocument(on)
  if (changed) notify()
}

export function togglePrivacy() {
  setPrivate(!isPrivate())
}

/** Another tab changed the choice: follow it. */
function listen(): (() => void) | undefined {
  try {
    const target = globalThis.window
    if (!target?.addEventListener) return undefined
    // The storage already holds the new value when the event comes: compare with what the listeners saw last.
    announced = isPrivate()
    const onStorage = (event: StorageEvent) => {
      if (event.key !== null && event.key !== privacyStorageKey) return
      const next = stored()
      chosen = next
      if (next === announced) return
      applyPrivacyToDocument(next)
      notify()
    }
    target.addEventListener('storage', onStorage)
    return () => target.removeEventListener('storage', onStorage)
  } catch {
    return undefined
  }
}

export function subscribePrivacy(listener: () => void) {
  listeners.add(listener)
  if (listeners.size === 1) stopListening = listen()
  return () => {
    listeners.delete(listener)
    if (listeners.size === 0) {
      stopListening?.()
      stopListening = undefined
    }
  }
}

/** `true` while sums are hidden. A server render sees them shown: the attribute of the inline script blurs them anyway. */
export function usePrivacy(): boolean {
  return useSyncExternalStore(subscribePrivacy, isPrivate, () => false)
}
