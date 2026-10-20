import type { Product } from '../../api/types'
import { useDesktop, useNarrow } from '../../lib/cards'
import { formatPrice, formatPurchasedOn, formatQuantity } from '../../lib/format'
import { Link } from '../../navigation'
import { ClassificationBadge } from '../classification/ClassificationMarks'
import { markFor } from '../classification/marks'
import type { ClassificationMark } from '../classification/marks'
import { MergeBadge } from '../merges/MergeMarks'
import type { PendingMark } from '../merges/state'
import { MANUAL_MARK, NO_PLACE } from '../product/state'

type Marks = { merges?: ReadonlyMap<number, PendingMark>; classifications?: ReadonlyMap<number, ClassificationMark> }
type Price = Product['prices'][number]

/** The last purchase of one place and currency: the price in the figures font, then the place, the date and the manual
 * mark in a note — the same two spans in the cards, the rows and the table. `place` is how the place reads (the cards
 * say «Страна: DE», the rows and the table just «DE»); a purchase without a place reads NO_PLACE everywhere. */
function LastPurchase({ price: { country, currency, last }, place = country ?? NO_PLACE }: { price: Price; place?: string }) {
  return <>
    <span className="ck-catalog-price">{formatPrice(last.paid_unit_price, currency)}</span>
    <span className="ck-catalog-note">{place} · <time dateTime={last.purchased_on}>{formatPurchasedOn(last.purchased_on)}</time>{last.manual && ` · ${MANUAL_MARK}`}</span>
  </>
}

/** A phone: one row per product — the name is the link of the whole row, brand and package under it, the last price at
 * the right in the figures font. Marks stay links of their own above the row link. */
export function ProductRows({ products, merges, classifications }: { products: Product[] } & Marks) {
  return <ul className="ck-catalog-rows">
    {products.map((product) => {
      const classification = markFor(classifications, product)
      const meta = [product.brand?.name, product.package ? formatQuantity(product.package.quantity, product.package.unit) : undefined, product.generic.name].filter(Boolean)
      return <li className="ck-catalog-row" key={product.id}>
        <div className="ck-catalog-row-main">
          <h3><Link className="ck-catalog-row-link" to={{ kind: 'product', productId: product.id, query: { page: 1 } }}>{product.name}</Link></h3>
          {meta.length > 0 && <p className="ck-catalog-note">{meta.join(' · ')}</p>}
          {merges?.has(product.id) && <MergeBadge mark={merges.get(product.id)!} />}
          {classification && <ClassificationBadge mark={classification} />}
        </div>
        <div className="ck-catalog-row-prices">
          {product.prices.length === 0 ? <p className="ck-catalog-note">Покупок нет</p>
            : product.prices.map((price) => <p key={`${price.country}/${price.currency}`}><LastPurchase price={price} /></p>)}
        </div>
      </li>
    })}
  </ul>
}

const tableColumns = ['Товар', 'Обобщённый продукт', 'Последняя покупка'] as const

/** A desktop (from 960 px, useDesktop): one table — the name with its brand, package and marks, the generic product,
 * the last purchase per place and currency. Its caption is read, not seen (.ck-catalog-visually-hidden, Catalog.css);
 * the columns are drawn by desktop.css. */
export function ProductTable({ products, merges, classifications }: { products: Product[] } & Marks) {
  return <table className="ck-catalog-table">
    <caption className="ck-catalog-visually-hidden">Товары и последние цены</caption>
    <colgroup><col className="ck-catalog-col-name" /><col className="ck-catalog-col-generic" /><col className="ck-catalog-col-last" /></colgroup>
    <thead><tr>{tableColumns.map((title) => <th key={title} scope="col">{title}</th>)}</tr></thead>
    <tbody>{products.map((product) => {
      const classification = markFor(classifications, product)
      const meta = [product.brand?.name, product.package ? formatQuantity(product.package.quantity, product.package.unit) : undefined].filter(Boolean)
      return <tr key={product.id}>
        <th scope="row">
          <h3><Link to={{ kind: 'product', productId: product.id, query: { page: 1 } }}>{product.name}</Link></h3>
          {meta.length > 0 && <p className="ck-catalog-note">{meta.join(' · ')}</p>}
          {merges?.has(product.id) && <MergeBadge mark={merges.get(product.id)!} />}
          {classification && <ClassificationBadge mark={classification} />}
        </th>
        <td>{product.generic.name}</td>
        <td className="ck-catalog-table-last">{product.prices.length === 0 ? <span className="ck-catalog-note">Покупок нет</span>
          : <ul>{product.prices.map((price) => <li key={`${price.country}/${price.currency}`}><LastPurchase price={price} /></li>)}</ul>}</td>
      </tr>
    })}</tbody>
  </table>
}

/**
 * `merges`: kept products of pending duplicate groups; `classifications`: products with a pending category suggestion.
 * Absent or empty — the list has no marks of that kind. `view` — the rows of a phone, the table of a desktop or the cards
 * between; absent, the window chooses (a server render: the cards).
 */
export default function ProductList({ products, merges, classifications, view: chosen }: {
  products: Product[]; merges?: ReadonlyMap<number, PendingMark>; classifications?: ReadonlyMap<number, ClassificationMark>
  view?: 'cards' | 'rows' | 'table'
}) {
  const narrow = useNarrow()
  const desktop = useDesktop()
  const view = chosen ?? (narrow ? 'rows' : desktop ? 'table' : 'cards')
  if (view === 'rows') return <ProductRows products={products} merges={merges} classifications={classifications} />
  if (view === 'table') return <ProductTable products={products} merges={merges} classifications={classifications} />
  return <ul className="ck-catalog-products">
    {products.map((product) => {
      const classification = markFor(classifications, product)
      return <li className="ck-catalog-product" key={product.id}>
      <div className="ck-catalog-product-description">
        <h3><Link to={{ kind: 'product', productId: product.id, query: { page: 1 } }}>{product.name}</Link></h3>
        {merges?.has(product.id) && <MergeBadge mark={merges.get(product.id)!} />}
        {classification && <ClassificationBadge mark={classification} />}
        <dl className="ck-catalog-metadata">
          <div><dt>Бренд</dt><dd>{product.brand?.name || 'Не указано'}</dd></div>
          <div><dt>Фасовка</dt><dd>{product.package ? <span className="ck-catalog-value">{formatQuantity(product.package.quantity, product.package.unit)}</span> : 'Не указано'}</dd></div>
          <div><dt>Обобщённый продукт</dt><dd>{product.generic.name}</dd></div>
        </dl>
      </div>
      <div className="ck-catalog-product-prices">
        <p className="ck-catalog-price-label">Последняя покупка</p>
        {product.prices.length === 0 ? <p className="ck-catalog-note">Покупок пока нет</p>
          : <ul>
            {product.prices.map((price) => <li key={`${price.country}/${price.currency}`}>
              <LastPurchase price={price} place={price.country ? `Страна: ${price.country}` : undefined} />
            </li>)}
          </ul>}
      </div>
    </li>
    })}
  </ul>
}
