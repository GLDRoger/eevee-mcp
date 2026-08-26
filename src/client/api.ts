import { z } from 'zod'
import {
  appletDetailResponseSchema,
  appletListResponseSchema,
  appletPreviewResponseSchema,
  appletResponseSchema,
  appletRunResponseSchema,
  appletVersionResponseSchema,
  correctionResponseSchema,
  workspaceSessionResponseSchema,
} from '@/domain/api'
import type {
  CreateAppletInput,
  CreateCorrectionInput,
  CreateRunInput,
  CreateVersionInput,
} from '@/domain/applet'
import { jsonObjectSchema, jsonValueSchema, type JsonValue } from '@/domain/json'

const errorSchema = z.object({ error: z.object({ message: z.string() }) })

const requestJson = async <Schema extends z.ZodType>(
  url: string,
  schema: Schema,
  init?: RequestInit,
): Promise<z.output<Schema>> => {
  const response = await fetch(url, { ...init, credentials: 'include' })
  const body: unknown = await response.json().catch(() => null)
  if (!response.ok) {
    const parsed = errorSchema.safeParse(body)
    throw new Error(parsed.success ? parsed.data.error.message : `EEVEE returned HTTP ${response.status}`)
  }
  return schema.parse(body)
}

const jsonMutation = (method: 'POST' | 'PUT', body: unknown, signal?: AbortSignal): RequestInit => ({
  method,
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
  ...(signal ? { signal } : {}),
})

export const api = {
  session: (signal?: AbortSignal) =>
    requestJson('/api/session', workspaceSessionResponseSchema, signal ? { signal } : undefined),
  listApplets: (signal?: AbortSignal) =>
    requestJson('/api/applets', appletListResponseSchema, signal ? { signal } : undefined),
  inspectApplet: (appletId: string, signal?: AbortSignal) =>
    requestJson(
      `/api/applets/${encodeURIComponent(appletId)}`,
      appletDetailResponseSchema,
      signal ? { signal } : undefined,
    ),
  createApplet: (input: CreateAppletInput, signal?: AbortSignal) =>
    requestJson(
      '/api/applets',
      appletResponseSchema,
      jsonMutation('POST', input, signal),
    ),
  createVersion: (appletId: string, input: CreateVersionInput, signal?: AbortSignal) =>
    requestJson(
      `/api/applets/${encodeURIComponent(appletId)}/versions`,
      appletVersionResponseSchema,
      jsonMutation('POST', input, signal),
    ),
  previewVersion: (appletId: string, versionId: string, signal?: AbortSignal) =>
    requestJson(
      `/api/applets/${encodeURIComponent(appletId)}/versions/${encodeURIComponent(versionId)}/preview`,
      appletPreviewResponseSchema,
      signal ? { signal } : undefined,
    ),
  publishVersion: async (appletId: string, versionId: string): Promise<void> => {
    await requestJson(
      `/api/applets/${encodeURIComponent(appletId)}/versions/${encodeURIComponent(versionId)}/publish`,
      z.object({ published: z.literal(true) }),
      jsonMutation('POST', {}),
    )
  },
  runApplet: (appletId: string, input: CreateRunInput, signal?: AbortSignal) =>
    requestJson(
      `/api/applets/${encodeURIComponent(appletId)}/runs`,
      appletRunResponseSchema,
      jsonMutation('POST', input, signal),
    ),
  completeRun: (runId: string, channel: string, signal?: AbortSignal) =>
    requestJson(
      `/api/runs/${encodeURIComponent(runId)}/complete`,
      appletRunResponseSchema,
      jsonMutation('POST', { channel }, signal),
    ),
  failRun: (runId: string, channel: string, error: string, signal?: AbortSignal) =>
    requestJson(
      `/api/runs/${encodeURIComponent(runId)}/fail`,
      appletRunResponseSchema,
      jsonMutation('POST', { channel, error }, signal),
    ),
  inspectRun: (runId: string, signal?: AbortSignal) =>
    requestJson(
      `/api/runs/${encodeURIComponent(runId)}`,
      appletRunResponseSchema,
      signal ? { signal } : undefined,
    ),
  readState: async (appletId: string): Promise<Record<string, JsonValue>> => {
    const response = await requestJson(
      `/api/applets/${encodeURIComponent(appletId)}/state`,
      z.object({ values: jsonObjectSchema }),
    )
    return response.values
  },
  writeState: async (appletId: string, key: string, value: unknown): Promise<JsonValue> => {
    const response = await requestJson(
      `/api/applets/${encodeURIComponent(appletId)}/state`,
      z.object({ value: jsonValueSchema }),
      jsonMutation('PUT', { key, value }),
    )
    return response.value
  },
  createCorrection: (runId: string, input: CreateCorrectionInput, signal?: AbortSignal) =>
    requestJson(
      `/api/runs/${encodeURIComponent(runId)}/corrections`,
      correctionResponseSchema,
      jsonMutation('POST', input, signal),
    ),
}
