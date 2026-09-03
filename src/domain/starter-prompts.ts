/**
 * Prompts the product hands to people. The landing page, the Applets home,
 * the Guide, and the Library home all read from here so the words stay one.
 */

/** Six things the bench is built for, each as the prompt you would paste. */
export const IDEAS = [
  {
    name: 'Castline',
    kind: 'Applet · foundry control tower',
    what: 'Heats, alloy stock, die bank, and quality holds for a die-casting plant. Releasing a work order without alloy coverage is refused.',
    prompt:
      'Build an applet in EEVEE called Castline: a control tower for a die-casting plant with three melt furnaces, five die cells, an alloy stock ledger in kg, work orders with plan quantities, and a quality-hold queue with dispositions. Reads: plant_snapshot, stock_risks (alloys at or below reorder), and hold_queue. Writes: post_movement (alloy in or out, with a reference), release_work_order, and disposition_hold (scrap, rework, or release, with a reason). Suite: releasing a work order whose alloy need exceeds available stock is refused with the shortfall shown, and a release disposition moves pieces out of hold and into accepted. Evaluate it and bring the passing version to me for review.',
  },
  {
    name: 'Cold Chain',
    kind: 'Applet · pharmacy custody',
    what: 'Vaccine lots across fridges with temperature excursions. An excursion quarantines the lot; release needs a QA note.',
    prompt:
      'Build an applet in EEVEE called Cold Chain: vaccine lots stored across four fridges, a temperature log per fridge, and a custody trail per lot. Reads: excursion_report (any reading above 8°C or below 2°C for 30 minutes or more) and lot_status. Writes: log_reading, quarantine_lot, and release_lot, which requires a QA note. Suite: a 35-minute excursion at 9°C quarantines every lot in that fridge, and release_lot without a note is refused. Bring the passing version to me.',
  },
  {
    name: 'Dock Board',
    kind: 'Applet · warehouse scheduling',
    what: 'Inbound appointments, dock doors, and the detention clock. Double-booking a door is refused.',
    prompt:
      'Build an applet in EEVEE called Dock Board: a 3PL warehouse with eight dock doors, inbound carrier appointments in 30-minute slots, arrival check-in, and a detention clock that starts two hours after arrival. Reads: dock_board (today by door) and detention_exposure (trucks past the free window, with cost at $75 per hour). Writes: assign_door, check_in, and reschedule_appointment, which needs a reason. Suite: assigning a door already booked for that slot is refused, and a truck checked in 2h10m ago shows $12.50 of detention. Evaluate it and bring it to me for review.',
  },
  {
    name: 'Covenant Watch',
    kind: 'Applet · commercial lending',
    what: 'Facilities, covenants, and drawdown requests. A drawdown against a breached covenant is refused; a waiver needs a reason.',
    prompt:
      'Build an applet in EEVEE called Covenant Watch: six borrowers, each with a credit facility, a limit, an undrawn balance, and two covenants (leverage below 3.5× and DSCR above 1.25×) with the latest reported values. Reads: exposure_by_borrower and covenant_breaches. Writes: approve_drawdown, refused while any covenant is breached, and waive_covenant, which needs a reason and an expiry date. Suite: a borrower at 3.8× leverage cannot draw, a dated waiver lets the same drawdown through, and the audit trail shows who waived what. Bring the passing version to me.',
  },
  {
    name: 'Vendor due diligence',
    kind: 'Library · redaction',
    what: 'Find names, emails, account numbers, and IBANs in a real master services agreement. The agent sees masked findings only.',
    prompt:
      'Scan the master services agreement and the vendor onboarding form I uploaded to the EEVEE Library for personal names, email addresses, phone numbers, account numbers, and IBANs, and open the findings for my review. Do not redact anything yourself; I will approve the redaction with my passkey before the file goes to procurement.',
  },
  {
    name: 'OEE cost model',
    kind: 'Studio · spreadsheet',
    what: 'Availability × performance × quality per cell, and cost per accepted piece, built from formulas so the inputs stay yours.',
    prompt:
      'Create a new spreadsheet in EEVEE and build an OEE and cost-per-piece model for three die-casting cells: an Inputs sheet with planned hours, downtime, cycle time, shots per hour, scrap rate, shot weight in kg, and alloy cost per kg; a Model sheet that computes availability, performance, quality, OEE, and cost per accepted piece for each cell; and a bar chart of OEE by cell. Use formulas, not pasted numbers, so I can change the inputs.',
  },
] as const

/** Meridian Ops in three acts: the proven demo path. */
export const MERIDIAN_ACTS = [
  {
    act: '01',
    name: 'Prove',
    claim: 'The agent installs a real ERP and runs its behavioral tests.',
    detail:
      'Meridian Ops is 15 source files, seven business modules, and 32 typed actions. The agent runs the order-to-cash scenarios before it asks you to review anything.',
    prompt:
      'Install the Meridian Ops reference applet in EEVEE, evaluate it against its behavioral suite, and bring the passing version to me for review.',
  },
  {
    act: '02',
    name: 'Approve',
    claim: 'Nothing publishes until your passkey verifies the exact version.',
    detail:
      'Read the source, the scenario verdicts, and the live preview. Approve & publish asks for your fingerprint, face, device PIN, or security key. The challenge is bound to this one version.',
    prompt:
      'After I publish Meridian Ops, run it with company_name set to "Meridian Ops". Share a three-step plan, inspect the company snapshot, and report the low-stock shortfall before proposing any write.',
  },
  {
    act: '03',
    name: 'Govern',
    claim: 'A published applet becomes tools. Writes wait for your key.',
    detail:
      'The published applet exposes its actions as WebMCP tools. Reads run at once. Writes are rehearsed against current data and wait in Decisions until you approve one request or grant a short lease.',
    prompt:
      'Run the published Meridian Ops applet for "Meridian Ops". Share your plan first. Then work the ERP through its applet tools: check the company snapshot and low-stock report, receive stock where there are shortfalls, take sales order SO-1000 through allocate, ship, deliver, issue its invoice, and record full payment. Every write pauses for my approval. Tell me each time and wait, or ask me for an autonomy lease.',
  },
] as const

export type StarterIdea = (typeof IDEAS)[number]
export type MeridianAct = (typeof MERIDIAN_ACTS)[number]
