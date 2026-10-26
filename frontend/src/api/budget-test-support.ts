import type { BudgetLimit, Dashboard, DashboardAttention, DashboardDay } from './budget-types'

/** The example of the contract and of the approved mockup: a family of Андрей and Лиза, October 2026, tenge. */
export function dashboardFixture(): Dashboard {
  return {
    month: '2026-10', previous_month: '2026-09', days_left: 19, members: ['andrey', 'liza'],
    currencies: [{
      currency: 'KZT', spent: '287450.00', previous_spent: '326100.00', limit_total: '400000.00', limited_spent: '287450.00',
      categories: [
        { category_id: 3, name: 'Продукты', spent: '92300.00', limit: '120000.00', limit_id: 7 },
        { category_id: 8, name: 'Кафе', spent: '54300.00', limit: '50000.00', limit_id: 8 },
        { category_id: 11, name: 'Транспорт', spent: '21500.50', limit: null, limit_id: null },
        { category_id: 1, name: 'Не разобрано', spent: '1200.00', limit: null, limit_id: null },
        { category_id: 6, name: 'Дом', spent: '0.00', limit: '30000.00', limit_id: 9 },
      ],
    }],
    recent: [
      { id: 12, source: 'photo', title: 'Magnum', category_name: 'Продукты', owner: 'liza', purchased_on: '2026-10-12', total: '18940.00', currency: 'KZT', lines_count: 23 },
      { id: 13, source: 'manual', title: 'Такси до аэропорта', category_name: 'Транспорт', owner: 'andrey', purchased_on: '2026-10-11', total: '4500.00', currency: 'KZT', lines_count: 1 },
      { id: 14, source: 'photo', title: 'Кофейня', category_name: null, owner: 'andrey', purchased_on: '2026-10-01', total: '1500.50', currency: 'KZT', lines_count: 1 },
    ],
  }
}

export function limitFixture(overrides: Partial<BudgetLimit> = {}): BudgetLimit {
  return { id: 7, category_id: 3, category_name: 'Продукты', currency: 'KZT', amount: '120000.00', ...overrides }
}

/** Every day of October 2026 for the pulse: spends on most days, nothing on a few, the sums of the mockup. */
export function byDayFixture(): DashboardDay[] {
  const spent = [1800, 0, 3500, 1000, 0, 2200, 6000, 800, 0, 1400, 3000, 0, 500, 4500, 1200, 0, 2500, 7000, 900, 1600, 0, 3300, 2000, 5200, 3800, 12000, 0, 0, 0, 0, 0]
  return spent.map((value, index) => ({ day: `2026-10-${String(index + 1).padStart(2, '0')}`, spent: `${value}.00` }))
}

/** The rows of «Требует внимания» of the mockup as the server sends them (the words without the money, the money apart):
 * a payment in two days, the income of the month, a verdict of the model. */
export function attentionFixture(): DashboardAttention[] {
  return [
    { kind: 'payment_due', title: 'Аренда квартиры через 2 дня', meta: 'Срок 5 ноября', href: '/recurring', amount: '220000.00', currency: 'KZT' },
    { kind: 'income_missing', title: 'Доход за октябрь не внесён', meta: 'Зарплата', href: '/receipts/new?kind=income', amount: '1050000.00', currency: 'KZT' },
    { kind: 'plan_verdict', title: 'Куртку лучше отложить до ноября', meta: 'лимит «Дом» уже 92 % · обсудить', href: '/chat', amount: null, currency: null },
  ]
}

/** The dashboard of the home of 2026-10-26: the fixture above with the budget, the day allowance, the pulse, the rows
 * of «Требует внимания» and the three tiles — what a server of the contract sends on the 26th of October. */
export function homeFixture(): Dashboard {
  return {
    ...dashboardFixture(), days_left: 6, base_currency: 'KZT',
    budget: { amount: '900000.00', currency: 'KZT', spent: '287450.00' },
    allowance: { currency: 'KZT', basis: 'budget', amount: '900000.00', spent: '287450.00', unpaid: '25000.00', unpaid_count: 1, days_left: 6, per_day: '97925.00', overspent: null },
    by_day: byDayFixture(), average_day: '2610.00',
    attention: attentionFixture(), attention_more: 2,
    tiles: {
      payments: { paid: 2, total: 5, left: '356445.00', currency: 'KZT', segments: [{ paid: true }, { paid: true }, { paid: false }, { paid: false }, { paid: false }] },
      plans: {
        expected: '277000.00', left: '185000.00', count: 3, done_count: 1,
        segments: [{ id: 1, name: 'Куртка', category_id: 12, amount: '65000.00', done: false }, { id: 2, name: 'Подарок', category_id: 10, amount: '92000.00', done: true }, { id: 3, name: 'Шины', category_id: 9, amount: '120000.00', done: false }],
        rows: [],
      },
      goals: { count: 3, share: '62.00', saved: '305000.00', currency: 'KZT', top: [{ name: 'Зима', share: '38.00' }, { name: 'Отпуск', share: '83.00' }] },
    },
  }
}
