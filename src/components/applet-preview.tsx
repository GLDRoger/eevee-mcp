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
import { createBoundedMemoryStore } from '@/domain/applet-store'
import { api } from '@/client/api'
import { appletActionMessageSchema, appletMessageSchema } from '@/client/applet-messages'
import { emitToolActivity } from '@/client/tool-activity'

const encodeBase64 = (bytes: Uint8Array): string => {
  let binary = ''
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000))
  }
  return btoa(binary)
}

export function AppletPreview({
  appletId,
  output,
  storage,
  runId,
  actions = [],
  title = 'Live specimen',
  onReady,
  onRevoked,
}: {
  appletId: string
  output: AppletRunOutput
  storage: 'durable' | 'ephemeral'
  runId?: string
  actions?: readonly AppletActionDefinition[]
  title?: string
  onReady?: () => void
  onRevoked?: () => void
}) {
  const frameRef = useRef<HTMLIFrameElement>(null)
  const bridgeActive = useRef(true)
  const loadCount = useRef(0)
  const memory = useRef(createBoundedMemoryStore())
  const reportedReady = useRef(false)
  const reportedRevoked = useRef(false)
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
  const actionByName = useMemo(
    () => new Map(actions.map((action) => [action.name, action])),
    [actions],
  )

  const updateActionRequest = useCallback((next: AppletActionRequest) => {
    setActionRequests((current) => [next, ...current.filter(({ id }) => id !== next.id)].slice(0, 50))
  }, [])

  const revoke = useCallback(() => {
    bridgeActive.current = false
    setReady(false)
    setRevoked(true)
    if (!reportedRevoked.current) {
      reportedRevoked.current = true
      onRevoked?.()
    }
  }, [onRevoked])

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
          onReady?.()
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
    return () => {
      window.removeEventListener('message', receive)
      for (const waiter of waiters.values()) {
        clearTimeout(waiter.timer)
        waiter.reject(new Error('The applet runtime closed before the action finished'))
      }
      waiters.clear()
    }
  }, [actionByName, appletId, onReady, output.channel, revoke, storage])

  useEffect(() => {
    if (storage !== 'durable' || !runId) return
    const controller = new AbortController()
    void api
      .listActionRequests(runId, controller.signal)
      .then(({ requests }) => setActionRequests(requests))
      .catch(() => {
        if (!controller.signal.aborted) setActionRequests([])
      })
    return () => controller.abort()
  }, [runId, storage])

  const executeApprovedAction = useCallback(
    async (request: AppletActionRequest): Promise<AppletActionRequest> => {
      const frame = frameRef.current?.contentWindow
      if (!frame) throw new Error('The applet runtime is unavailable')
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
        return completed.request
      } catch (error) {
        const message = error instanceof Error ? error.message : 'The applet action failed'
        const failed = await api.updateActionRequest(request.id, {
          operation: 'fail',
          error: message,
        })
        updateActionRequest(failed.request)
        throw error
      }
    },
    [output.channel, updateActionRequest],
  )

  useEffect(() => {
    const context = document.modelContext
    if (!context || !ready || storage !== 'durable' || !runId || actions.length === 0) return
    const controller = new AbortController()
    const registrations = actions.map((action) => {
      const name = `${APPLET_ACTION_TOOL_PREFIX}${action.name}`
      return context.registerTool(
        {
          name,
          title: action.title,
          description: `${action.description} Authority: ${action.authority}. Effects: ${action.effects.join(', ') || 'none'}.`,
          inputSchema: appletActionInputSchema(action),
          annotations: {
            readOnlyHint: !action.effects.includes('state:write'),
            untrustedContentHint: action.effects.includes('files:read'),
          },
          execute: async (input, { signal }) => {
            const activityId = crypto.randomUUID()
            const startedAt = performance.now()
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
              const created = await api.createActionRequest(runId, action.name, input, signal)
              updateActionRequest(created.request)
              if (created.request.state === 'pending') {
                emitToolActivity({
                  id: activityId,
                  tool: name,
                  title: action.title,
                  phase: 'succeeded',
                  at: new Date().toISOString(),
                  durationMs: Math.round(performance.now() - startedAt),
                  error: null,
                })
                return {
                  status: 'pending_human_approval',
                  requestId: created.request.id,
                  message: 'The request is visible in EEVEE. A person must approve it.',
                }
              }
              const completed = await executeApprovedAction(created.request)
              emitToolActivity({
                id: activityId,
                tool: name,
                title: action.title,
                phase: 'succeeded',
                at: new Date().toISOString(),
                durationMs: Math.round(performance.now() - startedAt),
                error: null,
              })
              return { status: completed.state, requestId: completed.id, result: completed.result }
            } catch (error) {
              emitToolActivity({
                id: activityId,
                tool: name,
                title: action.title,
                phase: 'failed',
                at: new Date().toISOString(),
                durationMs: Math.round(performance.now() - startedAt),
                error: error instanceof Error ? error.message.slice(0, 200) : 'The action failed',
              })
              throw error
            }
          },
        },
        { signal: controller.signal },
      )
    })
    void Promise.all(registrations).catch(() => controller.abort())
    return () => controller.abort()
  }, [actions, executeApprovedAction, ready, runId, storage, updateActionRequest])

  const decide = async (request: AppletActionRequest, decision: 'approve' | 'reject') => {
    try {
      const decided = await api.updateActionRequest(request.id, { operation: decision })
      updateActionRequest(decided.request)
      if (decision === 'approve') await executeApprovedAction(decided.request)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'The action decision failed'
      setActionRequests((current) =>
        current.map((item) => (item.id === request.id ? { ...item, error: message } : item)),
      )
    }
  }

  const titleId = `preview-${output.channel}`

  return (
    <section className="preview-stage" aria-labelledby={titleId}>
      <header>
        <h3 id={titleId}>{title}</h3>
        <span>{ready ? 'Runtime connected' : revoked ? 'Runtime revoked' : 'Starting runtime'}</span>
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
        <section className="applet-action-ledger" aria-labelledby={`${titleId}-actions`}>
          <header>
            <h4 id={`${titleId}-actions`}>Governed actions</h4>
            <span>{actions.length} published</span>
          </header>
          {actionRequests.length === 0 ? (
            <p>No action requests yet. Published actions appear as live WebMCP tools.</p>
          ) : (
            <ol>
              {actionRequests.slice(0, 8).map((request) => (
                <li key={request.id}>
                  <div>
                    <strong>{request.action.title}</strong>
                    <span>{request.state} · {request.action.effects.join(', ') || 'no durable effects'}</span>
                    <code>{JSON.stringify(request.input)}</code>
                    {request.error ? <p role="alert">{request.error}</p> : null}
                  </div>
                  {request.state === 'pending' ? (
                    <span className="applet-action-decision">
                      <button type="button" onClick={() => void decide(request, 'approve')}>Approve</button>
                      <button type="button" onClick={() => void decide(request, 'reject')}>Reject</button>
                    </span>
                  ) : request.state === 'succeeded' ? (
                    <code>{JSON.stringify(request.result)}</code>
                  ) : null}
                </li>
              ))}
            </ol>
          )}
        </section>
      ) : null}
    </section>
  )
}
