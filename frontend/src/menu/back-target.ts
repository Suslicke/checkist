import { parseRoute } from '../navigation'
import type { NavigationSnapshot, Route } from '../navigation'

/** The «назад» of the phone's top bar: where it leads and its name for a screen reader. */
export type BackTarget = { to: string; label: string }

/** The round control of the header row: «назад» before the heading, or «✕» after it on a focus screen. */
export type HeaderAction = BackTarget & { kind: 'back' | 'close' }

/** A new or changed spend: a screen of one task, with «✕» instead of «назад» and without the bottom bar of a phone. */
export function isFocusRoute(route: Route): boolean {
  return route.kind === 'expense-new' || route.kind === 'expense-edit' || route.kind === 'income-edit'
}

/** The two screens a section may be opened from: «Ещё» of a phone and «Деньги» (2026-10-26). A section opened from one
 * of them goes back to it. */
export type HubPath = '/more' | '/money'
/** The sections of the screen «Ещё» (menu/menu-items.ts `groups`: «Данные» and «Настройки»). */
const MORE_KINDS: Route['kind'][] = ['catalog', 'stores', 'statement-rules', 'jobs', 'export', 'family', 'account', 'health']
/** The sections of the hub «Деньги» (features/money): its tiles and its chat. */
const MONEY_KINDS: Route['kind'][] = ['incomes', 'recurring', 'planned', 'goals', 'review', 'chat', 'spending', 'receipts-stats', 'trends', 'stats-incomes']
export function isMoreSection(route: Route): boolean {
  return MORE_KINDS.includes(route.kind)
}
export function isHubSection(hub: HubPath, route: Route): boolean {
  return (hub === '/more' ? MORE_KINDS : MONEY_KINDS).includes(route.kind)
}
/** The hub the person is still inside of: the one they just left for one of its sections, or the one kept while they
 * stay in a section of it (a tab of the statistics, a filter); none anywhere else. */
export function hubOf(previousHref: string, previousHub: HubPath | undefined, route: Route): HubPath | undefined {
  for (const hub of ['/more', '/money'] as const) {
    if ((previousHref === hub || previousHub === hub) && isHubSection(hub, route)) return hub
  }
  return undefined
}

/** The name of the way back by the kind of the page it leads to. */
const backLabels: Partial<Record<Route['kind'], string>> = {
  dashboard: 'Назад на главную',
  receipts: 'Назад к тратам',
  receipt: 'Назад к трате',
  jobs: 'Назад к заданиям',
  job: 'Назад к заданию',
  catalog: 'Назад в каталог',
  category: 'Назад к категории',
  merges: 'Назад к дублям',
  classification: 'Назад к категориям товаров',
  'statement-new': 'Назад к выпискам',
  incomes: 'Назад к доходам',
  goals: 'Назад к целям',
  chat: 'Назад к беседам',
  planned: 'Назад к планам',
  more: 'Назад в «Ещё»',
  money: 'Назад в «Деньги»',
}

const labelOf = (href: string) => backLabels[parseRoute(new URL(href, 'http://checkist.invalid')).kind] ?? 'Назад'

const target = (to: string): BackTarget => ({ to, label: labelOf(to) })

/**
 * The way back from a nested page: to the list the person came from (`returnTo`, the same address with its
 * filters and page), otherwise to the parent list of the page. A page of a section itself has none.
 */
export function backTarget({ route, returnTo }: Pick<NavigationSnapshot, 'route' | 'returnTo'>): BackTarget | undefined {
  switch (route.kind) {
    case 'receipt': return target(returnTo ?? '/receipts')
    case 'expense-edit': return target(`/receipts/${route.receiptId}`)
    case 'job': return target(returnTo ?? '/recognition/jobs')
    case 'product': return target(returnTo ?? '/catalog')
    case 'category': return target('/catalog')
    case 'merge': return target(returnTo ?? '/catalog/merges')
    case 'limits': return target('/')
    case 'statement': return target(returnTo ?? '/statements/new')
    case 'goal': return target('/goals')
    // A thread goes back to the list of threads; the list itself is a section.
    case 'chat': return route.threadId !== undefined ? target('/chat') : undefined
    // Back to «Главная» of the same month; from a deeper category — still «Главная», the screen links its parents itself.
    case 'category-spends': return target(returnTo ?? (route.month ? `/?month=${route.month}` : '/'))
    default: return undefined
  }
}

/**
 * The control of the header row. A focus screen is closed by «✕»: a changed spend back to its receipt, a new one to
 * the page of the app the person came from (`from`), otherwise to «Главная». Any other nested page goes back by
 * «назад» (`backTarget`); a page of a section has none — unless it was opened from a hub (`hub`: «Ещё» or «Деньги»).
 */
export function headerAction(navigation: Pick<NavigationSnapshot, 'route' | 'returnTo'>, from?: string, hub?: HubPath): HeaderAction | undefined {
  const { route } = navigation
  if (route.kind === 'expense-new') return { kind: 'close', to: from ?? '/', label: 'Закрыть' }
  if (route.kind === 'expense-edit') return { kind: 'close', to: `/receipts/${route.receiptId}`, label: 'Закрыть' }
  if (route.kind === 'income-edit') return { kind: 'close', to: from ?? '/incomes', label: 'Закрыть' }
  // A section opened from a hub goes back to it, as a pushed screen of a phone app; from anywhere else it has none.
  const back = backTarget(navigation) ?? (hub && isHubSection(hub, route) ? target(hub) : undefined)
  return back && { kind: 'back', ...back }
}
