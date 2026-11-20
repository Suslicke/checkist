import { readFileSync, readdirSync } from 'node:fs'
import { join, relative } from 'node:path'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

/**
 * «Скрывать суммы» hides every amount (docs/plans/2026-11-20-design-2.md §2). An amount drawn as `<Money>` is blurred by
 * itself; an amount written as text by the helpers below is not, unless the screen hides it. This guard reads the screens
 * (`features/**` and `lib/**` `.tsx`, without tests and static previews) and finds every call of such a helper that is
 * drawn straight into JSX. Allowed patterns:
 *
 * - visible text — the call stands inside `<Private>` (the whole text is an amount: a line of the paper slip, «≈ 10 061 ₸»)
 *   or `<PrivateText>` (a sentence: only its amounts are blurred), components/Private.tsx;
 * - an attribute (`aria-label`, `title`, a prop of a component) — inside `hideAmounts(…)` (theme/privacy.ts), or in a
 *   branch of `hidden ? … : …` where `hidden` is `usePrivacy()` (a `title` is dropped then);
 * - a prop (or the children) of a component that draws it through `Private` / `PrivateText` itself — named in
 *   `DRAWN_PRIVATE` below with the line that draws it;
 * - a callback (`onPick={(row) => …}`): its text is a notice drawn through `<PrivateText>` where it is shown.
 *
 * A text built earlier into a variable or by a pure state function (`goals-state.ts` …) is not traced: such a text is
 * drawn through `<PrivateText>` where it reaches JSX (see the screens). The guard is red on a new raw `{formatMoney(…)}`.
 */
const HELPERS = new Set([
  'formatMoney', 'formatMoneyNumber', 'formatCents', 'formatCentsNumber', 'formatApproxMoney', 'formatMoneyWithBase', 'baseTwin',
  'formatPrice', 'excludedNote',
])
const WRAPPERS = new Set(['Private', 'PrivateText'])
/** `Component.prop` → the file and the line of it that draws the prop through `Private` / `PrivateText`. */
const DRAWN_PRIVATE: Record<string, { file: string; drawn: string }> = {
  'ReconcileForm.saved': { file: 'features/goals/GoalForms.tsx', drawn: '<Private className="ck-figures">{saved}</Private>' },
  'CurrencyBlock.note': { file: 'features/dashboard/CategorySpendsPage.tsx', drawn: '<PrivateText>{note}</PrivateText>' },
  'Figure.children': { file: 'features/product/PriceHistoryCards.tsx', drawn: '<Private className="ck-figures">{children}</Private>' },
  'Card.facts': { file: 'lib/cards/RecordCards.tsx', drawn: '<PrivateText>{fact.value}</PrivateText>' },
}

export type Leak = { line: number; text: string }

const tagName = (node: ts.JsxElement | ts.JsxSelfClosingElement) =>
  (ts.isJsxElement(node) ? node.openingElement.tagName : node.tagName).getText()

/** Whether the call is hidden by an allowed pattern, or drawn raw (a leak), or not drawn straight into JSX at all. */
function placeOf(call: ts.CallExpression): 'allowed' | 'leak' | 'outside' {
  let node: ts.Node = call
  while (node.parent) {
    const parent: ts.Node = node.parent
    if (ts.isCallExpression(parent) && parent.expression.getText() === 'hideAmounts') return 'allowed'
    if (ts.isConditionalExpression(parent) && node !== parent.condition && /\bhidden\b/.test(parent.condition.getText())) return 'allowed'
    // A callback of an event: what it builds is a notice, drawn where it is shown.
    if ((ts.isArrowFunction(parent) || ts.isFunctionExpression(parent)) && ts.isJsxExpression(parent.parent)
      && ts.isJsxAttribute(parent.parent.parent) && /^on[A-Z]/.test(parent.parent.parent.name.getText())) return 'outside'
    if (ts.isJsxAttribute(parent)) {
      const owner = parent.parent.parent
      return DRAWN_PRIVATE[`${owner.tagName.getText()}.${parent.name.getText()}`] ? 'allowed' : 'leak'
    }
    if (ts.isJsxExpression(parent) && (ts.isJsxElement(parent.parent) || ts.isJsxFragment(parent.parent))) {
      // A child of JSX: the nearest element around it says whether it is hidden.
      let around: ts.Node | undefined = parent.parent
      while (around && !ts.isJsxElement(around)) around = around.parent
      if (!around) return 'leak'
      const tag = tagName(around)
      return WRAPPERS.has(tag) || DRAWN_PRIVATE[`${tag}.children`] ? 'allowed' : 'leak'
    }
    // A statement or a declaration: the text is kept for later, not drawn here.
    if (ts.isStatement(parent) || ts.isVariableDeclaration(parent) || ts.isPropertyAssignment(parent) || ts.isSourceFile(parent)) return 'outside'
    node = parent
  }
  return 'outside'
}

/** The calls of the money helpers drawn raw into the JSX of one source. */
export function leaksOf(source: string, file = 'screen.tsx'): Leak[] {
  const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const leaks: Leak[] = []
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && HELPERS.has(node.expression.text) && placeOf(node) === 'leak') {
      leaks.push({ line: tree.getLineAndCharacterOfPosition(node.getStart()).line + 1, text: node.getText().slice(0, 80) })
    }
    ts.forEachChild(node, visit)
  }
  visit(tree)
  return leaks
}

const src = new URL('..', import.meta.url).pathname
function screens(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return entry.name.includes('preview') ? [] : screens(path)
    return entry.name.endsWith('.tsx') && !/\.test\.tsx$/.test(entry.name) && !entry.name.includes('preview') ? [path] : []
  })
}

describe('«Скрывать суммы» covers every amount written as text (privacy-coverage guard)', () => {
  it('finds no money helper drawn raw into the JSX of a screen', () => {
    const found = [...screens(join(src, 'features')), ...screens(join(src, 'lib'))].flatMap((path) =>
      leaksOf(readFileSync(path, 'utf8'), path).map((leak) => `${relative(src, path)}:${leak.line} ${leak.text}`))
    expect(found).toEqual([])
  })

  it('draws a prop of DRAWN_PRIVATE through Private or PrivateText where it says', () => {
    for (const [prop, { file, drawn }] of Object.entries(DRAWN_PRIVATE)) {
      expect(readFileSync(join(src, file), 'utf8'), prop).toContain(drawn)
    }
  })

  it('is red on a raw amount and green on the allowed patterns', () => {
    const raw = `export const A = ({ v }: { v: string }) => <p>Итог: {formatMoney(v, 'KZT')}</p>`
    expect(leaksOf(raw)).toEqual([{ line: 1, text: "formatMoney(v, 'KZT')" }])
    expect(leaksOf(`const B = () => <span title={\`\${formatPrice(p, 'KZT')}\`} />`)).toHaveLength(1)
    expect(leaksOf(`const C = () => <ul>{rows.map((row) => <li>{baseTwin(row.c, row.t, 'KZT')}</li>)}</ul>`)).toHaveLength(1)
    expect(leaksOf(`const D = () => <Foo saved={formatApproxMoney(s, 'KZT')} />`)).toHaveLength(1)
    const allowed = [
      `const A = () => <p>Итог: <Private>{formatMoney(v, 'KZT')}</Private></p>`,
      `const B = () => <p><PrivateText>{\`на \${formatMoney(v, 'KZT')} меньше\`}</PrivateText></p>`,
      `const C = () => <PrivateText>{rows.map((row) => formatMoney(row.t, row.c)).join(', ')}</PrivateText>`,
      `const D = () => <svg aria-label={hideAmounts(\`Потрачено \${formatMoney(v, 'KZT')}\`)} />`,
      `const E = () => <p title={hidden ? undefined : formatMoney(v, 'KZT')} />`,
      `const F = () => { const label = formatMoney(v, 'KZT'); return <p aria-label={hidden ? hideAmounts(label) : label} /> }`,
      `const G = () => <ReconcileForm saved={formatApproxMoney(s, 'KZT')} />`,
      `const H = () => <Picker onPick={(row) => onPatch({ id: row.id }, \`закрыт тратой \${formatMoney(row.total, row.currency)}.\`)} />`,
      `const I = () => <Figure>{formatPrice(p, 'KZT')}</Figure>`,
    ]
    for (const source of allowed) expect(leaksOf(source), source).toEqual([])
  })
})
