#!/usr/bin/env node
// End-to-end check of EEVEE's WebMCP surface in a real Chromium.
//
// Launches headless Chrome with WebMCP testing enabled, opens the workbench,
// enumerates the registered tools through document.modelContext.getTools(),
// and executes a read tool, a UI tool, and an invalid call through
// document.modelContext.executeTool(). This is the only check in the repo
// that exercises the browser API itself rather than a mock of it.
//
// Usage: node scripts/webmcp-e2e.mjs [--url http://localhost:3000] [--chrome /path/to/chrome]
// The site root is the landing page; a bare origin is resolved to /workbench.
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const argument = (name, fallback) => {
  const index = process.argv.indexOf(name)
  return index === -1 ? fallback : process.argv[index + 1]
}

const url = (() => {
  const given = new URL(argument('--url', process.env.EEVEE_URL ?? 'http://localhost:3000/'))
  if (given.pathname === '/' || given.pathname === '') given.pathname = '/workbench'
  return given.toString()
})()
// Optional: write PNG screenshots of the human flow here (desktop and 390 px).
const shotsDir = argument('--shots', process.env.EEVEE_SHOTS ?? '')
if (shotsDir) mkdirSync(shotsDir, { recursive: true })
const chromeCandidates = [
  argument('--chrome', process.env.CHROME_PATH),
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
].filter(Boolean)
const chrome = chromeCandidates.find((candidate) => existsSync(candidate))
if (!chrome) {
  console.error('No Chrome binary found; pass --chrome or set CHROME_PATH')
  process.exit(2)
}

const port = 9000 + Math.floor(Math.random() * 1000)
const profile = mkdtempSync(join(tmpdir(), 'eevee-webmcp-'))
const browser = spawn(
  chrome,
  [
    '--headless=new',
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`,
    '--enable-features=WebMCPTesting,DevToolsWebMCPSupport',
    '--no-first-run',
    '--no-default-browser-check',
    'about:blank',
  ],
  { stdio: 'ignore' },
)

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const failures = []
const check = (label, condition, detail = '') => {
  if (condition) console.log(`ok   ${label}`)
  else {
    failures.push(label)
    console.log(`FAIL ${label}${detail ? `: ${detail}` : ''}`)
  }
}

try {
  let targets = []
  for (let attempt = 0; attempt < 60 && targets.length === 0; attempt += 1) {
    try {
      targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json()
    } catch {
      await sleep(250)
    }
  }
  const page = targets.find((target) => target.type === 'page')
  if (!page) throw new Error('Chrome exposed no page target')

  const socket = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => {
    socket.onopen = resolve
    socket.onerror = reject
  })
  let nextId = 0
  const pending = new Map()
  socket.onmessage = (message) => {
    const data = JSON.parse(message.data)
    if (data.id && pending.has(data.id)) {
      pending.get(data.id)(data)
      pending.delete(data.id)
    }
  }
  const send = (method, params = {}) =>
    new Promise((resolve) => {
      const id = ++nextId
      pending.set(id, resolve)
      socket.send(JSON.stringify({ id, method, params }))
    })
  const evaluate = async (expression) => {
    const response = await send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
    })
    if (response.result?.exceptionDetails) {
      throw new Error(
        response.result.exceptionDetails.exception?.description ??
          JSON.stringify(response.result.exceptionDetails),
      )
    }
    return response.result?.result?.value
  }
  // Chrome's executeTool takes the input as a JSON string; agents send objects.
  const callTool = (name, input) =>
    evaluate(`(async () => {
      const tool = (await document.modelContext.getTools()).find((entry) => entry.name === ${JSON.stringify(name)})
      if (!tool) return { missing: true }
      try {
        const value = await document.modelContext.executeTool(tool, ${JSON.stringify(JSON.stringify(input))})
        return { ok: true, value: typeof value === 'string' ? JSON.parse(value) : value }
      } catch (error) {
        return { ok: false, error: String(error && error.message || error) }
      }
    })()`)

  await send('Page.enable')
  await send('Runtime.enable')
  // A desktop viewport keeps the agent rail visible so rendered text can be checked.
  await send('Emulation.setDeviceMetricsOverride', {
    width: 1440,
    height: 900,
    deviceScaleFactor: 1,
    mobile: false,
  })
  await send('Page.navigate', { url })
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const live = await evaluate(
      `document.modelContext ? document.modelContext.getTools().then((tools) => tools.length) : -1`,
    ).catch(() => 0)
    if (live > 0) break
    await sleep(500)
  }

  await evaluate(
    `window.__eeveeActivity = []; window.addEventListener('eevee:tool-activity', (event) => window.__eeveeActivity.push(event.detail)); true`,
  )

  check('document.modelContext exists', (await evaluate('typeof document.modelContext')) === 'object')
  const tools = await evaluate(
    `document.modelContext.getTools().then((tools) => tools.map((tool) => ({ name: tool.name, schema: JSON.stringify(tool.inputSchema || {}).length, description: (tool.description || '').length })))`,
  )
  const expectedCount = Number(process.env.EEVEE_TOOL_COUNT ?? 28)
  check(`${expectedCount} tools registered`, tools.length === expectedCount, `saw ${tools.length}`)
  const schemaBytes = tools.reduce((total, tool) => total + tool.schema, 0)
  const descriptionBytes = tools.reduce((total, tool) => total + tool.description, 0)
  console.log(`     tool list weighs ${schemaBytes} schema bytes + ${descriptionBytes} description bytes`)
  check('tool list under 48 KB', schemaBytes + descriptionBytes < 48_000)

  const listApplets = await callTool('list_applets', {})
  check('list_applets executes', listApplets.ok === true && Array.isArray(listApplets.value?.applets), listApplets.error)
  const listFiles = await callTool('list_files', {})
  check('list_files executes', listFiles.ok === true && Array.isArray(listFiles.value?.files), listFiles.error)
  const state = await callTool('get_workbench_state', {})
  check('get_workbench_state executes', state.ok === true && typeof state.value?.surface === 'string', state.error)

  const plan = await callTool('share_plan', {
    goal: 'E2E probe plan',
    steps: [{ id: 'list', title: 'List applets' }],
  })
  check('share_plan executes', plan.ok === true && plan.value?.goal === 'E2E probe plan', plan.error)
  await sleep(500)
  check(
    'shared plan renders on the workbench',
    await evaluate(`(document.querySelector('.mission-plan')?.textContent ?? '').includes('E2E probe plan')`),
  )

  const invalid = await callTool('inspect_applet', { appletId: 'not-a-uuid' })
  // Chrome's executeTool swallows thrown messages, so errors come back as a
  // structured result the agent can read.
  check(
    'invalid input returns a structured error naming the field',
    invalid.ok === true && typeof invalid.value?.error === 'string' && /appletId/.test(invalid.value.error),
    JSON.stringify(invalid),
  )
  const activity = await evaluate('JSON.stringify(window.__eeveeActivity)')
  const failedInspect = JSON.parse(activity).find(
    (entry) => entry.tool === 'inspect_applet' && entry.phase === 'failed',
  )
  check(
    'validation error names the field for the agent',
    Boolean(failedInspect && /appletId/.test(failedInspect.error ?? '')),
    failedInspect?.error,
  )
  check(
    'no tool failed on a missing options argument',
    !JSON.parse(activity).some((entry) => /destructure/.test(entry.error ?? '')),
  )

  // A spreadsheet edit with only `edits` must clear validation: every other
  // family defaults to empty, so the only complaint left is the missing file.
  const sparseEdit = await callTool('edit_spreadsheet', {
    fileId: '00000000-0000-4000-8000-000000000000',
    baseVersionId: '00000000-0000-4000-8000-000000000001',
    edits: [{ sheetId: 'sheet-1', row: 0, column: 0, writeValue: true, value: 1 }],
  })
  check(
    'edit_spreadsheet accepts a request with only edits',
    sparseEdit.ok === true && typeof sparseEdit.value?.error === 'string' && !/structuralOps|Invalid input/.test(sparseEdit.value.error),
    JSON.stringify(sparseEdit).slice(0, 300),
  )

  // Agent flow: install the reference applet, run its behavioral suite through
  // the real evaluation worker (sandboxed iframe plus the injected runtime), and
  // read the verdict back the way an agent would. A fresh Chrome profile is a
  // fresh workspace, so the install is never a no-op here.
  const installed = await callTool('install_reference_applet', { slug: 'meridian' })
  const appletId = installed.value?.applet?.id
  check(
    'install_reference_applet installs Meridian as a draft',
    installed.ok === true && typeof appletId === 'string' && installed.value.applet.activeVersionId === null,
    installed.error,
  )
  const inspected = appletId ? await callTool('inspect_applet', { appletId }) : { ok: false, error: 'no applet' }
  const version = inspected.value?.detail?.versions?.[0]
  const versionId = version?.id
  const suiteId = inspected.value?.detail?.evaluationSuites?.[0]?.id
  check(
    'inspect_applet returns the draft version and its behavioral suite',
    typeof versionId === 'string' && version.state === 'draft' && typeof suiteId === 'string',
    inspected.error,
  )
  const evaluationStartedAt = Date.now()
  const evaluated = versionId
    ? await callTool('evaluate_applet_version', { appletId, versionId, suiteId })
    : { ok: false, error: 'no version' }
  const run = evaluated.value?.run
  const failedCases = (run?.report?.candidate?.cases ?? [])
    .filter((entry) => entry.verdict !== 'pass')
    .map((entry) => `${entry.caseId}: ${entry.steps.find((step) => step.verdict === 'fail')?.detail ?? 'failed'}`)
  check(
    'evaluate_applet_version runs the suite in the browser worker',
    evaluated.ok === true && run?.state === 'passed',
    evaluated.error ?? run?.error,
  )
  check(
    'every Meridian scenario passes against the live runtime',
    run?.report?.verdict === 'pass' && failedCases.length === 0,
    failedCases.join('; '),
  )
  console.log(`     ${run?.report?.candidate?.cases?.length ?? 0} scenarios in ${Date.now() - evaluationStartedAt} ms`)
  for (const entry of run?.report?.candidate?.cases ?? []) {
    console.log(`     ${entry.verdict.padEnd(4)} ${entry.criticality.padEnd(13)} ${entry.name} (${entry.steps.length} steps)`)
  }

  // Human flow. A CDP virtual authenticator stands in for the person's
  // fingerprint; everything else is the real UI driven by real pointer input,
  // so WebAuthn and navigator.userActivation see a person: passkey enrolment,
  // review, publish, run, an automatic read, a rehearsed write approved with the
  // passkey, a lease, a leased write, revocation, and a rejection with a reason.
  await send('WebAuthn.enable')
  await send('WebAuthn.addVirtualAuthenticator', {
    options: {
      protocol: 'ctap2',
      transport: 'internal',
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  })
  const finder = (selector, text) =>
    `[...document.querySelectorAll(${JSON.stringify(selector)})].find((node) => node.textContent.trim() === ${JSON.stringify(text)} && !node.disabled)`
  const waitFor = async (expression, timeoutMs = 15_000) => {
    const startedAt = Date.now()
    while (Date.now() - startedAt < timeoutMs) {
      const value = await evaluate(expression).catch(() => false)
      if (value) return value
      await sleep(250)
    }
    return false
  }
  const clickButton = async (text, selector = 'button') => {
    const point = await waitFor(
      `(() => { const node = ${finder(selector, text)}; if (!node) return null; node.scrollIntoView({ block: 'center' }); const r = node.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 } })()`,
    )
    if (!point) return false
    for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) {
      await send('Input.dispatchMouseEvent', { type, x: point.x, y: point.y, button: 'left', clickCount: 1 })
    }
    return true
  }
  const viewport = (width, height, mobile) =>
    send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: mobile ? 2 : 1, mobile })
  const shot = async (name) => {
    if (!shotsDir) return
    await sleep(400)
    const captured = await send('Page.captureScreenshot', { format: 'png' })
    writeFileSync(join(shotsDir, `${name}.png`), Buffer.from(captured.result.data, 'base64'))
  }
  const startToolCall = (slot, name, input) =>
    evaluate(`window[${JSON.stringify(slot)}] = (async () => {
      const tool = (await document.modelContext.getTools()).find((entry) => entry.name === ${JSON.stringify(name)})
      const value = await document.modelContext.executeTool(tool, ${JSON.stringify(JSON.stringify(input))})
      return { ok: true, value: typeof value === 'string' ? JSON.parse(value) : value }
    })().catch((error) => ({ ok: false, error: String(error && error.message || error) })); true`)

  check('passkey enrolment starts from the header', await clickButton('Set up passkey'))
  check(
    'the passkey is ready after enrolment',
    Boolean(await waitFor(`document.body.textContent.includes('Passkey · ready')`)),
  )
  await shot('01-passkey-ready')
  check('review opens for the evaluated draft', await clickButton('Review & publish'))
  check('approve & publish asks for the passkey', await clickButton('Approve & publish'))
  let activeVersionId = null
  for (let attempt = 0; attempt < 40 && !activeVersionId; attempt += 1) {
    const current = await callTool('inspect_applet', { appletId })
    activeVersionId = current.value?.detail?.applet?.activeVersionId ?? null
    if (!activeVersionId) await sleep(500)
  }
  check('the passkey published the evaluated version', activeVersionId === versionId)
  await shot('02-published')

  const started = await callTool('run_applet', { appletId, input: {} })
  check('run_applet starts a run of the published version', started.ok === true && typeof started.value?.run?.id === 'string', started.error)
  const actionTools = await waitFor(
    `document.modelContext.getTools().then((tools) => tools.filter((tool) => tool.name.startsWith('applet_')).length)`,
    20_000,
  )
  check('the open run registers its 32 declared actions as applet_* tools', actionTools === 32, `saw ${actionTools}`)

  // By hand, without an agent: the ledger's own "send a request" form takes
  // the same server path as an applet_* tool call, so a judge with no agent
  // still reaches a rehearsed decision.
  check('the empty ledger offers a hand-raised request', await clickButton('Send a request the way an agent would'))
  await evaluate(`(() => {
    const select = document.querySelector('#test-action')
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(select, 'set_credit_hold')
    select.dispatchEvent(new Event('change', { bubbles: true }))
    return true
  })()`)
  await waitFor(`Boolean(document.querySelector('.ledger-test input[name="customer_id"]'))`)
  await evaluate(`(() => {
    const input = document.querySelector('.ledger-test input[name="customer_id"]')
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, 'c101')
    input.dispatchEvent(new Event('input', { bubbles: true }))
    const hold = document.querySelector('.ledger-test input[name="hold"]')
    if (!hold.checked) hold.click()
    return true
  })()`)
  check('the hand-raised request is sent', await clickButton('Send request'))
  check(
    'the hand-raised request is rehearsed like an agent call',
    Boolean(await waitFor(`Boolean(document.querySelector('.applet-action-ledger .rehearsal.is-returned'))`)),
  )
  await shot('02b-hand-request')
  check('the person rejects the hand-raised request', await clickButton('Reject', '.applet-action-decision button'))
  check('the rejection is confirmed', await clickButton('Confirm reject'))
  check(
    'the rejected hand-raised request leaves no pending decision',
    Boolean(await waitFor(`document.querySelectorAll('.applet-action-decision').length === 0 && document.body.textContent.includes('The person rejected this request')`)),
  )

  const before = await callTool('applet_list_customers', { limit: 5 })
  const holdOf = (response) => response.value?.result?.customers?.find((customer) => customer.id === 'c101')?.hold
  check(
    'an automatic read action executes without a decision',
    before.ok === true && before.value?.status === 'succeeded' && holdOf(before) === false,
    before.error ?? JSON.stringify(before.value),
  )

  await startToolCall('__eeveeWrite', 'applet_set_credit_hold', { customer_id: 'c101', hold: true })
  check(
    'the write request is rehearsed before the person decides',
    Boolean(await waitFor(`Boolean(document.querySelector('.applet-action-ledger .rehearsal.is-returned'))`)),
  )
  await shot('03-decision-pending')
  check('the person approves the write with the passkey', await clickButton('Approve', '.applet-action-decision button'))
  const written = await evaluate('window.__eeveeWrite')
  check(
    'the approved write executes and the waiting tool call returns succeeded',
    written.ok === true && written.value?.status === 'succeeded',
    written.error ?? JSON.stringify(written.value),
  )
  const record = await callTool('inspect_applet_action', { requestId: written.value?.requestId })
  check('inspect_applet_action shows the approved, executed request', record.ok === true && /"state":"succeeded"/.test(JSON.stringify(record.value)), record.error)
  const after = await callTool('applet_list_customers', { limit: 5 })
  check('the write landed in durable state', holdOf(after) === true)

  check('the person grants a 3-write lease with the passkey', await clickButton('3 writes · 5 min'))
  check('the lease chip shows 3 of 3 writes', Boolean(await waitFor(`document.body.textContent.includes('Lease · 3 of 3 writes')`)))
  const leased = await callTool('applet_set_credit_hold', { customer_id: 'c101', hold: false })
  check(
    'a leased write executes without a decision and spends one write',
    leased.ok === true && leased.value?.status === 'succeeded' && leased.value?.lease?.remainingWrites === 2,
    leased.error ?? JSON.stringify(leased.value),
  )
  check('the person revokes the lease', await clickButton('Revoke'))
  check('the lease chip is gone', Boolean(await waitFor(`!document.body.textContent.includes('Lease · ')`)))

  await startToolCall('__eeveeReject', 'applet_set_credit_hold', { customer_id: 'c101', hold: true })
  check(
    'a write after revocation waits for a decision again',
    Boolean(await waitFor(`document.querySelectorAll('.applet-action-decision').length === 1 && Boolean(document.querySelector('.applet-action-ledger .rehearsal.is-returned'))`)),
  )
  await viewport(390, 844, true)
  await shot('04-decision-390')
  await viewport(1440, 900, false)
  check('the person opens the rejection form', await clickButton('Reject', '.applet-action-decision button'))
  await evaluate(`(() => {
    const input = document.querySelector('input[aria-label="Rejection reason"]')
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, 'Not this quarter')
    input.dispatchEvent(new Event('input', { bubbles: true }))
    return true
  })()`)
  check('the person confirms the rejection', await clickButton('Confirm reject'))
  const rejected = await evaluate('window.__eeveeReject')
  check(
    'the rejected write returns the reason to the agent',
    rejected.ok === true && rejected.value?.status === 'rejected' && /Not this quarter/.test(rejected.value?.error ?? ''),
    rejected.error ?? JSON.stringify(rejected.value),
  )
  await shot('05-rejected')

  socket.close()
} catch (error) {
  failures.push(error instanceof Error ? error.message : String(error))
  console.error(error)
} finally {
  const exited = new Promise((resolve) => browser.once('exit', resolve))
  browser.kill()
  await Promise.race([exited, sleep(5_000)])
  // Chrome may still be flushing the profile when it exits; retry briefly.
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      rmSync(profile, { recursive: true, force: true })
      break
    } catch {
      await sleep(300)
    }
  }
}

if (failures.length > 0) {
  console.log(`\n${failures.length} check(s) failed`)
  process.exit(1)
}
console.log('\nall WebMCP checks passed')
