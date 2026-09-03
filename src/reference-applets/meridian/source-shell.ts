/** Applet-side shell, styles, and actions for the Meridian Ops ERP reference applet. */

export const appShellSource = String.raw`
import { useEffect, useState } from 'react'
import './styles/app.css'
import { seedState } from './lib/model'
import {
  addOrderLine, adjustStock, allocateOrder, archiveProduct, audited, cancelOrder,
  createCustomer, createOrder, createProduct, creditExposure, customerById, deliverOrder,
  invoiceBalance, invoiceById, issueInvoice, openBalance, orderById, orderTotal,
  receiveStock, recordPayment, removeOrderLine, setCreditHold, shipOrder, updateCustomer,
  updateProduct, voidInvoice,
} from './lib/logic'
import { commit, currentState, ensureState, loadState, replaceState, subscribe } from './lib/persist'
import { arAging, companySnapshot, inventoryValuation, lowStock, revenueByCategory, salesByCustomer } from './lib/reports'
import { Dashboard } from './modules/dashboard'
import { Inventory } from './modules/inventory'
import { Orders } from './modules/orders'
import { Customers } from './modules/customers'
import { Invoices } from './modules/invoices'
import { Reports } from './modules/reports'
import { Audit } from './modules/audit'

const MODULES = [
  ['dashboard', 'Dashboard'],
  ['inventory', 'Inventory'],
  ['orders', 'Orders'],
  ['customers', 'Customers'],
  ['invoices', 'Invoices'],
  ['reports', 'Reports'],
  ['audit', 'Audit'],
]

const bounded = (value, fallback, max) =>
  Number.isInteger(value) && value >= 1 ? Math.min(max, value) : fallback
const offsetOf = (value) => Number.isInteger(value) && value >= 0 ? value : 0

/** Newest first, then a window: { items, matched, offset, limit, hasMore }. */
const page = (items, limit, offset) => {
  const newestFirst = items.slice().reverse()
  const rows = newestFirst.slice(offset, offset + limit)
  return { matched: newestFirst.length, offset, limit, hasMore: offset + rows.length < newestFirst.length, items: rows }
}

const customerName = (state, customerId) => {
  const customer = state.customers.find((item) => item.id === customerId)
  return customer ? customer.name : customerId
}

const orderSummary = (state, order) => {
  const invoice = state.invoices.find((item) => item.orderId === order.id && item.state !== 'void')
  return {
    id: order.id,
    number: order.number,
    customerId: order.customerId,
    customerName: customerName(state, order.customerId),
    state: order.state,
    lineCount: order.lines.length,
    total: orderTotal(order),
    placedAt: order.placedAt,
    note: order.note,
    invoiceId: invoice ? invoice.id : null,
  }
}

const orderDetail = (state, order) => ({
  ...orderSummary(state, order),
  lines: order.lines.map((line) => {
    const product = state.products.find((item) => item.id === line.productId)
    return {
      productId: line.productId,
      sku: product ? product.sku : line.productId,
      name: product ? product.name : 'Unknown product',
      qty: line.qty,
      price: line.price,
      lineTotal: Math.round(line.qty * line.price * 100) / 100,
    }
  }),
})

const invoiceSummary = (state, invoice) => ({
  id: invoice.id,
  number: invoice.number,
  orderId: invoice.orderId,
  customerId: invoice.customerId,
  customerName: customerName(state, invoice.customerId),
  state: invoice.state,
  total: invoice.total,
  balance: invoiceBalance(invoice),
  issuedAt: invoice.issuedAt,
  dueAt: invoice.dueAt,
  paymentCount: invoice.payments.length,
})

const invoiceDetail = (state, invoice) => ({ ...invoiceSummary(state, invoice), payments: invoice.payments })

/** Keep an action result under the 64 KB result budget by dropping the oldest rows. */
const fitRows = (rows, build) => {
  let kept = rows
  while (kept.length > 0 && new TextEncoder().encode(JSON.stringify(build(kept))).byteLength > 60000) {
    kept = kept.slice(0, Math.max(1, Math.floor(kept.length * 0.8)))
    if (kept.length === 1) break
  }
  return { ...build(kept), truncated: kept.length < rows.length }
}

const mutate = async (transform) => commit(transform)

/** Run a transform that returns { state, <record> } and hand back the record. */
const create = async (transform) => {
  let record = null
  await commit((state) => {
    const outcome = transform(state)
    record = outcome.record
    return outcome.state
  })
  return record
}

export const actions = {
  company_snapshot: async () => companySnapshot(await ensureState()),
  list_products: async ({ category, limit }) => {
    const state = await ensureState()
    const items = state.products.filter((product) => !product.archived && (!category || product.category === category))
    const rows = items.slice(0, bounded(limit, 50, 100))
    return { matched: items.length, limit: rows.length, products: rows }
  },
  list_customers: async ({ limit }) => {
    const state = await ensureState()
    const rows = state.customers.slice(0, bounded(limit, 50, 100))
    return {
      matched: state.customers.length,
      customers: rows.map((customer) => ({
        ...customer,
        openBalance: openBalance(state, customer.id),
        exposure: creditExposure(state, customer.id),
      })),
    }
  },
  list_orders: async ({ state: orderState, limit, offset }) => {
    const state = await ensureState()
    const matches = state.orders.filter((order) => !orderState || order.state === orderState)
    const { items, ...meta } = page(matches, bounded(limit, 20, 50), offsetOf(offset))
    return { ...meta, orders: items.map((order) => orderSummary(state, order)) }
  },
  get_order: async ({ order_id }) => {
    const state = await ensureState()
    return orderDetail(state, orderById(state, order_id))
  },
  list_invoices: async ({ state: invoiceState, limit, offset }) => {
    const state = await ensureState()
    const matches = state.invoices.filter((invoice) => !invoiceState || invoice.state === invoiceState)
    const { items, ...meta } = page(matches, bounded(limit, 20, 100), offsetOf(offset))
    return { ...meta, invoices: items.map((invoice) => invoiceSummary(state, invoice)) }
  },
  get_invoice: async ({ invoice_id }) => {
    const state = await ensureState()
    return invoiceDetail(state, invoiceById(state, invoice_id))
  },
  low_stock_report: async () => lowStock(await ensureState()),
  inventory_valuation: async () => inventoryValuation(await ensureState()),
  receivables_aging: async () => arAging(await ensureState(), undefined),
  sales_by_customer: async () => salesByCustomer(await ensureState()),
  revenue_by_category: async () => revenueByCategory(await ensureState()),
  audit_trail: async ({ limit }) => {
    const state = await ensureState()
    const rows = state.audit.slice(-bounded(limit, 40, 200)).reverse()
    return fitRows(rows, (kept) => ({ total: state.audit.length, returned: kept.length, rows: kept }))
  },
  create_product: async (input) =>
    create((state) => {
      const outcome = createProduct(state, input)
      return { state: outcome.state, record: outcome.product }
    }),
  receive_stock: async ({ product_id, qty }) =>
    companySnapshot(await mutate((state) => receiveStock(state, product_id, qty))),
  adjust_stock: async ({ product_id, delta, reason }) =>
    companySnapshot(await mutate((state) => adjustStock(state, product_id, delta, reason))),
  update_product: async ({ product_id, price, cost, reorder_point }) => {
    const next = await mutate((state) => updateProduct(state, product_id, { price, cost, reorderPoint: reorder_point }))
    return next.products.find((product) => product.id === product_id)
  },
  archive_product: async ({ product_id }) =>
    companySnapshot(await mutate((state) => archiveProduct(state, product_id))),
  create_customer: async ({ name, region, terms, credit_limit }) =>
    create((state) => {
      const outcome = createCustomer(state, { name, region, terms, creditLimit: credit_limit })
      return { state: outcome.state, record: outcome.customer }
    }),
  update_customer: async ({ customer_id, terms, credit_limit }) => {
    const next = await mutate((state) => updateCustomer(state, customer_id, { terms, creditLimit: credit_limit }))
    return customerById(next, customer_id)
  },
  set_credit_hold: async ({ customer_id, hold }) => {
    const next = await mutate((state) => setCreditHold(state, customer_id, hold))
    return customerById(next, customer_id)
  },
  create_order: async ({ customer_id, note }) =>
    create((state) => {
      const outcome = createOrder(state, customer_id, note)
      return { state: outcome.state, record: orderDetail(outcome.state, outcome.order) }
    }),
  add_order_line: async ({ order_id, product_id, qty }) => {
    const next = await mutate((state) => addOrderLine(state, order_id, product_id, qty, undefined))
    return orderDetail(next, orderById(next, order_id))
  },
  remove_order_line: async ({ order_id, product_id }) => {
    const next = await mutate((state) => removeOrderLine(state, order_id, product_id))
    return orderDetail(next, orderById(next, order_id))
  },
  allocate_order: async ({ order_id }) => {
    const next = await mutate((state) => allocateOrder(state, order_id))
    return orderDetail(next, orderById(next, order_id))
  },
  ship_order: async ({ order_id }) => {
    const next = await mutate((state) => shipOrder(state, order_id))
    return orderSummary(next, orderById(next, order_id))
  },
  deliver_order: async ({ order_id }) => {
    const next = await mutate((state) => deliverOrder(state, order_id))
    return orderSummary(next, orderById(next, order_id))
  },
  cancel_order: async ({ order_id, reason }) => {
    const next = await mutate((state) => cancelOrder(state, order_id, reason))
    return orderSummary(next, orderById(next, order_id))
  },
  issue_invoice: async ({ order_id }) =>
    create((state) => {
      const outcome = issueInvoice(state, order_id)
      return { state: outcome.state, record: invoiceDetail(outcome.state, outcome.invoice) }
    }),
  record_payment: async ({ invoice_id, amount, memo }) => {
    const next = await mutate((state) => recordPayment(state, invoice_id, amount, memo))
    return invoiceDetail(next, invoiceById(next, invoice_id))
  },
  void_invoice: async ({ invoice_id, reason }) => {
    const next = await mutate((state) => voidInvoice(state, invoice_id, reason))
    return invoiceSummary(next, invoiceById(next, invoice_id))
  },
  reset_company: async () =>
    companySnapshot(await replaceState(audited(seedState(), 'Reset to the seeded company'))),
}

export default function App({ inputs }) {
  const [state, setState] = useState(() => currentState())
  const [module, setModule] = useState('dashboard')
  const [note, setNote] = useState('')

  useEffect(() => {
    const unsubscribe = subscribe(setState)
    if (!currentState()) {
      loadState().catch((error) => {
        setNote('The company could not be loaded: ' + (error instanceof Error ? error.message : 'storage failed'))
      })
    }
    return unsubscribe
  }, [])

  const apply = (transform) => {
    setNote('')
    commit(transform).catch((error) => {
      setNote(error instanceof Error ? error.message : 'The change was refused')
    })
  }

  const inline = module === 'orders' || module === 'invoices'
  return <main className="erp-shell">
    <header className="erp-topbar">
      <h1 id="company-name">{String(inputs.company_name || 'Meridian Ops')}</h1>
      <nav aria-label="Modules">
        {MODULES.map(([key, label]) => <button
          key={key}
          id={'nav-' + key}
          type="button"
          aria-current={module === key ? 'page' : undefined}
          onClick={() => { setNote(''); setModule(key) }}
        >{label}</button>)}
      </nav>
    </header>
    {note && !inline ? <p id="erp-note" role="alert">{note}</p> : null}
    {!state ? <p id="erp-loading" className="loading">Loading the company…</p>
      : module === 'dashboard' ? <Dashboard state={state} go={setModule} />
      : module === 'inventory' ? <Inventory state={state} apply={apply} />
      : module === 'orders' ? <Orders state={state} apply={apply} note={note} />
      : module === 'customers' ? <Customers state={state} apply={apply} />
      : module === 'invoices' ? <Invoices state={state} apply={apply} note={note} />
      : module === 'reports' ? <Reports state={state} />
      : <Audit state={state} />}
  </main>
}
`

export const stylesSource = String.raw`
:root { color-scheme: light; font-family: "Seravek", "Gill Sans Nova", Ubuntu, Calibri, sans-serif; }
* { box-sizing: border-box; }
body { margin: 0; background: #f6f6f8; color: #1c1f2e; }
button, input, select { font: inherit; color: inherit; }
button { cursor: pointer; }
.erp-shell { min-height: 100vh; }
.erp-topbar { display: flex; align-items: center; gap: 28px; padding: 0 20px; border-bottom: 1px solid #e4e5ea; background: #ffffff; }
.erp-topbar h1 { margin: 0; padding: 14px 0; font-family: Georgia, serif; font-size: 20px; font-weight: 600; }
.erp-topbar nav { display: flex; align-self: stretch; gap: 2px; }
.erp-topbar nav button { position: relative; padding: 0 14px; border: 0; background: transparent; color: #5b5f70; font-size: 14px; font-weight: 600; }
.erp-topbar nav button:hover { color: #1c1f2e; }
.erp-topbar nav button[aria-current="page"] { color: #1c1f2e; }
.erp-topbar nav button[aria-current="page"]::after { content: ""; position: absolute; right: 10px; bottom: -2px; left: 10px; height: 2px; border-radius: 2px; background: #275e43; }
#erp-note, #order-note, #invoice-note { margin: 14px 20px 0; padding: 10px 14px; border: 1px solid #e6c2ba; border-radius: 8px; background: #f7e6e0; color: #6e2c21; font-size: 14px; }
.loading { margin: 0; padding: 18px 20px; color: #5b5f70; font-size: 14px; }
.module { display: grid; gap: 18px; padding: 18px 20px 40px; }
.module-split { grid-template-columns: minmax(0, 5fr) minmax(0, 7fr); align-items: start; }
.stat-row { display: grid; grid-template-columns: repeat(auto-fit, minmax(130px, 1fr)); gap: 10px; grid-column: 1 / -1; }
.stat { display: grid; gap: 2px; padding: 12px 14px; border: 1px solid #e4e5ea; border-radius: 10px; background: #ffffff; text-align: left; box-shadow: 0 1px 2px rgba(28, 31, 46, 0.04); }
.stat:hover { border-color: #c9cbd3; }
.stat strong { font-family: Georgia, serif; font-size: 22px; font-weight: 600; font-variant-numeric: tabular-nums; }
.stat span { color: #5b5f70; font-size: 12px; }
.stat.is-alert { border-color: #8c3a2c; background: #f7e6e0; }
.stat.is-alert strong { color: #8c3a2c; }
.panel { display: grid; gap: 10px; padding: 14px 16px 16px; border: 1px solid #e4e5ea; border-radius: 12px; background: #ffffff; min-width: 0; box-shadow: 0 1px 2px rgba(28, 31, 46, 0.04); }
.panel > header { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; border-bottom: 1px solid #e4e5ea; padding-bottom: 8px; }
.panel h2 { margin: 0; font-family: Georgia, serif; font-size: 16px; font-weight: 600; }
.panel > header span { color: #5b5f70; font-size: 12px; }
.table-scroll { overflow-x: auto; max-width: 100%; -webkit-overflow-scrolling: touch; }
table { width: 100%; border-collapse: collapse; font-size: 13px; }
th, td { padding: 7px 8px; border-bottom: 1px solid #ececf0; text-align: left; white-space: nowrap; }
th[scope="col"] { color: #5b5f70; font-size: 11px; font-weight: 700; letter-spacing: .04em; text-transform: uppercase; }
th[scope="row"] { font-weight: 600; }
.numeric { font-variant-numeric: tabular-nums; }
tr.is-low th, tr.is-low td { background: #fbf3ec; }
.is-alert-text { color: #8c3a2c; font-weight: 700; }
.is-muted { color: #5b5f70; }
.money { font-variant-numeric: tabular-nums; }
.table-empty { margin: 0; color: #5b5f70; font-size: 13px; }
.state-tag { padding: 2px 8px; border: 1px solid #d3d5dc; background: #f6f6f8; border-radius: 999px; font-size: 11px; font-weight: 700; }
.state-tag.is-draft { color: #5b5f70; }
.state-tag.is-allocated { border-color: #275e43; color: #275e43; }
.state-tag.is-shipped { border-color: #275e43; background: #275e43; color: #ffffff; }
.state-tag.is-delivered, .state-tag.is-paid { border-color: #275e43; background: #e2efe6; color: #275e43; }
.state-tag.is-cancelled, .state-tag.is-void { border-color: #8c3a2c; color: #8c3a2c; }
.state-tag.is-open { border-color: #7a5b20; color: #7a5b20; }
.inline-form { display: flex; flex-wrap: wrap; align-items: end; gap: 10px; }
.field { display: grid; gap: 4px; font-size: 12px; font-weight: 700; color: #5b5f70; }
.field input, .field select { min-height: 36px; min-width: 90px; padding: 5px 8px; border: 1px solid #c9cbd3; border-radius: 8px; background: #fff; font-size: 14px; font-weight: 400; color: #1c1f2e; }
.inline-form > button, .order-moves button, .row-actions button { min-height: 36px; padding: 5px 14px; border: 1px solid #275e43; border-radius: 8px; background: #275e43; color: #ffffff; font-size: 13px; font-weight: 700; }
.inline-form > button:hover, .order-moves button:hover, .row-actions button:hover { background: #1c4a33; }
button.is-quiet { border-color: #8c3a2c; background: transparent; color: #8c3a2c; }
button.is-quiet:hover { background: #f7e6e0; }
.row-actions { display: flex; gap: 6px; }
.row-actions input { width: 64px; min-height: 34px; padding: 4px 6px; border: 1px solid #c9cbd3; border-radius: 8px; }
.record-list { display: grid; gap: 4px; margin: 0; padding: 0; list-style: none; }
.record { display: grid; width: 100%; grid-template-columns: 1fr auto auto; align-items: center; gap: 10px; padding: 8px 10px; border: 1px solid transparent; border-radius: 8px; background: transparent; text-align: left; font-size: 13px; }
.record:hover { background: #f0f0f4; }
.record.is-selected { border-color: #e4e5ea; background: #f6f6f8; }
.order-state-line { margin: 0; font-size: 13px; }
.order-moves { display: flex; flex-wrap: wrap; gap: 8px; }
.audit-list { display: grid; gap: 6px; margin: 0; padding: 0; list-style: none; color: #3a3e4d; font-size: 13px; }
.audit-list span { color: #5b5f70; font-variant-numeric: tabular-nums; }
.audit-list.is-full { max-height: 30rem; overflow-y: auto; }
button:focus-visible, input:focus-visible, select:focus-visible { outline: 3px solid #8c3a2c; outline-offset: 2px; }
@media (max-width: 900px) {
  .module-split { grid-template-columns: 1fr; }
  .erp-topbar { flex-wrap: wrap; padding-bottom: 8px; }
  .erp-topbar nav { width: 100%; overflow-x: auto; }
  .erp-topbar nav button { flex: 0 0 auto; }
}
`
