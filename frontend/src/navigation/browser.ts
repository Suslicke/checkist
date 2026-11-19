import { useSyncExternalStore } from 'react'
import { flushSync } from 'react-dom'
import { createNavigation } from './controller'
import type { NavigationDirection, NavigationTarget, NavigateOptions } from './controller'

let navigation: ReturnType<typeof createNavigation> | undefined
/** The browser has drawn the last step in the history itself (the swipe back of Safari): no second move over it. */
let drawnByBrowser = false

type ViewTransitionDocument = Document & { startViewTransition?: (update: () => void) => { finished: Promise<void> } }

/**
 * A change of the page drawn as a move (View Transitions; the keyframes are in shell.css, keyed by `data-nav-direction`
 * on `<html>`): iOS slides the new page in from the right, Android moves it along the X axis with a fade. Only where the
 * browser can and the person has not asked the system for less motion; otherwise — and if anything fails — the page
 * changes at once. React draws the new page inside the callback, synchronously, after the old one was captured.
 */
export function moveWithTransition(direction: NavigationDirection, update: () => void) {
  const page = typeof document === 'undefined' ? undefined : document as ViewTransitionDocument
  let still = true
  try {
    still = drawnByBrowser || !page || typeof page.startViewTransition !== 'function'
      || !window.matchMedia('(prefers-reduced-motion: no-preference)').matches
  } catch {
    still = true
  }
  drawnByBrowser = false
  if (still || !page?.startViewTransition) {
    update()
    return
  }
  const root = page.documentElement
  let done = false
  const draw = () => {
    if (done) return
    done = true
    flushSync(update)
  }
  try {
    root.dataset.navDirection = direction
    const transition = page.startViewTransition(draw)
    void transition.finished.catch(() => {}).finally(() => {
      if (root.dataset.navDirection === direction) delete root.dataset.navDirection
    })
  } catch {
    delete root.dataset.navDirection
    draw()
  }
}

function browserNavigation() {
  // Importing navigation helpers in Node does not require a browser.
  navigation ??= createNavigation({
    getHref: () => window.location.href,
    getState: () => window.history.state,
    pushState: (state, href) => window.history.pushState(state, '', href),
    replaceState: (state, href) => window.history.replaceState(state, '', href),
    back: () => window.history.back(),
    listenPopState: (listener) => {
      const onPopState = (event: PopStateEvent) => {
        // Safari and Chrome tell when they have animated the step themselves (a swipe back).
        drawnByBrowser = (event as PopStateEvent & { hasUAVisualTransition?: boolean }).hasUAVisualTransition === true
        listener()
        drawnByBrowser = false
      }
      window.addEventListener('popstate', onPopState)
      return () => window.removeEventListener('popstate', onPopState)
    },
    transition: moveWithTransition,
  })
  return navigation
}

export function navigate(target: NavigationTarget, options?: NavigateOptions) {
  browserNavigation().navigate(target, options)
}

/** «Назад»: a step back in the history when a page of the app lies there, otherwise to `fallback`. */
export function goBack(fallback: NavigationTarget) {
  browserNavigation().back(fallback)
}

/** Leave a saved form for `target` so that «назад» never opens the form again. */
export function leave(target: NavigationTarget) {
  browserNavigation().leave(target)
}

/** Stable snapshot of route/query and optional return context; also updates on popstate. */
export function useNavigation() {
  const store = browserNavigation()
  return useSyncExternalStore(store.subscribe, store.getSnapshot)
}

export function useRoute() {
  return useNavigation().route
}
