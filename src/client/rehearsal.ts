import { z } from 'zod'
import type { AppletActionDefinition, AppletActionEffect } from '@/domain/applet-action'
import { encodeBase64 } from '@/domain/bytes'
import type { JsonValue } from '@/domain/json'
import { api } from './api'
import { appletActionMessageSchema, appletMessageSchema } from './applet-messages'

const REHEARSAL_TIMEOUT_MS = 12_000

export type RehearsalWrite = { key: string; before: JsonValue; after: JsonValue }

export type Rehearsal =
  | { verdict: 'returned'; result: JsonValue; writes: RehearsalWrite[] }
  | { verdict: 'refused'; error: string; writes: RehearsalWrite[] }
  | { verdict: 'unavailable'; error: string }

const jsonRecordSchema = z.record(z.string(), z.custom<JsonValue>())

/**
 * Dry-run one pending action inside a shadow sandbox seeded with the CURRENT
 * durable state. Every write is intercepted and recorded instead of persisted,
 * file access stays read-only, and the applet's own handler produces the
 * result — so the approval card can show what WILL happen, not what the agent
 * says. The shadow frame never touches the visible runtime: it is a separate
 * iframe whose storage bridge terminates here.
 */
export const rehearseAction = (
  appletId: string,
  html: string,
  channel: string,
  action: AppletActionDefinition,
  input: Readonly<Record<string, unknown>>,
  requestId: string,
  signal?: AbortSignal,
): Promise<Rehearsal> =>
  new Promise((resolve) => {
    const frame = document.createElement('iframe')
    const writes: RehearsalWrite[] = []
    let state: Record<string, JsonValue> = {}
    let settled = false
    // The abort check and the timeout are armed only after every binding that
    // finish() touches exists. An already-aborted signal used to reach the
    // timer and receive bindings in their temporal dead zone, which threw
    // inside the executor, rejected the promise, and left the decision card on
    // "Rehearsing…" with no timeout to rescue it.
    let timer = 0

    const aborted = () =>
      finish({ verdict: 'unavailable', error: 'The rehearsal was cancelled' })

    const finish = (rehearsal: Rehearsal) => {
      if (settled) return
      settled = true
      window.clearTimeout(timer)
      window.removeEventListener('message', receive, true)
      signal?.removeEventListener('abort', aborted)
      frame.remove()
      resolve(rehearsal)
    }

    const allows = (effect: AppletActionEffect): boolean => action.effects.includes(effect)

    const respond = (id: string, result: { ok: true; value: unknown } | { ok: false; error: string }) => {
      frame.contentWindow?.postMessage({ source: 'eevee-harness', channel, id, ...result }, '*')
    }

    const receive = (event: MessageEvent<unknown>) => {
      if (event.source !== frame.contentWindow) return
      event.stopImmediatePropagation()

      const actionMessage = appletActionMessageSchema.safeParse(event.data)
      if (actionMessage.success && actionMessage.data.channel === channel) {
        if (actionMessage.data.requestId !== requestId) return
        finish(
          actionMessage.data.ok
            ? { verdict: 'returned', result: actionMessage.data.value, writes }
            : { verdict: 'refused', error: actionMessage.data.error, writes },
        )
        return
      }

      const parsed = appletMessageSchema.safeParse(event.data)
      if (!parsed.success || parsed.data.channel !== channel) return
      const message = parsed.data

      if (message.action === 'revoke') {
        finish({ verdict: 'unavailable', error: 'The applet runtime stopped during rehearsal' })
        return
      }
      if (message.action === 'ready') {
        frame.contentWindow?.postMessage(
          { source: 'eevee-action', channel, requestId, name: action.name, input },
          '*',
        )
        return
      }

      void (async () => {
        try {
          // The rehearsal must enforce exactly what the real harness enforces
          // (applet-preview.tsx): an invocation-tagged bridge call fails when
          // its effect is not declared. A laxer rehearsal would show a clean
          // consequence card for an action that will refuse on execution.
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
          const taggedByAction = message.invocation?.requestId === requestId
          if (taggedByAction && requiredEffect && !allows(requiredEffect)) {
            respond(message.id, {
              ok: false,
              error: `The ${action.name} action is not allowed to use ${requiredEffect}`,
            })
            return
          }
          // The real harness rejects any invocation-tagged call whose request
          // has no live waiter. A call tagged with a foreign requestId must
          // fail here too, not slip through as an untagged mount-time call.
          if (message.invocation && !taggedByAction) {
            respond(message.id, {
              ok: false,
              error: `The ${message.invocation.name} action is not part of this rehearsal`,
            })
            return
          }
          switch (message.action) {
            case 'get':
              respond(message.id, { ok: true, value: state[message.payload.key] ?? null })
              return
            case 'all':
              respond(message.id, { ok: true, value: { ...state } })
              return
            case 'set': {
              // Mount-time writes update the shadow state but are not part of
              // the action's consequences; only tagged writes reach the card.
              if (taggedByAction) {
                writes.push({
                  key: message.payload.key,
                  before: state[message.payload.key] ?? null,
                  after: message.payload.value,
                })
              }
              state = { ...state, [message.payload.key]: message.payload.value }
              respond(message.id, { ok: true, value: message.payload.value })
              return
            }
            case 'files-list': {
              const listed = await api.listFiles()
              respond(message.id, {
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
            case 'files-table': {
              const table = await api.readFileTable(message.payload.fileId)
              respond(message.id, { ok: true, value: table.sheets })
              return
            }
            case 'files-text': {
              const text = await api.readFileText(message.payload.fileId)
              respond(message.id, { ok: true, value: text.text })
              return
            }
            case 'files-read': {
              // Reads are side-effect free, and refusing them here showed the
              // approving person a "refused" card for actions that succeed in
              // real execution. Serve the same read-only value the harness
              // serves; the effect gate above already enforced files:read.
              const [inspected, bytes] = await Promise.all([
                api.inspectFile(message.payload.fileId),
                api.readFile(message.payload.fileId),
              ])
              respond(message.id, {
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
          }
        } catch (error) {
          respond(message.id, {
            ok: false,
            error: error instanceof Error ? error.message : 'The rehearsal request failed',
          })
        }
      })()
    }

    if (signal?.aborted) {
      aborted()
      return
    }
    signal?.addEventListener('abort', aborted)

    timer = window.setTimeout(
      () => finish({ verdict: 'unavailable', error: 'The rehearsal timed out' }),
      REHEARSAL_TIMEOUT_MS,
    )

    void api
      .readState(appletId)
      .then((values) => {
        state = jsonRecordSchema.parse(values)
        window.addEventListener('message', receive, true)
        frame.title = 'Action rehearsal'
        frame.setAttribute('sandbox', 'allow-scripts allow-forms')
        frame.setAttribute('referrerpolicy', 'no-referrer')
        frame.setAttribute('aria-hidden', 'true')
        Object.assign(frame.style, {
          border: '0',
          height: '720px',
          left: '-10000px',
          opacity: '0',
          pointerEvents: 'none',
          position: 'fixed',
          top: '0',
          width: '1280px',
        })
        frame.srcdoc = html
        document.body.append(frame)
      })
      .catch(() =>
        finish({ verdict: 'unavailable', error: 'The current state could not be read' }),
      )
  })
