import { useSyncExternalStore } from 'react'

/** The only phone threshold of the project: the same number stands in every `@media (max-width: 540px)`. */
export const PHONE_MAX_WIDTH = 540
export const narrowQuery = `(max-width: ${PHONE_MAX_WIDTH}px)`
/** The desktop threshold of the project (two columns): the same number stands in every `@media (min-width: 960px)`. */
export const DESKTOP_MIN_WIDTH = 960
export const desktopQuery = `(min-width: ${DESKTOP_MIN_WIDTH}px)`
/** A touch screen: the finger, not the mouse, is the pointer («Снять чек» is the right word there). */
export const coarsePointerQuery = '(pointer: coarse)'

export type NarrowEnvironment = {
  /** Whether the window is a phone now. */
  matches: () => boolean
  /** Reports that the answer may have changed (rotation, zoom, resized window). */
  listen: (listener: () => void) => () => void
}

export type NarrowStore = ReturnType<typeof createNarrowStore>

/** Every environment call is guarded: a missing or failing matchMedia means the wide view, never a broken page. */
export function createNarrowStore(environment: NarrowEnvironment) {
  return {
    getSnapshot(): boolean {
      try {
        return environment.matches() === true
      } catch {
        return false
      }
    },
    getServerSnapshot: (): boolean => false,
    subscribe(listener: () => void) {
      try {
        const stop = environment.listen(listener)
        return () => {
          try {
            stop()
          } catch {
            // Nothing to release.
          }
        }
      } catch {
        return () => {}
      }
    },
  }
}

/** The same store with a finger for the answer of a server render: a Node render keeps the words of a touch screen. */
export function createCoarsePointerStore(environment: NarrowEnvironment): NarrowStore {
  return { ...createNarrowStore(environment), getServerSnapshot: () => true }
}

const stores = new Map<string, NarrowStore>()

/** One store per media query, made on the first use. Nothing here touches the browser until React reads or subscribes:
 * components are also rendered in Node. */
function browserStore(query: string, serverSnapshot: boolean) {
  const known = stores.get(query)
  if (known) return known
  let list: MediaQueryList | undefined
  const media = () => (list ??= window.matchMedia(query))
  const environment: NarrowEnvironment = {
    matches: () => media().matches,
    listen: (listener) => {
      const current = media()
      current.addEventListener('change', listener)
      return () => current.removeEventListener('change', listener)
    },
  }
  const store = serverSnapshot ? createCoarsePointerStore(environment) : createNarrowStore(environment)
  stores.set(query, store)
  return store
}

function useMedia(query: string, serverSnapshot: boolean): boolean {
  const current = browserStore(query, serverSnapshot)
  return useSyncExternalStore(current.subscribe, current.getSnapshot, current.getServerSnapshot)
}

/** True on a phone (window up to 540 px wide). A server render (renderToStaticMarkup) always sees the wide view. */
export function useNarrow(): boolean {
  return useMedia(narrowQuery, false)
}

/** True on a desktop (window from 960 px wide): the only script-side switch of the desktop layout (the catalog table).
 * A server render never sees the desktop view. */
export function useDesktop(): boolean {
  return useMedia(desktopQuery, false)
}

/** True on a touch screen (`pointer: coarse`); a server render answers true, so a Node render keeps «Снять чек». */
export function useCoarsePointer(): boolean {
  return useMedia(coarsePointerQuery, true)
}
