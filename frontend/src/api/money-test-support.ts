import type { Money } from './money'

/** «Деньги» of October 2026 as the approved mockup draws it: the income entered, two of five payments paid, the plans
 * waiting, the goals at 62 %, six months of spends with October below the average, the review of September. */
export function moneyFixture(): Money {
  return {
    month: '2026-10', currency: 'KZT',
    income: '1050000.00', spent: '127500.00', set_aside: '305000.00',
    flow: { spent: '127500.00', payments_ahead: '356445.00', plans_ahead: '185000.00', free: '381055.00' },
    payments: { left: '356445.00', paid: 2, total: 5, next: { name: 'Аренда', due_date: '2026-10-28', days: 2 } },
    plans: { left: '185000.00', count: 3, undated_count: 2 },
    goals: { count: 3, share: 62, saved: '305000.00', currency: 'KZT', top: [{ name: 'Зима', share: 38 }, { name: 'Отпуск', share: 83 }] },
    months: [
      { month: '2026-05', spent: '240000.00' }, { month: '2026-06', spent: '420000.00' }, { month: '2026-07', spent: '330000.00' },
      { month: '2026-08', spent: '540000.00' }, { month: '2026-09', spent: '360000.00' }, { month: '2026-10', spent: '127500.00' },
    ],
    review: { month: '2026-09', change_previous: '12.00', tips: 3 },
  }
}
