import { buildRoute, parseRoute } from './routes'
import type { NavigableRoute, Route } from './routes'

/** Small History API port; unit tests provide an in-memory implementation. */
export interface NavigationEnvironment {
  getHref(): string
  getState(): unknown
  pushState(state: unknown, href: string): void
  replaceState(state: unknown, href: string): void
  listenPopState(listener: () => void): () => void
  /** `history.back()`; absent in a port that cannot step back (then «назад» navigates to its fallback). */
  back?(): void
}

export interface NavigationSnapshot {
  href: string
  route: Route
  /** Known source page; absent for direct entry to a detail. */
  returnTo?: string
  /** How many pages of the app lie behind this one in the history of the tab: 0 — the person entered here
   * (a link, a notification, a reload of the first page), so there is nothing of the app to step back to. */
  depth?: number
  /** The page of the app the person came from by the last push (`depth` > 0). */
  from?: string
}

export interface NavigateOptions {
  replace?: boolean
}

export type NavigationTarget = string | NavigableRoute

function listContext(value: unknown, origin: string, detail: Route): string | undefined {
  if (typeof value !== 'string') return undefined
  try {
    const url = new URL(value, origin)
    if (url.origin !== origin) return undefined
    const route = parseRoute(url)
    const compatible = detail.kind === 'product' ? ['catalog', 'category', 'receipt', 'classification'].includes(route.kind)
      : detail.kind === 'receipt' ? ['receipts', 'job', 'dashboard'].includes(route.kind)
        : detail.kind === 'merge' ? route.kind === 'merges'
          : detail.kind === 'job' && ['jobs', 'receipt'].includes(route.kind)
    return compatible && route.kind !== 'not-found' && route.kind !== 'invalid-query' ? buildRoute(route) : undefined
  } catch {
    return undefined
  }
}

const pathOf = (href: string) => href.split(/[?#]/)[0]

/**
 * Whether «назад» is one step back in the history: a page of the app lies behind this one and it is another page.
 * A push of the same page with another query (a filter, a mode of a chart) is not a place to come back to — then
 * «назад» leads to its fallback, the list or the parent, as before.
 */
export function stepsBack({ href, depth, from }: Pick<NavigationSnapshot, 'href' | 'depth' | 'from'>): boolean {
  return (depth ?? 0) > 0 && from !== undefined && pathOf(from) !== pathOf(href)
}

export function createNavigation(environment: NavigationEnvironment) {
  const listeners = new Set<() => void>()
  let unlisten: (() => void) | undefined

  const read = (): NavigationSnapshot => {
    const url = new URL(environment.getHref())
    const state = environment.getState()
    const route = parseRoute(url)
    const returnTo = state !== null && typeof state === 'object' && 'checkistReturnTo' in state
      ? listContext(state.checkistReturnTo, url.origin, route) : undefined
    const depth = state !== null && typeof state === 'object' && 'checkistDepth' in state
      && typeof state.checkistDepth === 'number' && state.checkistDepth > 0 ? state.checkistDepth : 0
    const from = depth > 0 && state !== null && typeof state === 'object' && 'checkistFrom' in state
      && typeof state.checkistFrom === 'string' ? state.checkistFrom : undefined
    return { href: `${url.pathname}${url.search}${url.hash}`, route, ...(returnTo && { returnTo }), ...(depth > 0 && { depth }), ...(from && { from }) }
  }
  let snapshot = read()
  const refresh = () => {
    const next = read()
    if (next.href === snapshot.href && next.returnTo === snapshot.returnTo && next.depth === snapshot.depth && next.from === snapshot.from) return
    snapshot = next
    listeners.forEach((listener) => listener())
  }

  const navigate = (target: NavigationTarget, options: NavigateOptions = {}) => {
    const current = new URL(environment.getHref())
    const url = new URL(typeof target === 'string' ? target : buildRoute(target), current)
    if (url.origin !== current.origin || !['http:', 'https:'].includes(url.protocol)) {
      throw new TypeError('Navigation must stay on this origin')
    }
    const href = `${url.pathname}${url.search}${url.hash}`
    if (href === snapshot.href) return
    const route = parseRoute(url)
    const returnTo = listContext(current.href, current.origin, route)
      ?? listContext(snapshot.returnTo, current.origin, route)
    // A push puts one more page of the app behind the new one; a replacement keeps what lay behind the old one.
    const depth = options.replace ? snapshot.depth ?? 0 : (snapshot.depth ?? 0) + 1
    const from = options.replace ? snapshot.from : snapshot.href
    const state = returnTo || depth > 0
      ? { ...(returnTo && { checkistReturnTo: returnTo }), ...(depth > 0 && { checkistDepth: depth, checkistFrom: from }) } : null
    if (options.replace) environment.replaceState(state, href)
    else environment.pushState(state, href)
    // pushState/replaceState do not fire popstate.
    refresh()
  }
  const hrefOf = (target: NavigationTarget) => {
    const url = new URL(typeof target === 'string' ? target : buildRoute(target), environment.getHref())
    return `${url.pathname}${url.search}${url.hash}`
  }

  return {
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) {
      // Refresh after an unsubscribed interval (including StrictMode's cleanup).
      if (listeners.size === 0) {
        unlisten = environment.listenPopState(refresh)
        refresh()
      }
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
        if (listeners.size === 0) {
          unlisten?.()
          unlisten = undefined
        }
      }
    },
    navigate,
    /**
     * «Назад»: one step back in the history of the tab when a page of the app lies there — the screen the person
     * really came from, with its filters and its place; otherwise (entered here) to `fallback`, the parent page.
     */
    back(fallback: NavigationTarget) {
      if (stepsBack(snapshot) && environment.back) environment.back()
      else navigate(fallback)
    },
    /**
     * Leave a finished screen (a saved form) for `target` without keeping the screen in the history: when `target`
     * is the page the person came from — one step back to it, otherwise `target` takes the place of the screen.
     * So «назад» never opens a form that was already saved.
     */
    leave(target: NavigationTarget) {
      if ((snapshot.depth ?? 0) > 0 && environment.back && snapshot.from === hrefOf(target)) environment.back()
      else navigate(target, { replace: true })
    },
  }
}
