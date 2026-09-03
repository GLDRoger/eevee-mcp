/** Applet-side UI module source for the Meridian Ops ERP reference applet. */

export const uiSource = String.raw`
import { money } from '../lib/format'

export function Money({ value }) {
  return <span className="money">{money(value)}</span>
}

export function StateTag({ value }) {
  return <span className={'state-tag is-' + value}>{value}</span>
}

export function Panel({ title, meta, children }) {
  return <section className="panel">
    <header><h2>{title}</h2>{meta ? <span>{meta}</span> : null}</header>
    {children}
  </section>
}

/** Tables scroll sideways inside their panel instead of clipping on narrow screens. */
export function Table({ head, children, empty }) {
  if (!children || (Array.isArray(children) && children.length === 0)) {
    return <p className="table-empty">{empty}</p>
  }
  return <div className="table-scroll">
    <table>
      <thead><tr>{head.map((label, index) => <th key={index} scope="col">{label}</th>)}</tr></thead>
      <tbody>{children}</tbody>
    </table>
  </div>
}

export function Field({ label, children }) {
  return <label className="field"><span>{label}</span>{children}</label>
}

export function count(n, singular, plural) {
  return n + ' ' + (n === 1 ? singular : plural || singular + 's')
}
`

export const dashboardSource = String.raw`
import { Money, Panel, StateTag, Table, count } from '../components/ui'
import { companySnapshot, lowStock, openOrders } from '../lib/reports'
import { shortDate } from '../lib/format'

export function Dashboard({ state, go }) {
  const snapshot = companySnapshot(state)
  const shortages = lowStock(state)
  const open = openOrders(state)
  return <div className="module">
    <div className="stat-row">
      <button type="button" className="stat" onClick={() => go('inventory')}>
        <strong id="stat-products">{snapshot.products}</strong><span>products</span>
      </button>
      <button type="button" className="stat" onClick={() => go('customers')}>
        <strong id="stat-customers">{snapshot.customers}</strong><span>customers</span>
      </button>
      <button type="button" className="stat" onClick={() => go('orders')}>
        <strong id="stat-open-orders">{snapshot.openOrders}</strong><span>open orders</span>
      </button>
      <button type="button" className={shortages.length > 0 ? 'stat is-alert' : 'stat'} onClick={() => go('inventory')}>
        <strong id="stat-low-stock">{snapshot.lowStock}</strong><span>low stock</span>
      </button>
      <button type="button" className="stat" onClick={() => go('invoices')}>
        <strong id="stat-receivables"><Money value={snapshot.openReceivables} /></strong><span>receivables</span>
      </button>
      <button type="button" className="stat" onClick={() => go('reports')}>
        <strong id="stat-inventory-value"><Money value={snapshot.inventoryValue} /></strong><span>on-hand value</span>
      </button>
    </div>
    <Panel title="Needs attention" meta={count(shortages.length, 'shortage')}>
      <Table head={['SKU', 'Stock', 'Reorder at', 'Shortfall']} empty="Nothing is below its reorder point.">
        {shortages.map((row) => <tr key={row.productId} className="shortage-row">
          <th scope="row">{row.sku}</th>
          <td className="numeric">{row.stock}</td>
          <td className="numeric">{row.reorderPoint}</td>
          <td className="numeric is-alert-text">{row.shortfall}</td>
        </tr>)}
      </Table>
    </Panel>
    <Panel title="Open orders" meta={count(open.length, 'order')}>
      <Table head={['Order', 'State', 'Total']} empty="No orders are in flight.">
        {open.map((row) => <tr key={row.id} className="open-order-row">
          <th scope="row">{row.number}</th>
          <td><StateTag value={row.state} /></td>
          <td><Money value={row.total} /></td>
        </tr>)}
      </Table>
    </Panel>
    <Panel title="Recent activity" meta={count(state.audit.length, 'entry', 'entries')}>
      <ol className="audit-list">
        {state.audit.slice(-6).reverse().map((item, index) => <li key={index}>
          <span>{shortDate(item.at)}</span> {item.entry}
        </li>)}
      </ol>
    </Panel>
  </div>
}
`

export const inventorySource = String.raw`
import { useState } from 'react'
import { Field, Money, Panel, Table } from '../components/ui'
import { createProduct, receiveStock } from '../lib/logic'
import { CATEGORIES } from '../lib/model'

export function Inventory({ state, apply }) {
  const [receiveQty, setReceiveQty] = useState({})
  const [draft, setDraft] = useState({ name: '', sku: '', category: 'hardware', price: '', cost: '' })

  const receive = (productId) => {
    const raw = String(receiveQty[productId] || '').trim()
    const qty = raw === '' ? NaN : Number(raw)
    // Non-integers reach the logic layer so the refusal is visible instead of silently rounded.
    apply((current) => receiveStock(current, productId, Number.isFinite(qty) ? qty : raw))
    setReceiveQty({ ...receiveQty, [productId]: '' })
  }

  const add = (event) => {
    event.preventDefault()
    apply((current) => createProduct(current, {
      name: draft.name, sku: draft.sku, category: draft.category,
      price: draft.price === '' ? NaN : Number(draft.price),
      cost: draft.cost === '' ? 0 : Number(draft.cost),
      stock: 0, reorderPoint: 0,
    }).state)
    setDraft({ name: '', sku: '', category: 'hardware', price: '', cost: '' })
  }

  const active = state.products.filter((product) => !product.archived)
  return <div className="module">
    <Panel title="Catalog" meta={active.length + ' active'}>
      <Table head={['SKU', 'Product', 'Category', 'Price', 'Stock', 'Reorder at', 'Receive']} empty="No products yet.">
        {active.map((product) => <tr
          key={product.id}
          className={product.tracked && product.reorderPoint > 0 && product.stock <= product.reorderPoint ? 'is-low' : undefined}
        >
          <th scope="row">{product.sku}</th>
          <td>{product.name}</td>
          <td>{product.category}</td>
          <td><Money value={product.price} /></td>
          <td className="numeric" id={'stock-' + product.id}>{product.tracked ? product.stock : '—'}</td>
          <td className="numeric">{product.tracked && product.reorderPoint > 0 ? product.reorderPoint : '—'}</td>
          <td className="row-actions">
            {product.tracked ? <>
              <input
                aria-label={'Units to receive for ' + product.sku}
                inputMode="numeric"
                placeholder="0"
                value={receiveQty[product.id] || ''}
                onChange={(event) => setReceiveQty({ ...receiveQty, [product.id]: event.target.value })}
              />
              <button type="button" id={'receive-' + product.id} onClick={() => receive(product.id)}>Receive</button>
            </> : <span className="is-muted">not stocked</span>}
          </td>
        </tr>)}
      </Table>
    </Panel>
    <Panel title="New product">
      <form className="inline-form" onSubmit={add}>
        <Field label="Name">
          <input aria-label="Product name" value={draft.name} maxLength={80}
            onChange={(event) => setDraft({ ...draft, name: event.target.value })} />
        </Field>
        <Field label="SKU">
          <input aria-label="Product SKU" value={draft.sku} maxLength={24}
            onChange={(event) => setDraft({ ...draft, sku: event.target.value })} />
        </Field>
        <Field label="Category">
          <select aria-label="Product category" value={draft.category}
            onChange={(event) => setDraft({ ...draft, category: event.target.value })}>
            {CATEGORIES.map((category) => <option key={category} value={category}>{category}</option>)}
          </select>
        </Field>
        <Field label="Price">
          <input aria-label="Selling price" inputMode="decimal" value={draft.price}
            onChange={(event) => setDraft({ ...draft, price: event.target.value })} />
        </Field>
        <Field label="Cost">
          <input aria-label="Unit cost" inputMode="decimal" value={draft.cost}
            onChange={(event) => setDraft({ ...draft, cost: event.target.value })} />
        </Field>
        <button id="product-add" type="submit">Add product</button>
      </form>
    </Panel>
  </div>
}
`

export const ordersSource = String.raw`
import { useState } from 'react'
import { Field, Money, Panel, StateTag, Table } from '../components/ui'
import {
  addOrderLine, allocateOrder, cancelOrder, createOrder,
  deliverOrder, issueInvoice, orderById, orderTotal, removeOrderLine, shipOrder,
} from '../lib/logic'
import { shortDate } from '../lib/format'

const NEXT_MOVE = {
  draft: { label: 'Allocate stock', act: allocateOrder },
  allocated: { label: 'Ship', act: shipOrder },
  shipped: { label: 'Mark delivered', act: deliverOrder },
}

/** Advance from the order's state at commit time, so two quick clicks allocate then ship. */
const advance = (orderId) => (current) => {
  const order = orderById(current, orderId)
  const move = NEXT_MOVE[order.state]
  if (!move) throw new Error(order.number + ' is ' + order.state + ' and has no next step')
  return move.act(current, order.id)
}

export function Orders({ state, apply, note }) {
  const newest = state.orders[state.orders.length - 1]
  const [customerId, setCustomerId] = useState(state.customers[0] ? state.customers[0].id : '')
  const [selectedId, setSelectedId] = useState(newest ? newest.id : '')
  const [lineDraft, setLineDraft] = useState({ productId: '', qty: '1' })
  const selected = state.orders.find((order) => order.id === selectedId)

  const open = () => {
    if (!customerId) return
    apply((current) => {
      const outcome = createOrder(current, customerId, '')
      setSelectedId(outcome.order.id)
      return outcome.state
    })
  }

  const addLine = (event) => {
    event.preventDefault()
    if (!selected || !lineDraft.productId) return
    const raw = lineDraft.qty.trim()
    const qty = raw === '' ? NaN : Number(raw)
    apply((current) => addOrderLine(current, selected.id, lineDraft.productId, Number.isFinite(qty) ? qty : raw, undefined))
    setLineDraft({ productId: '', qty: '1' })
  }

  return <div className="module module-split">
    <Panel title="Orders" meta={state.orders.length + ' total'}>
      <form className="inline-form" onSubmit={(event) => { event.preventDefault(); open() }}>
        <Field label="Customer">
          <select id="order-customer" aria-label="Order customer" value={customerId}
            onChange={(event) => setCustomerId(event.target.value)}>
            {state.customers.map((customer) =>
              <option key={customer.id} value={customer.id}>{customer.name}</option>)}
          </select>
        </Field>
        <button id="order-open" type="submit">Open order</button>
      </form>
      <ol className="record-list">
        {state.orders.slice().reverse().map((order) => <li key={order.id}>
          <button
            type="button"
            id={'order-' + order.id}
            className={order.id === selectedId ? 'record is-selected' : 'record'}
            onClick={() => setSelectedId(order.id)}
          >
            <strong>{order.number}</strong>
            <StateTag value={order.state} />
            <span><Money value={orderTotal(order)} /></span>
          </button>
        </li>)}
      </ol>
    </Panel>
    {selected ? <Panel
      title={selected.number}
      meta={shortDate(selected.placedAt) + ' · ' + (state.customers.find((customer) => customer.id === selected.customerId) || { name: 'unknown' }).name}
    >
      <div id="order-detail">
        <p className="order-state-line">State: <StateTag value={selected.state} /> · Total: <Money value={orderTotal(selected)} /></p>
        <Table head={['Product', 'Qty', 'Price', 'Line', 'Actions']} empty="No lines yet. Add one below.">
          {selected.lines.map((line) => {
            const product = state.products.find((item) => item.id === line.productId)
            return <tr key={line.productId}>
              <th scope="row">{product ? product.sku : line.productId}</th>
              <td className="numeric">{line.qty}</td>
              <td><Money value={line.price} /></td>
              <td><Money value={line.qty * line.price} /></td>
              <td>{selected.state === 'draft' ? <button
                type="button"
                onClick={() => apply((current) => removeOrderLine(current, selected.id, line.productId))}
              >Remove</button> : null}</td>
            </tr>
          })}
        </Table>
        {selected.state === 'draft' ? <form className="inline-form" onSubmit={addLine}>
          <Field label="Product">
            <select id="line-product" aria-label="Line product" value={lineDraft.productId}
              onChange={(event) => setLineDraft({ ...lineDraft, productId: event.target.value })}>
              <option value="">Choose</option>
              {state.products.filter((product) => !product.archived).map((product) =>
                <option key={product.id} value={product.id}>{product.sku}</option>)}
            </select>
          </Field>
          <Field label="Qty">
            <input id="line-qty" aria-label="Line quantity" inputMode="numeric" value={lineDraft.qty}
              onChange={(event) => setLineDraft({ ...lineDraft, qty: event.target.value })} />
          </Field>
          <button id="line-add" type="submit">Add line</button>
        </form> : null}
        <div className="order-moves">
          {NEXT_MOVE[selected.state] ? <button
            id="order-advance"
            type="button"
            onClick={() => apply(advance(selected.id))}
          >{NEXT_MOVE[selected.state].label}</button> : null}
          {selected.state === 'shipped' || selected.state === 'allocated' || selected.state === 'draft' ? <button
            id="order-cancel"
            type="button"
            className="is-quiet"
            onClick={() => apply((current) => cancelOrder(current, selected.id, 'Cancelled from the orders screen'))}
          >Cancel order</button> : null}
          {selected.state === 'delivered' ? <button
            id="order-invoice"
            type="button"
            onClick={() => apply((current) => issueInvoice(current, selected.id).state)}
          >Issue invoice</button> : null}
        </div>
        {note ? <p id="order-note" role="alert">{note}</p> : null}
      </div>
    </Panel> : <Panel title="No order selected"><p className="table-empty">Open an order to work it.</p></Panel>}
  </div>
}
`

export const customersSource = String.raw`
import { useState } from 'react'
import { Field, Money, Panel, Table } from '../components/ui'
import { createCustomer, creditExposure, openBalance, setCreditHold, updateCustomer } from '../lib/logic'
import { TERMS } from '../lib/model'

export function Customers({ state, apply }) {
  const [draft, setDraft] = useState({ name: '', region: 'east', terms: 'net30', creditLimit: '' })

  const add = (event) => {
    event.preventDefault()
    apply((current) => createCustomer(current, {
      name: draft.name, region: draft.region, terms: draft.terms,
      creditLimit: draft.creditLimit === '' ? 0 : Number(draft.creditLimit),
    }).state)
    setDraft({ name: '', region: 'east', terms: 'net30', creditLimit: '' })
  }

  return <div className="module">
    <Panel title="Customers" meta={state.customers.length + ' accounts'}>
      <Table head={['Customer', 'Region', 'Terms', 'Credit limit', 'Open balance', 'Exposure', 'Hold', 'Actions']} empty="No customers yet.">
        {state.customers.map((customer) => <tr key={customer.id} className={customer.hold ? 'is-low' : undefined}>
          <th scope="row">{customer.name}</th>
          <td>{customer.region}</td>
          <td>
            <select
              aria-label={'Payment terms for ' + customer.name}
              value={customer.terms}
              onChange={(event) => apply((current) => updateCustomer(current, customer.id, { terms: event.target.value }))}
            >
              {TERMS.map((terms) => <option key={terms} value={terms}>{terms}</option>)}
            </select>
          </td>
          <td><Money value={customer.creditLimit} /></td>
          <td><Money value={openBalance(state, customer.id)} /></td>
          <td id={'exposure-' + customer.id}><Money value={creditExposure(state, customer.id)} /></td>
          <td id={'hold-' + customer.id}>{customer.hold ? 'On hold' : '—'}</td>
          <td>
            <button type="button" id={'toggle-hold-' + customer.id}
              onClick={() => apply((current) => setCreditHold(current, customer.id, !customer.hold))}>
              {customer.hold ? 'Release' : 'Hold'}
            </button>
          </td>
        </tr>)}
      </Table>
    </Panel>
    <Panel title="New customer">
      <form className="inline-form" onSubmit={add}>
        <Field label="Name">
          <input aria-label="Customer name" value={draft.name} maxLength={80}
            onChange={(event) => setDraft({ ...draft, name: event.target.value })} />
        </Field>
        <Field label="Region">
          <input aria-label="Customer region" value={draft.region} maxLength={40}
            onChange={(event) => setDraft({ ...draft, region: event.target.value })} />
        </Field>
        <Field label="Terms">
          <select aria-label="Payment terms" value={draft.terms}
            onChange={(event) => setDraft({ ...draft, terms: event.target.value })}>
            {TERMS.map((terms) => <option key={terms} value={terms}>{terms}</option>)}
          </select>
        </Field>
        <Field label="Credit limit">
          <input aria-label="Credit limit" inputMode="decimal" value={draft.creditLimit}
            onChange={(event) => setDraft({ ...draft, creditLimit: event.target.value })} />
        </Field>
        <button type="submit">Add customer</button>
      </form>
    </Panel>
  </div>
}
`

export const invoicesSource = String.raw`
import { useState } from 'react'
import { Money, Panel, StateTag, Table } from '../components/ui'
import { invoiceBalance, recordPayment, voidInvoice } from '../lib/logic'
import { shortDate } from '../lib/format'

export function Invoices({ state, apply, note }) {
  const [amounts, setAmounts] = useState({})

  const pay = (invoiceId) => {
    const raw = String(amounts[invoiceId] || '').trim()
    const amount = raw === '' ? NaN : Number(raw)
    apply((current) => recordPayment(current, invoiceId, amount, 'Recorded from the invoices screen'))
    setAmounts({ ...amounts, [invoiceId]: '' })
  }

  const overdue = (invoice) => invoice.state === 'open' && new Date(invoice.dueAt).getTime() < Date.now()
  return <div className="module">
    <Panel title="Invoices" meta={state.invoices.filter((invoice) => invoice.state === 'open').length + ' open'}>
      <Table head={['Invoice', 'Customer', 'Issued', 'Due', 'Total', 'Balance', 'State', 'Payment']}
        empty="Deliver an order and issue its invoice to start the ledger.">
        {state.invoices.slice().reverse().map((invoice) => {
          const customer = state.customers.find((item) => item.id === invoice.customerId)
          const balance = invoiceBalance(invoice)
          return <tr key={invoice.id} id={'invoice-' + invoice.id} className={overdue(invoice) ? 'is-low' : undefined}>
            <th scope="row">{invoice.number}</th>
            <td>{customer ? customer.name : invoice.customerId}</td>
            <td>{shortDate(invoice.issuedAt)}</td>
            <td className={overdue(invoice) ? 'is-alert-text' : undefined}>{shortDate(invoice.dueAt)}{overdue(invoice) ? ' (overdue)' : ''}</td>
            <td><Money value={invoice.total} /></td>
            <td className="numeric" id={'balance-' + invoice.id}><Money value={balance} /></td>
            <td><StateTag value={invoice.state} /></td>
            <td className="row-actions">
              {invoice.state === 'open' ? <>
                <input
                  aria-label={'Payment amount for ' + invoice.number}
                  inputMode="decimal"
                  placeholder="0.00"
                  value={amounts[invoice.id] || ''}
                  onChange={(event) => setAmounts({ ...amounts, [invoice.id]: event.target.value })}
                />
                <button type="button" id={'pay-' + invoice.id} onClick={() => pay(invoice.id)}>Record</button>
                <button type="button" className="is-quiet" id={'void-' + invoice.id}
                  onClick={() => apply((current) => voidInvoice(current, invoice.id, 'Voided from the invoices screen'))}>
                  Void
                </button>
              </> : null}
            </td>
          </tr>
        })}
      </Table>
      {note ? <p id="invoice-note" role="alert">{note}</p> : null}
    </Panel>
  </div>
}
`

export const reportsScreenSource = String.raw`
import { Money, Panel, Table } from '../components/ui'
import { money } from '../lib/format'
import { arAging, inventoryValuation, revenueByCategory, salesByCustomer } from '../lib/reports'

export function Reports({ state }) {
  const valuation = inventoryValuation(state)
  const aging = arAging(state, undefined)
  const sales = salesByCustomer(state)
  const categories = revenueByCategory(state)
  return <div className="module module-split">
    <Panel title="Inventory valuation" meta={'total ' + money(valuation.total)}>
      <Table head={['SKU', 'Stock', 'Unit cost', 'Value']} empty="Nothing in stock.">
        {valuation.rows.map((row) => <tr key={row.sku}>
          <th scope="row">{row.sku}</th>
          <td className="numeric">{row.stock}</td>
          <td><Money value={row.unitCost} /></td>
          <td><Money value={row.value} /></td>
        </tr>)}
      </Table>
    </Panel>
    <Panel title="Receivables aging" meta={'open ' + money(aging.reduce((total, bucket) => total + bucket.amount, 0))}>
      <Table head={['Bucket', 'Invoices', 'Amount']} empty="No open receivables.">
        {aging.map((bucket) => <tr key={bucket.label} id={'aging-' + bucket.label.replace('+', 'plus')}>
          <th scope="row">{bucket.label}</th>
          <td className="numeric">{bucket.invoices}</td>
          <td><Money value={bucket.amount} /></td>
        </tr>)}
      </Table>
    </Panel>
    <Panel title="Sales by customer">
      <Table head={['Customer', 'Region', 'Billed']} empty="Nothing billed yet.">
        {sales.map((row) => <tr key={row.customerId}>
          <th scope="row">{row.name}</th>
          <td>{row.region}</td>
          <td><Money value={row.billed} /></td>
        </tr>)}
      </Table>
    </Panel>
    <Panel title="Delivered revenue by category">
      <Table head={['Category', 'Revenue']} empty="Deliver an order to see revenue.">
        {categories.map((row) => <tr key={row.category}>
          <th scope="row">{row.category}</th>
          <td><Money value={row.revenue} /></td>
        </tr>)}
      </Table>
    </Panel>
  </div>
}
`

export const auditScreenSource = String.raw`
import { Panel, count } from '../components/ui'
import { capOf } from '../lib/model'

export function Audit({ state }) {
  return <div className="module">
    <Panel title="Audit trail" meta={count(state.audit.length, 'entry', 'entries') + ' of ' + capOf('audit') + ' kept'}>
      <ol className="audit-list is-full">
        {state.audit.slice().reverse().map((item, index) => <li key={index}>
          <span>{item.at.slice(0, 19).replace('T', ' ')}</span> {item.entry}
        </li>)}
      </ol>
    </Panel>
  </div>
}
`
