'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { z } from 'zod'
import type { WebAppRunOutput } from '@/domain/applet'
import { jsonValueSchema, type JsonValue } from '@/domain/json'
import { api } from '@/client/api'

const messageBase = {
  source: z.literal('eevee-applet'),
  channel: z.uuid(),
}
const appletMessageSchema = z.discriminatedUnion('action', [
  z.strictObject({ ...messageBase, action: z.literal('ready') }),
  z.strictObject({ ...messageBase, action: z.literal('revoke') }),
  z.strictObject({
    ...messageBase,
    id: z.string().min(1).max(100),
    action: z.literal('get'),
    payload: z.strictObject({ key: z.string().min(1).max(128) }),
  }),
  z.strictObject({
    ...messageBase,
    id: z.string().min(1).max(100),
    action: z.literal('set'),
    payload: z.strictObject({ key: z.string().min(1).max(128), value: jsonValueSchema }),
  }),
  z.strictObject({
    ...messageBase,
    id: z.string().min(1).max(100),
    action: z.literal('all'),
    payload: z.strictObject({}),
  }),
])

export function AppletPreview({
  appletId,
  output,
  storage,
  title = 'Live specimen',
  onReady,
  onRevoked,
}: {
  appletId: string
  output: WebAppRunOutput
  storage: 'durable' | 'ephemeral'
  title?: string
  onReady?: () => void
  onRevoked?: () => void
}) {
  const frameRef = useRef<HTMLIFrameElement>(null)
  const bridgeActive = useRef(true)
  const loadCount = useRef(0)
  const memory = useRef(new Map<string, JsonValue>())
  const reportedReady = useRef(false)
  const reportedRevoked = useRef(false)
  const [ready, setReady] = useState(false)
  const [revoked, setRevoked] = useState(false)

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
    const receive = (event: MessageEvent<unknown>) => {
      if (event.source !== frameRef.current?.contentWindow) return
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
          if (storage === 'ephemeral') {
            if (message.action === 'all') {
              respond({ ok: true, value: Object.fromEntries(memory.current) })
              return
            }
            if (message.action === 'get') {
              respond({ ok: true, value: memory.current.get(message.payload.key) ?? null })
              return
            }
            memory.current.set(message.payload.key, message.payload.value)
            respond({ ok: true, value: message.payload.value })
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
  }, [appletId, onReady, output.channel, revoke, storage])

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
        sandbox="allow-scripts"
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
    </section>
  )
}
