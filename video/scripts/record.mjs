#!/usr/bin/env node
// Records the demo footage from a real Chrome through CDP.
//
// Each scene is a separate clip in public/rec/<scene>.mp4, plus a
// public/rec/manifest.json with the marks (named moments, in seconds from the
// start of the clip) that the Remotion composition lines callouts up with.
// A drawn cursor lives in the page so clicks read as a person's, and the
// agent's side of the story is real document.modelContext tool calls, the
// same path an agent in Chrome takes.
//
// Usage: node scripts/record.mjs [--url http://localhost:3000] [--out public/rec] [--only landing,home]
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'


const here = dirname(fileURLToPath(import.meta.url))
// The DOCX fixture for the Library scene is zipped with the app's own fflate.
const { zipSync } = createRequire(resolve(here, '..', '..', 'package.json'))('fflate')
const argument = (name, fallback) => {
  const index = process.argv.indexOf(name)
  return index === -1 ? fallback : process.argv[index + 1]
}
const origin = argument('--url', process.env.EEVEE_URL ?? 'http://localhost:3000').replace(/\/$/, '')
const out = resolve(here, '..', argument('--out', 'public/rec'))
const only = argument('--only', '')?.split(',').filter(Boolean) ?? []
mkdirSync(out, { recursive: true })

// 1440×810 CSS pixels at a 4/3 device scale is exactly 1920×1080 device
// pixels: the workbench keeps its three columns, and 14 px text lands at
// ~19 px in the frame.
const WIDTH = 1440
const HEIGHT = 810
const SCALE = 4 / 3

const chromeCandidates = [
  argument('--chrome', process.env.CHROME_PATH),
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary',
  '/usr/bin/google-chrome',
].filter(Boolean)
const chrome = chromeCandidates.find((candidate) => existsSync(candidate))
if (!chrome) {
  console.error('No Chrome binary found; pass --chrome or set CHROME_PATH')
  process.exit(2)
}

const port = 9000 + Math.floor(Math.random() * 1000)
const profile = mkdtempSync(join(tmpdir(), 'eevee-rec-'))
const browser = spawn(
  chrome,
  [
    '--headless=new',
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`,
    '--enable-features=WebMCPTesting,DevToolsWebMCPSupport',
    '--no-first-run',
    '--no-default-browser-check',
    '--hide-scrollbars',
    '--font-render-hinting=none',
    `--window-size=${WIDTH},${HEIGHT}`,
    'about:blank',
  ],
  { stdio: 'ignore' },
)
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
// A partial run (--only) keeps the other scenes' entries.
const manifestPath = join(out, 'manifest.json')
const manifest = existsSync(manifestPath)
  ? { ...JSON.parse(readFileSync(manifestPath, 'utf8')), width: 1920, height: 1080 }
  : { width: 1920, height: 1080, scenes: {} }

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
  const listeners = new Map()
  socket.onmessage = (message) => {
    const data = JSON.parse(message.data)
    if (data.id && pending.has(data.id)) {
      pending.get(data.id)(data)
      pending.delete(data.id)
    } else if (data.method && listeners.has(data.method)) {
      listeners.get(data.method)(data.params)
    }
  }
  const send = (method, params = {}) =>
    new Promise((resolve) => {
      const id = ++nextId
      pending.set(id, resolve)
      socket.send(JSON.stringify({ id, method, params }))
    })
  const evaluate = async (expression) => {
    const response = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
    if (response.result?.exceptionDetails) {
      throw new Error(response.result.exceptionDetails.exception?.description ?? JSON.stringify(response.result.exceptionDetails))
    }
    return response.result?.result?.value
  }
  const waitFor = async (expression, timeoutMs = 20_000) => {
    const startedAt = Date.now()
    while (Date.now() - startedAt < timeoutMs) {
      const value = await evaluate(expression).catch(() => false)
      if (value) return value
      await sleep(150)
    }
    throw new Error(`timed out waiting for ${expression.slice(0, 120)}`)
  }

  // ---- screencast -------------------------------------------------------
  let recording = null
  listeners.set('Page.screencastFrame', (params) => {
    send('Page.screencastFrameAck', { sessionId: params.sessionId })
    if (!recording) return
    const index = recording.frames.length
    const file = join(recording.dir, `f${String(index).padStart(5, '0')}.jpg`)
    writeFileSync(file, Buffer.from(params.data, 'base64'))
    recording.frames.push({ file, t: params.metadata.timestamp })
  })
  const now = () => Date.now() / 1000
  const start = async (name) => {
    const dir = join(out, `frames-${name}`)
    rmSync(dir, { recursive: true, force: true })
    mkdirSync(dir, { recursive: true })
    recording = { name, dir, frames: [], marks: [], startedAt: now() }
    await send('Page.startScreencast', { format: 'jpeg', quality: 92, maxWidth: 1920, maxHeight: 1080, everyNthFrame: 1 })
    console.log(`▶ ${name}`)
  }
  const mark = (label) => {
    if (!recording) return
    const t = now() - recording.startedAt
    recording.marks.push({ label, t: Math.round(t * 1000) / 1000 })
    console.log(`  · ${label} @ ${t.toFixed(1)}s`)
  }
  const stop = async () => {
    await send('Page.stopScreencast')
    await sleep(300)
    const { name, dir, frames, marks, startedAt } = recording
    recording = null
    const endedAt = now()
    if (frames.length === 0) throw new Error(`${name}: no frames captured`)
    // Chrome only sends a frame when something changed, so each frame holds
    // until the next one. Frame timestamps and Date.now() share the epoch.
    const first = Math.min(frames[0].t, startedAt)
    const lines = []
    frames.forEach((frame, index) => {
      const next = index + 1 < frames.length ? frames[index + 1].t : endedAt
      const duration = Math.max(1 / 60, next - frame.t)
      if (index === 0 && frame.t > first) {
        lines.push(`file '${frame.file}'`, `duration ${(frame.t - first).toFixed(4)}`)
      }
      lines.push(`file '${frame.file}'`, `duration ${duration.toFixed(4)}`)
    })
    lines.push(`file '${frames[frames.length - 1].file}'`)
    const list = join(dir, 'list.txt')
    writeFileSync(list, lines.join('\n') + '\n')
    const clip = join(out, `${name}.mp4`)
    const ffmpeg = spawnSync(
      'ffmpeg',
      ['-v', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', list, '-vf', 'fps=30,scale=1920:1080:flags=lanczos,format=yuv420p', '-c:v', 'libx264', '-crf', '17', '-preset', 'medium', '-movflags', '+faststart', clip],
      { stdio: 'inherit' },
    )
    if (ffmpeg.status !== 0) throw new Error(`${name}: ffmpeg failed`)
    const probe = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', clip], { encoding: 'utf8' })
    const duration = Number(probe.stdout.trim())
    manifest.scenes[name] = { file: `rec/${name}.mp4`, duration, marks }
    writeFileSync(join(out, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n')
    rmSync(dir, { recursive: true, force: true })
    console.log(`■ ${name}: ${frames.length} frames, ${duration.toFixed(1)}s`)
  }

  // ---- a person in the page ---------------------------------------------
  const CURSOR = `(() => {
    if (window.__rec) return true
    const style = document.createElement('style')
    style.textContent = '@keyframes recRipple{from{transform:scale(.3);opacity:.9}to{transform:scale(1.8);opacity:0}} html{scroll-behavior:auto!important} *{cursor:none!important}'
    document.head.appendChild(style)
    const el = document.createElement('div')
    el.id = 'rec-cursor'
    el.style.cssText = 'position:fixed;left:0;top:0;width:26px;height:30px;pointer-events:none;z-index:2147483647;opacity:0;filter:drop-shadow(0 2px 3px rgba(0,0,0,.4))'
    el.innerHTML = '<svg viewBox="0 0 26 30" width="26" height="30"><path d="M3 2 L3 24 L8.5 18.8 L12.6 27.5 L16.6 25.7 L12.5 17.2 L20 17 Z" fill="#fff" stroke="#111" stroke-width="1.6" stroke-linejoin="round"/></svg>'
    document.body.appendChild(el)
    const state = { x: innerWidth * 0.55, y: innerHeight * 0.55 }
    const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2)
    const place = () => { el.style.left = state.x + 'px'; el.style.top = state.y + 'px' }
    place()
    window.__rec = {
      state,
      show() { el.style.transition = 'opacity .3s'; el.style.opacity = '1' },
      hide() { el.style.transition = 'opacity .3s'; el.style.opacity = '0' },
      move(x, y, ms) {
        return new Promise((done) => {
          const sx = state.x, sy = state.y, t0 = performance.now()
          const step = (t) => {
            const p = Math.min(1, (t - t0) / ms)
            const e = ease(p)
            state.x = sx + (x - sx) * e
            state.y = sy + (y - sy) * e
            place()
            if (p < 1) requestAnimationFrame(step); else done()
          }
          requestAnimationFrame(step)
        })
      },
      ripple() {
        const r = document.createElement('div')
        r.style.cssText = 'position:fixed;left:' + state.x + 'px;top:' + state.y + 'px;width:34px;height:34px;margin:-17px 0 0 -17px;border-radius:50%;border:2.5px solid rgba(140,30,30,.85);pointer-events:none;z-index:2147483646;animation:recRipple .5s ease-out forwards'
        document.body.appendChild(r)
        setTimeout(() => r.remove(), 600)
      },
      scroll(target, top, ms) {
        const node = target === 'window' ? document.scrollingElement : document.querySelector(target)
        return new Promise((done) => {
          const from = node.scrollTop, t0 = performance.now()
          const step = (t) => {
            const p = Math.min(1, (t - t0) / ms)
            node.scrollTop = from + (top - from) * ease(p)
            if (p < 1) requestAnimationFrame(step); else done()
          }
          requestAnimationFrame(step)
        })
      },
    }
    return true
  })()`
  const person = () => evaluate(CURSOR)
  // Every helper re-runs the idempotent injector first: a dev-server reload
  // mid-scene would otherwise drop the cursor.
  const cursor = {
    show: async () => (await person(), evaluate('window.__rec.show(), true')),
    hide: async () => (await person(), evaluate('window.__rec.hide(), true')),
    move: async (x, y, ms = 650) => (await person(), evaluate(`window.__rec.move(${x}, ${y}, ${ms})`)),
  }
  const finder = (selector, text) =>
    text === undefined
      ? `document.querySelector(${JSON.stringify(selector)})`
      : `[...document.querySelectorAll(${JSON.stringify(selector)})].find((node) => node.textContent.trim() === ${JSON.stringify(text)} && !node.disabled)`
  // Brings the node into view with a smooth scroll of its scroll container,
  // walks the cursor there, ripples, and clicks with real pointer events.
  const click = async (selector, text, { settle = 350, travel = 650 } = {}) => {
    await waitFor(`Boolean(${finder(selector, text)})`)
    await person()
    const point = await evaluate(`(async () => {
      const node = ${finder(selector, text)}
      let container = node.parentElement
      while (container && container !== document.body) {
        const style = getComputedStyle(container)
        if (/(auto|scroll)/.test(style.overflowY) && container.scrollHeight > container.clientHeight + 4) break
        container = container.parentElement
      }
      const rect = node.getBoundingClientRect()
      if (container && container !== document.body) {
        const box = container.getBoundingClientRect()
        if (rect.top < box.top + 80 || rect.bottom > box.bottom - 80) {
          const top = container.scrollTop + (rect.top - box.top) - box.height / 2 + rect.height / 2
          await window.__rec.scroll(container === document.scrollingElement ? 'window' : '#' + (container.id || (container.id = 'rec-scroll-' + Math.random().toString(36).slice(2))), Math.max(0, top), 700)
        }
      } else if (rect.top < 80 || rect.bottom > innerHeight - 80) {
        await window.__rec.scroll('window', Math.max(0, scrollY + rect.top - innerHeight / 2), 700)
      }
      const r = node.getBoundingClientRect()
      return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }
    })()`)
    await cursor.move(point.x, point.y, travel)
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: point.x, y: point.y })
    await sleep(120)
    await evaluate('window.__rec.ripple(), true')
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: point.x, y: point.y, button: 'left', clickCount: 1 })
    await sleep(70)
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: point.x, y: point.y, button: 'left', clickCount: 1 })
    await sleep(settle)
  }
  const type = async (text) => {
    for (const character of text) {
      await send('Input.insertText', { text: character })
      await sleep(26 + Math.random() * 30)
    }
  }
  const scroll = async (target, top, ms = 1200) => (await person(), evaluate(`window.__rec.scroll(${JSON.stringify(target)}, ${top}, ${ms})`))
  const viewport = (width, height, scale, mobile = false) =>
    send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: scale, mobile })
  const navigate = async (path, ready) => {
    await send('Page.navigate', { url: `${origin}${path}` })
    await waitFor(ready)
    await person()
  }

  // ---- the agent's side ---------------------------------------------------
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
  const startToolCall = (slot, name, input) =>
    evaluate(`window[${JSON.stringify(slot)}] = (async () => {
      const tool = (await document.modelContext.getTools()).find((entry) => entry.name === ${JSON.stringify(name)})
      const value = await document.modelContext.executeTool(tool, ${JSON.stringify(JSON.stringify(input))})
      return { ok: true, value: typeof value === 'string' ? JSON.parse(value) : value }
    })().catch((error) => ({ ok: false, error: String(error && error.message || error) })); true`)
  const agent = async (name, input, label = name) => {
    mark(`agent:${label}`)
    const result = await callTool(name, input)
    if (!result.ok || result.value?.error) console.log(`    ${name} →`, result.error ?? result.value?.error)
    return result
  }

  await send('Page.enable')
  await send('Runtime.enable')
  await viewport(WIDTH, HEIGHT, SCALE)
  const wants = (name) => only.length === 0 || only.includes(name)
  const state = {}

  // ---- scenes -------------------------------------------------------------
  if (wants('landing')) {
    await navigate('/', `Boolean(document.querySelector('.lp-hero'))`)
    await sleep(600)
    await start('landing')
    await sleep(3200)
    mark('scroll')
    await scroll('window', 760, 3000)
    await sleep(1800)
    const top = (selector, offset = -40) => evaluate(`document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect().top + scrollY + (${offset})`)
    mark('family')
    await scroll('window', await top('#family'), 2600)
    await sleep(4200)
    mark('parents')
    await scroll('window', await top('.lp-parents', -140), 2400)
    await sleep(9500)
    mark('builtin')
    await scroll('window', await top('#builtin'), 2600)
    await sleep(5000)
    mark('builtin-list')
    await scroll('window', await top('#builtin', 420), 2600)
    await sleep(8000)
    await stop()
  }

  if (wants('home')) {
    await navigate('/workbench', `Boolean(document.querySelector('.home'))`)
    await waitFor(`document.modelContext ? document.modelContext.getTools().then((tools) => tools.length > 0) : false`)
    await sleep(500)
    await start('home')
    await cursor.show()
    await sleep(1400)
    await cursor.move(560, 470, 900)
    await sleep(300)
    mark('scroll')
    await scroll('.bench', 640, 2000)
    await sleep(1000)
    mark('guide')
    await click('.workspace-nav button', 'Guide')
    await sleep(1800)
    await click('.workspace-nav button', 'Applets')
    await sleep(800)
    await stop()
  }

  if (wants('install')) {
    if (!(await evaluate(`Boolean(document.querySelector('.home'))`))) {
      await navigate('/workbench', `Boolean(document.querySelector('.home'))`)
      await waitFor(`document.modelContext ? document.modelContext.getTools().then((tools) => tools.length > 0) : false`)
    }
    await sleep(300)
    await start('install')
    await cursor.show()
    await sleep(600)
    // Show the agent's rail so the tool calls read as they happen.
    await click('.side-toggle.is-right', undefined)
    await sleep(900)
    await agent('share_plan', {
      goal: 'Install Meridian Ops, prove it, and hand it to you for review',
      steps: [
        { id: 'install', title: 'Install the Meridian Ops reference applet as a draft' },
        { id: 'evaluate', title: 'Run its behavioral suite in the browser worker' },
        { id: 'review', title: 'Bring the passing version to you for review' },
      ],
    }, 'share_plan')
    await sleep(1600)
    const installed = await agent('install_reference_applet', { slug: 'meridian' })
    state.appletId = installed.value?.applet?.id
    await waitFor(`Boolean(document.querySelector('.stage'))`)
    await sleep(1800)
    mark('code')
    await click('.stage-toggle button', 'Code')
    await sleep(1200)
    const tabs = await evaluate(`document.querySelectorAll('.stage .review-source-tabs button').length`)
    for (const index of [3].filter((i) => i < tabs)) {
      await click(`.stage .review-source-tabs button:nth-child(${index + 1})`, undefined, { travel: 500 })
      await sleep(1800)
    }
    mark('app')
    await click('.stage-toggle button', 'App')
    await sleep(1000)
    const inspected = await agent('inspect_applet', { appletId: state.appletId })
    const version = inspected.value?.detail?.versions?.[0]
    state.versionId = version?.id
    state.suiteId = inspected.value?.detail?.evaluationSuites?.[0]?.id
    await sleep(800)
    mark('evaluate')
    const evaluated = await agent('evaluate_applet_version', { appletId: state.appletId, versionId: state.versionId, suiteId: state.suiteId })
    mark('evaluated')
    console.log(`    verdict ${evaluated.value?.run?.report?.verdict} (${evaluated.value?.run?.report?.candidate?.cases?.length} scenarios)`)
    await sleep(3200)
    await stop()
  }

  if (wants('publish')) {
    await send('WebAuthn.enable')
    await send('WebAuthn.addVirtualAuthenticator', {
      options: { protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true },
    })
    await start('publish')
    await cursor.show()
    await sleep(700)
    mark('passkey')
    await click('button', 'Set up passkey')
    await waitFor(`document.body.textContent.includes('Passkey · ready')`)
    await sleep(1100)
    mark('review')
    await click('button', 'Review & publish')
    await waitFor(`Boolean(document.querySelector('.review-evidence'))`)
    await sleep(2600)
    mark('approve')
    await click('button', 'Approve & publish')
    await waitFor(`document.body.textContent.includes('Published v1')`)
    mark('published')
    await sleep(2200)
    await stop()
  }

  if (wants('run')) {
    await start('run')
    await cursor.show()
    await sleep(500)
    const started = await agent('run_applet', { appletId: state.appletId, input: {} })
    state.runId = started.value?.run?.id
    await waitFor(`document.modelContext.getTools().then((tools) => tools.filter((tool) => tool.name.startsWith('applet_')).length === 32)`, 30_000)
    mark('tools-live')
    await sleep(2000)
    await agent('applet_company_snapshot', {}, 'company_snapshot')
    await sleep(1500)
    await agent('applet_low_stock_report', {}, 'low_stock_report')
    await sleep(1500)
    mark('write')
    await startToolCall('__write', 'applet_receive_stock', { product_id: 'p102', qty: 8 })
    await waitFor(`Boolean(document.querySelector('.applet-action-ledger .rehearsal.is-returned'))`)
    mark('rehearsed')
    await sleep(900)
    await evaluate(`(async () => { const n = document.querySelector('.applet-action-decision'); const b = document.querySelector('.bench'); const r = n.getBoundingClientRect(); const box = b.getBoundingClientRect(); const top = b.scrollTop + (r.top - box.top) - box.height / 2 + r.height / 2; await window.__rec.scroll('.bench', Math.max(0, top), 900); return true })()`)
    mark('centered')
    await sleep(3600)
    await click('.applet-action-decision button', 'Approve')
    const written = await waitFor(`(async () => { const r = await window.__write; return r ? JSON.stringify(r) : false })()`)
    mark('approved')
    console.log(`    receive_stock → ${written.slice(0, 80)}`)
    await sleep(2400)
    await stop()
  }

  if (wants('lease')) {
    await start('lease')
    await cursor.show()
    await sleep(600)
    mark('lease')
    await click('button', '3 writes · 5 min')
    await waitFor(`document.body.textContent.includes('Lease · 3 of 3 writes')`)
    await sleep(1400)
    await agent('applet_allocate_order', { order_id: 'o1000' }, 'allocate_order')
    await sleep(1200)
    await agent('applet_ship_order', { order_id: 'o1000' }, 'ship_order')
    await sleep(1400)
    mark('revoke')
    await click('button', 'Revoke')
    await waitFor(`!document.body.textContent.includes('Lease · ')`)
    await sleep(1000)
    mark('write')
    await startToolCall('__reject', 'applet_set_credit_hold', { customer_id: 'c101', hold: true })
    await waitFor(`document.querySelectorAll('.applet-action-decision').length === 1 && Boolean(document.querySelector('.applet-action-ledger .rehearsal.is-returned'))`)
    mark('rehearsed')
    await sleep(900)
    await evaluate(`(async () => { const n = document.querySelector('.applet-action-decision'); const b = document.querySelector('.bench'); const r = n.getBoundingClientRect(); const box = b.getBoundingClientRect(); const top = b.scrollTop + (r.top - box.top) - box.height / 2 + r.height / 2; await window.__rec.scroll('.bench', Math.max(0, top), 900); return true })()`)
    mark('centered')
    await sleep(1000)
    mark('reject')
    await click('.applet-action-decision button', 'Reject')
    await sleep(500)
    await click('input[aria-label="Rejection reason"]', undefined, { travel: 450 })
    await type('They paid INV-5000 last week.')
    await sleep(600)
    await click('button', 'Confirm reject')
    const rejected = await waitFor(`(async () => { const r = await window.__reject; return r ? JSON.stringify(r) : false })()`)
    mark('rejected')
    console.log(`    set_credit_hold → ${rejected.slice(0, 120)}`)
    await sleep(2400)
    await stop()
  }

  if (wants('studio')) {
    await start('studio')
    await cursor.show()
    await sleep(400)
    mark('studio')
    await click('.workspace-nav button', 'Studio')
    await sleep(1200)
    mark('new')
    await click('.library-upload', 'New spreadsheet')
    await waitFor(`document.body.textContent.includes('Workbook fully loaded')`, 30_000)
    await sleep(1800)
    const files = await callTool('list_files', {})
    const sheet = files.value?.files?.find((file) => file.medium === 'spreadsheet')
    const inspected = await callTool('inspect_file', { fileId: sheet.id })
    const sheetId = inspected.value?.detail?.sheets?.[0]?.id
    let baseVersionId = inspected.value?.detail?.file?.versionId
    const cell = (row, column, value, formula) => ({ sheetId, row, column, writeValue: true, value, ...(formula ? { formula } : {}) })
    const edits = [
      cell(0, 0, 'Cell'), cell(0, 1, 'Planned min'), cell(0, 2, 'Downtime min'), cell(0, 3, 'Ideal cycle s'), cell(0, 4, 'Pieces'), cell(0, 5, 'Rejects'),
      cell(0, 6, 'Availability'), cell(0, 7, 'Performance'), cell(0, 8, 'Quality'), cell(0, 9, 'OEE'),
      cell(1, 0, 'Cell A'), cell(1, 1, 480), cell(1, 2, 42), cell(1, 3, 30), cell(1, 4, 820), cell(1, 5, 12),
      cell(2, 0, 'Cell B'), cell(2, 1, 480), cell(2, 2, 95), cell(2, 3, 45), cell(2, 4, 460), cell(2, 5, 31),
      cell(3, 0, 'Cell C'), cell(3, 1, 480), cell(3, 2, 18), cell(3, 3, 25), cell(3, 4, 1050), cell(3, 5, 9),
    ]
    for (const r of [1, 2, 3]) {
      const n = r + 1
      edits.push(cell(r, 6, null, `(B${n}-C${n})/B${n}`), cell(r, 7, null, `(E${n}*D${n}/60)/(B${n}-C${n})`), cell(r, 8, null, `(E${n}-F${n})/E${n}`), cell(r, 9, null, `G${n}*H${n}*I${n}`))
    }
    const first = await agent('edit_spreadsheet', { fileId: sheet.id, baseVersionId, edits }, 'edit_spreadsheet')
    baseVersionId = first.value?.file?.versionId ?? baseVersionId
    await sleep(3600)
    mark('second')
    const more = [cell(0, 10, 'Cost per good piece'), cell(5, 0, 'Labour $/h'), cell(5, 1, 38)]
    for (const r of [1, 2, 3]) {
      const n = r + 1
      more.push(cell(r, 10, null, `($B$6*B${n}/60)/(E${n}-F${n})`))
    }
    await agent('edit_spreadsheet', { fileId: sheet.id, baseVersionId, edits: more }, 'edit_spreadsheet')
    await sleep(3600)
    await stop()
  }

  if (wants('library')) {
    await start('library')
    await cursor.show()
    await sleep(400)
    const docx = zipSync({
      '[Content_Types].xml': new TextEncoder().encode('<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'),
      '_rels/.rels': new TextEncoder().encode('<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'),
      'word/document.xml': new TextEncoder().encode(`<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>
        <w:p><w:r><w:t>Master Services Agreement: Northwind Components Ltd</w:t></w:r></w:p>
        <w:p><w:r><w:t>Vendor contact: Priya Raman, priya.raman@northwind-components.example, +1 415-555-0142.</w:t></w:r></w:p>
        <w:p><w:r><w:t>Term: 24 months from the effective date, net 30, with a 2% early-payment discount.</w:t></w:r></w:p>
        </w:body></w:document>`),
    })
    mark('create')
    const created = await agent('create_office_file', { name: 'Northwind MSA.docx', contentBase64: Buffer.from(docx).toString('base64') }, 'create_office_file')
    const docId = created.value?.file?.id
    await sleep(1600)
    mark('scan')
    const scanned = await agent('scan_document_review', { fileId: docId }, 'scan_document_review')
    const findingIds = scanned.value?.review?.findings?.map((finding) => finding.id) ?? []
    await sleep(1200)
    mark('review')
    await agent('request_redaction_review', { fileId: docId, findingIds }, 'request_redaction_review')
    await waitFor(`document.body.textContent.includes('masked finding')`)
    await sleep(3200)
    mark('remove')
    await click('.document-review button.primary-action', undefined)
    await waitFor(`document.body.textContent.includes('v2') || document.body.textContent.includes('2 immutable')`, 20_000)
    mark('redacted')
    await sleep(3000)
    await stop()
  }

  socket.close()
} catch (error) {
  console.error(error)
  process.exitCode = 1
} finally {
  const exited = new Promise((resolve) => browser.once('exit', resolve))
  browser.kill()
  await Promise.race([exited, sleep(5_000)])
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      rmSync(profile, { recursive: true, force: true })
      break
    } catch {
      await sleep(300)
    }
  }
  for (const entry of readdirSync(out)) if (entry.startsWith('frames-')) rmSync(join(out, entry), { recursive: true, force: true })
}
