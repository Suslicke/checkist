import type { PlannedAdvice, PlannedMonth, PlannedMonthCard, PlannedSegment, PlannedSpend } from './planned.ts'

const ANDREY = { username: 'andrey', display_name: 'Андрей' }

/** A plan of October 2026 in the shape of `GET /api/planned/`: the jacket of the approved mockup. */
export function plannedFixture(patch: Partial<PlannedSpend> = {}): PlannedSpend {
  return {
    id: 1, name: 'Зимняя куртка', category: { id: 12, name: 'Одежда', icon: 'shirt' }, currency: 'KZT', amount: '150000.00',
    due: '2026-10-01', due_exact: false, note: '', receipt: null,
    goal: { id: 3, name: 'Зима', kind: 'deposit', saved: '57000.00', share: '38.00' }, ai: { verdict: 'keep', reason: 'Холода не ждут.', at: '2026-10-26T09:00:00Z' },
    created_by: ANDREY, created_at: '2026-10-02T10:00:00Z',
    ...patch,
  }
}

const segments: PlannedSegment[] = [
  { id: 1, name: 'Зимняя куртка', category_id: 12, amount: '150000.00', done: false },
  { id: 2, name: 'Подарок маме', category_id: 10, amount: '52400.00', done: true },
  { id: 3, name: 'Шины на зиму', category_id: 9, amount: '120000.00', done: false },
  { id: 4, name: 'Стоматолог', category_id: 7, amount: '28000.00', done: true },
  { id: 5, name: 'Лампа в спальню', category_id: 8, amount: '15000.00', done: false },
]

const monthCard = (month: string, expected: string, count: number, done_count: number, segments: PlannedSegment[]): PlannedMonthCard =>
  ({ month, expected, count, done_count, segments })

/** October 2026, the 26th, as in the mockup: five plans of the month (two closed), three without a date, the months
 * ahead with a gap in January. The sums are the server's: nothing here is counted by the client. */
export function plannedMonthFixture(patch: Partial<PlannedMonth> = {}): PlannedMonth {
  return {
    month: '2026-10', today: '2026-10-26', currency: 'KZT',
    rows: [
      plannedFixture(),
      plannedFixture({
        id: 2, name: 'Подарок маме', category: { id: 10, name: 'Подарки', icon: 'gift' }, amount: '45000.00', due: '2026-10-25', due_exact: true,
        receipt: { id: 201, total: '52400.00', currency: 'KZT', purchased_on: '2026-10-24', store_name: 'Technodom' }, goal: null, ai: null,
      }),
      plannedFixture({ id: 3, name: 'Шины на зиму', category: { id: 9, name: 'Авто', icon: 'car' }, amount: '120000.00', due: '2026-10-20', due_exact: true, goal: null, ai: null }),
      plannedFixture({
        id: 4, name: 'Стоматолог', category: { id: 7, name: 'Здоровье', icon: 'heart' }, amount: '30000.00', due: '2026-10-11', due_exact: true,
        receipt: { id: 202, total: '28000.00', currency: 'KZT', purchased_on: '2026-10-11', store_name: 'Dent Clinic' }, goal: null, ai: null,
      }),
      plannedFixture({
        id: 5, name: 'Лампа в спальню', category: { id: 8, name: 'Дом', icon: 'home' }, amount: '15000.00', goal: null,
        ai: { verdict: 'drop', reason: 'Лимит «Дом» в октябре уже 112 %.', at: '2026-10-26T09:00:00Z' },
      }),
    ],
    undated: [
      plannedFixture({
        id: 6, name: 'Поездка в Грузию', category: { id: 11, name: 'Путешествия', icon: 'plane' }, amount: '400000.00', due: null, due_exact: false,
        goal: { id: 4, name: 'Отпуск', kind: 'deposit', saved: '248000.00', share: '62.00' }, ai: null,
      }),
      plannedFixture({
        id: 7, name: 'Ноутбук', category: { id: 16, name: 'Техника', icon: 'phone' }, amount: '120000.00', due: null, due_exact: false, goal: null,
        ai: { verdict: 'wait', reason: 'Без срока и ничего не отложено.', at: '2026-10-26T09:00:00Z' },
      }),
      plannedFixture({
        id: 8, name: 'Диван', category: { id: 8, name: 'Дом', icon: 'home' }, amount: '20000.00', due: null, due_exact: false, goal: null,
        ai: { verdict: 'drop', reason: 'За 20 000 ₸ это будет не диван, а кресло.', at: '2026-10-26T09:00:00Z' },
      }),
    ],
    base: { expected: '360000.00', done: '80400.00', left: '285000.00', excluded: 0, count: 5, done_count: 2, segments },
    months: [
      monthCard('2026-10', '360000.00', 5, 2, segments),
      monthCard('2026-11', '320000.00', 3, 0, [
        { id: 9, name: 'Страховка', category_id: 10, amount: '200000.00', done: false },
        { id: 10, name: 'Пальто', category_id: 12, amount: '80000.00', done: false },
        { id: 11, name: 'Полки', category_id: 8, amount: '40000.00', done: false },
      ]),
      monthCard('2026-12', '90000.00', 2, 0, [
        { id: 12, name: 'Подарки', category_id: 7, amount: '60000.00', done: false },
        { id: 13, name: 'Ёлка', category_id: 11, amount: '30000.00', done: false },
      ]),
      monthCard('2027-02', '400000.00', 1, 0, [{ id: 14, name: 'Отпуск', category_id: 9, amount: '400000.00', done: false }]),
    ],
    ...patch,
  }
}

/** «Как накопить на куртку»: 150 000 by the 1st of February, 57 000 put aside, three months ahead. */
export function plannedAdviceFixture(patch: Partial<PlannedAdvice> = {}): PlannedAdvice {
  return {
    need: '150000.00', saved: '57000.00', missing: '93000.00', currency: 'KZT', due: '2027-02-01', months: 3,
    options: [
      { key: 'lump_fixed', available: true, reason: null, amount: '89200.00', times: 1, gain: '3800.00', rate: '17.00', risk: 1, liquid: false, until: null },
      { key: 'monthly_flexible', available: true, reason: null, amount: '30500.00', times: 3, gain: '1500.00', rate: '15.00', risk: 1, liquid: true, until: null },
      { key: 'invest', available: false, reason: 'Советуем только для планов дальше года и не на обязательные вещи.', amount: null, times: null, gain: null, rate: null, risk: 3, liquid: true, until: null },
    ],
    ...patch,
  }
}
