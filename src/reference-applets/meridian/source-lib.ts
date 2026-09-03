/** Applet-side library source for the Meridian Ops ERP reference applet. */

export const modelSource = String.raw`
export const TERMS = ['prepaid', 'net15', 'net30']
export const ORDER_STATES = ['draft', 'allocated', 'shipped', 'delivered', 'cancelled']
export const INVOICE_STATES = ['open', 'paid', 'void']
export const CATEGORIES = ['hardware', 'consumables', 'services', 'apparel']

/**
 * Storage layout. Each collection is stored in fixed-size pages under keys
 * such as "orders.3", so one page always fits the 64 KB per-value budget and
 * a change rewrites only the pages whose content moved (see persist.ts).
 *
 * Worst case per record, with every string at its length cap, every character
 * costing 3 UTF-8 bytes (the most one UTF-16 code unit can cost once control
 * characters are stripped, and quotes escape to 2), and every number at its
 * widest (money <= 100,000,000.00, units <= 10,000,000, totals <= 1e16):
 *   product    structure + 3 x (20+24+80+11) string chars + numbers =   537 B x 100/page = 53,801 B
 *   customer   structure + 3 x (20+80+40+7) + numbers               =   508 B x 100/page = 50,901 B
 *   order      structure + 3 x (20+16+20+9+160+30) + 24 lines       = 3,517 B x  15/page = 52,771 B
 *   invoice    structure + 3 x (20+16+20+20+5+30+30) + 12 payments  = 5,061 B x  10/page = 50,621 B
 *   audit row  structure + 3 x (30+200)                             =   710 B x  80/page = 56,881 B
 * meridian/limits.test.ts builds those maximal pages and asserts the exact
 * figures and the 64,000-byte limit. Pages in use: 2 + 2 + 20 + 20 + 5, plus
 * "seq" = 50 keys of the 128 allowed.
 */
export const LIMITS = {
  products: { pageSize: 100, pages: 2 },
  customers: { pageSize: 100, pages: 2 },
  orders: { pageSize: 15, pages: 20 },
  invoices: { pageSize: 10, pages: 20 },
  audit: { pageSize: 80, pages: 5 },
}
export const capOf = (name) => LIMITS[name].pageSize * LIMITS[name].pages
export const MAX_LINES = 24
export const MAX_PAYMENTS = 12
export const MAX_MONEY = 100000000
export const MAX_UNITS = 10000000
export const MAX_TOTAL = 10000000000000000

const CONTROL = /[\u0000-\u001f\u007f]/g
const str = (value, max) => typeof value === 'string' ? value.replace(CONTROL, '').slice(0, max) : ''
const num = (value, fallback, max) =>
  typeof value === 'number' && Number.isFinite(value)
    ? Math.min(max, Math.max(0, Math.round(value * 100) / 100))
    : fallback
const int = (value, fallback, max) =>
  Number.isInteger(value) ? Math.min(max, Math.max(0, value)) : fallback
const oneOf = (value, options, fallback) => options.includes(value) ? value : fallback

export const isStocked = (category) => category !== 'services'

export const cleanProduct = (raw) => {
  if (!raw || typeof raw !== 'object') return null
  const id = str(raw.id, 20)
  if (!id) return null
  const category = oneOf(raw.category, CATEGORIES, 'hardware')
  const tracked = typeof raw.tracked === 'boolean' ? raw.tracked : isStocked(category)
  return {
    id,
    sku: str(raw.sku, 24) || id.toUpperCase(),
    name: str(raw.name, 80) || 'Unnamed product',
    category,
    price: num(raw.price, 0, MAX_MONEY),
    cost: num(raw.cost, 0, MAX_MONEY),
    stock: tracked ? int(raw.stock, 0, MAX_UNITS) : 0,
    reorderPoint: tracked ? int(raw.reorderPoint, 0, MAX_UNITS) : 0,
    archived: raw.archived === true,
    tracked,
  }
}

export const cleanCustomer = (raw) => {
  if (!raw || typeof raw !== 'object') return null
  const id = str(raw.id, 20)
  if (!id) return null
  return {
    id,
    name: str(raw.name, 80) || 'Unnamed customer',
    region: str(raw.region, 40) || 'unassigned',
    terms: oneOf(raw.terms, TERMS, 'net30'),
    creditLimit: num(raw.creditLimit, 0, MAX_MONEY),
    hold: raw.hold === true,
  }
}

export const cleanLine = (raw) => {
  if (!raw || typeof raw !== 'object') return null
  const productId = str(raw.productId, 20)
  const qty = int(raw.qty, 0, MAX_UNITS)
  if (!productId || qty < 1) return null
  return { productId, qty, price: num(raw.price, 0, MAX_MONEY) }
}

export const cleanOrder = (raw) => {
  if (!raw || typeof raw !== 'object') return null
  const id = str(raw.id, 20)
  if (!id) return null
  return {
    id,
    number: str(raw.number, 16) || id.toUpperCase(),
    customerId: str(raw.customerId, 20),
    state: oneOf(raw.state, ORDER_STATES, 'draft'),
    lines: (Array.isArray(raw.lines) ? raw.lines : []).map(cleanLine).filter(Boolean).slice(0, MAX_LINES),
    note: str(raw.note, 160),
    placedAt: str(raw.placedAt, 30),
  }
}

export const cleanPayment = (raw) => {
  if (!raw || typeof raw !== 'object') return null
  return { amount: num(raw.amount, 0, MAX_TOTAL), at: str(raw.at, 30), memo: str(raw.memo, 80) }
}

export const cleanInvoice = (raw) => {
  if (!raw || typeof raw !== 'object') return null
  const id = str(raw.id, 20)
  if (!id) return null
  return {
    id,
    number: str(raw.number, 16) || id.toUpperCase(),
    orderId: str(raw.orderId, 20),
    customerId: str(raw.customerId, 20),
    total: num(raw.total, 0, MAX_TOTAL),
    state: oneOf(raw.state, INVOICE_STATES, 'open'),
    issuedAt: str(raw.issuedAt, 30),
    dueAt: str(raw.dueAt, 30),
    payments: (Array.isArray(raw.payments) ? raw.payments : []).map(cleanPayment).filter(Boolean).slice(0, MAX_PAYMENTS),
  }
}

export const cleanAuditRow = (raw) =>
  raw && typeof raw === 'object' ? { at: str(raw.at, 30), entry: str(raw.entry, 200) } : null

const collection = (raw, clean, max) =>
  (Array.isArray(raw) ? raw : []).map(clean).filter(Boolean).slice(0, max)

export const cleanState = (raw) => {
  const value = raw && typeof raw === 'object' ? raw : {}
  const seq = value.seq && typeof value.seq === 'object' ? value.seq : {}
  return {
    products: collection(value.products, cleanProduct, capOf('products')),
    customers: collection(value.customers, cleanCustomer, capOf('customers')),
    orders: collection(value.orders, cleanOrder, capOf('orders')),
    invoices: collection(value.invoices, cleanInvoice, capOf('invoices')),
    audit: collection(value.audit, cleanAuditRow, Infinity).slice(-capOf('audit')),
    seq: {
      order: int(seq.order, 1000, MAX_UNITS),
      invoice: int(seq.invoice, 5000, MAX_UNITS),
      product: int(seq.product, 100, MAX_UNITS),
      customer: int(seq.customer, 100, MAX_UNITS),
    },
  }
}

/**
 * The seeded company: a catalog with one shortfall (INK-CY), three customers,
 * two delivered and invoiced orders (one invoice overdue and unpaid, one
 * partially paid) so the ledger and reports render on first run, and the
 * SO-1000 draft that the behavioral suite walks through order-to-cash.
 */
export const seedState = () => cleanState({
  products: [
    { id: 'p100', sku: 'CBL-2M', name: 'Braided cable 2 m', category: 'hardware', price: 14, cost: 5, stock: 140, reorderPoint: 40 },
    { id: 'p101', sku: 'HUB-8P', name: '8-port desk hub', category: 'hardware', price: 89, cost: 41, stock: 32, reorderPoint: 15 },
    { id: 'p102', sku: 'INK-CY', name: 'Cyan ink pack', category: 'consumables', price: 22, cost: 9, stock: 12, reorderPoint: 20 },
    { id: 'p103', sku: 'TEE-NV', name: 'Navy crew tee', category: 'apparel', price: 28, cost: 11, stock: 76, reorderPoint: 25 },
    { id: 'p104', sku: 'SRV-1H', name: 'Bench service hour', category: 'services', price: 120, cost: 0, stock: 0, reorderPoint: 0, tracked: false },
  ],
  customers: [
    { id: 'c100', name: 'Harbor Lab Supply', region: 'east', terms: 'net30', creditLimit: 5000 },
    { id: 'c101', name: 'Foundry North', region: 'west', terms: 'net15', creditLimit: 2500 },
    { id: 'c102', name: 'Quill & Card', region: 'east', terms: 'prepaid', creditLimit: 0 },
  ],
  orders: [
    {
      id: 'o998', number: 'SO-998', customerId: 'c101', state: 'delivered', placedAt: '2026-07-14T10:30:00Z',
      lines: [{ productId: 'p103', qty: 20, price: 28 }, { productId: 'p102', qty: 5, price: 22 }],
      note: 'Summer apparel run',
    },
    {
      id: 'o999', number: 'SO-999', customerId: 'c100', state: 'delivered', placedAt: '2026-08-12T15:10:00Z',
      lines: [{ productId: 'p101', qty: 2, price: 89 }, { productId: 'p104', qty: 3, price: 120 }],
      note: 'Bench install with service hours',
    },
    {
      id: 'o1000', number: 'SO-1000', customerId: 'c100', state: 'draft', placedAt: '2026-08-24T09:00:00Z',
      lines: [{ productId: 'p101', qty: 4, price: 89 }, { productId: 'p100', qty: 10, price: 14 }],
      note: 'September restock',
    },
  ],
  invoices: [
    {
      id: 'i5000', number: 'INV-5000', orderId: 'o998', customerId: 'c101', total: 670, state: 'open',
      issuedAt: '2026-07-20T09:00:00Z', dueAt: '2026-08-04T09:00:00Z', payments: [],
    },
    {
      id: 'i5001', number: 'INV-5001', orderId: 'o999', customerId: 'c100', total: 538, state: 'open',
      issuedAt: '2026-08-20T09:00:00Z', dueAt: '2026-09-19T09:00:00Z',
      payments: [{ amount: 200, at: '2026-08-26T14:00:00Z', memo: 'Deposit on account' }],
    },
  ],
  audit: [
    { at: '2026-07-14T10:30:00Z', entry: 'Workspace seeded with catalog and customers' },
    { at: '2026-07-20T09:00:00Z', entry: 'Delivered SO-998 and issued INV-5000 for 670' },
    { at: '2026-08-20T09:00:00Z', entry: 'Delivered SO-999 and issued INV-5001 for 538' },
    { at: '2026-08-26T14:00:00Z', entry: 'Recorded 200 against INV-5001' },
    { at: '2026-08-24T09:00:00Z', entry: 'Opened SO-1000 for Harbor Lab Supply' },
  ],
  seq: { order: 1001, invoice: 5002, product: 105, customer: 103 },
})
`

export const formatSource = String.raw`
export const money = (value) => {
  const amount = Math.round(value * 100) / 100
  return (amount < 0 ? '-$' : '$') + Math.abs(amount).toFixed(2)
}

export const shortDate = (iso) => {
  if (!iso) return '—'
  const parsed = new Date(iso)
  return Number.isNaN(parsed.getTime())
    ? '—'
    : parsed.toLocaleDateString('en', { month: 'short', day: 'numeric' })
}

export const nowIso = () => new Date().toISOString()

export const addDays = (iso, days) => {
  const base = new Date(iso)
  base.setDate(base.getDate() + days)
  return base.toISOString()
}
`

export const logicSource = String.raw`
import {
  CATEGORIES, LIMITS, MAX_LINES, MAX_MONEY, MAX_UNITS, TERMS, capOf, cleanLine, cleanState, isStocked,
} from './model'
import { addDays, nowIso } from './format'

const AUDIT_CAP = capOf('audit')
const AUDIT_PAGE = LIMITS.audit.pageSize

const fail = (message) => { throw new Error(message) }

export const requireInt = (value, label, min, max) => {
  if (!Number.isInteger(value)) fail(label + ' must be a whole number; got ' + String(value))
  if (value < min) fail(label + ' must be at least ' + min)
  if (value > (max === undefined ? MAX_UNITS : max)) fail(label + ' cannot exceed ' + (max === undefined ? MAX_UNITS : max))
  return value
}

export const requireMoney = (value, label, max) => {
  if (typeof value !== 'number' || !Number.isFinite(value)) fail(label + ' must be a number')
  if (value < 0) fail(label + ' cannot be negative')
  const limit = max === undefined ? MAX_MONEY : max
  if (value > limit) fail(label + ' cannot exceed ' + limit)
  return Math.round(value * 100) / 100
}

const requireText = (value, label, max) => {
  const text = typeof value === 'string' ? value.trim().slice(0, max) : ''
  if (!text) fail(label + ' is required')
  return text
}

export const audited = (state, entry) => {
  const audit = [...state.audit, { at: nowIso(), entry: String(entry).slice(0, 200) }]
  // Trim one storage page at a time so a full trail rewrites its pages once
  // per page of new rows instead of on every append.
  return {
    ...state,
    audit: audit.length > AUDIT_CAP ? audit.slice(audit.length - (AUDIT_CAP - AUDIT_PAGE)) : audit,
  }
}

export const productById = (state, productId) =>
  state.products.find((item) => item.id === productId) || fail('No product has id ' + productId)

export const customerById = (state, customerId) =>
  state.customers.find((item) => item.id === customerId) || fail('No customer has id ' + customerId)

export const orderById = (state, orderId) =>
  state.orders.find((item) => item.id === orderId) || fail('No order has id ' + orderId)

export const invoiceById = (state, invoiceId) =>
  state.invoices.find((item) => item.id === invoiceId) || fail('No invoice has id ' + invoiceId)

const replaceProduct = (state, next) => ({
  ...state,
  products: state.products.map((item) => item.id === next.id ? next : item),
})

const replaceCustomer = (state, next) => ({
  ...state,
  customers: state.customers.map((item) => item.id === next.id ? next : item),
})

const replaceOrder = (state, next) => ({
  ...state,
  orders: state.orders.map((item) => item.id === next.id ? next : item),
})

const replaceInvoice = (state, next) => ({
  ...state,
  invoices: state.invoices.map((item) => item.id === next.id ? next : item),
})

const requireRoom = (state, name, label) => {
  if (state[name].length >= capOf(name)) fail('The company already holds ' + capOf(name) + ' ' + label)
}

export const createProduct = (state, input) => {
  requireRoom(state, 'products', 'products')
  if (!CATEGORIES.includes(input.category)) fail('Category must be one of ' + CATEGORIES.join(', '))
  const id = 'p' + state.seq.product
  const tracked = isStocked(input.category)
  const product = {
    id,
    sku: String(input.sku || id.toUpperCase()).slice(0, 24),
    name: requireText(input.name, 'Product name', 80),
    category: input.category,
    price: requireMoney(input.price, 'Price'),
    cost: requireMoney(input.cost === undefined ? 0 : input.cost, 'Cost'),
    stock: tracked ? requireInt(input.stock === undefined ? 0 : input.stock, 'Opening stock', 0) : 0,
    reorderPoint: tracked ? requireInt(input.reorderPoint === undefined ? 0 : input.reorderPoint, 'Reorder point', 0) : 0,
    archived: false,
    tracked,
  }
  const next = cleanState({
    ...state,
    products: [...state.products, product],
    seq: { ...state.seq, product: state.seq.product + 1 },
  })
  return { state: audited(next, 'Created product ' + product.sku + ' (' + product.category + ')'), product }
}

const requireStocked = (product, verb) => {
  if (!product.tracked) fail(product.sku + ' is a ' + product.category + ' item with no stock to ' + verb)
}

export const receiveStock = (state, productId, qty) => {
  const product = productById(state, productId)
  requireStocked(product, 'receive')
  const units = requireInt(qty, 'Quantity', 1)
  if (product.stock + units > MAX_UNITS) fail(product.sku + ' cannot hold more than ' + MAX_UNITS + ' units')
  const next = replaceProduct(state, { ...product, stock: product.stock + units })
  return audited(next, 'Received ' + units + ' × ' + product.sku + ' (now ' + (product.stock + units) + ')')
}

export const adjustStock = (state, productId, delta, reason) => {
  const product = productById(state, productId)
  requireStocked(product, 'adjust')
  const change = requireInt(delta, 'Adjustment', -MAX_UNITS)
  const stock = product.stock + change
  if (stock < 0) fail('An adjustment cannot take ' + product.sku + ' below zero')
  if (stock > MAX_UNITS) fail(product.sku + ' cannot hold more than ' + MAX_UNITS + ' units')
  const why = requireText(reason, 'A stock adjustment reason', 160)
  const next = replaceProduct(state, { ...product, stock })
  return audited(next, 'Adjusted ' + product.sku + ' by ' + change + ' to ' + stock + ': ' + why)
}

export const updateProduct = (state, productId, changes) => {
  const product = productById(state, productId)
  const notes = []
  let next = { ...product }
  if (changes.price !== undefined) {
    next.price = requireMoney(changes.price, 'Price')
    notes.push('price ' + next.price)
  }
  if (changes.cost !== undefined) {
    next.cost = requireMoney(changes.cost, 'Cost')
    notes.push('cost ' + next.cost)
  }
  if (changes.reorderPoint !== undefined) {
    requireStocked(product, 'reorder')
    next.reorderPoint = requireInt(changes.reorderPoint, 'Reorder point', 0)
    notes.push('reorder point ' + next.reorderPoint)
  }
  if (notes.length === 0) fail('Give a price, cost, or reorder point to change')
  return audited(replaceProduct(state, next), 'Updated ' + product.sku + ': ' + notes.join(', '))
}

export const archiveProduct = (state, productId) => {
  const product = productById(state, productId)
  if (product.archived) fail(product.sku + ' is already archived')
  const open = state.orders.some((order) =>
    order.state !== 'cancelled' && order.state !== 'delivered' &&
    order.lines.some((line) => line.productId === productId))
  if (open) fail(product.sku + ' is on an open order and cannot be archived')
  return audited(replaceProduct(state, { ...product, archived: true }), 'Archived ' + product.sku)
}

export const createCustomer = (state, input) => {
  requireRoom(state, 'customers', 'customers')
  if (!TERMS.includes(input.terms)) fail('Terms must be one of ' + TERMS.join(', '))
  const id = 'c' + state.seq.customer
  const customer = {
    id,
    name: requireText(input.name, 'Customer name', 80),
    region: String(input.region || 'unassigned').slice(0, 40),
    terms: input.terms,
    creditLimit: requireMoney(input.creditLimit === undefined ? 0 : input.creditLimit, 'Credit limit'),
    hold: false,
  }
  const next = cleanState({
    ...state,
    customers: [...state.customers, customer],
    seq: { ...state.seq, customer: state.seq.customer + 1 },
  })
  return { state: audited(next, 'Created customer ' + customer.name + ' on ' + customer.terms), customer }
}

export const updateCustomer = (state, customerId, changes) => {
  const customer = customerById(state, customerId)
  const notes = []
  let next = { ...customer }
  if (changes.terms !== undefined) {
    if (!TERMS.includes(changes.terms)) fail('Terms must be one of ' + TERMS.join(', '))
    next.terms = changes.terms
    notes.push('terms ' + next.terms)
  }
  if (changes.creditLimit !== undefined) {
    next.creditLimit = requireMoney(changes.creditLimit, 'Credit limit')
    notes.push('credit limit ' + next.creditLimit)
  }
  if (notes.length === 0) fail('Give terms or a credit limit to change')
  return audited(replaceCustomer(state, next), customer.name + ': ' + notes.join(', '))
}

/** Idempotent: setting the hold a customer already has changes nothing. */
export const setCreditHold = (state, customerId, hold) => {
  const customer = customerById(state, customerId)
  if (typeof hold !== 'boolean') fail('hold must be true or false')
  if (customer.hold === hold) return state
  const next = replaceCustomer(state, { ...customer, hold })
  return audited(next, customer.name + (hold ? ' placed on credit hold' : ' released from credit hold'))
}

export const orderTotal = (order) =>
  Math.round(order.lines.reduce((total, line) => total + line.qty * line.price, 0) * 100) / 100

export const invoiceBalance = (invoice) =>
  Math.round((invoice.total - invoice.payments.reduce((total, payment) => total + payment.amount, 0)) * 100) / 100

export const openBalance = (state, customerId) =>
  Math.round(state.invoices
    .filter((invoice) => invoice.customerId === customerId && invoice.state === 'open')
    .reduce((total, invoice) => total + invoiceBalance(invoice), 0) * 100) / 100

export const isInvoiced = (state, orderId) =>
  state.invoices.some((invoice) => invoice.orderId === orderId && invoice.state !== 'void')

/** Committed orders (allocated, shipped, or delivered) that have not been invoiced yet. */
export const uninvoicedExposure = (state, customerId) =>
  Math.round(state.orders
    .filter((order) =>
      order.customerId === customerId &&
      (order.state === 'allocated' || order.state === 'shipped' || order.state === 'delivered') &&
      !isInvoiced(state, order.id))
    .reduce((total, order) => total + orderTotal(order), 0) * 100) / 100

/** Everything a customer owes or has committed to: open invoice balances plus uninvoiced orders. */
export const creditExposure = (state, customerId) =>
  Math.round((openBalance(state, customerId) + uninvoicedExposure(state, customerId)) * 100) / 100

export const createOrder = (state, customerId, note) => {
  requireRoom(state, 'orders', 'orders')
  const customer = customerById(state, customerId)
  if (customer.hold) fail(customer.name + ' is on credit hold; release it first')
  const id = 'o' + state.seq.order
  const order = {
    id, number: 'SO-' + state.seq.order, customerId, state: 'draft',
    lines: [], note: String(note || '').slice(0, 160), placedAt: nowIso(),
  }
  const next = cleanState({
    ...state,
    orders: [...state.orders, order],
    seq: { ...state.seq, order: state.seq.order + 1 },
  })
  return { state: audited(next, 'Opened ' + order.number + ' for ' + customer.name), order }
}

export const addOrderLine = (state, orderId, productId, qty, price) => {
  const order = orderById(state, orderId)
  if (order.state !== 'draft') fail(order.number + ' is ' + order.state + '; only drafts take lines')
  const product = productById(state, productId)
  if (product.archived) fail(product.sku + ' is archived')
  const units = requireInt(qty, 'Quantity', 1)
  const existing = order.lines.find((item) => item.productId === productId)
  if (!existing && order.lines.length >= MAX_LINES) fail(order.number + ' already has ' + MAX_LINES + ' lines')
  const line = cleanLine({
    productId,
    qty: (existing ? existing.qty : 0) + units,
    price: price === undefined ? product.price : requireMoney(price, 'Price'),
  })
  if (!line) fail('The order line is invalid')
  const lines = existing
    ? order.lines.map((item) => item.productId === productId ? line : item)
    : [...order.lines, line]
  const next = replaceOrder(state, { ...order, lines })
  return audited(next, 'Added ' + units + ' × ' + product.sku + ' to ' + order.number)
}

export const removeOrderLine = (state, orderId, productId) => {
  const order = orderById(state, orderId)
  if (order.state !== 'draft') fail(order.number + ' is ' + order.state + '; only drafts change')
  if (!order.lines.some((line) => line.productId === productId)) fail(order.number + ' has no line for ' + productId)
  const next = replaceOrder(state, {
    ...order,
    lines: order.lines.filter((line) => line.productId !== productId),
  })
  return audited(next, 'Removed ' + productId + ' from ' + order.number)
}

export const allocateOrder = (state, orderId) => {
  const order = orderById(state, orderId)
  if (order.state !== 'draft') fail(order.number + ' is already ' + order.state)
  if (order.lines.length === 0) fail(order.number + ' has no lines to allocate')
  const customer = customerById(state, order.customerId)
  if (customer.hold) fail(customer.name + ' is on credit hold')
  const exposure = Math.round((creditExposure(state, customer.id) + orderTotal(order)) * 100) / 100
  if (customer.terms !== 'prepaid' && customer.creditLimit > 0 && exposure > customer.creditLimit) {
    fail(order.number + ' would take ' + customer.name + ' to ' + exposure + ' against a ' + customer.creditLimit + ' limit')
  }
  const short = order.lines.find((line) => {
    const product = productById(state, line.productId)
    return product.tracked && product.stock < line.qty
  })
  if (short) {
    const product = productById(state, short.productId)
    fail('Only ' + product.stock + ' × ' + product.sku + ' in stock; ' + short.qty + ' needed')
  }
  let next = state
  for (const line of order.lines) {
    const product = productById(next, line.productId)
    if (!product.tracked) continue
    next = replaceProduct(next, { ...product, stock: product.stock - line.qty })
  }
  next = replaceOrder(next, { ...order, state: 'allocated' })
  return audited(next, 'Allocated ' + order.number + ' and reserved stock')
}

export const shipOrder = (state, orderId) => {
  const order = orderById(state, orderId)
  if (order.state !== 'allocated') fail(order.number + ' must be allocated before shipping; it is ' + order.state)
  return audited(replaceOrder(state, { ...order, state: 'shipped' }), 'Shipped ' + order.number)
}

export const deliverOrder = (state, orderId) => {
  const order = orderById(state, orderId)
  if (order.state !== 'shipped') fail(order.number + ' must be shipped before delivery; it is ' + order.state)
  return audited(replaceOrder(state, { ...order, state: 'delivered' }), 'Delivered ' + order.number)
}

export const cancelOrder = (state, orderId, reason) => {
  const order = orderById(state, orderId)
  if (order.state === 'delivered') fail(order.number + ' is delivered and cannot be cancelled')
  if (order.state === 'cancelled') fail(order.number + ' is already cancelled')
  const why = requireText(reason, 'A cancellation reason', 160)
  let next = state
  if (order.state === 'allocated' || order.state === 'shipped') {
    for (const line of order.lines) {
      const product = productById(next, line.productId)
      if (!product.tracked) continue
      next = replaceProduct(next, { ...product, stock: Math.min(MAX_UNITS, product.stock + line.qty) })
    }
  }
  next = replaceOrder(next, { ...order, state: 'cancelled' })
  return audited(next, 'Cancelled ' + order.number + ': ' + why)
}

export const issueInvoice = (state, orderId) => {
  requireRoom(state, 'invoices', 'invoices')
  const order = orderById(state, orderId)
  if (order.state !== 'delivered') fail(order.number + ' must be delivered before invoicing')
  if (isInvoiced(state, orderId)) fail(order.number + ' already has an invoice')
  const customer = customerById(state, order.customerId)
  const issuedAt = nowIso()
  const dueDays = customer.terms === 'net30' ? 30 : customer.terms === 'net15' ? 15 : 0
  const invoice = {
    id: 'i' + state.seq.invoice,
    number: 'INV-' + state.seq.invoice,
    orderId,
    customerId: customer.id,
    total: orderTotal(order),
    state: 'open',
    issuedAt,
    dueAt: addDays(issuedAt, dueDays),
    payments: [],
  }
  const next = cleanState({
    ...state,
    invoices: [...state.invoices, invoice],
    seq: { ...state.seq, invoice: state.seq.invoice + 1 },
  })
  return { state: audited(next, 'Issued ' + invoice.number + ' for ' + invoice.total + ' due ' + invoice.dueAt.slice(0, 10)), invoice }
}

export const recordPayment = (state, invoiceId, amount, memo) => {
  const invoice = invoiceById(state, invoiceId)
  if (invoice.state !== 'open') fail(invoice.number + ' is ' + invoice.state)
  const paid = requireMoney(amount, 'A payment', invoice.total)
  if (paid <= 0) fail('A payment must be positive')
  const balance = invoiceBalance(invoice)
  if (paid > balance) fail(invoice.number + ' has only ' + balance + ' outstanding')
  if (invoice.payments.length >= 12) fail(invoice.number + ' already has 12 payments; settle the balance in one')
  const payments = [...invoice.payments, { amount: paid, at: nowIso(), memo: String(memo || '').slice(0, 80) }]
  const settled = Math.round((invoice.total - payments.reduce((total, payment) => total + payment.amount, 0)) * 100) / 100
  const next = replaceInvoice(state, { ...invoice, payments, state: settled <= 0 ? 'paid' : 'open' })
  return audited(next, 'Recorded ' + paid + ' against ' + invoice.number + (settled <= 0 ? ' (paid in full)' : ' (' + settled + ' open)'))
}

export const voidInvoice = (state, invoiceId, reason) => {
  const invoice = invoiceById(state, invoiceId)
  if (invoice.state === 'paid') fail(invoice.number + ' is paid and cannot be voided')
  if (invoice.state === 'void') fail(invoice.number + ' is already void')
  const why = requireText(reason, 'A void reason', 160)
  const next = replaceInvoice(state, { ...invoice, state: 'void' })
  return audited(next, 'Voided ' + invoice.number + ': ' + why)
}
`

export const reportsSource = String.raw`
import { invoiceBalance, orderTotal } from './logic'

/** Value tracked stock at unit cost; services and other untracked items hold no stock. */
export const inventoryValuation = (state) => {
  const rows = state.products
    .filter((product) => !product.archived && product.tracked)
    .map((product) => ({
      productId: product.id,
      sku: product.sku,
      stock: product.stock,
      unitCost: product.cost,
      value: Math.round(product.stock * product.cost * 100) / 100,
    }))
  return { rows, total: Math.round(rows.reduce((total, row) => total + row.value, 0) * 100) / 100 }
}

export const lowStock = (state) =>
  state.products
    .filter((product) => !product.archived && product.tracked && product.reorderPoint > 0 && product.stock <= product.reorderPoint)
    .map((product) => ({
      productId: product.id,
      sku: product.sku,
      stock: product.stock,
      reorderPoint: product.reorderPoint,
      shortfall: product.reorderPoint - product.stock,
    }))

export const openOrders = (state) =>
  state.orders
    .filter((order) => order.state === 'draft' || order.state === 'allocated' || order.state === 'shipped')
    .map((order) => ({ id: order.id, number: order.number, state: order.state, total: orderTotal(order) }))

export const AGING_LABELS = ['current', '1-15', '16-30', '31+']

/** Days past due: <= 0 is current, 1-15, 16-30, and 31 or more days overdue. */
export const agingBucket = (overdueDays) =>
  overdueDays <= 0 ? 0 : overdueDays <= 15 ? 1 : overdueDays <= 30 ? 2 : 3

export const arAging = (state, atIso) => {
  const at = new Date(atIso || Date.now()).getTime()
  const buckets = AGING_LABELS.map((label) => ({ label, amount: 0, invoices: 0 }))
  for (const invoice of state.invoices) {
    if (invoice.state !== 'open') continue
    const balance = invoiceBalance(invoice)
    if (balance <= 0) continue
    const due = new Date(invoice.dueAt).getTime()
    const overdueDays = Number.isNaN(due) ? 0 : Math.floor((at - due) / 86400000)
    const bucket = buckets[agingBucket(overdueDays)]
    bucket.amount = Math.round((bucket.amount + balance) * 100) / 100
    bucket.invoices += 1
  }
  return buckets
}

export const salesByCustomer = (state) => {
  const totals = new Map()
  for (const invoice of state.invoices) {
    if (invoice.state === 'void') continue
    totals.set(invoice.customerId, (totals.get(invoice.customerId) || 0) + invoice.total)
  }
  return state.customers
    .map((customer) => ({
      customerId: customer.id,
      name: customer.name,
      region: customer.region,
      billed: Math.round((totals.get(customer.id) || 0) * 100) / 100,
    }))
    .sort((a, b) => b.billed - a.billed)
}

export const revenueByCategory = (state) => {
  const productById = new Map(state.products.map((product) => [product.id, product]))
  const deliveredTotals = new Map()
  for (const order of state.orders) {
    if (order.state !== 'delivered') continue
    for (const line of order.lines) {
      const product = productById.get(line.productId)
      if (!product) continue
      deliveredTotals.set(
        product.category,
        (deliveredTotals.get(product.category) || 0) + line.qty * line.price,
      )
    }
  }
  return [...deliveredTotals.entries()]
    .map(([category, revenue]) => ({ category, revenue: Math.round(revenue * 100) / 100 }))
    .sort((a, b) => b.revenue - a.revenue)
}

export const companySnapshot = (state) => ({
  products: state.products.filter((product) => !product.archived).length,
  customers: state.customers.length,
  openOrders: openOrders(state).length,
  lowStock: lowStock(state).length,
  openReceivables: Math.round(state.invoices
    .filter((invoice) => invoice.state === 'open')
    .reduce((total, invoice) => total + invoiceBalance(invoice), 0) * 100) / 100,
  inventoryValue: inventoryValuation(state).total,
})
`

export const persistSource = String.raw`
import { LIMITS, cleanState, seedState } from './model'

/**
 * Paged, change-tracked persistence over window.eevee.store.
 *
 * Every collection lives in fixed-size pages ("orders.0" ... "orders.19") plus
 * one "seq" key; page sizes are chosen in model.ts so a full page stays under
 * the 64 KB per-value limit. A commit computes the next state from the state
 * currently on screen, shows it immediately, then writes only the pages whose
 * JSON changed. Commits run one at a time, so two quick interactions always
 * see each other's result. If a write is refused, pages already written are
 * put back and the previous state is restored on screen.
 */
const COLLECTIONS = Object.keys(LIMITS)
const SEQ_KEY = 'seq'
const pageKey = (name, index) => name + '.' + index
const store = () => window.eevee.store

const listeners = new Set()
let current = null
let persisted = new Map()
let queue = Promise.resolve()

const notify = () => { for (const listener of listeners) listener(current) }

export const subscribe = (listener) => {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export const currentState = () => current

const entriesOf = (state) => {
  const entries = []
  for (const name of COLLECTIONS) {
    const { pageSize, pages } = LIMITS[name]
    for (let index = 0; index < pages; index += 1) {
      const value = state[name].slice(index * pageSize, (index + 1) * pageSize)
      entries.push({ key: pageKey(name, index), value, empty: '[]' })
    }
  }
  entries.push({ key: SEQ_KEY, value: state.seq, empty: 'null' })
  return entries.map((entry) => ({ ...entry, json: JSON.stringify(entry.value) }))
}

const assemble = (saved) => {
  const raw = { seq: saved[SEQ_KEY] }
  for (const name of COLLECTIONS) {
    raw[name] = []
    for (let index = 0; index < LIMITS[name].pages; index += 1) {
      const page = saved[pageKey(name, index)]
      if (Array.isArray(page)) raw[name].push(...page)
    }
  }
  return cleanState(raw)
}

/** The store cannot delete keys, so an unknown page is treated as empty. */
const knownJson = (entry) => persisted.has(entry.key) ? persisted.get(entry.key) : entry.empty

const writeChanged = async (next) => {
  const changed = entriesOf(next).filter((entry) => knownJson(entry) !== entry.json)
  const written = []
  try {
    for (const entry of changed) {
      await store().set(entry.key, entry.value)
      written.push(entry)
    }
  } catch (error) {
    for (const entry of written) {
      try {
        await store().set(entry.key, JSON.parse(knownJson(entry)))
      } catch {
        // Best effort: the failed page is reported; the restored screen is authoritative.
      }
    }
    throw error
  }
  for (const entry of written) persisted.set(entry.key, entry.json)
  return changed.map((entry) => entry.key)
}

const enqueue = (work) => {
  const run = queue.then(work)
  queue = run.catch(() => undefined)
  return run
}

const readPages = async () => {
  const saved = await store().all()
  const seeded = saved && typeof saved === 'object' && saved[SEQ_KEY] !== undefined && saved[SEQ_KEY] !== null
  persisted = new Map()
  if (seeded) {
    for (const [key, value] of Object.entries(saved)) persisted.set(key, JSON.stringify(value))
    current = assemble(saved)
    notify()
    return current
  }
  // Show the seeded company at once; its pages are written behind the same
  // queue, so a change made meanwhile waits for the seed to land.
  current = seedState()
  notify()
  await writeChanged(current)
  return current
}

/** Read every page once (on mount or after a restart) and seed the company when storage is empty. */
export const loadState = () => enqueue(readPages)

const latest = async () => current || readPages()

/** The state on screen, loading it first when nothing has been read yet. */
export const ensureState = () => current ? Promise.resolve(current) : loadState()

/**
 * Apply a change. The transform sees the latest state (never a stale read),
 * the screen updates before storage is written, and a refused write restores
 * the previous state and rejects with a message that says so.
 */
export const commit = (transform) =>
  enqueue(async () => {
    const base = await latest()
    const next = cleanState(transform(base))
    current = next
    notify()
    try {
      await writeChanged(next)
    } catch (error) {
      current = base
      notify()
      throw new Error(
        'Not saved: ' + (error instanceof Error ? error.message : 'storage refused the change') +
        '. The screen was restored to the last saved state.',
      )
    }
    return next
  })

/** Replace everything (reset): pages that become empty are cleared too. */
export const replaceState = (next) => commit(() => next)
`
