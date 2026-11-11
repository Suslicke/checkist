import { describe, expect, it } from 'vitest'
import type { Route } from '../navigation'
import { backTarget, headerAction, hubOf, isFocusRoute, isHubSection } from './back-target'

const at = (route: Route, returnTo?: string) => backTarget({ route, returnTo })

describe('«назад» of the phone top bar (pure, no browser)', () => {
  it('leads a nested page to its parent list without a remembered list', () => {
    expect(at({ kind: 'receipt', receiptId: 7 })).toEqual({ to: '/receipts', label: 'Назад к тратам' })
    expect(at({ kind: 'job', jobId: 9 })).toEqual({ to: '/recognition/jobs', label: 'Назад к заданиям' })
    expect(at({ kind: 'product', productId: 5, query: { page: 1 } })).toEqual({ to: '/catalog', label: 'Назад в каталог' })
    expect(at({ kind: 'category', categoryId: 3, query: { page: 1 } })).toEqual({ to: '/catalog', label: 'Назад в каталог' })
    expect(at({ kind: 'merge', groupId: 2 })).toEqual({ to: '/catalog/merges', label: 'Назад к дублям' })
    expect(at({ kind: 'limits' })).toEqual({ to: '/', label: 'Назад на главную' })
    // The form that changes a spend goes back to the spend itself.
    expect(at({ kind: 'expense-edit', receiptId: 12 })).toEqual({ to: '/receipts/12', label: 'Назад к трате' })
  })

  it('returns to the very list the person came from, with its filters and page', () => {
    expect(at({ kind: 'receipt', receiptId: 7 }, '/?month=2026-09')).toEqual({ to: '/?month=2026-09', label: 'Назад на главную' })
    expect(at({ kind: 'receipt', receiptId: 7 }, '/receipts?store=4&page=2')).toEqual({ to: '/receipts?store=4&page=2', label: 'Назад к тратам' })
    expect(at({ kind: 'receipt', receiptId: 7 }, '/recognition/jobs/3')).toEqual({ to: '/recognition/jobs/3', label: 'Назад к заданию' })
    expect(at({ kind: 'product', productId: 5, query: { page: 1 } }, '/catalog/categories/4?page=3')).toEqual({ to: '/catalog/categories/4?page=3', label: 'Назад к категории' })
    expect(at({ kind: 'product', productId: 5, query: { page: 1 } }, '/receipts/7')).toEqual({ to: '/receipts/7', label: 'Назад к трате' })
    expect(at({ kind: 'product', productId: 5, query: { page: 1 } }, '/catalog/classification?status=all')).toEqual({ to: '/catalog/classification?status=all', label: 'Назад к категориям товаров' })
    expect(at({ kind: 'merge', groupId: 2 }, '/catalog/merges?page=2')).toEqual({ to: '/catalog/merges?page=2', label: 'Назад к дублям' })
    expect(at({ kind: 'job', jobId: 9 }, '/receipts/7')).toEqual({ to: '/receipts/7', label: 'Назад к трате' })
  })

  it('has no way back on a page of a section itself', () => {
    const top: Route[] = [
      { kind: 'dashboard' }, { kind: 'receipts', query: { page: 1 } }, { kind: 'catalog', query: { page: 1 } }, { kind: 'jobs', query: { page: 1 } },
      { kind: 'spending', query: {} }, { kind: 'health' }, { kind: 'account' }, { kind: 'upload' }, { kind: 'expense-new' },
      { kind: 'merges', query: { page: 1 } }, { kind: 'classification', query: { page: 1 } }, { kind: 'not-found', path: '/x' },
    ]
    for (const route of top) expect(at(route, '/receipts'), route.kind).toBeUndefined()
  })
})

describe('the round control of the header row (pure, no browser)', () => {
  it('closes a focus screen with «✕»: a changed spend to its receipt, a new one to where the person came from', () => {
    expect(headerAction({ route: { kind: 'expense-edit', receiptId: 12 } })).toEqual({ kind: 'close', to: '/receipts/12', label: 'Закрыть', step: true })
    expect(headerAction({ route: { kind: 'expense-new' } }, '/receipts?page=2')).toEqual({ kind: 'close', to: '/receipts?page=2', label: 'Закрыть', step: true })
    // Opened directly: «Главная».
    expect(headerAction({ route: { kind: 'expense-new' } })).toEqual({ kind: 'close', to: '/', label: 'Закрыть', step: true })
    expect(isFocusRoute({ kind: 'expense-new' })).toBe(true)
    expect(isFocusRoute({ kind: 'expense-edit', receiptId: 3 })).toBe(true)
    expect(isFocusRoute({ kind: 'receipts', query: { page: 1 } })).toBe(false)
  })

  it('goes back from any other nested page and has nothing on a page of a section', () => {
    expect(headerAction({ route: { kind: 'receipt', receiptId: 7 } }, '/stats')).toEqual({ kind: 'back', to: '/receipts', label: 'Назад к тратам', step: true })
    expect(headerAction({ route: { kind: 'dashboard' } }, '/receipts')).toBeUndefined()
  })

  it('leads a section opened from «Деньги» back to it, as one opened from «Ещё» (2026-10-26)', () => {
    for (const route of [{ kind: 'goals' }, { kind: 'recurring' }, { kind: 'incomes' }, { kind: 'planned' }, { kind: 'review' }, { kind: 'chat' }, { kind: 'spending', query: {} }] as Route[]) {
      expect(isHubSection('/money', route), route.kind).toBe(true)
      expect(headerAction({ route }, '/money', '/money'), route.kind).toEqual({ kind: 'back', to: '/money', label: 'Назад в «Деньги»' })
    }
    expect(isHubSection('/more', { kind: 'goals' })).toBe(false)
    expect(isHubSection('/money', { kind: 'stores' })).toBe(false)
    expect(headerAction({ route: { kind: 'stores' } }, '/money', '/money')).toBeUndefined()
    expect(headerAction({ route: { kind: 'goals' } }, '/money')).toBeUndefined()
    // A nested page keeps its own parent.
    expect(headerAction({ route: { kind: 'goal', goalId: 4 } }, '/goals', '/money')).toEqual({ kind: 'back', to: '/goals', label: 'Назад к целям', step: true })
  })

  it('keeps the hub while the person stays in one of its sections, and drops it anywhere else', () => {
    // Just left «Деньги» for its section.
    expect(hubOf('/money', undefined, { kind: 'goals' })).toBe('/money')
    expect(hubOf('/more', undefined, { kind: 'stores' })).toBe('/more')
    // Moved on inside the section (a tab of the statistics, a month of the plans): still inside the hub.
    expect(hubOf('/stats', '/money', { kind: 'trends', query: {} })).toBe('/money')
    expect(hubOf('/planned', '/money', { kind: 'planned', month: '2026-11' })).toBe('/money')
    expect(hubOf('/goals', '/money', { kind: 'goal', goalId: 4 })).toBeUndefined()
    // Left the hub's sections, or came from somewhere else.
    expect(hubOf('/goals', '/money', { kind: 'receipts', query: { page: 1 } })).toBeUndefined()
    expect(hubOf('/', undefined, { kind: 'goals' })).toBeUndefined()
    expect(hubOf('/money', undefined, { kind: 'stores' })).toBeUndefined()
  })

  it('gives a section «назад» to the page it was opened from by a link, and none after the menu (2026-11-11)', () => {
    const recurring = { route: { kind: 'recurring' } as const, href: '/recurring' }
    // A row of «Требует внимания» on «Главная» → «Платежи».
    expect(headerAction({ ...recurring, depth: 1, from: '/' })).toEqual({ kind: 'back', to: '/', label: 'Назад', step: true })
    // Through the menu, entered directly, or only a filter of the same page changed: nothing.
    expect(headerAction(recurring)).toBeUndefined()
    expect(headerAction({ ...recurring, href: '/recurring?month=2026-10', depth: 2, from: '/recurring' })).toBeUndefined()
    // «Главная» never has it; a hub and a detail page keep their own way back.
    expect(headerAction({ route: { kind: 'dashboard' }, href: '/', depth: 1, from: '/receipts' })).toBeUndefined()
    expect(headerAction({ ...recurring, depth: 1, from: '/money' }, '/money', '/money')).toEqual({ kind: 'back', to: '/money', label: 'Назад в «Деньги»' })
    expect(headerAction({ route: { kind: 'receipt', receiptId: 7 }, href: '/receipts/7', depth: 1, from: '/recurring' }))
      .toEqual({ kind: 'back', to: '/receipts', label: 'Назад к тратам', step: true })
  })
})
