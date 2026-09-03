'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { AppletRunOutput } from '@/domain/applet'
import {
  APPLET_ACTION_TOOL_PREFIX,
  appletActionInputSchema,
  type AppletActionDefinition,
  type AppletActionEffect,
  type AppletActionRequest,
} from '@/domain/applet-action'
import type { JsonValue } from '@/domain/json'
import { LEASE_CHOICES, leaseActive, type AutonomyLease } from '@/domain/autonomy-lease'
import { createBoundedMemoryStore } from '@/domain/applet-store'
import { encodeBase64 } from '@/domain/bytes'
import { api } from '@/client/api'
import { appletActionMessageSchema, appletMessageSchema } from '@/client/applet-messages'
import { rehearseAction, type Rehearsal } from '@/client/rehearsal'
import { emitToolActivity } from '@/client/tool-activity'
import { authorizeHuman } from '@/client/human-authority'
import { rehearsalChanges, summarizeChanges } from '@/client/rehearsal-diff'
import { modelContextOf, waitForActionDecision } from '@/client/webmcp'
import { DECISIONS_CHANGED_EVENT } from './decisions'
import { Field, valueFor } from './input-form'

/** How long an applet_* tool call waits for the person before returning a pending request. */
const INLINE_DECISION_WAIT_MS = 45_000

const decided = (state: AppletActionRequest['state']): boolean =>
  state === 'succeeded' || state === 'failed' || state === 'rejected'

/**
 * True while the browser holds transient user activation for this page. A
 * real click or keypress inside the sandboxed applet iframe activates the
 * parent document too, so this is a signal the applet cannot forge: it tells
 * the bridge a person is driving the interface right now.
 */
const personIsInteracting = (): boolean => {
  const activation = navigator.userActivation
  return activation ? activation.isActive : true
}

export function AppletPreview({
  appletId,
  output,
  storage,
  runId,
  actions = [],
  title = 'Live specimen',
  frameless = false,
  onReady,
  onRevoked,
  lease = null,
  onLeaseChange,
  focusRequestId = null,
}: {
  appletId: string
  output: AppletRunOutput
  storage: 'durable' | 'ephemeral'
  runId?: string
  actions?: readonly AppletActionDefinition[]
  title?: string
  frameless?: boolean
  onReady?: () => void
  onRevoked?: () => void
  lease?: AutonomyLease | null
  onLeaseChange?: (lease: AutonomyLease | null) => void
  focusRequestId?: string | null
}) {
  const frameRef = useRef<HTMLIFrameElement>(null)
  const bridgeActive = useRef(true)
  const loadCount = useRef(0)
  const memory = useRef(createBoundedMemoryStore())
  const reportedReady = useRef(false)
  const reportedRevoked = useRef(false)
  // Once an agent-triggered action has run in this frame, untagged durable
  // writes need a person at the controls. Before that, mount-time writes
  // such as seeding are the published applet's own reviewed behavior.
  const agentHasActed = useRef(false)
  const actionWaiters = useRef(
    new Map<
      string,
      {
        actionName: string
        resolve: (value: JsonValue) => void
        reject: (error: Error) => void
        timer: ReturnType<typeof setTimeout>
      }
    >(),
  )
  const [ready, setReady] = useState(false)
  const [revoked, setRevoked] = useState(false)
  const [actionRequests, setActionRequests] = useState<AppletActionRequest[]>([])
  const [rehearsals, setRehearsals] = useState<Record<string, Rehearsal>>({})
  const [authorityError, setAuthorityError] = useState('')
  const [grantingLease, setGrantingLease] = useState(false)
  const [decidingId, setDecidingId] = useState<string | null>(null)
  const [confirmingId, setConfirmingId] = useState<string | null>(null)
  const [rejectingId, setRejectingId] = useState<string | null>(null)
  const [rejectReason, setRejectReason] = useState('')
  // A person without an agent can still raise a governed request the way an
  // agent would; the request takes the same server path and gets the same
  // rehearsal and decision.
  const [testAction, setTestAction] = useState<string | null>(null)
  // A decided card holds a brief highlight so the moment of approval is
  // visible, and the tools chip flashes once when a run's actions register.
  const [settledId, setSettledId] = useState<string | null>(null)
  const [toolsFresh, setToolsFresh] = useState(false)
  const [sendingTest, setSendingTest] = useState(false)
  const [toolRegistration, setToolRegistration] = useState<{
    live: number
    failures: string[]
  } | null>(null)
  // The lease lives in the parent so it survives view toggles and remounts;
  // the ref mirrors it for the tool-execute closures registered below.
  // Spends update the ref synchronously through updateLease; this effect
  // reconciles external changes such as a run switch clearing the lease.
  const leaseRef = useRef<AutonomyLease | null>(lease)
  useEffect(() => {
    leaseRef.current = lease
  }, [lease])
  // The ready/revoked callbacks live in refs so parents may pass inline
  // arrows without re-running the message-listener effect. Re-running that
  // effect mid-action would reject every in-flight action waiter.
  const onReadyRef = useRef(onReady)
  const onRevokedRef = useRef(onRevoked)
  useEffect(() => {
    onReadyRef.current = onReady
    onRevokedRef.current = onRevoked
  })
  const actionByName = useMemo(
    () => new Map(actions.map((action) => [action.name, action])),
    [actions],
  )

  const onLeaseChangeRef = useRef(onLeaseChange)
  useEffect(() => {
    onLeaseChangeRef.current = onLeaseChange
  })
  const updateLease = useCallback((next: AutonomyLease | null) => {
    leaseRef.current = next
    onLeaseChangeRef.current?.(next)
  }, [])

  // Unmounting the preview cancels every running shadow rehearsal instead of
  // leaving hidden iframes alive until their timeout. The controller is made
  // per mount: React StrictMode runs this cleanup once during development
  // before the real mount, and a controller created in the ref initializer
  // stayed aborted afterwards, so every rehearsal died on arrival.
  const rehearsalAbort = useRef<AbortController | null>(null)
  useEffect(() => {
    const controller = new AbortController()
    rehearsalAbort.current = controller
    return () => {
      controller.abort()
      if (rehearsalAbort.current === controller) rehearsalAbort.current = null
    }
  }, [])

  // A pending request gets rehearsed the moment it appears: the same applet
  // code runs against a copy of current state with writes intercepted, so the
  // decision card can show consequences instead of intentions.
  const rehearse = useCallback(
    (request: AppletActionRequest, force = false) => {
      setRehearsals((current) =>
        request.id in current && !force
          ? current
          : { ...current, [request.id]: { verdict: 'unavailable', error: 'Rehearsing…' } },
      )
      void rehearseAction(
        appletId,
        output.html,
        output.channel,
        request.action,
        request.input,
        request.id,
        rehearsalAbort.current?.signal,
      ).then((rehearsal) =>
        setRehearsals((current) => ({ ...current, [request.id]: rehearsal })),
      )
    },
    [appletId, output.channel, output.html],
  )

  const updateActionRequest = useCallback((next: AppletActionRequest) => {
    setActionRequests((current) => [next, ...current.filter(({ id }) => id !== next.id)].slice(0, 50))
    window.dispatchEvent(new CustomEvent(DECISIONS_CHANGED_EVENT, { detail: { requestId: next.id } }))
  }, [])

  const revoke = useCallback(() => {
    bridgeActive.current = false
    setReady(false)
    setRevoked(true)
    // A revoked runtime can never answer, so in-flight actions fail now
    // instead of hanging until their fifteen-second timeout.
    for (const waiter of actionWaiters.current.values()) {
      clearTimeout(waiter.timer)
      waiter.reject(new Error('The applet runtime was revoked before the action finished'))
    }
    actionWaiters.current.clear()
    if (!reportedRevoked.current) {
      reportedRevoked.current = true
      onRevokedRef.current?.()
    }
  }, [])

  useEffect(() => {
    const waiters = actionWaiters.current
    const receive = (event: MessageEvent<unknown>) => {
      if (event.source !== frameRef.current?.contentWindow) return
      const actionMessage = appletActionMessageSchema.safeParse(event.data)
      if (actionMessage.success && actionMessage.data.channel === output.channel) {
        const waiter = waiters.get(actionMessage.data.requestId)
        if (!waiter) return
        clearTimeout(waiter.timer)
        waiters.delete(actionMessage.data.requestId)
        if (actionMessage.data.ok) waiter.resolve(actionMessage.data.value)
        else waiter.reject(new Error(actionMessage.data.error))
        return
      }
      const parsed = appletMessageSchema.safeParse(event.data)
      if (!parsed.success || parsed.data.channel !== output.channel) return
      const message = parsed.data
      if (message.action === 'revoke') {
        revoke()
        return
      }
      if (!bridgeActive.current) return
      if (message.action === 'ready') {
        setReady(true)
        if (!reportedReady.current) {
          reportedReady.current = true
          onReadyRef.current?.()
        }
        return
      }
      const respond = (result: { ok: true; value: unknown } | { ok: false; error: string }) => {
        if (!bridgeActive.current) return
        frameRef.current?.contentWindow?.postMessage(
          {
            source: 'eevee-harness',
            channel: message.channel,
            id: message.id,
            ...result,
          },
          '*',
        )
      }
      void (async () => {
        try {
          const requiredEffect: AppletActionEffect | null =
            message.action === 'set'
              ? 'state:write'
              : message.action === 'get' || message.action === 'all'
                ? 'state:read'
                : message.action === 'files-list'
                  ? 'files:list'
                  : message.action.startsWith('files-')
                    ? 'files:read'
                    : null
          if (message.invocation && requiredEffect) {
            const invocation = actionWaiters.current.get(message.invocation.requestId)
            const action = actionByName.get(message.invocation.name)
            if (
              !invocation ||
              invocation.actionName !== message.invocation.name ||
              !action ||
              !action.effects.includes(requiredEffect)
            ) {
              respond({
                ok: false,
                error: `The ${message.invocation.name} action is not allowed to use ${requiredEffect}`,
              })
              return
            }
          }
          // An untagged durable write is either the person using the applet's
          // own interface or an action handler that deferred its write past
          // the invocation to slip the gate. The browser's user-activation
          // flag tells them apart, and the applet cannot forge it.
          if (
            message.action === 'set' &&
            storage === 'durable' &&
            !message.invocation &&
            agentHasActed.current &&
            !personIsInteracting()
          ) {
            respond({
              ok: false,
              error:
                'Durable writes outside a person\'s interaction must go through a declared action with human authority',
            })
            return
          }
          if (message.action === 'files-list') {
            const listed = await api.listFiles()
            respond({
              ok: true,
              value: listed.files.map(({ id, name, medium, version, size }) => ({
                id,
                name,
                medium,
                version,
                size,
              })),
            })
            return
          }
          if (message.action === 'files-read') {
            const [inspected, bytes] = await Promise.all([
              api.inspectFile(message.payload.fileId),
              api.readFile(message.payload.fileId),
            ])
            respond({
              ok: true,
              value: {
                id: inspected.detail.file.id,
                name: inspected.detail.file.name,
                medium: inspected.detail.file.medium,
                version: inspected.detail.file.version,
                contentBase64: encodeBase64(bytes),
              },
            })
            return
          }
          if (message.action === 'files-table') {
            const table = await api.readFileTable(message.payload.fileId)
            respond({ ok: true, value: table.sheets })
            return
          }
          if (message.action === 'files-text') {
            const text = await api.readFileText(message.payload.fileId)
            respond({ ok: true, value: text.text })
            return
          }
          if (storage === 'ephemeral') {
            if (message.action === 'all') {
              respond({ ok: true, value: memory.current.all() })
              return
            }
            if (message.action === 'get') {
              respond({ ok: true, value: memory.current.get(message.payload.key) })
              return
            }
            respond({
              ok: true,
              value: memory.current.set(message.payload.key, message.payload.value),
            })
            return
          }
          if (message.action === 'all') {
            respond({ ok: true, value: await api.readState(appletId) })
            return
          }
          if (message.action === 'get') {
            const values = await api.readState(appletId)
            respond({ ok: true, value: values[message.payload.key] ?? null })
            return
          }
          respond({
            ok: true,
            value: await api.writeState(appletId, message.payload.key, message.payload.value),
          })
        } catch (error) {
          respond({
            ok: false,
            error: error instanceof Error ? error.message : 'Storage request failed',
          })
        }
      })()
    }
    window.addEventListener('message', receive)
    return () => window.removeEventListener('message', receive)
  }, [actionByName, appletId, output.channel, revoke, storage])

  // Waiters are rejected only on true unmount. Rejecting them whenever the
  // listener effect re-subscribed used to fail in-flight approved actions on
  // any unrelated parent re-render.
  useEffect(() => {
    const waiters = actionWaiters.current
    return () => {
      for (const waiter of waiters.values()) {
        clearTimeout(waiter.timer)
        waiter.reject(new Error('The applet runtime closed before the action finished'))
      }
      waiters.clear()
    }
  }, [])

  useEffect(() => {
    if (storage !== 'durable' || !runId) return
    const controller = new AbortController()
    void api
      .listActionRequests(runId, controller.signal)
      .then(({ requests }) => {
        setActionRequests(requests)
        // Rehearse only the pending requests the ledger can show. Rehearsing
        // all fifty would spawn fifty shadow iframes on every mount.
        for (const request of requests.filter(({ state }) => state === 'pending').slice(0, 8)) {
          rehearse(request)
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) setActionRequests([])
      })
    return () => controller.abort()
  }, [rehearse, runId, storage])

  // A rehearsal is a picture of consequences against the state at that
  // moment. After any other write lands, the picture is stale, so pending
  // cards rehearse again rather than show a before/after that no longer holds.
  const pendingIds = actionRequests
    .filter(({ state }) => state === 'pending')
    .slice(0, 8)
    .map(({ id }) => id)
    .join(',')
  useEffect(() => {
    if (storage !== 'durable' || pendingIds === '') return
    const rerun = () => {
      for (const request of actionRequests.filter(({ state }) => state === 'pending').slice(0, 8)) {
        rehearse(request, true)
      }
    }
    window.addEventListener('eevee:state-changed', rerun)
    return () => window.removeEventListener('eevee:state-changed', rerun)
    // actionRequests is intentionally read through pendingIds so the listener
    // only re-subscribes when the set of pending cards changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingIds, rehearse, storage])

  const executeApprovedAction = useCallback(
    async (request: AppletActionRequest): Promise<AppletActionRequest> => {
      const frame = frameRef.current?.contentWindow
      if (!frame || !bridgeActive.current) {
        throw new Error('The applet runtime is unavailable; run the applet again')
      }
      agentHasActed.current = true
      const started = await api.updateActionRequest(request.id, { operation: 'start' })
      updateActionRequest(started.request)
      try {
        const result = await new Promise<JsonValue>((resolve, reject) => {
          const timer = setTimeout(() => {
            actionWaiters.current.delete(request.id)
            reject(new Error('The applet action timed out'))
          }, 15_000)
          actionWaiters.current.set(request.id, {
            actionName: request.action.name,
            resolve,
            reject,
            timer,
          })
          frame.postMessage(
            {
              source: 'eevee-action',
              channel: output.channel,
              requestId: request.id,
              name: request.action.name,
              input: request.input,
            },
            '*',
          )
        })
        const completed = await api.updateActionRequest(request.id, {
          operation: 'complete',
          result,
        })
        updateActionRequest(completed.request)
        if (request.action.effects.includes('state:write')) {
          window.dispatchEvent(new CustomEvent('eevee:state-changed', { detail: { appletId } }))
        }
        return completed.request
      } catch (error) {
        const raw = error instanceof Error ? error.message : ''
        // The fail operation requires 1–500 trimmed characters; an oversized
        // or empty message must not strand the request in `running`.
        const message = raw.trim().slice(0, 500) || 'The applet action failed'
        const failed = await api.updateActionRequest(request.id, {
          operation: 'fail',
          error: message,
        })
        updateActionRequest(failed.request)
        throw error
      }
    },
    [appletId, output.channel, updateActionRequest],
  )

  useEffect(() => {
    const context = modelContextOf()
    if (!context || !ready || storage !== 'durable' || !runId || actions.length === 0) return
    const controller = new AbortController()
    const registrations = actions.map((action) => {
      const name = `${APPLET_ACTION_TOOL_PREFIX}${action.name}`
      return context
        .registerTool(
          {
            name,
            title: action.title,
            description: `${action.description} Authority: ${action.authority}. Effects: ${action.effects.join(', ') || 'none'}.${
              action.authority === 'human'
                ? ' The call waits up to 45 seconds for the person to decide; if it returns pending, use await_action_decision.'
                : ''
            }`,
            inputSchema: appletActionInputSchema(action),
            annotations: {
              readOnlyHint: action.authority === 'automatic' && !action.effects.includes('state:write'),
              untrustedContentHint: action.effects.includes('files:read'),
            },
            execute: async (input, options) => {
              const signal = options?.signal ?? new AbortController().signal
              const activityId = crypto.randomUUID()
              const startedAt = performance.now()
              const report = (phase: 'succeeded' | 'failed', error: string | null, suffix = '') =>
                emitToolActivity({
                  id: activityId,
                  tool: name,
                  title: `${action.title}${suffix}`,
                  phase,
                  at: new Date().toISOString(),
                  durationMs: Math.round(performance.now() - startedAt),
                  error,
                })
              emitToolActivity({
                id: activityId,
                tool: name,
                title: action.title,
                phase: 'started',
                at: new Date().toISOString(),
                durationMs: null,
                error: null,
              })
              try {
                if (!frameRef.current?.contentWindow || !bridgeActive.current) {
                  throw new Error('The applet runtime is unavailable; call run_applet again')
                }
                const created = await api.createActionRequest(runId, action.name, input ?? {}, signal)
                updateActionRequest(created.request)
                if (created.request.state === 'pending') {
                  // An active lease is spent authority: the person already
                  // granted this run a bounded number of writes, so the request
                  // is approved on their standing decision and the spend is
                  // visible in the lease chip and the activity record.
                  const activeLease = leaseRef.current
                  if (activeLease && leaseActive(activeLease)) {
                    const authorized = await api.spendAutonomyLease(
                      created.request.id,
                      activeLease.leaseId,
                      signal,
                    )
                    updateLease(authorized.lease)
                    updateActionRequest(authorized.request)
                    const spent = await executeApprovedAction(authorized.request)
                    report('succeeded', null, ' (leased)')
                    return {
                      status: spent.state,
                      requestId: spent.id,
                      result: spent.result,
                      lease: {
                        remainingWrites: leaseRef.current?.remainingWrites ?? 0,
                        expiresAt: activeLease.expiresAt,
                      },
                    }
                  }
                  rehearse(created.request)
                  // The decision is the product. Waiting here lets the agent's
                  // call resolve the moment the person taps their passkey,
                  // instead of forcing a polling loop on every write.
                  const settled = await waitForActionDecision(
                    created.request.id,
                    INLINE_DECISION_WAIT_MS,
                    signal,
                  )
                  updateActionRequest(settled)
                  if (decided(settled.state)) {
                    report(settled.state === 'succeeded' ? 'succeeded' : 'failed', settled.error)
                    return {
                      status: settled.state,
                      requestId: settled.id,
                      result: settled.result,
                      ...(settled.error ? { error: settled.error } : {}),
                    }
                  }
                  report('succeeded', null, ' (waiting)')
                  return {
                    status: 'pending_human_approval',
                    requestId: created.request.id,
                    message:
                      'The person has not decided yet. The request is rehearsed and visible in EEVEE with field-level consequences; call await_action_decision with this requestId, or ask the person for an autonomy lease if several writes are coming.',
                  }
                }
                const completed = await executeApprovedAction(created.request)
                report('succeeded', null)
                return { status: completed.state, requestId: completed.id, result: completed.result }
              } catch (error) {
                report(
                  'failed',
                  error instanceof Error ? error.message.slice(0, 200) : 'The action failed',
                )
                throw error
              }
            },
          },
          { signal: controller.signal },
        )
        .then(
          () => null,
          (reason: unknown) => `${name}: ${reason instanceof Error ? reason.message : String(reason)}`,
        )
    })
    void Promise.all(registrations).then((outcomes) => {
      if (controller.signal.aborted) return
      const failures = outcomes.filter((outcome): outcome is string => outcome !== null)
      setToolRegistration({ live: actions.length - failures.length, failures })
      setToolsFresh(true)
      window.setTimeout(() => {
        if (!controller.signal.aborted) setToolsFresh(false)
      }, 2000)
    })
    return () => {
      controller.abort()
      setToolRegistration(null)
      setToolsFresh(false)
    }
  }, [actions, executeApprovedAction, ready, rehearse, runId, storage, updateActionRequest, updateLease])

  const humanActions = useMemo(() => actions.filter((action) => action.authority === 'human'), [actions])

  const sendTestRequest = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const action = testAction ? actionByName.get(testAction) : undefined
    if (!action || !runId || sendingTest) return
    const form = new FormData(event.currentTarget)
    const input: Record<string, JsonValue> = {}
    for (const field of action.inputs) {
      const value = valueFor(field, form)
      if (value !== undefined) input[field.key] = value
    }
    setSendingTest(true)
    setAuthorityError('')
    try {
      if (!frameRef.current?.contentWindow || !bridgeActive.current) {
        throw new Error('The applet runtime is unavailable; run the applet again')
      }
      const created = await api.createActionRequest(runId, action.name, input)
      updateActionRequest(created.request)
      if (created.request.state === 'pending') rehearse(created.request)
      setTestAction(null)
    } catch (reason) {
      setAuthorityError(reason instanceof Error ? reason.message : 'The request was not created')
    } finally {
      setSendingTest(false)
    }
  }

  const decide = async (
    request: AppletActionRequest,
    decision: 'approve' | 'reject',
    reason?: string,
  ) => {
    setDecidingId(request.id)
    setConfirmingId(null)
    setRejectingId(null)
    try {
      setAuthorityError('')
      const authorized = await authorizeHuman({
        kind: 'action-decision',
        requestId: request.id,
        decision,
        ...(decision === 'reject' && reason ? { reason } : {}),
      })
      if (authorized.kind !== 'action-decision') {
        throw new Error('The passkey did not authorize this decision')
      }
      updateActionRequest(authorized.request)
      window.dispatchEvent(new CustomEvent('eevee:changed', { detail: { appletId } }))
      if (decision === 'approve') await executeApprovedAction(authorized.request)
      setSettledId(`${decision}:${request.id}`)
      window.setTimeout(
        () => setSettledId((current) => (current === `${decision}:${request.id}` ? null : current)),
        2600,
      )
    } catch (error) {
      const message = error instanceof Error ? error.message : 'The action decision failed'
      setAuthorityError(message)
      setActionRequests((current) =>
        current.map((item) => (item.id === request.id ? { ...item, error: message } : item)),
      )
    } finally {
      setDecidingId(null)
      setRejectReason('')
    }
  }

  const grantLease = async (writes: number, minutes: number) => {
    if (!runId) return
    setGrantingLease(true)
    setAuthorityError('')
    try {
      const authorized = await authorizeHuman({
        kind: 'autonomy-lease',
        appletId,
        runId,
        writes,
        minutes,
      })
      if (authorized.kind !== 'autonomy-lease') {
        throw new Error('The passkey did not authorize this lease')
      }
      updateLease(authorized.lease)
    } catch (error) {
      setAuthorityError(error instanceof Error ? error.message : 'The lease was not granted')
    } finally {
      setGrantingLease(false)
    }
  }

  const revokeLease = async (current: AutonomyLease) => {
    updateLease(null)
    try {
      await api.revokeAutonomyLease(current.leaseId)
    } catch (error) {
      setAuthorityError(error instanceof Error ? error.message : 'The lease was not revoked')
    }
  }

  // A decision opened from the topbar queue scrolls its card into view; the
  // rehearsal diff and the approve control live here, below the specimen.
  const ledgerRef = useRef<HTMLElement>(null)
  useEffect(() => {
    if (!focusRequestId) return
    if (!actionRequests.some(({ id }) => id === focusRequestId)) return
    ledgerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, [actionRequests, focusRequestId])

  const titleId = `preview-${output.channel}`
  const activeLease = leaseActive(lease) ? lease : null

  return (
    <section
      className={frameless ? 'preview-stage is-frameless' : 'preview-stage'}
      aria-labelledby={titleId}
    >
      <header className={frameless && ready ? 'is-hidden' : undefined}>
        <h3 id={titleId}>{title}</h3>
        <span>{ready ? 'Runtime connected' : revoked ? 'Runtime stopped' : 'Starting runtime'}</span>
      </header>
      <iframe
        ref={frameRef}
        title="Applet output"
        sandbox="allow-scripts allow-forms"
        referrerPolicy="no-referrer"
        srcDoc={output.html}
        onLoad={() => {
          if (loadCount.current === 0) {
            loadCount.current = 1
            return
          }
          revoke()
        }}
      />
      {storage === 'durable' && actions.length > 0 ? (
        <section ref={ledgerRef} className="applet-action-ledger" aria-labelledby={`${titleId}-actions`}>
          <header>
            <h4 id={`${titleId}-actions`}>
              Actions
              {toolRegistration ? (
                <small
                  className={[
                    'action-tools',
                    toolRegistration.failures.length > 0 ? 'is-partial' : '',
                    toolsFresh ? 'is-fresh' : '',
                  ].filter(Boolean).join(' ')}
                  title={
                    toolRegistration.failures.length > 0
                      ? toolRegistration.failures.join('\n')
                      : 'Every declared action is registered as an applet_* WebMCP tool for the agent.'
                  }
                >
                  {toolRegistration.live} of {actions.length} live as agent tools
                </small>
              ) : null}
            </h4>
            <div className="lease-controls">
              {activeLease ? (
                <>
                  <span className="lease-chip" title="The agent may spend these writes without asking again. Every spend still lands in the record.">
                    Lease · {activeLease.remainingWrites} of {activeLease.grantedWrites} writes ·
                    until {new Date(activeLease.expiresAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </span>
                  <button className="text-action" type="button" onClick={() => void revokeLease(activeLease)}>
                    Revoke
                  </button>
                </>
              ) : (
                <>
                  <span className="lease-offer-label">Grant a lease</span>
                  {LEASE_CHOICES.map((choice) => (
                    <button
                      key={choice.label}
                      type="button"
                      className="lease-offer"
                      disabled={grantingLease}
                      title={`The agent may make ${choice.writes} writes in the next ${choice.minutes} minutes without asking. Each spend is recorded here; revoke any time.`}
                      onClick={() => void grantLease(choice.writes, choice.minutes)}
                    >
                      {grantingLease ? 'Verifying…' : choice.label}
                    </button>
                  ))}
                  <small className="lease-offer-note">
                    Writes then run without asking, each one recorded here; revoke any time. Needs your passkey.
                  </small>
                </>
              )}
            </div>
          </header>
          {authorityError ? <p className="form-error" role="alert">{authorityError}</p> : null}
          {actionRequests.length === 0 ? (
            <div className="ledger-empty">
              <p>
                No requests yet. Clicking inside the app is you, so nothing waits. When an agent calls one of
                these actions, its request lands here, rehearsed against current data, for your decision.
              </p>
              {runId && humanActions.length > 0 && storage === 'durable' ? (
                testAction === null ? (
                  <button type="button" className="text-action" onClick={() => setTestAction(humanActions[0]?.name ?? null)}>
                    Send a request the way an agent would
                  </button>
                ) : (
                  <form className="ledger-test" onSubmit={(event) => void sendTestRequest(event)}>
                    <label className="run-field" htmlFor="test-action">
                      <span>Action</span>
                      <select id="test-action" value={testAction} onChange={(event) => setTestAction(event.target.value)}>
                        {humanActions.map((action) => (
                          <option key={action.name} value={action.name}>
                            {action.title}
                          </option>
                        ))}
                      </select>
                      <small>{actionByName.get(testAction)?.description}</small>
                    </label>
                    <div className="run-fields">
                      {(actionByName.get(testAction)?.inputs ?? []).map((field) => (
                        <Field key={`${testAction}-${field.key}`} field={field} />
                      ))}
                    </div>
                    <span className="applet-action-decision">
                      <button type="submit" disabled={sendingTest}>
                        {sendingTest ? 'Sending…' : 'Send request'}
                      </button>
                      <button type="button" className="text-action" onClick={() => setTestAction(null)}>
                        Cancel
                      </button>
                    </span>
                  </form>
                )
              ) : null}
            </div>
          ) : (
            <ol>
              {actionRequests.slice(0, 8).map((request) => {
                const rehearsal = rehearsals[request.id]
                const rehearsed = rehearsal?.verdict === 'returned'
                const busy = decidingId === request.id
                return (
                  <li
                    key={request.id}
                    className={[
                      request.id === focusRequestId ? 'is-focus' : '',
                      settledId === `approve:${request.id}` ? 'is-settled' : '',
                      settledId === `reject:${request.id}` ? 'is-dismissed' : '',
                    ]
                      .filter(Boolean)
                      .join(' ') || undefined}
                  >
                    <div>
                      <strong>{request.action.title}</strong>
                      <span>{requestStateLabel(request)} · {effectsLabel(request.action.effects)}</span>
                      <code>{JSON.stringify(request.input)}</code>
                      {request.state === 'pending' ? <RehearsalCard rehearsal={rehearsal} /> : null}
                      {request.error ? <p role="alert">{request.error}</p> : null}
                    </div>
                    {request.state === 'pending' ? (
                      <span className="applet-action-decision">
                        {rejectingId === request.id ? (
                          <>
                            <input
                              type="text"
                              maxLength={300}
                              placeholder="Reason for the agent (optional)"
                              aria-label="Rejection reason"
                              value={rejectReason}
                              onChange={(event) => setRejectReason(event.target.value)}
                            />
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => void decide(request, 'reject', rejectReason.trim() || undefined)}
                            >
                              Confirm reject
                            </button>
                            <button type="button" className="text-action" onClick={() => setRejectingId(null)}>
                              Back
                            </button>
                          </>
                        ) : confirmingId === request.id ? (
                          <>
                            <button type="button" disabled={busy} onClick={() => void decide(request, 'approve')}>
                              Approve without rehearsal
                            </button>
                            <button type="button" className="text-action" onClick={() => setConfirmingId(null)}>
                              Back
                            </button>
                          </>
                        ) : (
                          <>
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() =>
                                rehearsed ? void decide(request, 'approve') : setConfirmingId(request.id)
                              }
                            >
                              {busy ? 'Verifying…' : 'Approve'}
                            </button>
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => {
                                setRejectReason('')
                                setRejectingId(request.id)
                              }}
                            >
                              Reject
                            </button>
                          </>
                        )}
                      </span>
                    ) : request.state === 'succeeded' ? (
                      <details className="action-result">
                        <summary>Result</summary>
                        <code>{JSON.stringify(request.result)}</code>
                      </details>
                    ) : null}
                  </li>
                )
              })}
            </ol>
          )}
        </section>
      ) : null}
    </section>
  )
}

const EFFECT_LABELS: Record<AppletActionEffect, string> = {
  'state:read': 'reads state',
  'state:write': 'writes state',
  'files:list': 'lists files',
  'files:read': 'reads files',
}

const effectsLabel = (effects: readonly AppletActionEffect[]): string =>
  effects.length === 0 ? 'no durable effects' : effects.map((effect) => EFFECT_LABELS[effect]).join(', ')

const requestStateLabel = (request: AppletActionRequest): string => {
  switch (request.state) {
    case 'pending':
      return 'waiting for you'
    case 'approved':
      return 'approved'
    case 'rejected':
      return 'rejected'
    case 'running':
      return 'running'
    case 'succeeded':
      return 'done'
    case 'failed':
      return 'failed'
    default: {
      const unreachable: never = request.state
      return unreachable
    }
  }
}

const preview = (value: JsonValue): string => {
  const encoded = JSON.stringify(value)
  return encoded.length > 160 ? `${encoded.slice(0, 157)}…` : encoded
}

function RehearsalCard({ rehearsal }: { rehearsal: Rehearsal | undefined }) {
  if (!rehearsal) return null
  if (rehearsal.verdict === 'unavailable') {
    return <p className="rehearsal is-unavailable">Rehearsal: {rehearsal.error}</p>
  }
  if (rehearsal.verdict === 'refused') {
    return (
      <div className="rehearsal is-refused">
        <p>Rehearsed against current state. The applet refused:</p>
        <code>{rehearsal.error}</code>
      </div>
    )
  }
  const changes = rehearsalChanges(rehearsal.writes)
  return (
    <div className="rehearsal is-returned">
      <p>Rehearsed against current data · {summarizeChanges(changes)}</p>
      {changes.map((change) => (
        <dl key={change.path} className={`is-${change.kind}`} title={change.path}>
          <dt>
            <span className="rehearsal-group">{change.group}</span>
            {change.kind === 'changed' ? (
              <>
                {change.subject ? <span className="rehearsal-subject">{change.subject}</span> : null}
                <span className="rehearsal-field">{change.field}</span>
              </>
            ) : (
              <span className="rehearsal-field">{change.kind}</span>
            )}
          </dt>
          <dd>
            {change.kind === 'changed' ? (
              <>
                <s>{preview(change.before)}</s>
                <span aria-hidden="true"> → </span>
                <ins>{preview(change.after)}</ins>
              </>
            ) : change.kind === 'added' ? (
              <ins>{change.subject ?? preview(change.after)}</ins>
            ) : (
              <s>{change.subject ?? preview(change.before)}</s>
            )}
          </dd>
        </dl>
      ))}
    </div>
  )
}
