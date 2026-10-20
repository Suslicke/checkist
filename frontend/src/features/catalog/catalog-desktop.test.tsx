import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as api from '../../api/catalog'
import type { ApiResult, Product } from '../../api/types'
import { category, categoryDetail, pageOf, product } from '../../api/test-support'
import type { CatalogRequestState } from './catalog-request'
import { CatalogPage } from './CatalogPage'
import { CategoryPage } from './CategoryPage'
import ProductList, { ProductTable } from './ProductList'
import * as catalogRequests from './use-catalog-request'

const noop = () => {}
const loading = { kind: 'loading' as const }
const empty: Product = { ...product, id: 10, brand: null, package: null, prices: [] }
afterEach(() => vi.restoreAllMocks())

type Answers = Partial<Record<'categories' | 'category' | 'products', CatalogRequestState<unknown>>>
/** Answers the requests of a page by name, whatever their order in the page: a page wraps each loader in useCallback,
 * so the loader has no identity to key on; instead the loader is called once against the mocked API, and each API call
 * returns its own name in place of a promise. A request without an answer fails the test by name. */
function answer(answers: Answers) {
  vi.spyOn(api, 'getCategories').mockReturnValue('categories' as never)
  vi.spyOn(api, 'getCategory').mockReturnValue('category' as never)
  vi.spyOn(api, 'getProducts').mockReturnValue('products' as never)
  vi.spyOn(catalogRequests, 'useCatalogRequest').mockImplementation(<T,>(load: (signal: AbortSignal) => Promise<ApiResult<T>>) => {
    const name = load(new AbortController().signal) as unknown as keyof Answers
    const state = answers[name]
    if (!state) throw new Error(`the test gives no answer to the ${name} request`)
    return { state: state as CatalogRequestState<T>, retry: noop }
  })
}

describe('desktop view of the catalog (SSR markup; the table itself is drawn from 960 px by useDesktop)', () => {
  it('draws the products as a table: name with its meta and marks, generic product, last purchase per place', () => {
    const html = renderToStaticMarkup(<ProductTable products={[product, empty]} />)
    expect(html).toMatch(/^<table class="ck-catalog-table"><caption class="ck-catalog-visually-hidden">Товары и последние цены<\/caption><colgroup>/)
    expect(html).toContain('<col class="ck-catalog-col-name"/><col class="ck-catalog-col-generic"/><col class="ck-catalog-col-last"/>')
    expect(html.match(/<th scope="col">/g)).toHaveLength(3)
    for (const title of ['Товар', 'Обобщённый продукт', 'Последняя покупка']) expect(html).toContain(`<th scope="col">${title}</th>`)
    expect(html).toContain('<th scope="row"><h3><a href="/catalog/products/9">Молоко 850 мл</a></h3>')
    expect(html).toMatch(/<p class="ck-catalog-note">Пример · 850\sмл<\/p>/u)
    expect(html.match(/<td>Молоко<\/td>/g)).toHaveLength(2)
    expect(html).toMatch(/<td class="ck-catalog-table-last"><ul><li><span class="ck-catalog-price">[^<]*€<\/span><span class="ck-catalog-note">DE · <time dateTime="2026-10-04">/)
    expect(html.match(/Покупок нет/g)).toHaveLength(1)
    // The empty product: no meta line at all, not an empty one.
    expect(html).toContain('<th scope="row"><h3><a href="/catalog/products/10">Молоко 850 мл</a></h3></th>')
  })

  it('keeps the cards in a Node render and lets a caller choose the view', () => {
    const plain = renderToStaticMarkup(<ProductList products={[product]} />)
    expect(plain).toContain('class="ck-catalog-products"')
    expect(plain).not.toContain('<table')
    expect(renderToStaticMarkup(<ProductList products={[product]} view="table" />)).toMatch(/^<table class="ck-catalog-table">/)
    expect(renderToStaticMarkup(<ProductList products={[product]} view="rows" />)).toMatch(/^<ul class="ck-catalog-rows">/)
    expect(renderToStaticMarkup(<ProductList products={[product]} view="cards" />)).toBe(plain)
  })

  it('wraps the catalog page into a rail (search, categories) and a main (products) in the order of today', () => {
    answer({ categories: { kind: 'ok', data: pageOf([category]) }, products: loading })
    const html = renderToStaticMarkup(<CatalogPage query={{ page: 1 }} />)
    expect(html).toMatch(/^<div class="ck-catalog"><div class="ck-catalog-side"><form/)
    expect(html).toMatch(/<\/form><section[^>]*aria-labelledby="ck-catalog-categories-heading"/)
    expect(html).toMatch(/<\/section><\/div><div class="ck-catalog-main"><section[^>]*class="ck-catalog-results"[\s\S]*<\/section><\/div><\/div>$/)
    expect(html.match(/ck-catalog-side"/g)).toHaveLength(1)
    expect(html.match(/ck-catalog-main"/g)).toHaveLength(1)
  })

  it('wraps the category page as head, then the rail beside the products; before the category loads the head stands alone', () => {
    answer({ category: { kind: 'ok', data: { ...categoryDetail, children: [{ ...category, id: 3, name: 'Сыры' }] } }, products: loading })
    const html = renderToStaticMarkup(<CategoryPage categoryId={2} query={{ page: 1 }} />)
    // The icon picker (a moderator only) renders nothing here: the head wrapper closes right after the category section.
    const order = ['<div class="ck-catalog"><div class="ck-catalog-main"><nav', 'ck-catalog-category"', '</section></div><div class="ck-catalog-side"><section',
      'ck-catalog-subcategories-heading', '<form', '</form></div><div class="ck-catalog-main"><section', 'ck-catalog-results']
    const at = order.map((anchor) => html.indexOf(anchor))
    expect(at.every((index) => index > -1), order.filter((_, index) => at[index] === -1).join(', ')).toBe(true)
    expect([...at].sort((a, b) => a - b)).toEqual(at)
    expect(html.match(/ck-catalog-main"/g)).toHaveLength(2)
    expect(html.match(/ck-catalog-side"/g)).toHaveLength(1)
    answer({ category: loading, products: loading })
    const waiting = renderToStaticMarkup(<CategoryPage categoryId={2} query={{ page: 1 }} />)
    expect(waiting).toMatch(/^<div class="ck-catalog"><div class="ck-catalog-main"><section[^>]*class="ck-catalog-category"[\s\S]*<\/section><\/div><\/div>$/)
    expect(waiting).not.toContain('ck-catalog-side')
  })
})
