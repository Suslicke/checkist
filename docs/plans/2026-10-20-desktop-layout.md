# ПК-раскладка клиента (2026-10-20, ветка `feature/desktop-layout`)

План синтезирован панелью из трёх дизайнов (минимальный diff · от пользователя · от рисков), трёх судей и критика полноты; исходные карты и суждения — в журнале сессии. Просьба человека: «давай делай ПК-раскладку». Приёмка интерфейса — за человеком.

## Точка перелома

`@media (min-width: 960px)` — the one desktop breakpoint, the number Dashboard.css:257 and Skeleton.css:46 already use and their guards pin (dashboard-css.test.ts:77 media list; skeleton.test.tsx:129 `toContain('@media (min-width: 960px) {')`). Exported as `DESKTOP_MIN_WIDTH = 960` / `desktopQuery` next to `PHONE_MAX_WIDTH` in `src/lib/cards/narrow.ts`; `useDesktop()` (server snapshot false) is the only script-side switch (the catalog table). Content width at that line: 888 px at a 960 window, 952 at 1024, 1128 from 1272 (`.page` 1200/36 of App.css:28 stays, pinned by shell-css.test.ts:152-162). 541–959 keeps every current cap (760/720/600) because every geometry rule lives inside a min-width: 960 block; ≤540 is untouched.

## Общие решения

- Base = RISK FIRST (design 3) with the grafts the judges agreed on: ONE new stylesheet `frontend/src/theme/desktop.css` holding a single `@media (min-width: 960px) { … }` block; outside the block only boxless column wrappers (`display: contents;`) and `order:` rules. It is imported in `src/styles.ts` right after `./features/more/More.css` and before `./components/Skeleton.css` (after every screen sheet, before Skeleton/NetworkBar/tokens/App/ActionBar — styles-order.test.ts keeps `slice(-3)` = tokens/App/ActionBar, and its `readdirSync` listing picks the new file up automatically). Equal-specificity rules win over Receipts/Catalog/Expense/Recurring/Goals/Incomes/Stores rules by cascade order; where a screen rule is heavier the desktop rule repeats that selector verbatim. App.css and ActionBar.css still come AFTER desktop.css: nothing in desktop.css may rely on beating an App.css rule of equal weight (none of the tasks does — the shell rules touched are `button`/`a` element selectors only).
- Its own guard `src/theme/desktop-css.test.ts`: exactly one @media equal to `(min-width: 960px)`; nothing outside it but `display: contents;` / `order: N;` bodies; no colour literal; `font-size` only `var(--ck-text-xs|sm|base|lg|xl|hero)`; no `z-index`, `position: fixed`, `transition`, `animation`, `@keyframes`, `!important`, `scroll-padding`, `(max-width`, `overflow`, `@import`, `appearance`, `outline: none|0`; `position: sticky` only on the allow-listed selector `.expense-page > .expense-hint`; listed in styles.ts after the last `features/` import and immediately before `components/Skeleton.css`. Plus a narrow.test.ts assertion that every `(min-width: N px)` with N > 541 in desktop.css, Dashboard.css and Skeleton.css equals `DESKTOP_MIN_WIDTH` (Skeleton.css will hold TWO 960 blocks, see T1 — the assertion checks values, not count). The project guards that scan every stylesheet were read and will pass by construction: receipts-css.test.ts:52-62 (`.action-link.<modifier>` colour rules across all sheets — desktop.css has none), focus-ring-css.test.ts:62-66 (no `:focus` rule removing the outline), date-fields-css.test.ts:73-86 (no `appearance:` rule, no `type="date"` selector), action-bar-css.test.ts:81-84 (`scroll-padding` only in ActionBar.css), mobile-css.test.ts:82-85 (`@keyframes` only in the four named files).
- Guards that are NOT edited and files that are NOT touched: App.css (menu-css.test.ts:30-32 four @media; shell-css.test.ts:103-132 state list; :152-162 `.page` 1200/36), Receipts.css (receipts-css.test.ts:97-101 `outside` must hold no @media), Catalog.css gets only one base rule (`.ck-catalog-visually-hidden`, no @media, no overflow, no `white-space: normal` — catalog-css.test.ts:24-26,38-41,53 stay as they are), Expense.css, Recurring.css, Goals.css, Incomes.css, Stores.css, ActionBar.css, tokens.css (no new token, no colour, no px font-size), the 540 px phone threshold and `useNarrow`. Dashboard.css is edited only inside its existing `@media (min-width: 960px)` block (line 257-260) plus one base `display: contents` line (its media list stays `[reduced-motion, (min-width: 960px), (max-width: 540px)]`). Skeleton.css keeps its pinned block at line 46-49 byte-identical and gets a SECOND `@media (min-width: 960px)` block at the end of the layout rules (before the reduced-motion block) plus one base `display: none` line.
- Phone (≤540) and 541–959 stay pixel-identical by construction: the only un-media'd additions are `display: contents` wrappers whose children keep today's DOM order (Лимиты, Платежи, Каталог: contiguous groups, no `order` needed) or reproduce today's visual order through `order` (Главная: the existing `.dash-column-side > * { order: 1 }` / `.dash-recent { order: 2 }` of Dashboard.css:33-34), plus a hidden skeleton aside (`display: none` below 960). Class names, geometry, colours and font sizes of existing phone rules do not change. One documented consequence on Главная: the DOM (tab/reader) order of «Доход месяца» and the recurring cards moves after «Последние траты» on a phone while their visual order is unchanged — the same relation the limits card already has today.
- Column recipe: list screens use `grid-template-columns: minmax(0, 3fr) minmax(0, 2fr); gap: 16px; align-items: start` (1128 → 667/445, 952 → 562/374); primary content (list, form, summary) left, secondary cards (limits, history, suggestions, categories) right. Главная keeps its 1fr/1fr; the spend form is 2fr/1fr with the «words» helper sticky at the right; the catalog is a 280 px rail + main; the receipt lines table ALWAYS spans both columns. Receipt-table arithmetic (Receipts.css:69-77, cells `padding: 12px`, `th[scope="row"] width: 32%; min-width: 160px`, number headings and `.receipt-number` values `nowrap`, six columns Товар · Количество · Цена · Сумма · Скидка · Оплачено): natural minimum ≈ (160+24) + (92+24) + 4 × (≈118+24 for «189 490,00 KZT») ≈ 868 px. Frame inner width = page content − 40 (panel padding) − 2 (frame border): 846 at 960, 910 at 1024, 1086 at 1280, 1086 at 1440 → scroll-free from 1024 (WRAP_ACCEPTANCE.md step 5), 22 px short at 960–1023 with the longest KZT sums only (the ≤1023 sticky name column of Receipts.css:101-106 still covers that case). Today's 760 cap gives 718 px at every desktop width, so the plan strictly improves it.
- Two wrappers need markup (Лимиты `.limits-main`, Платежи `.rec-main`/`.rec-side`, Каталог `.ck-catalog-side`/`.ck-catalog-main`); Главная moves `IncomeSummary` and `RecurringDue` into `.dash-column-side` (dashboard-markup.test.tsx:189-197 keeps passing: hero > main, actions > hero, recent < side, limits > side); the catalog gets a real `ProductTable` behind `useDesktop()` (SSR/tests keep the cards; ProductList.tsx:47 already calls `useNarrow(` so lib/cards/coverage.test.ts stays green as long as ProductTable lives in ProductList.tsx); «Снять чек» → «Загрузить чек» on a fine pointer through `useCoarsePointer()` whose server snapshot is `true` (dashboard-markup.test.tsx:55 keeps `Снять чек</button>`).
- Rejected (do not do): multicol `.spends-days { columns: 2 }`; a min-width block in Receipts.css or a second @media / `overflow-x` frame / `white-space: normal` in Catalog.css; an unguarded `.goals { display: grid }` (GoalPage.tsx:56 shares `div.goals.ck-stack`) — always `.goals:has(> .goal-add)`; `grid-template-areas` for Лимиты (a long history detaches the save bar from the list); wrappers inside `form.expense-form`; a full-width 1128 px manual-spend hero; moving «Последние траты» to the side column (pinned by dashboard-markup.test.tsx:196); a skeleton `max-width` or new shape markup that draws differently at 541–959; any rule in App.css; a new `--ck-z-*` layer; new rules inside Skeleton.css's FIRST 960 block (it precedes the `.ck-skel-spends`, `.ck-skel-pair`, `.ck-skel-button` base rules at lines 57-71, so an equal-weight rule there loses).
- Skeletons mirror the screens: `spends` gets the one-line filter row and 52 px rows inside Skeleton.css's new second 960 block; a new shape `columns` = the `page` card plus a hidden aside (`display: none` below 960, column 2 at ≥960) for Лимиты/Платежи/Цели/Доходы/Магазины (fallback in ScreenBoundary and the pages' own `RequestState kind="loading"`), so 541–959 render exactly today's `page` card; `home` is unchanged (limits stay the first card of the side column at ≥960 through `.dash-column-side > .dash-limits { order: 0 }`). Documented exceptions that keep `page`: the receipt page (its sections are the grid items and each carries its own loading state, so the wait is already in columns), the expense form (one card, a different 2fr/1fr grid) and the catalog (its search, categories and products sections render at once with per-section loading) — their `ScreenFallback` shows only while the screen's script loads.
- Checks every task runs: `cd frontend && npm test && npm run lint && npm run build` (exit 0, no chunk-size warning). Headless Chromium on synthetic data (seed_stats_demo / seed_statement_demo / seed_product_merge_demo, `RECEIPT_OCR_PROVIDER=fake`, Vite dev, both themes, no form submits) is the agent's aid only; UI acceptance is the human's. Widths 390 and 760 are screenshot BEFORE and AFTER each task and pixel-diffed (must be identical); then 960, 1023, 1024, 1280, 1440.
- Critic's corrections applied to the judged plan (2026-10-20, after reading every guard and source the plan names): (1) T1 — the new Skeleton.css rules go into a SECOND `@media (min-width: 960px)` block appended after the `(min-width: 541px)` block, not into the pinned block at line 46: that block precedes `.ck-skel-spends { max-width: 760px }` (:57), `.ck-skel-pair` (:69) and `.ck-skel-button` (:71), so `.ck-skel-spends { max-width: none }` placed there would lose by order; skeleton.test.tsx pins two blocks, narrow.test.ts checks values not count; the aside base rule is one line. (2) T2 — the planned markup assertion `html.indexOf('inc-summary') > side` cannot pass: `IncomeSummary` (IncomeSummary.tsx:40) and `RecurringDue` (RecurringDue.tsx:155+) return `null` until their fetch resolves, so a server render never contains them; replaced by a source-text assertion on DashboardPage.tsx. (3) T7 — `MonthBudgetPanel` (LimitsPage.tsx:128-148) renders the same `form.limits-form` > `.limits-row-head` + `.limits-controls` (with «Сохранить бюджет»): the one-line row rule is scoped to `.limits-list .limits-form` so the budget card keeps its stacked layout and Dashboard.css:224-226 wrap rules. (4) T6 — added `.ck-catalog > .ck-catalog-main:only-child { grid-column: 1 / -1; }`: CategoryPage renders only its first main wrapper before the node loads (and on error), which would otherwise sit in column 2 beside an empty rail; verified no catalog test pins markup across the new wrapper boundaries (no `</form><section`, `</section><section`, `ck-catalog"><` anchors in src/features/catalog, src/pages or src/components tests), so no test edits are expected there. (5) Receipt-table arithmetic written down (shared decision above) with the real paddings and the `.receipt-number` nowrap values; T4 no longer claims an image height. (6) T10 — a manual acceptance file `frontend/DESKTOP_ACCEPTANCE.md` (naming as WRAP/MOBILE/OFFLINE_ACCEPTANCE.md) with per-screen steps at 1024/1280/1440 in both themes and the 390/760 «unchanged» check, referenced from docs/frontend.md and the CLAUDE.md paragraph; WRAP_ACCEPTANCE steps 1 and 5 still get their one-line additions. (7) Guard inventory extended: desktop-css.test.ts also forbids `appearance` and `outline: none|0`; the five project-wide stylesheet scanners (receipts-css, focus-ring, date-fields, action-bar, mobile-css) are named with what they check. (8) Noted that `.ck-action-bar` is sticky only under `(max-width: 540px) and (min-height: 480px)` (ActionBar.css), so the filter buttons in column 5 (T3) and the limits save bar (T7) are plain flow items on a desktop. (9) Line numbers re-verified: LimitsPage.tsx:334, RecurringPage.tsx:304, GoalsPage.tsx:72, IncomesPage.tsx:107, StoresPage.tsx:158 (loading `RequestState`); Receipts.css:7/217 caps, :121-123 toolbar, :154 row, :249-266 toolbar tiles; Dashboard.css:14/32-34/257-260; Skeleton.css:37/46-49/57/72-77; Expense.css:6/123; Recurring.css:52; Incomes.css:23; Goals.css:4; Stores.css:3; Catalog.css:4/69.

## Задачи

### T1. Foundation: desktop.css, its guard, useDesktop/useCoarsePointer, skeleton mirroring

Экран: shared (stylesheet order, hooks, skeletons). Зависит от: —.

**Спецификация.**

FILES: create `frontend/src/theme/desktop.css`, `frontend/src/theme/desktop-css.test.ts`; edit `frontend/src/styles.ts`, `frontend/src/lib/cards/narrow.ts`, `frontend/src/lib/cards/index.ts`, `frontend/src/lib/cards/narrow.test.ts`, `frontend/src/lib/cards/README.md`, `frontend/src/components/Skeleton.css`, `frontend/src/components/Skeleton.tsx`, `frontend/src/components/RequestState.tsx`, `frontend/src/components/ScreenBoundary.tsx`, `frontend/src/components/skeleton.test.tsx`, and one attribute each in `src/features/dashboard/LimitsPage.tsx` (:334), `src/features/recurring/RecurringPage.tsx` (:304), `src/features/goals/GoalsPage.tsx` (:72), `src/features/incomes/IncomesPage.tsx` (:107), `src/features/stores/StoresPage.tsx` (:158).

1. `src/theme/desktop.css` (UTF-8, LF). Content:
```
/* Компьютер (от 960 px — DESKTOP_MIN_WIDTH в lib/cards/narrow.ts): раскладка экранов в колонки. Один блок @media на весь
   файл; вне блока — только обёртки колонок без коробки (display: contents) и их order, которые повторяют нынешний порядок
   телефона. Телефон (≤ 540 px) и 541–959 px не меняются. Цвета — токены, размеры текста — только шкала --ck-text-*.
   Файл идёт в styles.ts после всех CSS экранов и до Skeleton.css: при равном весе правило отсюда побеждает правило экрана;
   App.css и ActionBar.css идут ПОСЛЕ — на их правила равного веса здесь не рассчитывать. Страж — theme/desktop-css.test.ts. */

@media (min-width: 960px) {
  /* Правила экранов добавляют свои задачи: Траты, Чек, Новая трата, Каталог, Платежи, Цели, Доходы, Магазины. */
}
```

2. `src/styles.ts`: insert `import './theme/desktop.css'` immediately after `import './features/more/More.css'` and before `import './components/Skeleton.css'`. Nothing else moves (styles-order.test.ts: `slice(-3)` stays tokens/App/ActionBar; its directory listing finds the new file by itself).

3. `src/theme/desktop-css.test.ts` (new):
```ts
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const source = new URL('../', import.meta.url)
const read = (path: string) => readFileSync(new URL(path, source), 'utf8')
const css = read('theme/desktop.css').replace(/\/\*[\s\S]*?\*\//g, '')
const styles = read('styles.ts')
const rules = (text: string) => [...text.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
  .flatMap((match) => match[1].split(',').map((selector) => ({ selector: selector.trim(), body: match[2].trim() })))
const media = /@media\s*\(min-width:\s*960px\)\s*\{((?:[^{}]*\{[^{}]*\})*)\s*\}/
const outside = css.replace(media, '')

describe('desktop stylesheet (src/theme/desktop.css, text of the rules, not rendering)', () => {
  it('is listed after every screen stylesheet and right before the skeletons', () => {
    const listed = [...styles.matchAll(/^import '\.\/([^']+\.css)'$/gm)].map((match) => match[1])
    const at = listed.indexOf('theme/desktop.css')
    expect(at).toBeGreaterThan(-1)
    expect(listed.slice(at).filter((path) => path.startsWith('features/'))).toEqual([])
    expect(listed[at + 1]).toBe('components/Skeleton.css')
  })
  it('holds one media block: the desktop threshold of the project', () => {
    expect([...css.matchAll(/@media ([^{]+)\{/g)].map((match) => match[1].trim())).toEqual(['(min-width: 960px)'])
    expect(media.test(css)).toBe(true)
  })
  it('keeps nothing outside the block but boxless column wrappers and their order', () => {
    expect(outside).not.toContain('@media')
    for (const item of rules(outside)) expect(item.body, item.selector).toMatch(/^(display: contents;|order: -?\d+;)$/)
  })
  it('adds no colour, no text size outside the scale, no layer, no motion, no fixed position, no scroll, no own look of a field, no ring taken off', () => {
    expect(css).not.toMatch(/#[0-9a-f]{3,8}\b|\b(?:rgb|hsl|hwb|lab|lch|oklab|oklch)a?\(/i)
    for (const [, size] of css.matchAll(/font-size:\s*([^;]+);/g)) expect(size.trim()).toMatch(/^var\(--ck-text-(xs|sm|base|lg|xl|hero)\)$/)
    expect(css).not.toMatch(/z-index|position: fixed|transition|animation|@keyframes|!important|scroll-padding|\(max-width|overflow|@import|appearance|outline:\s*(none|0)/)
    expect(rules(css).filter((item) => /position: sticky/.test(item.body)).map((item) => item.selector)).toEqual([])
  })
})
```
(T5 changes the last `toEqual([])` to `toEqual(['.expense-page > .expense-hint'])`.) Note the `media` regexp accepts only flat rules inside the block: no nested braces in desktop.css.

4. `src/lib/cards/narrow.ts`: after `narrowQuery` add
```ts
/** The desktop threshold of the project (two columns): the same number stands in every `@media (min-width: 960px)`. */
export const DESKTOP_MIN_WIDTH = 960
export const desktopQuery = `(min-width: ${DESKTOP_MIN_WIDTH}px)`
/** A touch screen: the finger, not the mouse, is the pointer («Снять чек» is the right word there). */
export const coarsePointerQuery = '(pointer: coarse)'
```
Refactor the private `browserNarrow()` into a generic `browserStore(query: string, serverSnapshot: boolean)` keyed by query in a `Map<string, NarrowStore>` (nothing touches `window` until React reads or subscribes — as today); `createNarrowStore(environment)` keeps its exact signature and behaviour (server snapshot `false`, narrow.test.ts unchanged). Add `createCoarsePointerStore(environment)` = `{ ...createNarrowStore(environment), getServerSnapshot: () => true }` (the store's methods are own enumerable properties, so the spread keeps them). Export `useDesktop(): boolean` (query `desktopQuery`, server `false` — a Node render never sees the table) and `useCoarsePointer(): boolean` (query `coarsePointerQuery`, server `true` — a Node render keeps «Снять чек»), both through `useSyncExternalStore` exactly like `useNarrow`. `useNarrow` stays as is. `src/lib/cards/index.ts`: export `DESKTOP_MIN_WIDTH, desktopQuery, coarsePointerQuery, createCoarsePointerStore, useDesktop, useCoarsePointer`.

5. `src/lib/cards/narrow.test.ts`: add a describe 'desktop threshold': `DESKTOP_MIN_WIDTH === 960`, `desktopQuery === '(min-width: 960px)'`; and 'equals the width of every desktop media query': for `['../../theme/desktop.css', '../../features/dashboard/Dashboard.css', '../../components/Skeleton.css']` collect `[...read(path).matchAll(/@media[^{]*\(min-width:\s*(\d+)px\)/g)].map((m) => Number(m[1]))`, filter `> PHONE_MAX_WIDTH + 1` (Skeleton.css has a `(min-width: 541px)` phone-boundary block) and expect `[...new Set(widths)]` to equal `[DESKTOP_MIN_WIDTH]` for each file (Skeleton.css holds two 960 blocks after this task — values, not count). Add 'useDesktop without a browser': renders `false` with no window and with a stubbed matchMedia returning `matches: true` (same shape as the existing useNarrow tests). Add 'useCoarsePointer without a browser': renders `true` (server snapshot) and `createCoarsePointerStore(env).getServerSnapshot() === true`, `getSnapshot()` follows the environment. README.md: a section «Широкий экран: useDesktop()» — 960 is the desktop threshold, not a second phone threshold; the server render never sees the desktop view; `useCoarsePointer()` for a word that depends on the pointer; new desktop rules go only into `theme/desktop.css`.

6. Skeletons. `Skeleton.tsx`: `export type SkeletonShape = 'page' | 'home' | 'spends' | 'columns'`. The `page` branch stays byte-identical. New branch `shape === 'columns'`: `<div className="ck-skel ck-skel-columns" data-skeleton="columns" aria-hidden="true"><div className="ck-skel-line ck-skel-w35" /><div className="ck-skel-figure ck-skel-w55" /><Rows count={3} /><div className="ck-skel-aside"><div className="ck-skel-line ck-skel-w35" /><div className="ck-skel-line ck-skel-small ck-skel-w60" /><div className="ck-skel-line ck-skel-small ck-skel-w45" /><div className="ck-skel-line ck-skel-small ck-skel-w55" /></div></div>` (the `page` content plus one aside; update the header comment of the file with the fourth shape). `RequestState.tsx`: `const bare = !props.compact && (shape === 'home' || shape === 'spends')` (columns stays inside the request-state card like page, so 541–959 look exactly as today: `.request-state` padding 28 px of App.css:135, not `.ck-skel-card`'s 20). `ScreenBoundary.tsx` `ScreenSkeleton`: `const shape: SkeletonShape = kind === 'dashboard' ? 'home' : kind === 'receipts' ? 'spends' : ['limits', 'recurring', 'goals', 'incomes', 'stores'].includes(kind) ? 'columns' : 'page'` (these are `Route['kind']` values of src/navigation/routes.ts:148-197; `receipt`, `expense`, `catalog`, `category` keep `page` on purpose — their screens draw their own section cards or a single form card, see shared decisions). The five pages pass `shape="columns"` to their own loading `RequestState` at the lines listed above.

`Skeleton.css` — the pinned block at lines 46-49 stays byte-identical; it PRECEDES the base rules `.ck-skel-spends` (:57), `.ck-skel-pair` (:69) and `.ck-skel-button` (:71), so an equal-weight rule placed there would lose by order. Therefore: (a) base, next to the «Главная» rules (after line 45): `.ck-skel-aside { display: none; }`; (b) a NEW block appended after the `@media (min-width: 541px) { … }` block (line 77) and before the `/* Inside a card: two small lines. */` compact rules (i.e. still before the reduced-motion block):
```
/* A wide screen (960 px, as desktop.css): the two columns of a list screen; «Траты» as wide as the page with its one-line
   filters and 52 px rows. A second block of the same width on purpose: it must follow the rules above it. */
@media (min-width: 960px) {
  .ck-skel-columns { grid-template-columns: minmax(0, 3fr) minmax(0, 2fr); align-items: start; }
  .ck-skel-columns > * { grid-column: 1; }
  .ck-skel-columns > .ck-skel-aside { display: grid; gap: 16px; grid-column: 2; grid-row: 1 / span 3; }
  .ck-skel-spends { max-width: none; }
  .ck-skel-spends .ck-skel-row { min-height: 52px; padding: 8px 0; }
  .ck-skel-filters { grid-template-columns: repeat(4, minmax(0, 1fr)) auto; align-items: end; gap: 8px 12px; padding: 12px 16px; }
  .ck-skel-filters > .ck-skel-w30 { display: none; }
  .ck-skel-filters > .ck-skel-pair { display: contents; }
  .ck-skel-filters > .ck-skel-small { grid-column: 1 / -1; order: 9; }
  .ck-skel-filters > .ck-skel-button { grid-column: 5; }
}
```
(`.ck-skel-filters` is a `.ck-skel-card`, already `display: grid`; its direct children in SpendsTopSkeleton are the w30 line, two `.ck-skel-pair`s of two `Labelled`s, the small w60 line and the button — the pairs dissolve into four columns, the button takes column 5, the help line row 2.) The literal lines `.ck-skel-column { display: contents; }` and `@media (min-width: 960px) {` stay; no `font-size`, no new @keyframes, colour only `--ck-skeleton`.

7. `skeleton.test.tsx`: add 'draws the two columns of a list screen as the page card with an aside': `renderToStaticMarkup(<RequestState kind="loading" message="Загружаем лимиты…" shape="columns" />)` contains `class="request-state request-state-loading"` (NOT `request-state-bare`), `data-skeleton="columns"`, `count(html, 'class="ck-skel-figure ')` 1, `count(html, 'class="ck-skel-row"')` 3, one `class="ck-skel-aside"`, words === message. Change :70 to `expect(renderToStaticMarkup(<ScreenFallback kind="goals" />)).toContain('data-skeleton="columns"')` and add `expect(renderToStaticMarkup(<ScreenFallback kind="account" />)).toContain('data-skeleton="page"')`. In the CSS describe add: `expect(css).toContain('.ck-skel-aside { display: none; }')` and `expect(css.match(/@media \(min-width: 960px\) \{/g)).toHaveLength(2)` with a comment why the second block exists; the existing `css.slice(0, motion)` no-animation check and the `@keyframes` list of mobile-css.test.ts:85 are unaffected.

MUST NOT CHANGE: any existing rule of Skeleton.css outside the new block except the one added base line; `page`/`home`/`spends` markup; the pinned counts (home: 3 cards / 4 rows / 3 limits; spends: 2 days / 5 rows); the first 960 block.

**Проверка.**

cd frontend && npx vitest run src/styles-order.test.ts src/theme src/menu src/components/skeleton.test.tsx src/lib/cards src/features/receipts/receipts-css.test.ts src/features/catalog/catalog-css.test.ts src/features/dashboard/dashboard-css.test.ts src/components/action-bar-css.test.ts — all green; then npm test && npm run lint && npm run build (exit 0). Assertions: `grep -c '@media' src/theme/desktop.css` = 1; `grep -n 'theme/desktop.css' src/styles.ts` sits between More.css and Skeleton.css; `grep -c '@media (min-width: 960px) {' src/components/Skeleton.css` = 2 and `git diff src/components/Skeleton.css` shows the first block untouched, one base `.ck-skel-aside` line and one appended block; rendering `<RequestState kind="loading" shape="columns" />` in Node gives the page card (no `request-state-bare`). Headless: /budget/limits and /recurring with the API throttled at 760 px before/after — identical screenshots; at 1280 the loading card shows the aside in column 2; /receipts fallback at 1280 (`?` reload with the script throttled) shows the filter skeleton as one row five tracks wide (`getComputedStyle(document.querySelector('.ck-skel-filters')).gridTemplateColumns` has 5 tracks).

### T2. Главная: fill the right column, limits first, «Загрузить чек» on a mouse

Экран: Главная (/). Зависит от: T1.

**Спецификация.**

FILES: `frontend/src/features/dashboard/DashboardPage.tsx`, `frontend/src/features/dashboard/Dashboard.css` (inside the existing `@media (min-width: 960px)` block at :257-260 only), `frontend/src/features/dashboard/dashboard-markup.test.tsx` (one added test).

MARKUP (DashboardView, DashboardPage.tsx:337-372): remove `<IncomeSummary month={data.month} />` and `<RecurringDue month={data.month} />` from `.dash-column-main` (they stand between `<Actions />` and the «Последние траты» section at :351-352) and insert them as the first two children of `<div className="dash-column dash-column-side">` (:364), before `{limits.map(...)}`. Nothing else in the tree changes; `.dash-recent` stays the last child of main; update the comment at :335-336. Phone order is unchanged because Dashboard.css:32-34 already gives every side child `order: 1` and `.dash-recent` `order: 2`: hero · others · unconverted · actions · income · recurring · limits · recent — today's sequence exactly. The DOM order of income/recurring moves after «Последние траты» (tab and reader order on a phone), the same relation the limits card already has today — accepted and documented.

CSS (Dashboard.css, add inside the 960 block, after `.dash-column { display: grid; gap: 16px; min-width: 0; }`): `.dash-column-side > .dash-limits { order: 0; }` — on a wide screen «Лимиты» (both the currency cards and the fallback card carry `dash-limits`, DashboardPage.tsx:265 and :365) stay the first card of the right column (0,2,0 beats the `order: 1` of (0,1,0)); «Доход месяца» (`section.ck-panel.inc-summary` or the `p.inc-summary-empty` line, IncomeSummary.tsx:12-13) and the cards of RecurringDue (`section.ck-panel.rec-card`, `.rec-card.rec-ask`) follow in DOM order. The `.dash` grid stays `minmax(0, 1fr) minmax(0, 1fr); align-items: start; max-width: none`. No token, no colour.

LABEL: in `Actions()` (DashboardPage.tsx:160-169): `import { useCoarsePointer } from '../../lib/cards'`, `const coarse = useCoarsePointer()`, render `{coarse ? 'Снять чек' : 'Загрузить чек'}` as the text of `button.dash-action.dash-action-shot` (icon `camera` and `useQuickShot('gallery')` unchanged: a mouse gets the file dialog from the same button, so the word says what happens). Node renders «Снять чек» (server snapshot true), so dashboard-markup.test.tsx:55 keeps matching.

TEST: `IncomeSummary` (IncomeSummary.tsx:40) and `RecurringDue` (RecurringDue.tsx:155+) return `null` until their request resolves, so a server render of DashboardView never contains `inc-summary` or `rec-card` — do NOT assert on the rendered HTML. Add to dashboard-markup.test.tsx a source-text test 'keeps the income line and the recurring cards in the side column, under the limits on a wide screen': `const source = readFileSync(new URL('./DashboardPage.tsx', import.meta.url), 'utf8')`; `const side = source.indexOf('dash-column dash-column-side')`; expect `source.indexOf('<IncomeSummary')` > side, `source.indexOf('<RecurringDue')` > `source.indexOf('<IncomeSummary')`, both < `source.indexOf('{limits.map(')`, and `source.indexOf('dash-recent')` < side; plus `expect(read('./Dashboard.css'))` (dashboard-css.test.ts already reads it; put the rule check there if preferred): the 960 block text contains `.dash-column-side > .dash-limits { order: 0; }`.

GUARDS: none edited. dashboard-markup.test.tsx:189-197 still holds (hero > main, actions > hero, recent < side, limits > side). dashboard-css.test.ts:77 media list unchanged; `body('.dash-column-side > *')` still contains `order: 1;`. Re-run src/features/incomes/*.test.tsx and src/features/recurring/*.test.tsx (none reference `dash-column`; base-currency-markup.test.tsx and allowance.test.tsx render DashboardView but pin no column content).

MUST NOT CHANGE: class names, the `home` skeleton (its side column draws the limits card first — the same as the screen at ≥960), MonthHeader, the phone bar, any rule outside the 960 block.

**Проверка.**

cd frontend && npx vitest run src/features/dashboard src/features/incomes src/features/recurring src/lib/cards && npm test && npm run lint && npm run build. Assertions: the source-text test passes; `Снять чек</button>` still in SSR; `grep -n 'dash-column-side > .dash-limits' src/features/dashboard/Dashboard.css` is inside the 960 block (line > 257 and < the `(max-width: 540px)` line). Headless /?month=<seeded month> at 390 and 760 before/after: pixel-identical (visual order money · actions · income · recurring · limits · recent); at 1280/1440: left column = hero → actions → «Последние траты», right = «Лимиты» → «Доход месяца» → RecurringDue cards; the first action reads «Загрузить чек» (headless has a fine pointer) and opens the file chooser; emulate `(pointer: coarse)` → «Снять чек».

### T3. Траты: full width, one-line filter row, dense 52 px rows

Экран: Траты (/receipts). Зависит от: T1.

**Спецификация.**

FILES: `frontend/src/theme/desktop.css` only (inside the 960 block). No markup change (ReceiptsPage.tsx:142-165, ReceiptFilters.tsx:37-73, SpendDays.tsx:93-127 stay).

Add inside `@media (min-width: 960px) {`:
```
  /* «Траты» (features/receipts): the whole page, the filters as one line of four fields and the buttons, 52 px rows. */
  .spends-page { max-width: none; }
  .spends-toolbar > .receipt-panel { padding: 12px 16px; gap: 8px; }
  .spends-toolbar > .receipt-panel > h2 { position: absolute; width: 1px; height: 1px; clip-path: inset(50%); white-space: nowrap; }
  .spends-toolbar > .receipt-panel > form { grid-template-columns: repeat(4, minmax(0, 1fr)) auto; align-items: end; gap: 8px 12px; }
  .spends-toolbar > .receipt-panel > form > .receipt-filter-grid { display: contents; }
  .spends-toolbar > .receipt-panel > form > .receipt-note, .spends-toolbar > .receipt-panel > form > .receipt-field-error { grid-column: 1 / -1; order: 9; margin: 0; }
  .spends-toolbar > .receipt-panel > form > .receipt-actions { grid-column: 5; flex-wrap: nowrap; gap: 8px; }
  .spends-toolbar > .receipt-panel > form > .receipt-actions > button { white-space: nowrap; }
  .spends-row { display: grid; grid-template-columns: 40px minmax(0, 1.2fr) minmax(0, 1fr) auto; column-gap: 12px; align-items: center; min-height: 52px; padding: 8px 16px; }
  .spends-row-main { display: contents; }
  .spends-row-amount { justify-self: end; text-align: right; }
```
Why it works: the panel keeps `flex: 1 1 100%` under the chips (Receipts.css:123) and its `h2` keeps `aria-labelledby` (hidden by position/clip, not overflow — the guard forbids `overflow`); the two `.receipt-filter-grid`s (children 1 and 3 of the form, ReceiptFilters.tsx:47-52) dissolve so the four `.receipt-field`s — Период с · Период по · Операция · По дате покупки — become columns 1–4 of row 1 (≈ 204 px each at 1128, ≈ 160 at 952, ≈ 150 at 888 — enough for a Chrome date field); `.receipt-actions.ck-action-bar` (Применить · Сбросить, :61-73) is column 5 of row 1 (auto-placement: definite column, first free row; `.ck-action-bar` is sticky only under `(max-width: 540px) and (min-height: 480px)` in ActionBar.css, so on a desktop it is a plain grid item); the help line `p#…-help` (kept for `aria-describedby`), the «Фильтры из ссылки» note and the form-level error span rows 2+ through `order: 9`. The select errors (`.receipt-field-error` inside `.receipt-field`, :35) are not direct children and stay under their field. The phone Sheet is a portal in `body` (`.ck-filters-sheet`, Sheet.tsx:86), so the `.spends-toolbar >` scope never reaches it. Specificity: `.receipt-panel form` (0,1,1) < ours (0,2,1); `.receipt-filter-grid` (0,1,0) < (0,3,0); `.receipt-actions` (0,1,0) < (0,3,0); `.receipt-panel > h2` (0,1,1) < (0,2,1). The row: `a.spends-row`'s direct children are `span.spends-badge`, `span.spends-row-main` (title + meta) and `span.spends-row-amount` (SpendDays.tsx:95-101) → badge | title | meta | amount on one line; `.spends-row` (0,1,0) later in cascade overrides `display: flex; min-height: 64px; padding: 12px 16px` of Receipts.css:154; `margin: 0 -16px`, `:hover`, `:focus-visible` (outline-offset −3), `[data-hidden]`, the swipe rules (`:where(.spends-swipe) > .spends-row`, `transform`, `.spends-row-delete`, :199-204) are untouched; `.spends-row-title`/`.spends-row-meta` keep their ellipsis (`minmax(0, …)` tracks). Days (`.spends-days`), `p.spends-count`, Pagination (centred), `.spends-jobs`, ReviewBanner and PendingSpends stay full-width rows. Height before the first spend ≈ 48 + 16 + 44 + 8 + ≈ 110 + 16 ≈ 240 px instead of ≈ 700.

GUARDS: none edited — Receipts.css untouched (receipts-css.test.ts:97-101 `outside` has no @media; spends-markup.test.tsx:177-190 reads Receipts.css only). desktop-css.test.ts: `order: 9` lives inside the block (allowed anywhere), no overflow, no colour, no z-index.

MUST NOT CHANGE: Receipts.css, ReceiptFilters/ReceiptsPage/SpendDays markup, the Sheet, `.spends-page-narrow`, the `spends` skeleton markup (its ≥960 rules came in T1 and mirror this row and this filter line).

**Проверка.**

cd frontend && npx vitest run src/theme src/features/receipts && npm test && npm run lint && npm run build. Headless /receipts (seeded, ≥ 2 pages) at 390 and 760 before/after: pixel-identical (the 760 view keeps the 760 cap and the vertical form). At 960, 1024, 1280, 1440 in both themes: the filter form is one row (`getComputedStyle(form).gridTemplateColumns` has 5 tracks; the four `.receipt-field`s share `offsetTop` with the buttons; the help line is below them); `document.querySelector('.spends-toolbar h2').getBoundingClientRect().width <= 1`; first `.spends-row` height ≤ 56 px with `.spends-row-title` and `.spends-row-meta` on the same `offsetTop`; `document.scrollWidth <= innerWidth`; Tab reaches Период с → Период по → Операция → По дате покупки → Применить in that order; the throttled loading state at 1280 draws the filter row the same height (±16 px) as the real one; swipe/Tab to «Удалить» on a manual spend still slides the row.

### T4. Чек: summary beside the photo, lines table full width, pill actions

Экран: Чек / Трата (/receipts/{id}). Зависит от: T1.

**Спецификация.**

FILES: `frontend/src/theme/desktop.css` only (inside the 960 block). No markup change: ReceiptPage.tsx:73-98 already renders `div.receipts-page.receipt-screen` > `p.expense-notice`?, `p.receipt-back`, `section.receipt-panel.receipt-hero`, `section#receipt-images` (photo receipts only; ReceiptBlock.tsx:25 renders the section in every request state), `section#receipt-lines`, `section#receipt-discounts`, `section#receipt-taxes`.

Add inside the block:
```
  /* The page of a receipt: the header beside its images, the lines table across the whole width (no scroll from 1024 px,
     WRAP_ACCEPTANCE step 5), discounts beside taxes; a spend by hand keeps one 760 px header. */
  .receipt-screen { max-width: none; grid-template-columns: minmax(0, 3fr) minmax(0, 2fr); align-items: start; }
  .receipt-screen > * { grid-column: 1 / -1; }
  .receipt-screen > .receipt-hero { grid-column: 1; }
  .receipt-screen > #receipt-images { grid-column: 2; }
  .receipt-screen:not(:has(> #receipt-images)) > .receipt-hero { grid-column: 1 / -1; max-width: 760px; }
  .receipt-screen > #receipt-discounts { grid-column: 1; }
  .receipt-screen > #receipt-taxes { grid-column: 2; }
  .receipt-screen #receipt-images .receipt-images { grid-template-columns: minmax(0, 1fr); }
  .receipt-toolbar > .receipt-actions > a, .receipt-toolbar > .receipt-actions > button { flex: 0 1 auto; flex-direction: row; gap: 8px; min-height: 44px; padding: 0 16px; }
  .receipt-toolbar:has(.expense-repeat):has([data-receipt-hide]) > .receipt-actions > a, .receipt-toolbar:has(.expense-repeat):has([data-receipt-hide]) > .receipt-actions > button { flex-basis: auto; }
```
Result rows: [notice] · [«К тратам»] · [hero 667 px at 1128 / 562 at 952 | «Изображения чека» 445 / 374, one crop per row] · [«Строки чека» full width: `.receipt-table-scroll` inner 1086 / 910 px (page content − 40 panel padding − 2 frame border) against a natural minimum of ≈ 868 px (Receipts.css:74 cells `padding: 12px`, :77 name `min-width: 160px`, :76 nowrap number headings, `.receipt-number` values nowrap, six columns) → no scroll from 1024 (WRAP step 5); at 960–1023 the inner 846 px may still scroll by ≈ 20 px with the longest sums, where the ≤1023 sticky rule of Receipts.css:101-106 keeps the name column pinned — accepted; `th[scope="row"] width: 32%` ≈ 290–350 px, «Категория: Продукты питания» no longer wraps] · [Скидки | Налоги]. Auto-placement (sparse, column-definite items): hero (col 1) and `#receipt-images` (col 2) share a row because images follow the hero in DOM and column 2 ≥ column 1; likewise discounts/taxes. A manual spend (no `#receipt-images`): the hero spans both columns capped at 760 px, «Позиции траты» full width. Specificity: `.receipt-screen > *` (0,1,0) < `.receipt-screen > .receipt-hero` (0,2,0) < `#receipt-images` (1,1,0); `:not(:has(> #receipt-images))` lifts the manual rule to (1,2,0). `.receipts-page` is already `display: grid; gap: 16px` (Receipts.css:5). Action tiles: `.receipt-toolbar > .receipt-actions` is `display: contents` (Receipts.css:250), so the pills are the toolbar's flex items; the `::before` icon (22 px, :253) sits before the word; «Изменить · Повторить · Скрыть · Удалить» ≈ 530 px in one line at 667 (two lines at 562, `flex-wrap: wrap` of :249 already); the selector of :251 is repeated exactly (0,2,1) and wins by order; the four-tile selector of :259 (0,4,1) is repeated verbatim so its `flex-basis: calc((100% - 8px) / 2)` loses by order. `[data-receipt-hidden]` (:265), `.expense-failure`, `.expense-confirm` (:266) keep `flex: 1 1 100%` (not matched by `> a, > button`). The phone thumbnail (`narrow` only, ReceiptPage.tsx:71) is unaffected.

GUARDS: none edited (Receipts.css untouched; receipts-markup.test.tsx:303-304 and receipt-delete.test.tsx:92 pin markup only). `:has()` is already relied on in Receipts.css:174/201/259.

MUST NOT CHANGE: Receipts.css, ReceiptPage/ReceiptContent markup, `.receipt-table-scroll` (its `overflow-x: auto` frame stays — the guard forbids `overflow` only in desktop.css), the card view on phones.

**Проверка.**

cd frontend && npx vitest run src/theme src/features/receipts && npm test && npm run lint && npm run build. Headless on a seeded photo receipt with ≥ 20 lines and on a manual spend, both themes: 390 and 760 before/after pixel-identical; at 1024, 1280, 1440 `const s = document.querySelector('.receipt-table-scroll'); s.scrollWidth === s.clientWidth` (WRAP step 5) and `document.scrollWidth <= innerWidth`; `#receipt-images` and `.receipt-hero` share `offsetTop` at ≥960; the manual spend's `.receipt-hero` width ≤ 760 and `#receipt-lines` spans the page; the toolbar pills are 44 px tall, icon left of the word, all in one line at 1280; at 1023 the sticky name column still works (scroll the frame); `#receipt-discounts` and `#receipt-taxes` share `offsetTop`.

### T5. Новая трата: form at the left, «Скажите словами» pinned at the right

Экран: Новая трата / Изменить (/receipts/new, /receipts/{id}/edit, /incomes/{id}/edit). Зависит от: T1.

**Спецификация.**

FILES: `frontend/src/theme/desktop.css` (inside the 960 block), `frontend/src/theme/desktop-css.test.ts` (one expectation). No markup change: ExpensePage.tsx:572-583 renders `div.expense-page` > `div.expense-kind` (new spend with income chips) > `form.expense-hint` (TextHint.tsx:30, only `isNew`) > `form.expense-form` (ExpensePage.tsx:191).

Add inside the block:
```
  /* A new spend: the form at the left (two thirds), «Скажите словами — заполню форму» pinned at the right; without the
     hint (editing) one 760 px column. The form itself is not split: its reading and tab order stay. */
  .expense-page { display: grid; grid-template-columns: minmax(0, 2fr) minmax(0, 1fr); gap: 16px 24px; align-items: start; max-width: none; }
  .expense-page > .expense-kind { grid-column: 1; }
  .expense-page > .expense-hint { grid-column: 2; grid-row: 1 / span 2; position: sticky; top: 16px; }
  .expense-page > .expense-form { grid-column: 1; }
  .expense-page:not(:has(> .expense-hint)) { grid-template-columns: minmax(0, 1fr); max-width: 760px; }
```
Widths: form column 736 px at 1128 (the details card's LineEditor six-column grid, Expense.css:123, gets ≈ 696 inner, more than today's ≈ 560), 619 at 952, 581 at 888 (tight for the line grid at 960–1023 — accepted, it is wider than today's 600 page anyway); hint 368 / 309 / 291 (input + mic + send fit from 291: 291 − 32 − 48 − 48 − 16 = 147 px of input). Without `.expense-kind` the form takes row 1 and the hint spans rows 1–2 (row 2 is empty, 0 px); with it, kind row 1, form row 2. `align-items: start` gives the hint's cell the height of the form, inside which it sticks at 16 px from the top (no sticky header on a desktop: App.css has `position: sticky` only in its phone bar block). `.expense-page` (0,1,0) later in cascade beats Expense.css:6 `display: flex; max-width: 600px`; the `:not(:has(> .expense-hint))` rule weighs (0,2,0) and wins for edit pages and for a new spend whose hint is absent. The phone rules (`html.ck-focus-mode`, `.expense-form .expense-actions` margin at :203, ActionBar pinning) are ≤540 only and untouched; `.expense-actions` stays in flow at the end of the form on a desktop; Expense.css's `@media (pointer: fine)` (:67) is unrelated.

GUARD: desktop-css.test.ts — change the sticky allow-list expectation to `toEqual(['.expense-page > .expense-hint'])`. Nothing else: Expense.css is in no media guard; expense tests pin form internals, not the page root (no `class="expense-page` anchor in src/features/expense tests).

MUST NOT CHANGE: Expense.css, ExpensePage/ExpenseForm/TextHint/LineEditor markup, the 600 px phone/tablet cap (541–959 keep it), the save bar, `expense-kind`'s pill geometry.

**Проверка.**

cd frontend && npx vitest run src/theme src/features/expense && npm test && npm run lint && npm run build. Headless, both themes: /receipts/new at 390 and 760 before/after pixel-identical; at 1024/1280/1440 `.expense-hint` and `.expense-form` share `offsetTop` (or the hint shares it with `.expense-kind`), the hint stays in view after scrolling 600 px down a form with 6+ positions (`getBoundingClientRect().top` ≈ 16), the LineEditor row of an unfolded position shows name/category/remove on one line and quantity/unit/price/discount/sum on the next (its 6-column grid) at 1280; /receipts/{manual}/edit at 1280: one column ≤ 760 px, no empty right half; `document.scrollWidth <= innerWidth` everywhere.

### T6. Каталог: category rail at the left, a real product table at the right

Экран: Каталог (/catalog, /catalog?q=, /catalog/categories/{id}). Зависит от: T1.

**Спецификация.**

FILES: `frontend/src/features/catalog/CatalogPage.tsx`, `frontend/src/features/catalog/CategoryPage.tsx`, `frontend/src/features/catalog/ProductList.tsx`, `frontend/src/features/catalog/Catalog.css` (one base rule, no @media), `frontend/src/theme/desktop.css` (base wrappers + block rules), new `frontend/src/features/catalog/catalog-desktop.test.tsx`.

MARKUP. CatalogPage.tsx:25-37: `<div className="ck-catalog"><div className="ck-catalog-side"><CatalogSearch …/>{the «Категории» section as is}</div><div className="ck-catalog-main"><ProductsSection …/></div></div>`. CategoryPage.tsx:27-45, DOM order unchanged: `<div className="ck-catalog"><div className="ck-catalog-main">{node && <CategoryBreadcrumbs/>}{the .ck-catalog-category section}{node && <CategoryIconPicker …/>}</div>{node && <div className="ck-catalog-side">{node.children.length > 0 && the «Подкатегории» section}<CatalogSearch …/></div>}{node && <div className="ck-catalog-main"><ProductsSection …/></div>}</div>`. ProductList.tsx: add `view?: 'cards' | 'rows' | 'table'` to the props; `const narrow = useNarrow(); const desktop = useDesktop(); const view = props.view ?? (narrow ? 'rows' : desktop ? 'table' : 'cards')`; `rows` = existing `ProductRows`, `cards` = the existing `ul.ck-catalog-products` branch unchanged, `table` = new exported `ProductTable({ products, merges, classifications })` IN THE SAME FILE (lib/cards/coverage.test.ts demands `useNarrow(` in every .tsx holding `<table`):
```tsx
const tableColumns = ['Товар', 'Обобщённый продукт', 'Последняя покупка'] as const
export function ProductTable({ products, merges, classifications }: { products: Product[] } & Marks) {
  return <table className="ck-catalog-table">
    <caption className="ck-catalog-visually-hidden">Товары и последние цены</caption>
    <colgroup><col className="ck-catalog-col-name" /><col className="ck-catalog-col-generic" /><col className="ck-catalog-col-last" /></colgroup>
    <thead><tr>{tableColumns.map((title) => <th key={title} scope="col">{title}</th>)}</tr></thead>
    <tbody>{products.map((product) => {
      const classification = markFor(classifications, product)
      const meta = [product.brand?.name, product.package ? formatQuantity(product.package.quantity, product.package.unit) : undefined].filter(Boolean)
      return <tr key={product.id}>
        <th scope="row"><h3><Link to={{ kind: 'product', productId: product.id, query: { page: 1 } }}>{product.name}</Link></h3>
          {meta.length > 0 && <p className="ck-catalog-note">{meta.join(' · ')}</p>}
          {merges?.has(product.id) && <MergeBadge mark={merges.get(product.id)!} />}
          {classification && <ClassificationBadge mark={classification} />}</th>
        <td>{product.generic.name}</td>
        <td className="ck-catalog-table-last">{product.prices.length === 0 ? <span className="ck-catalog-note">Покупок нет</span>
          : <ul>{product.prices.map(({ country, currency, last }) => <li key={`${country}/${currency}`}>
            <span className="ck-catalog-price">{formatPrice(last.paid_unit_price, currency)}</span>
            <span className="ck-catalog-note">{country ?? NO_PLACE} · <time dateTime={last.purchased_on}>{formatPurchasedOn(last.purchased_on)}</time>{last.manual && ` · ${MANUAL_MARK}`}</span></li>)}</ul>}</td>
      </tr>
    })}</tbody>
  </table>
}
```
(all imports — `formatPrice`, `formatPurchasedOn`, `formatQuantity`, `Link`, `MergeBadge`, `ClassificationBadge`, `markFor`, `NO_PLACE`, `MANUAL_MARK` — already exist in ProductList.tsx:1-10; add `useDesktop` to the `../../lib/cards` import.) Catalog.css, base (before the `@media (max-width: 540px)` block, e.g. after `.ck-catalog-value` at :52): `.ck-catalog-visually-hidden { position: absolute; width: 1px; height: 1px; clip-path: inset(50%); white-space: nowrap; }` (no `overflow`, catalog-css.test.ts:53; `nowrap` is not `normal`, :38-41; the file keeps one @media, :24-26).

CSS, desktop.css. Outside the block (wrappers): `.ck-catalog-side, .ck-catalog-main { display: contents; }`. Inside the block:
```
  /* The catalog: the search and the categories a 280 px rail at the left, the products a table at the right (ProductList
     draws it from 960 px, useDesktop). A category page keeps its order: head, then the rail beside the products; before
     its category loads (or on an error) the head alone takes the whole width. */
  .ck-catalog { grid-template-columns: 280px minmax(0, 1fr); gap: 20px 24px; align-items: start; }
  .ck-catalog-side, .ck-catalog-main { display: grid; gap: 20px; min-width: 0; }
  .ck-catalog-side { grid-column: 1; }
  .ck-catalog-main { grid-column: 2; }
  .ck-catalog-main ~ .ck-catalog-side { grid-row: 1 / span 2; }
  .ck-catalog > .ck-catalog-main:only-child { grid-column: 1 / -1; }
  .ck-catalog-side .ck-catalog-search-controls { grid-template-columns: minmax(0, 1fr); }
  .ck-catalog-table { width: 100%; table-layout: fixed; border-collapse: separate; border-spacing: 0; border-radius: var(--ck-radius); background: var(--ck-surface); box-shadow: var(--ck-card-shadow); }
  .ck-catalog-col-name { width: 44%; }
  .ck-catalog-col-generic { width: 24%; }
  .ck-catalog-col-last { width: 32%; }
  .ck-catalog-table th, .ck-catalog-table td { padding: 12px 16px; text-align: left; vertical-align: top; }
  .ck-catalog-table thead th { color: var(--ck-text-muted); font-size: var(--ck-text-xs); font-weight: 700; white-space: nowrap; }
  .ck-catalog-table tbody th, .ck-catalog-table tbody td { border-top: 1px solid var(--ck-divider); }
  .ck-catalog-table th[scope="row"] { font-weight: 400; }
  .ck-catalog-table h3 a { display: inline-block; min-height: 44px; padding-block: 6px; color: var(--ck-link); text-decoration: none; }
  .ck-catalog-table h3 a:hover { text-decoration: underline; }
  .ck-catalog-table-last ul { display: grid; gap: 10px; margin: 0; padding: 0; list-style: none; }
  .ck-catalog-table-last li { display: grid; gap: 2px; }
```
Widths: main column 824 px at 1128 (363/198/264), 648 at 952 (285/156/207), 584 at 888; `table-layout: fixed` + `.ck-catalog { overflow-wrap: anywhere }` (Catalog.css:4) keep it from scrolling: names and generic names wrap by words, the price stays whole (`.ck-catalog-price` nowrap, ≈ 100 px in a 155–232 px cell), the place/date note wraps after the «·» if needed (the `<time>` stays whole). Row ≈ 60 px → 50 products ≈ 3 100 px instead of ≈ 11 000. Catalog page placement: side (col 1, row 1) | main (col 2, row 1). Category page: main#1 (breadcrumbs, head, icon picker) col 2 row 1; side (subcategories, search) col 1 rows 1–2 via `.ck-catalog-main ~ .ck-catalog-side` (definite row, placed before the auto-placed mains); main#2 (products) col 2 row 2; before the node loads only main#1 exists → `:only-child` spans both columns. Below 960 the wrappers have no box: both pages render exactly today's one column in today's DOM order. The rail's `ResponsiveFilters` of the generic select renders its children inline on a wide screen (ResponsiveFilters.tsx:32) inside the 280 px card.

TESTS. New `catalog-desktop.test.tsx` (model: catalog-mobile.test.tsx:1-25; fixtures `product`, `category` from `../../api/test-support`): render `<ProductTable products={[product, { ...product, id: 10, brand: null, package: null, prices: [] }]} />`; expect three `<th scope="col">` with `Товар`, `Обобщённый продукт`, `Последняя покупка`; `<th scope="row"><h3><a href="/catalog/products/9">Молоко 850 мл</a></h3>`; `/<p class="ck-catalog-note">Пример · 850\sмл<\/p>/u`; `<td>Молоко</td>`; `<span class="ck-catalog-price">` with `€`; `<time dateTime="2026-10-04">`; `Покупок нет` once; `<caption class="ck-catalog-visually-hidden">` (adjust the literal values to the fixture's actual name/id/date after reading test-support.ts:22). Also: `<ProductList products={[product]} />` in Node still renders `class="ck-catalog-products"` and no `<table`; `<ProductList products={[product]} view="table" />` renders the table; `view="rows"` renders `ck-catalog-rows`. Existing catalog tests: verified that no test in src/features/catalog, src/pages or src/components pins HTML across the new wrapper boundaries (`</form><section`, `</section><section`, `ck-catalog"><`), and request-focus-markup.test.tsx:70 matches the `h2` alone — no edits expected; if `npm test` shows one, insert `<div class="ck-catalog-side">` / `</div><div class="ck-catalog-main">` at the matching spot, the element order being unchanged.

GUARDS: catalog-css.test.ts unchanged (one @media, no overflow, no white-space: normal, pinned `.ck-catalog-product` columns untouched); lib/cards/coverage.test.ts satisfied (ProductList.tsx calls `useNarrow(`); desktop-css.test.ts allows the wrappers outside and `:hover` inside (no colour literal, `font-size` is a token); screens.test.tsx unaffected (no new screen module).

MUST NOT CHANGE: the card markup/CSS (`.ck-catalog-product*`), ProductRows, CategoryChips, Pagination, the 540 block of Catalog.css, Product.css.

**Проверка.**

cd frontend && npx vitest run src/features/catalog src/lib/cards src/theme src/components/request-focus-markup.test.tsx src/pages && npm test && npm run lint && npm run build. Headless (seed_product_merge_demo or any base with ≥ 50 products), both themes: /catalog and /catalog/categories/{id} at 390 and 760 before/after pixel-identical (cards at 760, rows at 390, no table); at 1024/1280/1440 `document.querySelector('.ck-catalog-table')` exists, `document.scrollWidth <= innerWidth`, `.ck-catalog-side` is 280 px wide and shares `offsetTop` with `.ck-catalog-main` on /catalog; on the category page the breadcrumbs/head sit above the products in column 2 and the rail starts at row 1; with the category request throttled the head spans the page (no empty rail); every `.ck-catalog-price` is on one line (`getClientRects().length === 1`); page height for 50 products ≤ 4 000 px at 1280; Tab order: search → categories → table links.

### T7. Лимиты: the list at the left, currency/budget above it, history at the right

Экран: Лимиты (/budget/limits). Зависит от: T1.

**Спецификация.**

FILES: `frontend/src/features/dashboard/LimitsPage.tsx`, `frontend/src/features/dashboard/Dashboard.css` (one base line + rules inside the existing 960 block).

MARKUP (LimitsView, LimitsPage.tsx:184-264): wrap the four contiguous siblings — the `section.limits-currencies` (either variant, :189-203), `{base && budget && <MonthBudgetPanel …/>}` (:204), the `ul.limits-list` / empty `RequestState` (:205-255), and `{categories.length > 0 && <div className="limits-savebar ck-action-bar">…}` (:256-259) — in `<div className="limits-main">`. `p.limits-intro` stays first, `<LimitHistory …/>` (`section.ck-panel.dash-card.limits-history`, :92) and `p.limits-back` stay after the wrapper. DOM order is unchanged, so allowance.test.tsx:80-84 (currencies < budget < list) keeps passing and the phone reads the same sequence.

CSS, Dashboard.css. Base (next to `.dash-column { display: contents; }`, line 32): `.limits-main { display: contents; }`. Inside `@media (min-width: 960px) {` (after the `.dash` rules, :258-259):
```
  /* «Лимиты»: the currency, the budget, the list and its save bar at the left (three fifths), the history at the right;
     a row of the list is one line. The budget card (the same form markup) keeps its stacked layout. */
  .limits { max-width: none; grid-template-columns: minmax(0, 3fr) minmax(0, 2fr); align-items: start; }
  .limits > .limits-intro, .limits > .limits-back { grid-column: 1 / -1; max-width: 760px; }
  .limits-main { display: grid; gap: 16px; min-width: 0; grid-column: 1; }
  .limits > .limits-history { grid-column: 2; }
  .limits-list .limits-form { grid-template-columns: minmax(0, 1fr) minmax(0, 16rem); align-items: center; column-gap: 16px; }
  .limits-list .limits-form > .limits-row-head { grid-column: 1; }
  .limits-list .limits-form > .limits-controls { grid-column: 2; }
  .limits-list .limits-form > .receipt-field-error, .limits-list .limits-form > .limits-done { grid-column: 1 / -1; }
```
Why the `.limits-list` scope: `MonthBudgetPanel` (LimitsPage.tsx:128-148) renders the same `form.limits-form` > `.limits-row-head` + `.limits-controls` (input + «Сохранить бюджет») inside `section.limits-budget`; an unscoped rule would squeeze its wrapping controls (Dashboard.css:224-226) into 16 rem. Placement: intro spans row 1; `.limits-main` col 1 row 2; `.limits-history` col 2 row 2 (column 2 ≥ column 1, same row); back spans row 3. Without history the list column is 60 % wide — fine. The row of a category (:222-245) becomes one 64 px line: dot · name · current limit at the left, input + «Удалить» (16 rem) at the right; at 1128 the head has ≈ 330 px, at 952 ≈ 250 px; `.limits-toggle` (:246) stays under the row. The phone save bar (`margin-inline: -16px` at :264, ActionBar pinning) is unaffected: the wrapper is `display: contents` there, and `.ck-action-bar` is sticky only under 540 px.

GUARDS: dashboard-css.test.ts:77 — media list unchanged (rules go inside the existing block); its token check needs nothing (no new `var(--ck-*)`); `body('.dash-column')` etc. untouched; no `font-size`. Re-run src/features/dashboard/*.test.ts(x) (limits-state, limit-history, allowance; no test pins `<div class="limits"><p class="limits-intro"` as one string — verified by grep). Add to allowance.test.tsx or limits tests one assertion: the rendered LimitsView contains `<div class="limits-main">` after `limits-intro` and `limits-history` after `limits-savebar`.

MUST NOT CHANGE: the `(max-width: 540px)` block of Dashboard.css, class names, `MonthBudgetPanel`, `LimitHistory`, the `columns` skeleton (T1) — it draws the page card at the left and the aside at the right, mirroring this.

**Проверка.**

cd frontend && npx vitest run src/features/dashboard src/theme src/lib/cards && npm test && npm run lint && npm run build. Assertions: `grep -n 'limits-main' src/features/dashboard/Dashboard.css` → one base `display: contents;` line and the 960-block rules; `grep -c '.limits-list .limits-form' src/features/dashboard/Dashboard.css` ≥ 4 and no unscoped `.limits-form {` inside the 960 block; SSR of LimitsView keeps `limits-currencies` < `limits-budget` < `limits-list` < `limits-savebar` < `limits-history` < `limits-back`. Headless /budget/limits (seeded, with history and a month budget), both themes: 390 and 760 before/after pixel-identical; at 1024/1280/1440 `.limits-main` and `.limits-history` share `offsetTop`, each `.limits-list .limits-form` is one line (`.limits-row-head` and `.limits-controls` share `offsetTop`), the budget card's field and «Сохранить бюджет» look as before (stacked under «Сумма на месяц»), the save bar sits directly under the list, `document.scrollWidth <= innerWidth`; change a value → «Сохранить N» enables as before.

### T8. Платежи: questions, suggestions and the month at the left; income and off at the right

Экран: Платежи (/recurring). Зависит от: T1.

**Спецификация.**

FILES: `frontend/src/features/recurring/RecurringPage.tsx`, `frontend/src/theme/desktop.css` (base wrappers + block rules).

MARKUP (RecurringView, RecurringPage.tsx:92-128): keep `p.rec-intro` first, then `<div className="rec-main">` around the contiguous `<QuestionsCard …/>` (`section.ck-panel.rec-card.rec-ask`, or null), `<NoticeLine …/>` (`p.rec-notice`, or null), the suggestions section (`aria-labelledby="rec-suggest-heading"`, optional) and the payments section (`aria-labelledby="rec-list-heading"`); then `<div className="rec-side">` around the «Регулярный доход» section (`rec-income-heading`) and the «Выключены» section (`rec-off-heading`, optional). DOM order is unchanged → no `order` rules; the phone and 541–959 render exactly today's column (the wrappers have no box).

CSS, desktop.css. Outside the block: `.rec-main, .rec-side { display: contents; }`. Inside the block:
```
  /* «Платежи»: the questions, the found ones and the month at the left (three fifths); the regular income and the
     switched-off ones at the right. The forms stay in the sheet. */
  .rec-page { max-width: none; grid-template-columns: minmax(0, 3fr) minmax(0, 2fr); align-items: start; }
  .rec-page > .rec-intro { grid-column: 1 / -1; max-width: 760px; }
  .rec-main, .rec-side { display: grid; gap: 16px; min-width: 0; }
  .rec-main { grid-column: 1; }
  .rec-side { grid-column: 2; }
```
`.rec-page` is already `display: grid; grid-template-columns: minmax(0, 1fr); gap: 16px` (Recurring.css:52); `.rec-page` (0,1,0) later in cascade overrides its `max-width: 760px` and single column. Row heights are independent per column thanks to the wrappers; the «Добавить платёж» / «Добавить доход» buttons keep `width: 100%` inside their cards (667 / 445 px). The Sheet (forms) is a portal and unaffected.

GUARDS: none edited. src/features/recurring/*.test.tsx pin headings and rows, not the page root (no `rec-page`/`rec-intro` anchor — verified by grep); re-run them.

MUST NOT CHANGE: Recurring.css, RecurringDue (Главная), the sheet forms, class names of the sections.

**Проверка.**

cd frontend && npx vitest run src/features/recurring src/theme && npm test && npm run lint && npm run build. Headless /recurring (seeded with a question, a suggestion, an income template and a switched-off payment), both themes: 390 and 760 before/after pixel-identical; at 1024/1280/1440 `.rec-main` and `.rec-side` share `offsetTop`, `.rec-ask` (if present) is the first card of the left column, «Регулярный доход» the first card of the right, `document.scrollWidth <= innerWidth`; opening «Добавить платёж» still shows the sheet.

### T9. Цели, Доходы, Магазины: two columns by CSS only

Экран: Цели (/goals), Доходы (/incomes), Магазины (/stores). Зависит от: T1.

**Спецификация.**

FILES: `frontend/src/theme/desktop.css` only (inside the 960 block). No markup change.

Add inside the block:
```
  /* «Цели» (the list only: the page of one goal shares the .goals root and has no .goal-add): the family's at the left,
     the personal ones at the right; one group alone keeps today's width; «Новая цель» is not a page-wide button. */
  .goals:has(> .goal-add) { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 16px; align-items: start; max-width: none; }
  .goals:has(> .goal-add) > .goal-empty, .goals:has(> .goal-add) > section:only-of-type { grid-column: 1 / -1; max-width: 720px; }
  .goals:has(> .goal-add) > .goal-add { grid-column: 1 / -1; width: auto; min-width: 280px; justify-self: start; }
  /* «Доходы»: the month at the left (three fifths), the categories at the right. */
  .inc-page { display: grid; grid-template-columns: minmax(0, 3fr) minmax(0, 2fr); gap: 16px; align-items: start; max-width: none; }
  .inc-page > .inc-notice { grid-column: 1 / -1; }
  /* «Магазины»: all the places at the left (three fifths), «Похоже на одного получателя» at the right of the same row. */
  .stores-page { display: grid; grid-template-columns: minmax(0, 3fr) minmax(0, 2fr); grid-auto-flow: row dense; gap: 16px; align-items: start; max-width: none; }
  .stores-page > .stores-intro, .stores-page > .stores-notice, .stores-page > .stores-failure, .stores-page > .stores-actions { grid-column: 1 / -1; }
  .stores-page > .stores-intro { max-width: 760px; }
  .stores-page > .stores-suggestions { grid-column: 2; }
  .stores-page > .ck-panel:not(.stores-suggestions) { grid-column: 1; }
```
Why: GoalsView root is `div.goals.ck-stack` with `section.ck-panel` groups (`Group` returns null for an empty list, GoalsPage.tsx:30-31), `section.ck-panel.goal-empty`, `button.goal-add` (GoalsPage.tsx:42-54); GoalPage.tsx:56 uses the same root WITHOUT `.goal-add`, so `:has(> .goal-add)` (0,2,0) keeps /goals/{id} at its 720 px column (Goals.css:4); `section:only-of-type` counts `<section>` siblings only (the add button is a `<button>`); `.goal-add` (0,1,0, Goals.css:21 `width: 100%`) loses to (0,3,0). IncomesPage root is `div.inc-page.ck-stack` with `p.inc-notice` (optional), the month section and the categories section (IncomesPage.tsx:29-57); `.inc-page` (0,1,0) later in cascade beats Incomes.css:23 `max-width: 760px` and the `:where(.ck-stack)` flex brick (tokens.css, weight 0); auto-placement puts the month in column 1 and the categories in column 2 of the same row (the notice, when present, spans the row above). StoresPage root is `div.stores-page` (flex column, Stores.css:3) with intro, notice?, failure?, `section.ck-panel.stores-suggestions` (moderators with suggestions, StoresPage.tsx:47), `section.ck-panel` «Все магазины» (:67), `div.stores-actions.ck-action-bar` (selection, :100), and the merge `Sheet` which renders `null` when closed and a `body` portal when open (Sheet.tsx:59,86) — so it is never a grid child in the browser; dense flow lets the later «Все магазины» fill column 1 of the suggestions' row; without suggestions the list sits alone in the 60 % column. Phone rules of Stores.css (`.stores-actions { margin-inline: calc(50% - 50vw) }`, the 540 block) and the ActionBar pinning are untouched (≤540 only).

GUARDS: none edited (Goals.css, Incomes.css, Stores.css are in no CSS guard; goals/incomes/stores tests pin markup only — no `class="goals`, `inc-page`, `stores-page` anchors, verified — and markup does not change).

MUST NOT CHANGE: Goals.css, Incomes.css, Stores.css, GoalPage (/goals/{id} stays one 720 px column), markup of the three pages.

**Проверка.**

cd frontend && npx vitest run src/theme src/features/goals src/features/incomes src/features/stores && npm test && npm run lint && npm run build. Headless, both themes, 390 and 760 before/after pixel-identical for /goals, /goals/{id}, /incomes, /stores; at 1024/1280/1440: /goals (family with shared + personal) shows the two group cards sharing `offsetTop` and `.goal-add` ≤ 400 px wide at the left; /goals as a single person shows one card ≤ 720 px; /goals/{id} unchanged (one column ≤ 720 px); /incomes month card and categories card share `offsetTop`; /stores as a moderator with suggestions shows «Все магазины» (col 1) and «Похоже на одного получателя» (col 2) on one row, as a member one 60 % column; selecting two stores shows the «Склеить выбранные · 2» bar spanning the page; `document.scrollWidth <= innerWidth` everywhere.

### T10. Full sweep: pixel-diff, scroll assertions, acceptance notes

Экран: all ten screens (documentation and verification). Зависит от: T1, T2, T3, T4, T5, T6, T7, T8, T9.

**Спецификация.**

FILES: new `frontend/DESKTOP_ACCEPTANCE.md`; `frontend/WRAP_ACCEPTANCE.md`, `docs/frontend.md`, `docs/verification.md` (a results section), `CLAUDE.md` (one paragraph «Раскладка для компьютера» in the style of the existing ones). No code change unless a check below fails (then fix in the owning task's files and re-run).

1. Docs. `frontend/DESKTOP_ACCEPTANCE.md` (the human's manual acceptance, same shape as WRAP/MOBILE/OFFLINE_ACCEPTANCE.md): section А — «Не изменилось»: at 390 and 760 every route of the sweep looks as before (bottom bar, sheet filters, cards, swipe, the 760/720/600 caps; the dashboard order money · actions · income · recurring · limits · recent); section Б — one step per screen at 1024, 1280, 1440 in both themes: Главная (columns, «Лимиты» first at the right, «Загрузить чек» with a mouse / «Снять чек» on a touch screen), Траты (one-line filters, 52 px rows, Tab order), Чек (hero | images, table without scroll, pills, discounts | taxes; manual spend one header), Новая трата (form | sticky hint; edit page one column), Каталог (rail | table; category page head above the table; loading head full width), Лимиты (list left, history right, one-line rows, budget card stacked), Платежи, Цели (incl. /goals/{id} unchanged), Доходы, Магазины (moderator and member), loading skeletons in columns; section В — «Не проверено агентом»: real monitor, Safari, 200 % zoom (WRAP step 11 repeated at 1280 for /receipts/{id} and /catalog), keyboard with a screen reader. WRAP_ACCEPTANCE.md step 1: add «на 1280 и 1440 — товары таблицей (Товар · Обобщённый продукт · Последняя покупка), без прокрутки; дерево категорий и поиск — колонка 280 px слева»; step 5: add «на 1280 и 1440 таблица строк на всю ширину страницы, карточка чека слева от «Изображений чека», колонка названия ≥ 290 px, кнопки действий — таблетки в одну строку». docs/frontend.md: new section «Раскладка для компьютера (≥ 960 px)»: one stylesheet `src/theme/desktop.css` with one `@media (min-width: 960px)` block (guard `theme/desktop-css.test.ts`), `DESKTOP_MIN_WIDTH`/`useDesktop`/`useCoarsePointer` in `lib/cards`, the wrappers (`.limits-main`, `.rec-main`/`.rec-side`, `.ck-catalog-side`/`.ck-catalog-main`) as `display: contents` below 960, the per-screen layouts (3fr/2fr lists, 2fr/1fr spend form with the sticky hint, 280 px catalog rail + `ProductTable`, receipt hero|images + full-width lines with the width arithmetic, Главная income/recurring in the side column under the limits and the documented DOM-order consequence, «Загрузить чек» on a fine pointer), the `columns` skeleton and the second 960 block of Skeleton.css (why it exists), and the rule for new screens: «новое правило компьютера — только в блок `desktop.css` (App.css и ActionBar.css идут после него); новый экран списка — `shape="columns"` и колонки 3fr/2fr; телефон и 541–959 не трогать; в Skeleton.css правила компьютера — во второй блок 960»; link DESKTOP_ACCEPTANCE.md. CLAUDE.md paragraph: the same in short with the test/lint/build numbers, the acceptance file, and «браузер и телефон человеком не проверялись». docs/verification.md: the commands and results below.

2. Sweep (headless Chromium, Vite dev on a seeded local base, fake OCR, both themes, no form submits, prod never opened). Routes: `/`, `/receipts`, `/receipts/{photo receipt with 20+ lines}`, `/receipts/{manual}`, `/receipts/new`, `/receipts/{manual}/edit`, `/catalog`, `/catalog?q=мол`, `/catalog/categories/{id}`, `/budget/limits`, `/recurring`, `/goals`, `/goals/{id}`, `/incomes`, `/stores`. Widths: 390 and 760 (compared pixel-by-pixel with screenshots of `main` at the same routes/data: must be identical), then 960, 1023, 1024, 1280, 1440. In every page: `document.scrollWidth <= window.innerWidth`; on the receipt page at ≥1024 `.receipt-table-scroll` has `scrollWidth === clientWidth`; on /catalog at ≥1024 `.ck-catalog-table` exists and no ancestor scrolls horizontally; throttle the API (e.g. 2 s) and screenshot the loading state at 1280 for `/`, `/receipts`, `/budget/limits`, `/recurring`: the skeleton's columns and the loaded screen's columns share the same left/right edges (±16 px; the `columns` card is one card with 28 px padding, so its aside starts ≈ 6 px left of the real column 2).

3. Keyboard/a11y spot checks at 1280: Tab order on /receipts (search → chips → four fields → Применить → Сбросить → first row), /receipts/new (kind → hint → form fields, the sticky hint never traps focus), /catalog (search → categories → table links); the «Фильтры» heading is still announced (aria-labelledby) though invisible; on / the reader order is hero → actions → recent → limits → income → recurring (documented).

4. Report: прошло / не прошло / не проверено with exact commands, exit codes, test counts (`npm test` files/tests), and the widths/routes screenshotted; remind that acceptance on a real monitor, iPhone and Safari is the human's (DESKTOP_ACCEPTANCE.md).

**Проверка.**

cd frontend && npm test && npm run lint && npm run build — exit 0 each, test count ≥ the previous total + the new tests (desktop-css, narrow, skeleton, catalog-desktop, dashboard source-text, limits wrapper); `git diff --stat main -- frontend/src/App.css frontend/src/theme/tokens.css frontend/src/features/receipts/Receipts.css frontend/src/features/catalog/Catalog.css frontend/src/features/expense/Expense.css frontend/src/features/recurring/Recurring.css frontend/src/features/goals/Goals.css frontend/src/features/incomes/Incomes.css frontend/src/features/stores/Stores.css frontend/src/components/ActionBar.css` shows only Catalog.css (+1 base rule); `git diff main -- frontend/src/features/dashboard/Dashboard.css frontend/src/components/Skeleton.css` shows additions inside Dashboard.css's 960 block plus its one base line, and in Skeleton.css one base line plus one appended second 960 block (the first block byte-identical); the 390/760 pixel-diff of every route is empty; every ≥1024 assertion of step 2 passes; the docs exist (`grep -n 'Раскладка для компьютера' docs/frontend.md CLAUDE.md`; `test -f frontend/DESKTOP_ACCEPTANCE.md`).

## Приёмка

At 1024, 1280 and 1440 (both themes; the human's steps are in frontend/DESKTOP_ACCEPTANCE.md): Главная — hero → actions → «Последние траты» at the left, «Лимиты» first at the right followed by «Доход месяца» and the recurring cards, the first action reads «Загрузить чек» with a mouse (and opens the file dialog), «Снять чек» on a touch screen; Траты — the page is as wide as the content, the filters are one line (Период с · Период по · Операция · По дате покупки · Применить · Сбросить) with the help text under it, rows are 52 px with title and meta on one line, the first spend starts ≈ 240 px from the top; Чек — the header card stands left of «Изображения чека», «Строки чека» spans the page with no horizontal scroll (frame ≥ 910 px against ≈ 868 needed) and the name column no longer wraps «Категория: Продукты питания», «Скидки» beside «Налоги», the four actions are 44 px pills in one line; a manual spend keeps one ≤ 760 px header; Новая трата — the form at the left, «Скажите словами» at the right and staying in view while scrolling, an edit page is one ≤ 760 px column; Каталог — a 280 px rail (search, categories) at the left and a table «Товар · Обобщённый продукт · Последняя покупка» at the right without horizontal scroll (small overlaps allowed only at 960–1023), 50 products ≈ 3 000 px, the category page keeps its breadcrumbs and head above the table and shows the head alone full width while the category loads; Лимиты — list (one line per category: name and current limit left, field and «Удалить» right; the budget card stacked as today) with the save bar under it at the left, «История изменений» at the right; Платежи — questions/suggestions/month at the left, regular income and switched-off at the right; Цели — family and personal groups side by side, «Новая цель» a normal-width button, /goals/{id} unchanged; Доходы — month card left, categories right; Магазины — all places left, suggestions right (moderator); loading skeletons of Главная, Траты, Лимиты, Платежи, Цели, Доходы, Магазины show the same columns (the receipt, expense and catalog pages draw their own section cards); nothing scrolls the page horizontally; keyboard order follows the DOM (on Главная: hero → actions → recent → limits → income → recurring). At 390 (and 760) every screen is pixel-identical to main — bottom bar, sheet filters, cards, swipe-to-delete, the 760/720/600 caps on tablets; the dashboard phone visual order stays money · actions · income · recurring · limits · recent. UI acceptance on a real monitor, iPhone and Safari is the human's.
