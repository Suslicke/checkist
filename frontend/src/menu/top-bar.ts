/** What the header row of a page is (App.tsx, shell.css `data-nav`): the root of a section — «Главная», «Траты», a page
 * of the menu, which draws a large title on iOS; a page nested in a section, with «назад»; a focus screen, with «✕». */
export type TopBarKind = 'root' | 'nested' | 'focus'

export function topBarKind(action: { kind: 'back' | 'close' } | undefined): TopBarKind {
  return action?.kind === 'close' ? 'focus' : action?.kind === 'back' ? 'nested' : 'root'
}

type Entry = { isIntersecting: boolean; boundingClientRect: { top: number }; rootBounds: { top: number } | null }

/** The page has gone under the pinned bar: the mark that lies right under the header row (on iOS — under the large
 * title) has left the window above the lower edge of the bar. A mark below the window is no scroll. */
export function scrolledUnder(entry: Entry): boolean {
  return !entry.isIntersecting && entry.boundingClientRect.top < (entry.rootBounds?.top ?? 0)
}

/** The windows in which the top bar is pinned (the bottom-bar block of shell.css), and a turn of the phone: the bar and
 * its height (the safe area) may change with them. */
const BAR_QUERIES = ['(max-width: 540px) and (min-width: 340px) and (min-height: 480px)', '(orientation: portrait)']

/**
 * Sets `data-scrolled` on `main` while the page lies under the top bar: iOS turns the bar into glass and shows the short
 * title, Android fills it (shell.css). One IntersectionObserver on `mark`, its upper margin the height of the pinned bar —
 * no scroll listener, the layout is read only when the bar may have changed (a threshold of the width, a turn).
 * `bars` — the candidates for the pinned bar, the first one pinned wins. Returns the cleanup; a no-op without a browser.
 */
export function watchTopBar(main: HTMLElement | null, bars: (HTMLElement | null)[], mark: HTMLElement | null): () => void {
  if (!main || !mark || typeof window === 'undefined' || typeof IntersectionObserver === 'undefined') return () => {}
  let observer: IntersectionObserver | undefined
  const start = () => {
    observer?.disconnect()
    const bar = bars.find((node): node is HTMLElement => node !== null && getComputedStyle(node).position === 'sticky')
    const height = Math.max(0, Math.round(bar?.offsetHeight ?? 0))
    observer = new IntersectionObserver((entries) => {
      const entry = entries[entries.length - 1]
      if (entry) main.toggleAttribute('data-scrolled', scrolledUnder(entry))
    }, { rootMargin: `-${height}px 0px 0px 0px` })
    observer.observe(mark)
  }
  start()
  const lists: MediaQueryList[] = []
  try {
    for (const query of BAR_QUERIES) {
      const list = window.matchMedia(query)
      list.addEventListener('change', start)
      lists.push(list)
    }
  } catch {
    // Without matchMedia the first measure stays.
  }
  return () => {
    observer?.disconnect()
    for (const list of lists) list.removeEventListener('change', start)
    main.removeAttribute('data-scrolled')
  }
}
