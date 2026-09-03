import type { CreateVersionInput } from '@/domain/applet'
import type { AppletActionDefinition } from '@/domain/applet-action'
import type { CreateEvaluationSuiteInput } from '@/domain/evaluation'
import type { InputField } from '@/domain/input'
import { formatSource, logicSource, modelSource, persistSource, reportsSource } from './source-lib'
import {
  auditScreenSource,
  customersSource,
  dashboardSource,
  inventorySource,
  invoicesSource,
  ordersSource,
  reportsScreenSource,
  uiSource,
} from './source-modules'
import { appShellSource, stylesSource } from './source-shell'

export const MERIDIAN_REFERENCE = {
  slug: 'meridian',
  name: 'Meridian Ops',
  description:
    'A seven-module ERP for a small operation: inventory, orders with a stock and credit gate, customers, invoicing with receivables aging, reports, and a 400-row audit trail.',
} as const

const text = (key: string, label: string, description: string, required: boolean, maxLength: number): InputField =>
  ({ key, label, description, kind: 'text', required, maxLength })

const money = (key: string, label: string, description: string, required = true): InputField =>
  ({ key, label, description, kind: 'number', required, minimum: 0, maximum: 100_000_000 })

type NumberField = Extract<InputField, { kind: 'number' }>
const units = (key: string, label: string, description: string, minimum: number, required = true): NumberField =>
  ({ key, label, description, kind: 'number', required, minimum, maximum: 10_000_000, step: 1 })

const choice = (key: string, label: string, description: string, options: readonly string[], required: boolean): InputField =>
  ({ key, label, description, kind: 'choice', required, options: options.map((value) => ({ value, label: value })) })

const CATEGORIES = ['hardware', 'consumables', 'services', 'apparel'] as const
const TERMS = ['prepaid', 'net15', 'net30'] as const
const ORDER_STATES = ['draft', 'allocated', 'shipped', 'delivered', 'cancelled'] as const
const INVOICE_STATES = ['open', 'paid', 'void'] as const

const read = (name: string, title: string, description: string, inputs: InputField[] = []): AppletActionDefinition => ({
  name, title, description, inputs, effects: ['state:read'], authority: 'automatic',
})

const write = (name: string, title: string, description: string, inputs: InputField[] = []): AppletActionDefinition => ({
  name, title, description, inputs, effects: ['state:read', 'state:write'], authority: 'human',
})

const productId = text('product_id', 'Product id', 'Stable id from list_products.', true, 20)
const customerId = text('customer_id', 'Customer id', 'Stable id from list_customers.', true, 20)
const orderId = text('order_id', 'Order id', 'Stable id from list_orders.', true, 20)
const invoiceId = text('invoice_id', 'Invoice id', 'Stable id from list_invoices.', true, 20)
const reason = text('reason', 'Reason', 'Why this change is right; recorded in the audit trail.', true, 160)
const limit = (fallback: number, maximum: number): NumberField =>
  ({ ...units('limit', 'Limit', `Rows to return; default ${fallback}, at most ${maximum}.`, 1, false), maximum })
const offset = units('offset', 'Offset', 'Rows to skip for paging; default 0.', 0, false)

const SNAPSHOT = 'Returns the company snapshot: product, customer, open-order, and low-stock counts, open receivables, and on-hand value.'

/**
 * 32 governed actions (13 automatic reads, 19 human-approved writes). The
 * runtime allows at most 32, so adding one means merging or retiring another.
 */
const actions: AppletActionDefinition[] = [
  read('company_snapshot', 'Company snapshot', SNAPSHOT),
  read('list_products', 'List products', 'Returns { matched, products } of active products, newest last, with sku, category, price, cost, stock, reorderPoint, and tracked (false for services, which hold no stock). Optional category filter.', [
    choice('category', 'Category', 'Only products in this category.', CATEGORIES, false),
    limit(50, 100),
  ]),
  read('list_customers', 'List customers', 'Returns { matched, customers } with terms, credit limit, hold flag, openBalance (open invoice balances), and exposure (open balances plus uninvoiced committed orders).', [limit(50, 100)]),
  read('list_orders', 'List orders', 'Returns { matched, offset, limit, hasMore, orders } newest first as summaries (number, customer, state, lineCount, total, invoiceId) without lines; use get_order for lines. Optional state filter and paging.', [
    choice('state', 'Order state', 'Only orders in this state.', ORDER_STATES, false),
    limit(20, 50),
    offset,
  ]),
  read('get_order', 'Get order', 'Returns one order with its lines (sku, name, qty, price, lineTotal), total, customer, state, and the id of its live invoice if any.', [orderId]),
  read('list_invoices', 'List invoices', 'Returns { matched, offset, limit, hasMore, invoices } newest first with total, balance, state, issued and due dates, and paymentCount; use get_invoice for the payment history. Optional state filter and paging.', [
    choice('state', 'Invoice state', 'Only invoices in this state.', INVOICE_STATES, false),
    limit(20, 100),
    offset,
  ]),
  read('get_invoice', 'Get invoice', 'Returns one invoice with its balance and full payment history (amount, at, memo).', [invoiceId]),
  read('low_stock_report', 'Low stock report', 'Returns tracked products at or below their reorder point with stock, reorderPoint, and shortfall.'),
  read('inventory_valuation', 'Inventory valuation', 'Returns { rows, total }: tracked, unarchived stock valued at unit cost per SKU. Services are excluded because they hold no stock.'),
  read('receivables_aging', 'Receivables aging', 'Returns four buckets of open invoice balances by days past due: current (not yet due), 1-15, 16-30, and 31+, each with amount and invoice count.'),
  read('sales_by_customer', 'Sales by customer', 'Returns billed totals (non-void invoices) per customer, highest first, with region.'),
  read('revenue_by_category', 'Revenue by category', 'Returns delivered order revenue grouped by product category, highest first.'),
  read('audit_trail', 'Audit trail', 'Returns { total, returned, rows, truncated }: the most recent audit rows, newest first. Default 40 rows, at most 200; the trail keeps the last 400.', [limit(40, 200)]),
  write('create_product', 'Create product', 'Adds a catalog product with zero stock; services are created untracked (no stock). Returns the created product with its new id.', [
    text('name', 'Name', 'Product name.', true, 80),
    text('sku', 'SKU', 'Short stock code; defaults to the id.', false, 24),
    choice('category', 'Category', 'Product category; services hold no stock.', CATEGORIES, true),
    money('price', 'Price', 'Selling price in dollars.'),
    money('cost', 'Cost', 'Unit cost in dollars.'),
  ]),
  write('receive_stock', 'Receive stock', 'Adds whole units to a tracked product’s stock and records the receipt. Returns the company snapshot.', [
    productId,
    units('qty', 'Quantity', 'Whole units received.', 1),
  ]),
  write('adjust_stock', 'Adjust stock', 'Applies a signed whole-unit correction to a tracked product; refuses to go below zero. Returns the company snapshot.', [
    productId,
    { ...units('delta', 'Adjustment', 'Signed whole-unit change; negative removes stock.', -10_000_000), maximum: 10_000_000 },
    reason,
  ]),
  write('update_product', 'Update product', 'Changes the price, cost, or reorder point of a product (give at least one). Returns the updated product.', [
    productId,
    money('price', 'Price', 'New selling price in dollars.', false),
    money('cost', 'Cost', 'New unit cost in dollars.', false),
    units('reorder_point', 'Reorder point', 'Units on hand that trigger the low-stock flag; tracked products only.', 0, false),
  ]),
  write('archive_product', 'Archive product', 'Retires a product from the catalog; refused while it sits on an open order. Returns the company snapshot.', [productId]),
  write('create_customer', 'Create customer', 'Adds a customer account with payment terms and a credit limit (0 means no limit). Returns the created customer with its new id.', [
    text('name', 'Name', 'Customer name.', true, 80),
    text('region', 'Region', 'Sales region.', false, 40),
    choice('terms', 'Terms', 'Payment terms.', TERMS, true),
    money('credit_limit', 'Credit limit', 'Maximum exposure in dollars; 0 means no limit.'),
  ]),
  write('update_customer', 'Update customer', 'Changes a customer’s payment terms or credit limit (give at least one). Returns the updated customer.', [
    customerId,
    choice('terms', 'Terms', 'New payment terms.', TERMS, false),
    money('credit_limit', 'Credit limit', 'New maximum exposure in dollars; 0 means no limit.', false),
  ]),
  write('set_credit_hold', 'Set credit hold', 'Places (hold: true) or releases (hold: false) a credit hold; a hold blocks new orders and allocation. Idempotent. Returns the customer.', [
    customerId,
    { key: 'hold', label: 'Hold', description: 'true to place the hold, false to release it.', kind: 'boolean', required: true },
  ]),
  write('create_order', 'Create order', 'Opens an empty draft sales order for a customer who is not on hold. Returns the new order.', [
    customerId,
    text('note', 'Note', 'Optional order note.', false, 160),
  ]),
  write('add_order_line', 'Add order line', 'Adds whole units of a product to a draft order at catalog price (merging into an existing line). Returns the order with lines.', [
    orderId, productId,
    units('qty', 'Quantity', 'Whole units ordered.', 1),
  ]),
  write('remove_order_line', 'Remove order line', 'Removes one product line from a draft order. Returns the order with lines.', [orderId, productId]),
  write('allocate_order', 'Allocate order', 'Reserves tracked stock for a draft order and moves it to allocated. Refused on shortages, credit holds, or when open balances plus uninvoiced orders would breach the credit limit. Returns the order.', [orderId]),
  write('ship_order', 'Ship order', 'Moves an allocated order to shipped. Returns the order summary.', [orderId]),
  write('deliver_order', 'Deliver order', 'Moves a shipped order to delivered so it can be invoiced. Returns the order summary.', [orderId]),
  write('cancel_order', 'Cancel order', 'Cancels a draft, allocated, or shipped order; reserved stock returns to inventory. Returns the order summary.', [orderId, reason]),
  write('issue_invoice', 'Issue invoice', 'Creates an open invoice for a delivered order on the customer’s terms; one live invoice per order. Returns the invoice.', [orderId]),
  write('record_payment', 'Record payment', 'Applies a payment to an open invoice; marks it paid when the balance reaches zero. Returns the invoice with payments.', [
    invoiceId,
    money('amount', 'Amount', 'Payment amount in dollars, at most the open balance.'),
    text('memo', 'Memo', 'What this payment records.', false, 80),
  ]),
  write('void_invoice', 'Void invoice', 'Voids an open invoice with a reason so the order can be reinvoiced. Returns the invoice summary.', [invoiceId, reason]),
  write('reset_company', 'Reset company', 'Replaces all data with the seeded demonstration company. ' + SNAPSHOT),
]

export const meridianVersion: CreateVersionInput = {
  note: 'Reference seven-module ERP with a governed action surface',
  inputs: [
    {
      key: 'company_name',
      label: 'Company name',
      description: 'Heading shown across the ERP.',
      kind: 'text',
      required: true,
      defaultValue: 'Meridian Ops',
      maxLength: 80,
    },
  ],
  definition: {
    kind: 'react-app',
    entry: 'src/App.tsx',
    files: [
      { path: 'src/App.tsx', content: appShellSource },
      { path: 'src/styles/app.css', content: stylesSource },
      { path: 'src/lib/model.ts', content: modelSource },
      { path: 'src/lib/format.ts', content: formatSource },
      { path: 'src/lib/logic.ts', content: logicSource },
      { path: 'src/lib/reports.ts', content: reportsSource },
      { path: 'src/lib/persist.ts', content: persistSource },
      { path: 'src/components/ui.tsx', content: uiSource },
      { path: 'src/modules/dashboard.tsx', content: dashboardSource },
      { path: 'src/modules/inventory.tsx', content: inventorySource },
      { path: 'src/modules/orders.tsx', content: ordersSource },
      { path: 'src/modules/customers.tsx', content: customersSource },
      { path: 'src/modules/invoices.tsx', content: invoicesSource },
      { path: 'src/modules/reports.tsx', content: reportsScreenSource },
      { path: 'src/modules/audit.tsx', content: auditScreenSource },
    ],
    actions,
  },
}

export const meridianEvaluation: CreateEvaluationSuiteInput = {
  name: 'Meridian order-to-cash behavior',
  cases: [
    {
      id: 'order-to-cash',
      name: 'A draft order allocates stock, ships, delivers, and survives restart',
      criticality: 'required',
      input: { company_name: 'Meridian Ops' },
      steps: [
        { action: 'assert-text', selector: '#company-name', contains: 'Meridian Ops' },
        { action: 'assert-count', selector: '.open-order-row', count: 1 },
        { action: 'assert-text', selector: '#stat-open-orders', contains: '1' },
        { action: 'click', selector: '#nav-orders' },
        { action: 'click', selector: '#order-o1000' },
        { action: 'assert-text', selector: '#order-detail', contains: 'draft' },
        { action: 'click', selector: '#order-advance' },
        { action: 'assert-text', selector: '#order-detail', contains: 'allocated' },
        { action: 'click', selector: '#nav-inventory' },
        { action: 'assert-text', selector: '#stock-p101', contains: '28' },
        { action: 'click', selector: '#nav-orders' },
        { action: 'click', selector: '#order-advance' },
        { action: 'click', selector: '#order-advance' },
        { action: 'assert-text', selector: '#order-detail', contains: 'delivered' },
        { action: 'restart' },
        { action: 'click', selector: '#nav-orders' },
        { action: 'click', selector: '#order-o1000' },
        { action: 'assert-text', selector: '#order-detail', contains: 'delivered' },
        { action: 'click', selector: '#nav-dashboard' },
        { action: 'assert-count', selector: '.open-order-row', count: 0 },
      ],
    },
    {
      id: 'allocation-gate-refuses',
      name: 'Allocating an empty draft is refused with a visible reason',
      criticality: 'required',
      input: { company_name: 'Meridian Ops' },
      steps: [
        { action: 'click', selector: '#nav-orders' },
        { action: 'click', selector: '#order-open' },
        { action: 'assert-text', selector: '#order-detail', contains: 'draft' },
        { action: 'click', selector: '#order-advance' },
        { action: 'assert-text', selector: '#order-note', contains: 'no lines' },
        { action: 'assert-text', selector: '#order-detail', contains: 'draft' },
      ],
    },
    {
      id: 'ledger-seeded',
      name: 'The seeded ledger shows an overdue and a partially paid invoice',
      criticality: 'required',
      input: { company_name: 'Meridian Ops' },
      steps: [
        { action: 'click', selector: '#nav-invoices' },
        { action: 'assert-count', selector: '#invoice-i5000, #invoice-i5001', count: 2 },
        { action: 'assert-text', selector: '#invoice-i5000', contains: 'overdue' },
        { action: 'assert-text', selector: '#balance-i5001', contains: '$338.00' },
        { action: 'click', selector: '#nav-reports' },
        { action: 'assert-text', selector: '#aging-current', contains: '$338.00' },
      ],
    },
    {
      id: 'dashboard-navigates',
      name: 'Dashboard stats navigate to their modules',
      criticality: 'informational',
      input: { company_name: 'Meridian Ops' },
      steps: [
        { action: 'click', selector: '#stat-products' },
        { action: 'assert-text', selector: '#product-add', contains: 'Add product' },
        { action: 'click', selector: '#nav-dashboard' },
        { action: 'assert-count', selector: '.stat', count: 6 },
      ],
    },
  ],
}
