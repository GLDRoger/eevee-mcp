'use client'

import { useState } from 'react'

type Line = { group: string; subject?: string; field?: string; before?: string; after: string; kind: 'changed' | 'added' }

type Scenario = {
  id: string
  tab: string
  situation: string
  call: { tool: string; input: string }
  rehearsal: { summary: string; lines: Line[] }
  decision: { kind: 'approve' | 'reject' | 'lease'; label: string; detail: string }
  lands: string[]
}

/** Three writes against the seeded Meridian Ops company, three different decisions. */
const SCENARIOS: Scenario[] = [
  {
    id: 'restock',
    tab: 'Restock a shortfall',
    situation: 'Cyan ink packs (INK-CY) are at 12. The reorder point is 20.',
    call: { tool: 'applet_receive_stock', input: '{ product_id: "p102", qty: 8 }' },
    rehearsal: {
      summary: '1 products field change, 1 audit added',
      lines: [
        { group: 'products', subject: 'INK-CY', field: 'stock', before: '12', after: '20', kind: 'changed' },
        { group: 'audit', after: 'Received 8 × INK-CY', kind: 'added' },
      ],
    },
    decision: { kind: 'approve', label: 'Approve', detail: 'Your fingerprint verifies this one request; the challenge is bound to its id.' },
    lands: ['INK-CY stock reads 20', 'The low-stock report is empty', 'The audit trail shows the receipt and who approved it'],
  },
  {
    id: 'hold',
    tab: 'Hold a customer',
    situation: 'Foundry North owes $670 on INV-5000, thirty days past due. The agent wants to stop new orders.',
    call: { tool: 'applet_set_credit_hold', input: '{ customer_id: "c101", hold: true }' },
    rehearsal: {
      summary: '1 customers field change, 1 audit added',
      lines: [
        { group: 'customers', subject: 'Foundry North', field: 'hold', before: 'false', after: 'true', kind: 'changed' },
        { group: 'audit', after: 'Foundry North placed on credit hold', kind: 'added' },
      ],
    },
    decision: { kind: 'reject', label: 'Reject · “Call them first”', detail: 'Nothing changes. The agent’s tool call returns your reason, word for word.' },
    lands: ['Foundry North stays open', 'The request is on record as rejected, with your reason', 'The agent reads the reason and adjusts its plan'],
  },
  {
    id: 'ship',
    tab: 'Ship SO-1000',
    situation: 'Harbor Lab Supply’s September restock is a draft: 4 desk hubs and 10 cables. Allocate, ship, deliver, then invoice.',
    call: { tool: 'applet_allocate_order', input: '{ order_id: "o1000" }' },
    rehearsal: {
      summary: '3 field changes, 1 audit added',
      lines: [
        { group: 'orders', subject: 'SO-1000', field: 'state', before: 'draft', after: 'allocated', kind: 'changed' },
        { group: 'products', subject: 'HUB-8P', field: 'stock', before: '32', after: '28', kind: 'changed' },
        { group: 'products', subject: 'CBL-2M', field: 'stock', before: '140', after: '130', kind: 'changed' },
        { group: 'audit', after: 'SO-1000 allocated', kind: 'added' },
      ],
    },
    decision: { kind: 'lease', label: 'Grant a lease · 3 writes, 5 minutes', detail: 'Allocate, ship, and deliver run without asking. Each spend is recorded. The fourth write, the invoice, waits for you again.' },
    lands: ['SO-1000 moves draft → allocated → shipped → delivered', 'Three spends show in the header: 0 of 3 left', 'issue_invoice arrives as a new card and waits'],
  },
]

export function LandingScenarios() {
  const [active, setActive] = useState(SCENARIOS[0].id)
  const scenario = SCENARIOS.find((entry) => entry.id === active) ?? SCENARIOS[0]
  return (
    <div className="lp-try">
      <div className="lp-try-tabs" role="tablist" aria-label="Jobs">
        {SCENARIOS.map((entry) => (
          <button
            key={entry.id}
            type="button"
            role="tab"
            aria-selected={entry.id === scenario.id}
            onClick={() => setActive(entry.id)}
          >
            {entry.tab}
          </button>
        ))}
      </div>
      <div className="lp-try-panel" key={scenario.id} role="tabpanel">
        <div className="lp-try-situation">
          <span>Situation</span>
          <p>{scenario.situation}</p>
        </div>
        <div className="lp-try-flow">
          <div className="lp-try-step">
            <span>The agent calls</span>
            <code>{scenario.call.tool}</code>
            <code className="is-input">{scenario.call.input}</code>
          </div>
          <div className="lp-try-step is-rehearsal">
            <span>Rehearsed on a copy</span>
            <p>{scenario.rehearsal.summary}</p>
            {scenario.rehearsal.lines.map((line) => (
              <dl key={`${line.group}-${line.subject ?? ''}-${line.field ?? ''}`}>
                <dt>
                  <i>{line.group}</i>
                  {line.subject ? <b>{line.subject}</b> : null}
                  <i>{line.field ?? line.kind}</i>
                </dt>
                <dd>
                  {line.kind === 'changed' ? (
                    <>
                      <s>{line.before}</s> → <ins>{line.after}</ins>
                    </>
                  ) : (
                    <ins>{line.after}</ins>
                  )}
                </dd>
              </dl>
            ))}
          </div>
          <div className={`lp-try-step is-decision is-${scenario.decision.kind}`}>
            <span>You decide</span>
            <strong>{scenario.decision.label}</strong>
            <p>{scenario.decision.detail}</p>
          </div>
          <div className="lp-try-step is-lands">
            <span>What lands</span>
            <ul>
              {scenario.lands.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </div>
  )
}
