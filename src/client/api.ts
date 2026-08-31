import { z } from 'zod'
import {
  appletDetailResponseSchema,
  appletActionRequestListResponseSchema,
  appletActionRequestResponseSchema,
  appletListResponseSchema,
  appletPreviewResponseSchema,
  appletResponseSchema,
  appletRunResponseSchema,
  appletVersionResponseSchema,
  appletVersionDetailResponseSchema,
  correctionResponseSchema,
  evaluationExecutionResponseSchema,
  evaluationPlanResponseSchema,
  evaluationRunResponseSchema,
  evaluationSuiteResponseSchema,
  workspaceSessionResponseSchema,
} from '@/domain/api'
import type {
  CreateAppletInput,
  CreateCorrectionInput,
  CreateRunInput,
  CreateVersionInput,
} from '@/domain/applet'
import type { AppletActionRequest } from '@/domain/applet-action'
import type {
  CompleteEvaluationInput,
  CreateEvaluationSuiteInput,
  EvaluationTarget,
  StartEvaluationInput,
} from '@/domain/evaluation'
import { jsonObjectSchema, jsonValueSchema, type JsonValue } from '@/domain/json'
import { ownedArrayBuffer } from '@/domain/bytes'
import {
  officeFileDetailResponseSchema,
  officeFileListResponseSchema,
  officeFileResponseSchema,
} from '@/domain/office-file'
import type { PdfEdit } from '@/domain/pdf'
import type { WorkbookSaveRequest } from '@/office/sheets/shared/desktop-api'

const errorSchema = z.object({ error: z.object({ message: z.string() }) })
const tableScalarSchema = z.union([z.string(), z.number(), z.boolean(), z.null()])
const fileTableResponseSchema = z.strictObject({
  sheets: z.array(
    z.strictObject({ name: z.string(), rows: z.array(z.array(tableScalarSchema)) }),
  ),
})
const fileTextResponseSchema = z.strictObject({ text: z.string() })
const spreadsheetEditResponseSchema = officeFileResponseSchema.extend({
  touchedEntries: z.array(z.string()),
})

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

const fileMutation = (
  bytes: Uint8Array,
  headers: Record<string, string>,
  signal?: AbortSignal,
): RequestInit => ({
  method: 'POST',
  headers,
  body: ownedArrayBuffer(bytes),
  ...(signal ? { signal } : {}),
})

const requestBytes = async (url: string, signal?: AbortSignal): Promise<Uint8Array> => {
  const response = await fetch(url, { credentials: 'include', ...(signal ? { signal } : {}) })
  if (!response.ok) {
    const body: unknown = await response.json().catch(() => null)
    const parsed = errorSchema.safeParse(body)
    throw new Error(parsed.success ? parsed.data.error.message : `EEVEE returned HTTP ${response.status}`)
  }
  return new Uint8Array(await response.arrayBuffer())
}

export const api = {
  session: (signal?: AbortSignal) =>
    requestJson('/api/session', workspaceSessionResponseSchema, signal ? { signal } : undefined),
  listApplets: (signal?: AbortSignal) =>
    requestJson('/api/applets', appletListResponseSchema, signal ? { signal } : undefined),
  listFiles: (signal?: AbortSignal) =>
    requestJson('/api/files', officeFileListResponseSchema, signal ? { signal } : undefined),
  inspectFile: (fileId: string, signal?: AbortSignal) =>
    requestJson(
      `/api/files/${encodeURIComponent(fileId)}`,
      officeFileDetailResponseSchema,
      signal ? { signal } : undefined,
    ),
  readFile: (fileId: string, versionId?: string, signal?: AbortSignal) =>
    requestBytes(
      `/api/files/${encodeURIComponent(fileId)}/content${
        versionId ? `?versionId=${encodeURIComponent(versionId)}` : ''
      }`,
      signal,
    ),
  readFileTable: (fileId: string, versionId?: string, signal?: AbortSignal) =>
    requestJson(
      `/api/files/${encodeURIComponent(fileId)}/table${
        versionId ? `?versionId=${encodeURIComponent(versionId)}` : ''
      }`,
      fileTableResponseSchema,
      signal ? { signal } : undefined,
    ),
  readFileText: (fileId: string, versionId?: string, signal?: AbortSignal) =>
    requestJson(
      `/api/files/${encodeURIComponent(fileId)}/text${
        versionId ? `?versionId=${encodeURIComponent(versionId)}` : ''
      }`,
      fileTextResponseSchema,
      signal ? { signal } : undefined,
    ),
  uploadFile: (name: string, bytes: Uint8Array, signal?: AbortSignal) =>
    requestJson(
      '/api/files',
      officeFileResponseSchema,
      fileMutation(bytes, { 'x-eevee-file-name': encodeURIComponent(name) }, signal),
    ),
  saveFile: (
    fileId: string,
    baseVersionId: string,
    bytes: Uint8Array,
    signal?: AbortSignal,
  ) =>
    requestJson(
      `/api/files/${encodeURIComponent(fileId)}/versions`,
      officeFileResponseSchema,
      fileMutation(bytes, { 'x-eevee-base-version-id': baseVersionId }, signal),
    ),
  editPdf: (fileId: string, baseVersionId: string, edit: PdfEdit, signal?: AbortSignal) =>
    requestJson(
      `/api/files/${encodeURIComponent(fileId)}/pdf-edits`,
      officeFileResponseSchema,
      jsonMutation('POST', { baseVersionId, edit }, signal),
    ),
  editSpreadsheet: (
    fileId: string,
    baseVersionId: string,
    request: WorkbookSaveRequest,
    signal?: AbortSignal,
  ) =>
    requestJson(
      `/api/files/${encodeURIComponent(fileId)}/xlsx-edits`,
      spreadsheetEditResponseSchema,
      jsonMutation('POST', { baseVersionId, request }, signal),
    ),
  inspectApplet: (appletId: string, signal?: AbortSignal) =>
    requestJson(
      `/api/applets/${encodeURIComponent(appletId)}`,
      appletDetailResponseSchema,
      signal ? { signal } : undefined,
    ),
  inspectAppletVersion: (appletId: string, versionId: string, signal?: AbortSignal) =>
    requestJson(
      `/api/applets/${encodeURIComponent(appletId)}/versions/${encodeURIComponent(versionId)}`,
      appletVersionDetailResponseSchema,
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
  createEvaluationSuite: (
    appletId: string,
    input: CreateEvaluationSuiteInput,
    signal?: AbortSignal,
  ) =>
    requestJson(
      `/api/applets/${encodeURIComponent(appletId)}/evaluation-suites`,
      evaluationSuiteResponseSchema,
      jsonMutation('POST', input, signal),
    ),
  startEvaluation: (appletId: string, input: StartEvaluationInput, signal?: AbortSignal) =>
    requestJson(
      `/api/applets/${encodeURIComponent(appletId)}/evaluations`,
      evaluationPlanResponseSchema,
      jsonMutation('POST', input, signal),
    ),
  evaluationExecution: (
    runId: string,
    target: EvaluationTarget,
    caseId: string,
    signal?: AbortSignal,
  ) =>
    requestJson(
      `/api/evaluations/${encodeURIComponent(runId)}/executions/${target}/${encodeURIComponent(caseId)}`,
      evaluationExecutionResponseSchema,
      signal ? { signal } : undefined,
    ),
  completeEvaluation: (
    runId: string,
    input: CompleteEvaluationInput,
    signal?: AbortSignal,
  ) =>
    requestJson(
      `/api/evaluations/${encodeURIComponent(runId)}/complete`,
      evaluationRunResponseSchema,
      jsonMutation('POST', input, signal),
    ),
  failEvaluation: (runId: string, error: string, signal?: AbortSignal) =>
    requestJson(
      `/api/evaluations/${encodeURIComponent(runId)}/fail`,
      evaluationRunResponseSchema,
      jsonMutation('POST', { error }, signal),
    ),
  inspectEvaluation: (runId: string, signal?: AbortSignal) =>
    requestJson(
      `/api/evaluations/${encodeURIComponent(runId)}`,
      evaluationRunResponseSchema,
      signal ? { signal } : undefined,
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
  listActionRequests: (runId: string, signal?: AbortSignal) =>
    requestJson(
      `/api/runs/${encodeURIComponent(runId)}/actions`,
      appletActionRequestListResponseSchema,
      signal ? { signal } : undefined,
    ),
  createActionRequest: (
    runId: string,
    actionName: string,
    input: Record<string, unknown>,
    signal?: AbortSignal,
  ) =>
    requestJson(
      `/api/runs/${encodeURIComponent(runId)}/actions`,
      appletActionRequestResponseSchema,
      jsonMutation('POST', { actionName, input }, signal),
    ),
  inspectActionRequest: (requestId: string, signal?: AbortSignal) =>
    requestJson(
      `/api/action-requests/${encodeURIComponent(requestId)}`,
      appletActionRequestResponseSchema,
      signal ? { signal } : undefined,
    ),
  updateActionRequest: (
    requestId: string,
    operation:
      | { operation: 'approve' | 'reject' | 'start' }
      | { operation: 'complete'; result: AppletActionRequest['result'] }
      | { operation: 'fail'; error: string },
    signal?: AbortSignal,
  ) =>
    requestJson(
      `/api/action-requests/${encodeURIComponent(requestId)}`,
      appletActionRequestResponseSchema,
      jsonMutation('POST', operation, signal),
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
  dismissCorrection: (correctionId: string, signal?: AbortSignal) =>
    requestJson(
      `/api/corrections/${encodeURIComponent(correctionId)}/dismiss`,
      correctionResponseSchema,
      jsonMutation('POST', {}, signal),
    ),
}
