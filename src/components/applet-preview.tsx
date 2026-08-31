'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { WebAppRunOutput } from '@/domain/applet'
import { createBoundedMemoryStore } from '@/domain/applet-store'
import { api } from '@/client/api'
import { appletMessageSchema } from '@/client/applet-messages'

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
  const memory = useRef(createBoundedMemoryStore())
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
    </section>
  )
}
