import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { Session } from '../../session'
import { headerAction } from '../../menu/back-target'
import { buildRoute, parseRoute } from '../../navigation'

const state = vi.hoisted(() => ({ session: undefined as Session | undefined }))
vi.mock('../../session', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../session')>(), useSession: () => state.session!,
}))
const { default: MorePage } = await import('./MorePage')

const person: Session = { kind: 'user', mode: 'accounts', user: { id: 1, username: 'suslicke', display_name: 'Андрей', is_staff: true },
  household: { id: 3, name: 'Пустовые', members: ['suslicke'] }, permissions: { moderate_catalog: true } }
const local: Session = { kind: 'user', mode: 'local_single', user: { id: 1, username: 'local', is_staff: false }, household: null, permissions: { moderate_catalog: true } }
const view = (session: Session) => { state.session = session; return renderToStaticMarkup(<MorePage />).replace(/<svg\b.*?<\/svg>/g, '') }
const links = (html: string) => [...html.matchAll(/<a\b[^>]*href="([^"]+)"/g)].map((match) => match[1])

describe('«Ещё» as a screen of its own (2026-10-13, Vitest/SSR, not browser visual acceptance)', () => {
  it('opens at /more', () => {
    expect(parseRoute(new URL('/more', 'http://checkist.invalid'))).toEqual({ kind: 'more' })
    expect(buildRoute({ kind: 'more' })).toBe('/more')
  })

  it('shows the person and the family, then «Данные», «Настройки» and «Оформление»; the money sections are the screen «Деньги» (2026-10-26)', () => {
    const html = view(person)
    // The name of the card is its words with «Аккаунт: » for the ear (label in name): no aria-label that hides the meta.
    expect(html).toContain('<a class="ck-panel more-profile" href="/account"><span class="more-avatar" aria-hidden="true">А</span><span class="ck-row-main"><span class="more-profile-name"><span class="ck-visually-hidden">Аккаунт: </span>Андрей</span>')
    expect(html).not.toMatch(/more-profile"[^>]*aria-label/)
    expect(html).toContain('Семья «Пустовые» · пароль и уведомления')
    expect(html).not.toContain('more-tiles')
    expect(html).not.toContain('href="/incomes"')
    expect(html).toContain('<h2 id="more-data" class="more-title">Данные</h2>')
    expect(links(html)).toEqual(['/account', '/receipts/upload', '/statements/new', '/catalog', '/stores', '/statements/rules', '/recognition/jobs', '/export', '/family', '/health'])
    // The account is the card on top, not a row again.
    expect(html.match(/href="\/account"/g)).toHaveLength(1)
    // «Оформление» closes the screen: the theme and the squares as segments, «Скрывать суммы», the main number of «Главная».
    expect(html.indexOf('<h2 id="more-settings" class="more-title">Настройки</h2>')).toBeLessThan(html.indexOf('<h2 id="more-appearance-heading">Оформление</h2>'))
    expect(html).toContain('<div class="ck-segments" role="group" aria-labelledby="more-appearance-theme-label">')
    expect(html).toContain('<div class="ck-segments" role="group" aria-labelledby="more-appearance-icons-label"><button type="button" aria-pressed="true">Категория</button>')
    expect(html).toMatch(/<input id="more-appearance-privacy" type="checkbox" role="switch" class="ck-switch"[^>]*>/)
    expect(html).toContain('Главное число на Главной')
    // The hint of the home screen is for Safari on an iPhone only: a server render never shows it.
    expect(html).not.toContain('data-more-install')
  })

  it('has no card of the person without accounts', () => {
    const html = view(local)
    expect(html).not.toContain('more-profile')
    expect(links(html).at(-1)).toBe('/health')
  })

  it('is the way back of a section opened from it, and only of such a one', () => {
    expect(headerAction({ route: { kind: 'stores' } }, '/more', '/more')).toEqual({ kind: 'back', to: '/more', label: 'Назад в «Ещё»' })
    expect(headerAction({ route: { kind: 'export', query: {} } }, '/more', '/more')).toEqual({ kind: 'back', to: '/more', label: 'Назад в «Ещё»' })
    expect(headerAction({ route: { kind: 'stores' } }, '/')).toBeUndefined()
    // «Цели» are a section of «Деньги» now: from «Ещё» they are not reached, so they never go back to it.
    expect(headerAction({ route: { kind: 'goals' } }, '/more', '/more')).toBeUndefined()
    // A nested page keeps its own parent; a page outside of «Ещё» never goes back to it.
    expect(headerAction({ route: { kind: 'product', productId: 4, query: { page: 1 } } }, '/catalog', '/more')).toEqual({ kind: 'back', to: '/catalog', label: 'Назад в каталог', step: true })
    expect(headerAction({ route: { kind: 'dashboard' } }, '/more', '/more')).toBeUndefined()
  })
})
