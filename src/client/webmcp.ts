import { z } from 'zod'
import {
  createAppletSchema,
  createCorrectionSchema,
  createRunSchema,
  createVersionSchema,
  reviseVersionSchema,
} from '@/domain/applet'
import { isPublishableQuality } from '@/domain/quality'
import {
  createEvaluationSuiteSchema,
  startEvaluationSchema,
  type EvaluationRun,
  type EvaluationSuite,
} from '@/domain/evaluation'
import type { AppletActionRequest } from '@/domain/applet-action'
import { api } from './api'
import { emitToolActivity } from './tool-activity'
import { evaluateAppletVersion } from './evaluation-worker'
import { pdfEditRequestSchema } from '@/domain/pdf'
import { workbookSaveRequestSchema } from '@/office/sheets/shared/desktop-api'
import { referenceAppletSlugSchema } from '@/domain/reference-applet'
import { reactAppDefinitionSchema } from '@/domain/react-app'
import { videoEditorDefinitionSchema } from '@/domain/video-editor'
import { sensitiveFindingIdsSchema } from '@/domain/document-review'
import { shareMissionPlanSchema, updateMissionStepSchema } from '@/domain/mission-plan'
import { clearMissionPlan, shareMissionPlan, updateMissionStep } from './mission-plan'
import { readWorkbenchState } from './workbench-state'

const appletIdSchema = z.strictObject({ appletId: z.uuid() })
const referenceAppletToolSchema = z.strictObject({ slug: referenceAppletSlugSchema })
const createReactVersionToolSchema = createVersionSchema.extend({
  appletId: z.uuid(),
  definition: reactAppDefinitionSchema,
})
const createVideoVersionToolSchema = createVersionSchema.extend({
  appletId: z.uuid(),
  definition: videoEditorDefinitionSchema,
})
const reviseVersionToolSchema = reviseVersionSchema.extend({ appletId: z.uuid() })
const runCorrectionSchema = createCorrectionSchema.extend({ runId: z.uuid() })
const versionReviewSchema = z.strictObject({ appletId: z.uuid(), versionId: z.uuid() })
const inspectVersionToolSchema = versionReviewSchema.extend({
  paths: z
    .array(z.string().min(1).max(240))
    .max(48)
    .optional()
    .describe(
      'Source paths whose full content you want. Omit to get every file under 40 KB in total; larger bundles list the remaining paths with sizes.',
    ),
})
const evaluationSuiteToolSchema = createEvaluationSuiteSchema.extend({ appletId: z.uuid() })
const evaluationToolSchema = startEvaluationSchema.extend({ appletId: z.uuid() })
const evaluationRunToolSchema = z.strictObject({ runId: z.uuid() })
const actionRequestToolSchema = z.strictObject({ requestId: z.uuid() })
const awaitActionDecisionSchema = z.strictObject({
  requestId: z.uuid(),
  timeoutSeconds: z
    .number()
    .int()
    .min(1)
    .max(120)
    .default(60)
    .describe('How long to wait for the person before returning the still-pending request.'),
})
const officeFileToolSchema = z.strictObject({ fileId: z.uuid() })
const requestRedactionReviewSchema = z.strictObject({
  fileId: z.uuid(),
  findingIds: sensitiveFindingIdsSchema,
})
const pdfEditToolSchema = pdfEditRequestSchema.extend({ fileId: z.uuid() })
const officeBytesSchema = z
  .string()
  .min(4)
  .max(34_000_000)
  .regex(/^[A-Za-z0-9+/]*={0,2}$/)
  .refine((value) => value.length % 4 === 0, 'Office file bytes must use padded base64')
const createOfficeFileToolSchema = z.strictObject({
  name: z.string().trim().min(1).max(255),
  contentBase64: officeBytesSchema,
})
const replaceOfficeFileToolSchema = z.strictObject({
  fileId: z.uuid(),
  baseVersionId: z.uuid(),
  contentBase64: officeBytesSchema,
})
const workbookSaveShape = workbookSaveRequestSchema.shape
const spreadsheetEditToolSchema = z
  .strictObject({
    fileId: z.uuid().describe('From list_files.'),
    baseVersionId: z.uuid().describe('The current versionId from inspect_file; a stale id is refused.'),
    edits: workbookSaveShape.edits.default([]).describe('Cell writes. Each names a sheetId (from inspect_file sheets[].id, not the sheet name), zero-based row and column, and either writeValue true with value (string, number, boolean, or null) and an optional formula without the leading =, or writeValue false with value null plus a style for a style-only change.'),
    structuralOps: workbookSaveShape.structuralOps.default([]).describe('Insert or delete rows and columns.'),
    chartEdits: workbookSaveShape.chartEdits.default([]).describe('Change existing charts by id.'),
    visualEdits: workbookSaveShape.visualEdits.default([]).describe('Move, resize, or delete existing drawings and images.'),
    visualAdditions: workbookSaveShape.visualAdditions.default([]).describe('Add charts and drawings anchored to cells.'),
    tableAdditions: workbookSaveShape.tableAdditions.default([]).describe('Turn a range into a table.'),
    pivotAdditions: workbookSaveShape.pivotAdditions.default([]).describe('Add a pivot table over a range.'),
    sheetOps: workbookSaveShape.sheetOps.default([]).describe('Add, rename, duplicate, remove, or hide sheets. Any sheet op requires sheetOrder listing every sheet id in final tab order.'),
    sheetOrder: workbookSaveShape.sheetOrder.default([]).describe('Final tab order as sheet ids; required with sheetOps, otherwise leave empty.'),
    filterStates: workbookSaveShape.filterStates.default([]).describe('Auto-filter ranges and criteria per sheet.'),
    hyperlinkEdits: workbookSaveShape.hyperlinkEdits.default([]).describe('Set or clear cell hyperlinks.'),
    cfStates: workbookSaveShape.cfStates.default([]).describe('Conditional formatting rules per sheet.'),
    dvStates: workbookSaveShape.dvStates.default([]).describe('Data validation rules per sheet.'),
    pageSetupStates: workbookSaveShape.pageSetupStates.default([]).describe('Print and page layout per sheet.'),
    noteStates: workbookSaveShape.noteStates.default([]).describe('Cell notes per sheet.'),
    formulaValues: workbookSaveShape.formulaValues.default([]).describe('Cached results for formula cells, so readers without a formula engine see values; omit and EEVEE recalculates nothing.'),
    pivotCacheRefreshPaths: workbookSaveShape.pivotCacheRefreshPaths.default([]).describe('Pivot cache parts to mark for refresh.'),
    pivotRefreshUpdates: workbookSaveShape.pivotRefreshUpdates.default([]).describe('Pivot refresh results to write.'),
    sheetProtections: workbookSaveShape.sheetProtections.default([]).describe('Sheet protection settings.'),
    sparklineAdditions: workbookSaveShape.sparklineAdditions.default([]).describe('Sparkline groups to add.'),
    definedNamesState: workbookSaveShape.definedNamesState.nullable().default(null).describe('Workbook defined names to write, or null to leave them alone.'),
  })
  .refine(
    (request) =>
      [
        request.edits,
        request.structuralOps,
        request.chartEdits,
        request.visualEdits,
        request.visualAdditions,
        request.tableAdditions,
        request.pivotAdditions,
        request.sheetOps,
        request.filterStates,
        request.hyperlinkEdits,
        request.cfStates,
        request.dvStates,
        request.pageSetupStates,
        request.noteStates,
        request.pivotCacheRefreshPaths,
        request.pivotRefreshUpdates,
        request.sheetProtections,
        request.sparklineAdditions,
      ].some((entries) => entries.length > 0) || request.definedNamesState !== null,
    'A spreadsheet edit needs at least one operation',
  )

export const EEVEE_TOOL_COUNT = 28

/** Bytes of source content inspect_applet_version returns before it starts listing paths only. */
const INSPECT_SOURCE_BUDGET = 40_000
/** How long an applet_* tool waits for the person before handing back a pending request. */
const DECISION_POLL_MS = 1_000

/**
 * z.uuid() renders as format: "uuid" plus a 150-byte regex pattern. Repeated
 * across every id field the pattern is ~4.5 KB of the advertised tool list
 * that tells an agent nothing the format keyword does not; execute() still
 * validates the full zod schema.
 */
const withoutUuidPatterns = (node: unknown): unknown => {
  if (Array.isArray(node)) return node.map(withoutUuidPatterns)
  if (node === null || typeof node !== 'object') return node
  const record = node as Record<string, unknown>
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(record)) {
    if (key === 'pattern' && record.format === 'uuid') continue
    out[key] = withoutUuidPatterns(value)
  }
  return out
}

const inputSchema = (schema: z.ZodType): object =>
  withoutUuidPatterns(z.toJSONSchema(schema, { target: 'draft-7', io: 'input' })) as object

/**
 * The version tools embed the input-definition union twice each (run inputs
 * and every action's inputs). Hoisting repeated subschemas into $defs keeps
 * those tools a third of their inlined size; Chrome registers $ref schemas
 * without complaint (scripts/webmcp-e2e.mjs checks this in a real browser).
 */
const compactInputSchema = (schema: z.ZodType): object =>
  withoutUuidPatterns(z.toJSONSchema(schema, { target: 'draft-7', io: 'input', reused: 'ref' })) as object

/**
 * Validation failures are thrown here and turned into a structured result by
 * the instrument wrapper below; Chrome 152 replaces any thrown message with
 * "UnknownError: Tool was executed but the invocation failed", so a thrown
 * error carries nothing to the agent. Zod's default message is a JSON issue
 * array; the pretty form names each bad field on its own line.
 */
const parseInput = <Schema extends z.ZodType>(schema: Schema, input: unknown): z.output<Schema> => {
  const parsed = schema.safeParse(input)
  if (parsed.success) return parsed.data
  throw new Error(`Invalid input:\n${z.prettifyError(parsed.error)}`)
}

/**
 * The full edit_spreadsheet contract renders to a ~35 KB JSON schema (~9,000
 * tokens), which every agent would pay on every page load just to see the tool
 * list. The tool therefore advertises this compact summary; execute() still
 * validates the complete contract and returns exact field-level errors, and
 * inspect_tool_contract serves the full schema on demand.
 */
const spreadsheetEditAdvertisedSchema: object = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  type: 'object',
  additionalProperties: false,
  required: ['fileId', 'baseVersionId'],
  properties: {
    fileId: { type: 'string', format: 'uuid' },
    baseVersionId: {
      type: 'string',
      format: 'uuid',
      description: 'Current version id from inspect_file; a stale id is rejected.',
    },
    edits: {
      type: 'array',
      description: 'Per-sheet cell value, formula, rich-text, and style edits.',
    },
    formulaValues: {
      type: 'array',
      description:
        'Recalculated cached values for formula cells, per sheet. Every sheet you name here must exist.',
    },
    structuralOps: { type: 'array', description: 'Row and column insert, delete, resize, hide.' },
    sheetOps: { type: 'array', description: 'Add, rename, clone, recolor, or remove sheets.' },
    sheetOrder: { type: 'array', description: 'Complete sheet order after the save.' },
    filterStates: { type: 'array', description: 'Auto-filter ranges and criteria per sheet.' },
    hyperlinkEdits: {
      type: 'array',
      description: 'Hyperlink additions and removals. External targets must use https, http, mailto, or tel.',
    },
    cfStates: { type: 'array', description: 'Conditional formatting rule sets per sheet.' },
    dvStates: { type: 'array', description: 'Data validation rule sets per sheet.' },
    pageSetupStates: { type: 'array', description: 'Print and page layout settings per sheet.' },
    noteStates: { type: 'array', description: 'Cell note additions, edits, and removals.' },
    chartEdits: { type: 'array', description: 'Edits to existing charts.' },
    visualEdits: { type: 'array', description: 'Move, resize, or delete drawings and images.' },
    visualAdditions: { type: 'array', description: 'New charts, shapes, and images.' },
    tableAdditions: { type: 'array', description: 'New worksheet tables.' },
    pivotAdditions: { type: 'array', description: 'New pivot tables.' },
    pivotCacheRefreshPaths: { type: 'array', description: 'Pivot caches to refresh.' },
    pivotRefreshUpdates: { type: 'array', description: 'Pivot definition updates on refresh.' },
    sheetProtections: { type: 'array', description: 'Sheet protection settings.' },
    sparklineAdditions: { type: 'array', description: 'New sparkline groups.' },
    definedNamesState: {
      description: 'Complete defined-names state, or null to leave names unchanged.',
    },
  },
  description:
    'At least one operation is required. Call inspect_tool_contract with tool "edit_spreadsheet" for the complete field-level schema; invalid requests return exact validation errors.',
}

/**
 * Same trade for the video medium: the full definition (project, clips,
 * files, actions, inputs) renders to ~8 KB that every agent would pay on
 * every page even when no video applet exists. Advertise the shape, validate
 * the full contract in execute, and serve the full schema on demand.
 */
const videoVersionAdvertisedSchema: object = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  type: 'object',
  additionalProperties: false,
  required: ['appletId', 'note', 'inputs', 'definition'],
  properties: {
    appletId: { type: 'string', format: 'uuid' },
    note: { type: 'string', maxLength: 240, description: 'Changelog line for this version.' },
    inputs: { type: 'array', description: 'Typed inputs, same shape as create_react_app_version; [] when none.' },
    definition: {
      type: 'object',
      additionalProperties: false,
      required: ['kind', 'entry', 'files', 'project'],
      properties: {
        kind: { const: 'video-editor' },
        entry: { const: 'src/App.tsx' },
        files: { type: 'array', description: 'React source bundle, same rules and layout guidance as create_react_app_version: many small files, not one long App.tsx.' },
        actions: { type: 'array', description: 'Declared actions, same shape as create_react_app_version.' },
        project: {
          type: 'object',
          description:
            'Edit-decision list: width, height, fps, durationMs, and 1 to 64 clips with id, label, startMs, durationMs, track (0 to 7), tone.',
        },
      },
    },
    resolvesCorrections: { type: 'array', items: { type: 'string', format: 'uuid' } },
  },
  description:
    'Call inspect_tool_contract with tool "create_video_editor_version" for the complete field-level schema.',
}

const contractToolSchema = z.strictObject({
  tool: z
    .enum(['edit_spreadsheet', 'create_video_editor_version'])
    .describe('The tool whose complete input schema you want.'),
})

const emitChanged = (appletId?: string): void => {
  window.dispatchEvent(new CustomEvent('eevee:changed', { detail: appletId ? { appletId } : {} }))
}

const emitFilesChanged = (fileId?: string): void => {
  window.dispatchEvent(new CustomEvent('eevee:files-changed', { detail: fileId ? { fileId } : {} }))
}

const decodeBase64 = (content: string): Uint8Array => {
  const binary = atob(content)
  return Uint8Array.from(binary, (character) => character.charCodeAt(0))
}

const byteLength = (value: string): number => new TextEncoder().encode(value).byteLength

const sleep = (ms: number, signal: AbortSignal): Promise<void> =>
  new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new Error('The wait was cancelled'))
      return
    }
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', abort)
      resolve()
    }, ms)
    const abort = () => {
      clearTimeout(timer)
      reject(new Error('The wait was cancelled'))
    }
    signal.addEventListener('abort', abort, { once: true })
  })

const decided = (state: AppletActionRequest['state']): boolean =>
  state === 'succeeded' || state === 'failed' || state === 'rejected'

/**
 * Poll one action request until the person has decided and the applet has
 * executed it, or the deadline passes. Used by await_action_decision and
 * exposed so the dynamic applet_* tools can wait the same way.
 */
export const waitForActionDecision = async (
  requestId: string,
  timeoutMs: number,
  signal: AbortSignal,
): Promise<AppletActionRequest> => {
  const deadline = performance.now() + timeoutMs
  let latest = (await api.inspectActionRequest(requestId, signal)).request
  while (!decided(latest.state) && performance.now() < deadline) {
    await sleep(DECISION_POLL_MS, signal)
    latest = (await api.inspectActionRequest(requestId, signal)).request
  }
  return latest
}

const suiteSummary = (suite: EvaluationSuite) => ({
  id: suite.id,
  revision: suite.revision,
  name: suite.name,
  createdAt: suite.createdAt,
  cases: suite.cases.map(({ id, name, criticality, steps }) => ({
    id,
    name,
    criticality,
    stepCount: steps.length,
  })),
})

const evaluationRunSummary = (run: EvaluationRun) => ({
  id: run.id,
  state: run.state,
  candidateVersionId: run.candidateVersionId,
  baselineVersionId: run.baselineVersionId,
  suiteId: run.suiteId,
  verdict: run.report?.verdict ?? null,
  failedCases:
    run.report?.candidate.cases
      .filter(({ verdict }) => verdict === 'fail')
      .map(({ caseId, name, criticality }) => ({ caseId, name, criticality })) ?? [],
  regressions: run.report?.regressions ?? [],
  error: run.error,
  createdAt: run.createdAt,
  completedAt: run.completedAt,
})

/**
 * Tools inside EEVEE always receive a signal. The browser may call execute
 * with no options at all (Chrome 152 does), so the registered wrapper fills
 * that gap once instead of every tool guarding for it.
 */
type EeveeTool = Omit<WebMcpTool, 'execute'> & {
  execute(input: Record<string, unknown>, options: WebMcpExecuteOptions): Promise<unknown>
}

export type ToolRegistration = {
  live: number
  total: number
  failures: string[]
}

export const modelContextOf = (): WebMcpModelContext | undefined =>
  document.modelContext ?? navigator.modelContext

export const registerEeveeTools = (): {
  ready: Promise<ToolRegistration>
  unregister: () => void
} => {
  const context = modelContextOf()
  if (!context) {
    return {
      ready: Promise.resolve({ live: 0, total: EEVEE_TOOL_COUNT, failures: [] }),
      unregister: () => undefined,
    }
  }

  const tools: EeveeTool[] = [
    {
      name: 'share_plan',
      title: 'Share your plan',
      description:
        'Post your working plan onto the EEVEE workbench so the person can watch progress. Call this FIRST for any multi-step task, then keep steps current with update_plan_step. Sharing a new plan replaces the old one. Step ids are short lowercase slugs such as "install" or "evaluate".',
      inputSchema: inputSchema(shareMissionPlanSchema),
      annotations: { readOnlyHint: true, untrustedContentHint: false },
      execute: async (input) => shareMissionPlan(parseInput(shareMissionPlanSchema, input)),
    },
    {
      name: 'update_plan_step',
      title: 'Update a plan step',
      description:
        'Mark one shared plan step pending, active, done, or failed, with an optional short note. The person sees the change instantly.',
      inputSchema: inputSchema(updateMissionStepSchema),
      annotations: { readOnlyHint: true, untrustedContentHint: false },
      execute: async (input) => updateMissionStep(parseInput(updateMissionStepSchema, input)),
    },
    {
      name: 'get_workbench_state',
      title: 'Read the workbench state',
      description:
        'Read what the person currently sees: the open surface, applet, run, review, file, decisions waiting on them, active lease, passkey enrollment, and how many EEVEE tools are live. Call this when you are unsure where the person is before acting.',
      inputSchema: inputSchema(z.strictObject({})),
      annotations: { readOnlyHint: true, untrustedContentHint: false },
      execute: async () => readWorkbenchState(),
    },
    {
      name: 'list_files',
      title: 'List Office files',
      description:
        'List durable DOCX, XLSX, PPTX, and PDF files with current version, size, medium, and checksum.',
      inputSchema: inputSchema(z.strictObject({})),
      annotations: { readOnlyHint: true, untrustedContentHint: true },
      execute: async (_input, { signal }) => api.listFiles(signal),
    },
    {
      name: 'inspect_file',
      title: 'Inspect Office file',
      description:
        'Inspect one Office file and its immutable version register. For spreadsheets, sheets[] lists each sheet\'s id and name; edit_spreadsheet needs the id. This metadata tool does not expose raw file bytes.',
      inputSchema: inputSchema(officeFileToolSchema),
      annotations: { readOnlyHint: true, untrustedContentHint: true },
      execute: async (input, { signal }) => {
        const { fileId } = parseInput(officeFileToolSchema, input)
        return api.inspectFile(fileId, signal)
      },
    },
    {
      name: 'scan_document_review',
      title: 'Scan sensitive text',
      description:
        'Scan the current DOCX version for supported sensitive patterns. This scan response returns masks, locations, and stable ids rather than echoing matched values.',
      inputSchema: inputSchema(officeFileToolSchema),
      annotations: { readOnlyHint: true, untrustedContentHint: true },
      execute: async (input, { signal }) => {
        const { fileId } = parseInput(officeFileToolSchema, input)
        return api.scanDocumentReview(fileId, signal)
      },
    },
    {
      name: 'request_redaction_review',
      title: 'Request redaction review',
      description:
        'Open selected masked DOCX findings for a person to review. This tool never redacts or saves; the visible EEVEE control requires the workspace passkey before creating a new immutable version.',
      inputSchema: inputSchema(requestRedactionReviewSchema),
      annotations: { readOnlyHint: true, untrustedContentHint: true },
      execute: async (input, { signal }) => {
        const { fileId, findingIds } = parseInput(requestRedactionReviewSchema, input)
        const { review } = await api.scanDocumentReview(fileId, signal)
        if (!review.supported) throw new Error(review.limitation)
        const available = new Set(review.findings.map(({ id }) => id))
        if (findingIds.some((id) => !available.has(id))) {
          throw new Error('One or more findings are stale; scan the current document version again')
        }
        window.dispatchEvent(
          new CustomEvent('eevee:review-file', { detail: { fileId, findingIds } }),
        )
        return {
          status: 'requires-human-approval',
          fileId,
          versionId: review.versionId,
          findingCount: findingIds.length,
          message: 'The masked findings are open in Sensitive-text review. A person must choose them and verify the save with the workspace passkey.',
        }
      },
    },
    {
      name: 'create_office_file',
      title: 'Create Office file',
      description:
        'Create a durable DOCX, XLSX, PPTX, or PDF from complete base64-encoded file bytes. Use the native Office format, not HTML renamed with an Office extension.',
      inputSchema: inputSchema(createOfficeFileToolSchema),
      annotations: { readOnlyHint: false, untrustedContentHint: true },
      execute: async (input, { signal }) => {
        const { name, contentBase64 } = parseInput(createOfficeFileToolSchema, input)
        const created = await api.uploadFile(name, decodeBase64(contentBase64), signal)
        emitFilesChanged(created.file.id)
        return created
      },
    },
    {
      name: 'replace_office_file',
      title: 'Replace Office file',
      description:
        'Replace a DOCX, XLSX, PPTX, or PDF with complete base64-encoded native file bytes and save a new immutable version. Inspect first and pass the current version id.',
      inputSchema: inputSchema(replaceOfficeFileToolSchema),
      annotations: { readOnlyHint: false, untrustedContentHint: true },
      execute: async (input, { signal }) => {
        const { fileId, baseVersionId, contentBase64 } = parseInput(replaceOfficeFileToolSchema, input)
        const replaced = await api.saveFile(
          fileId,
          baseVersionId,
          decodeBase64(contentBase64),
          signal,
        )
        emitFilesChanged(fileId)
        return replaced
      },
    },
    {
      name: 'edit_spreadsheet',
      title: 'Edit spreadsheet',
      description:
        'Apply validated cell, formula, style, row/column, sheet, filter, validation, note, page-layout, chart, table, pivot, drawing, and sparkline edits to an XLSX. The save uses the same full gateway as the Sheets editor and creates an immutable version. Call inspect_tool_contract with tool "edit_spreadsheet" first for the complete field-level input schema.',
      inputSchema: spreadsheetEditAdvertisedSchema,
      annotations: { readOnlyHint: false, untrustedContentHint: true },
      execute: async (input, { signal }) => {
        const parsed = parseInput(spreadsheetEditToolSchema, input)
        const { fileId, baseVersionId, ...request } = parsed
        const edited = await api.editSpreadsheet(
          fileId,
          baseVersionId,
          { ...request, sessionId: crypto.randomUUID(), mode: 'save' },
          signal,
        )
        emitFilesChanged(fileId)
        return edited
      },
    },
    {
      name: 'inspect_tool_contract',
      title: 'Inspect a tool\'s full contract',
      description:
        'Return the complete field-level JSON schema for a tool whose advertised schema is a summary: edit_spreadsheet (every operation family) or create_video_editor_version (project and clip fields). Call it before composing a complex call to either.',
      inputSchema: inputSchema(contractToolSchema),
      annotations: { readOnlyHint: true, untrustedContentHint: false },
      execute: async (input) => {
        const { tool } = parseInput(contractToolSchema, input)
        return {
          tool,
          inputSchema:
            tool === 'edit_spreadsheet'
              ? inputSchema(spreadsheetEditToolSchema)
              : compactInputSchema(createVideoVersionToolSchema),
        }
      },
    },
    {
      name: 'edit_pdf',
      title: 'Edit PDF',
      description:
        'Rotate or delete one page in a PDF and save the result as a new immutable version. Inspect the file first and pass its current version id.',
      inputSchema: inputSchema(pdfEditToolSchema),
      annotations: { readOnlyHint: false, untrustedContentHint: true },
      execute: async (input, { signal }) => {
        const { fileId, baseVersionId, edit } = parseInput(pdfEditToolSchema, input)
        const edited = await api.editPdf(fileId, baseVersionId, edit, signal)
        emitFilesChanged(fileId)
        return edited
      },
    },
    {
      name: 'list_applets',
      title: 'List applets',
      description:
        'List the durable applets in this EEVEE workspace with version, evaluation, run, and correction counts.',
      inputSchema: inputSchema(z.strictObject({})),
      annotations: { readOnlyHint: true, untrustedContentHint: true },
      execute: async (_input, { signal }) => api.listApplets(signal),
    },
    {
      name: 'install_reference_applet',
      title: 'Install reference applet',
      description:
        'Install an audited EEVEE reference package as a draft with typed source, governed actions, and a behavioral suite. A person must still evaluate, review, and publish it.',
      inputSchema: inputSchema(referenceAppletToolSchema),
      annotations: { readOnlyHint: false, untrustedContentHint: false },
      execute: async (input, { signal }) => {
        const { slug } = parseInput(referenceAppletToolSchema, input)
        const installed = await api.installReferenceApplet(slug, signal)
        emitChanged(installed.applet.id)
        return {
          ...installed,
          message:
            'Installed as a draft with its behavioral suite. Next: call evaluate_applet_version with this appletId and its latest versionId (see inspect_applet for both and the suiteId), then request_version_review so a person can publish, then run_applet.',
        }
      },
    },
    {
      name: 'inspect_applet',
      title: 'Inspect applet',
      description:
        'Inspect one applet: typed inputs, immutable version summaries, behavioral suite outlines, recent evaluation verdicts, recent runs, and proposed corrections. Open corrections are the standing brief for the next version. Use inspect_evaluation_run for step-level evidence and inspect_applet_version for source.',
      inputSchema: inputSchema(appletIdSchema),
      annotations: { readOnlyHint: true, untrustedContentHint: true },
      execute: async (input, { signal }) => {
        const { appletId } = parseInput(appletIdSchema, input)
        const { detail } = await api.inspectApplet(appletId, signal)
        return {
          detail: {
            ...detail,
            runs: detail.runs.slice(0, 10),
            evaluationSuites: detail.evaluationSuites.map(suiteSummary),
            evaluationRuns: detail.evaluationRuns.slice(0, 5).map(evaluationRunSummary),
          },
        }
      },
    },
    {
      name: 'inspect_applet_version',
      title: 'Inspect applet version',
      description:
        'Inspect one immutable version: typed inputs, declared actions, evaluation evidence, and its source files. Pass paths to read specific files in full; without paths you get every file while the total stays under 40 KB, then path listings with sizes.',
      inputSchema: inputSchema(inspectVersionToolSchema),
      annotations: { readOnlyHint: true, untrustedContentHint: true },
      execute: async (input, { signal }) => {
        const { appletId, versionId, paths } = parseInput(inspectVersionToolSchema, input)
        const response = await api.inspectAppletVersion(appletId, versionId, signal)
        const wanted = paths ? new Set(paths) : null
        let budget = INSPECT_SOURCE_BUDGET
        const files = response.definition.files.map((file) => {
          const bytes = byteLength(file.content)
          const include = wanted ? wanted.has(file.path) : bytes <= budget
          if (include && !wanted) budget -= bytes
          return include
            ? { path: file.path, bytes, content: file.content }
            : { path: file.path, bytes, content: null }
        })
        const omitted = files.filter(({ content }) => content === null).map(({ path }) => path)
        const known = new Set(files.map(({ path }) => path))
        const missing = paths ? paths.filter((path) => !known.has(path)) : []
        return {
          version: response.version,
          definition: { ...response.definition, files },
          ...(omitted.length > 0
            ? { omittedPaths: omitted, hint: 'Call again with paths to read the omitted files.' }
            : {}),
          ...(missing.length > 0 ? { missingPaths: missing } : {}),
        }
      },
    },
    {
      name: 'create_applet',
      title: 'Create applet',
      description:
        'Create a durable draft applet. medium is "web-app" (a multi-file React app with a full sandbox executor and up to 32 typed actions) or "video" (a bounded edit-decision-list editor with no media decode). Follow with create_react_app_version or create_video_editor_version.',
      inputSchema: inputSchema(createAppletSchema),
      annotations: { readOnlyHint: false, untrustedContentHint: true },
      execute: async (input, { signal }) => {
        const created = await api.createApplet(parseInput(createAppletSchema, input), signal)
        emitChanged(created.applet.id)
        return created
      },
    },
    {
      name: 'create_react_app_version',
      title: 'Create React app version',
      description:
        'Create an immutable web applet version from a typed React source bundle (src/App.tsx plus up to 47 more .ts, .tsx, or .css files under src/, 200 KB per file, 1.5 MB total; imports limited to react and relative paths, including import "./x.css") and an input definition. Do not minimize the file count: lay the app out like a real codebase, one file per screen, module, data model, action handler group, and stylesheet, so a person can review each part on its own; a single long App.tsx is harder to review and is not what the limits are for. Runtime contract: window.eevee.inputs is an object keyed by input key; store.get/set/all return Promises (durable key-value state, 128 keys, 64 KB each); files.list/read/table/text return Promises and fail during behavioral evaluation, so handle that; every declared action needs a handler registered with actions.register({ name: async (input) => jsonResult }) and nothing else may be registered. Returns status "blocked" with blockers when compilation or a required static check fails; such a version cannot be evaluated or published. Next: create_evaluation_suite, evaluate_applet_version, request_version_review. To iterate, prefer revise_react_app_version. Pass open correction ids in resolvesCorrections to mark them applied.',
      inputSchema: compactInputSchema(createReactVersionToolSchema),
      annotations: { readOnlyHint: false, untrustedContentHint: true },
      execute: async (input, { signal }) => {
        const parsed = parseInput(createReactVersionToolSchema, input)
        const { appletId, ...version } = parsed
        const created = await api.createVersion(appletId, version, signal)
        emitChanged(appletId)
        return versionOutcome(created)
      },
    },
    {
      name: 'revise_react_app_version',
      title: 'Revise React app version',
      description:
        'Create the next immutable version by sending only a delta against an existing version: changedFiles replace or add files by path, deletedPaths drop files that exist in the base (src/App.tsx must remain), and untouched files carry over unchanged. Inputs and actions default to the base version. Same runtime contract and return shape as create_react_app_version; a blocked base can be revised from its last good sibling. Next: evaluate_applet_version, then request_version_review.',
      inputSchema: compactInputSchema(reviseVersionToolSchema),
      annotations: { readOnlyHint: false, untrustedContentHint: true },
      execute: async (input, { signal }) => {
        const parsed = parseInput(reviseVersionToolSchema, input)
        const { appletId, ...revision } = parsed
        const created = await api.reviseVersion(appletId, revision, signal)
        emitChanged(appletId)
        return versionOutcome(created)
      },
    },
    {
      name: 'create_video_editor_version',
      title: 'Create video editor version',
      description:
        'Create an immutable video applet version from an edit-decision-list project (format, fps, duration, clips on up to 8 tracks) and a typed React editor that renders it through window.eevee.media.project. Same source rules as create_react_app_version; no media decode or playback. Call inspect_tool_contract with tool "create_video_editor_version" for the full schema.',
      inputSchema: videoVersionAdvertisedSchema,
      annotations: { readOnlyHint: false, untrustedContentHint: true },
      execute: async (input, { signal }) => {
        const parsed = parseInput(createVideoVersionToolSchema, input)
        const { appletId, ...version } = parsed
        const created = await api.createVersion(appletId, version, signal)
        emitChanged(appletId)
        return created
      },
    },
    {
      name: 'create_evaluation_suite',
      title: 'Create evaluation suite',
      description:
        'Create an immutable behavioral scenario suite for an interactive applet using bounded fill, click, press, wait, restart, and assertion steps that run against the applet\'s own DOM (CSS selectors). At least one case must be required. A restart step preserves stored state, which is how a scenario proves persistence. Each case\'s input keys must be inputs the version declares. One suite per applet is usually enough; suites are immutable, so a new one becomes the default for evaluate_applet_version. Returns suite.id: pass it as suiteId to evaluate_applet_version.',
      inputSchema: compactInputSchema(evaluationSuiteToolSchema),
      annotations: { readOnlyHint: false, untrustedContentHint: true },
      execute: async (input, { signal }) => {
        const parsed = parseInput(evaluationSuiteToolSchema, input)
        const { appletId, ...suite } = parsed
        const created = await api.createEvaluationSuite(appletId, suite, signal)
        emitChanged(appletId)
        return created
      },
    },
    {
      name: 'evaluate_applet_version',
      title: 'Evaluate applet version',
      description:
        'Run a version through its browser scenarios. suiteId defaults to the applet\'s newest suite; pass it explicitly. When a published version exists, EEVEE executes the same suite against both versions and records regressions. The run\'s report lists each step with its detail. Next: request_version_review when the verdict is pass, or revise_react_app_version when it is not.',
      inputSchema: inputSchema(evaluationToolSchema),
      annotations: { readOnlyHint: false, untrustedContentHint: true },
      execute: async (input, { signal }) => {
        const { appletId, versionId, suiteId } = parseInput(evaluationToolSchema, input)
        const evaluated = await evaluateAppletVersion(appletId, versionId, suiteId, signal)
        emitChanged(appletId)
        return evaluated
      },
    },
    {
      name: 'inspect_evaluation_run',
      title: 'Inspect evaluation run',
      description:
        'Inspect stored case and step evidence, required verdicts, and candidate-versus-published regressions for one evaluation run.',
      inputSchema: inputSchema(evaluationRunToolSchema),
      annotations: { readOnlyHint: true, untrustedContentHint: true },
      execute: async (input, { signal }) => {
        const { runId } = parseInput(evaluationRunToolSchema, input)
        return api.inspectEvaluation(runId, signal)
      },
    },
    {
      name: 'inspect_applet_action',
      title: 'Inspect applet action',
      description:
        'Inspect a governed action request after a published applet tool returns its request id. Reports the human decision, execution state, result, and failure evidence or rejection reason.',
      inputSchema: inputSchema(actionRequestToolSchema),
      annotations: { readOnlyHint: true, untrustedContentHint: true },
      execute: async (input, { signal }) => {
        const { requestId } = parseInput(actionRequestToolSchema, input)
        return api.inspectActionRequest(requestId, signal)
      },
    },
    {
      name: 'await_action_decision',
      title: 'Wait for a human decision',
      description:
        'Block until the person approves or rejects a pending action request and the applet finishes executing it, or until timeoutSeconds passes. Returns the request with its final state, result, or rejection reason. Use this instead of polling inspect_applet_action.',
      inputSchema: inputSchema(awaitActionDecisionSchema),
      annotations: { readOnlyHint: true, untrustedContentHint: true },
      execute: async (input, { signal }) => {
        const { requestId, timeoutSeconds } = parseInput(awaitActionDecisionSchema, input)
        const request = await waitForActionDecision(requestId, timeoutSeconds * 1_000, signal)
        return {
          request,
          ...(decided(request.state)
            ? {}
            : { message: `Still ${request.state} after ${timeoutSeconds}s. The person has not decided yet; ask them, or call again.` }),
        }
      },
    },
    {
      name: 'request_version_review',
      title: 'Request version review',
      description:
        'Bring a passing draft version to the person for review: it must have passed static checks and its required scenarios. The person reads the source, the verdicts, and the live preview, then clicks Approve & publish with their passkey; nothing you call can publish. After publishing, call run_applet. This tool never bypasses the human approval gate.',
      inputSchema: inputSchema(versionReviewSchema),
      annotations: { readOnlyHint: true, untrustedContentHint: false },
      execute: async (input, { signal }) => {
        const detail = parseInput(versionReviewSchema, input)
        const inspected = await api.inspectApplet(detail.appletId, signal)
        const version = inspected.detail.versions.find(({ id }) => id === detail.versionId)
        if (!version) throw new Error('The requested version does not exist in this applet')
        if (!isPublishableQuality(version.qualityReport)) {
          throw new Error('The requested version has not passed its required quality checks')
        }
        const expectedBaseline = inspected.detail.applet.activeVersionId
        const suiteIds = new Set(inspected.detail.evaluationSuites.map(({ id }) => id))
        const evaluated = inspected.detail.evaluationRuns.some(
          (run) =>
            run.candidateVersionId === version.id &&
            run.baselineVersionId === expectedBaseline &&
            suiteIds.has(run.suiteId) &&
            run.state === 'passed',
        )
        if (!evaluated) {
          throw new Error(
            suiteIds.size === 0
              ? 'This applet has no behavioral suite yet; create one, evaluate the version, then request review'
              : 'The requested version has no passing evaluation against the current published baseline; call evaluate_applet_version first',
          )
        }
        window.dispatchEvent(new CustomEvent('eevee:review-version', { detail }))
        return {
          status: 'requires-human-approval',
          ...detail,
          message: 'The version is open for review. A person must approve and publish it with their passkey.',
        }
      },
    },
    {
      name: 'run_applet',
      title: 'Run applet',
      description:
        'Start a durable run of the published version. input keys come from the version\'s typed inputs (inspect_applet). Fails until a person has published a version. While the run is open on the person\'s screen, its declared actions register as applet_* tools; the browser fires toolchange, so refresh your tool list after this returns.',
      inputSchema: inputSchema(createRunSchema.extend({ appletId: z.uuid() })),
      annotations: { readOnlyHint: false, untrustedContentHint: true },
      execute: async (input, { signal }) => {
        const parsed = parseInput(createRunSchema.extend({ appletId: z.uuid() }), input)
        const { appletId, ...run } = parsed
        const created = await api.runApplet(appletId, run, signal)
        emitChanged(appletId)
        const { output, ...record } = created.run
        return {
          run: { ...record, outputAvailable: output !== null },
          message:
            'The run is open on the person\'s screen and its declared actions are now registered as applet_* tools; refresh your tool list. They unregister if the person switches to Code view or closes the applet. Any earlier open run of this applet was superseded.',
        }
      },
    },
    {
      name: 'record_correction',
      title: 'Record correction',
      description:
        'Record a person-observed problem and desired result for a successful run. This creates an open proposal: treat it as the brief for the next matching version call and resolve it there via resolvesCorrections.',
      inputSchema: inputSchema(runCorrectionSchema),
      annotations: { readOnlyHint: false, untrustedContentHint: true },
      execute: async (input, { signal }) => {
        const parsed = parseInput(runCorrectionSchema, input)
        const { runId, ...correction } = parsed
        const created = await api.createCorrection(runId, correction, signal)
        emitChanged(created.correction.appletId)
        return created
      },
    },
  ]
  /**
   * Version tools answer with the outcome first. A failed compile used to
   * arrive as a pass-looking envelope with the esbuild message six levels
   * down; agents scanning for ok proceeded to build suites for versions
   * with no artifact.
   */
  const versionOutcome = (created: Awaited<ReturnType<typeof api.createVersion>>) => {
    const blockers = created.version.qualityReport.checks
      .filter((check) => check.criticality === 'required' && check.verdict === 'fail')
      .map((check) => `${check.label}: ${check.detail}`)
    return {
      status: blockers.length > 0 ? 'blocked' : 'passing_static_checks',
      versionId: created.version.id,
      blockers,
      message:
        blockers.length > 0
          ? 'This version cannot be evaluated or published. Fix every blocker and call revise_react_app_version with baseVersionId set to the last good version, or create_react_app_version again.'
          : 'Static checks passed. Next: create_evaluation_suite if the applet has none, then evaluate_applet_version with this versionId, then request_version_review.',
      ...created,
    }
  }

  const instrument = (tool: EeveeTool): WebMcpTool => ({
    ...tool,
    execute: async (input, options) => {
      const id = crypto.randomUUID()
      const title = tool.title ?? tool.name
      const startedAt = performance.now()
      emitToolActivity({
        id,
        tool: tool.name,
        title,
        phase: 'started',
        at: new Date().toISOString(),
        durationMs: null,
        error: null,
      })
      try {
        const value = await tool.execute(input ?? {}, options ?? { signal: new AbortController().signal })
        emitToolActivity({
          id,
          tool: tool.name,
          title,
          phase: 'succeeded',
          at: new Date().toISOString(),
          durationMs: Math.round(performance.now() - startedAt),
          error: null,
        })
        return value
      } catch (error) {
        const message = error instanceof Error ? error.message.slice(0, 2000) : 'The tool call failed'
        emitToolActivity({
          id,
          tool: tool.name,
          title,
          phase: 'failed',
          at: new Date().toISOString(),
          durationMs: Math.round(performance.now() - startedAt),
          error: message.slice(0, 500),
        })
        // Returned, not thrown. Chrome 152's executeTool replaces any thrown
        // error with "UnknownError: Tool was executed but the invocation
        // failed" and drops the message, so a thrown validation error tells
        // the agent nothing. A structured result carries the field-level
        // text in every host.
        return { error: message, tool: tool.name }
      }
    },
  })

  const controller = new AbortController()
  const registrations = tools.map((tool) =>
    context
      .registerTool(instrument(tool), { signal: controller.signal })
      .then(() => null, (reason: unknown) => `${tool.name}: ${reason instanceof Error ? reason.message : String(reason)}`),
  )

  return {
    // One rejected registration must not silently take the other tools with
    // it; the person sees "25 of 26 live" and the failure names the tool.
    ready: Promise.all(registrations).then((outcomes) => {
      const failures = outcomes.filter((outcome): outcome is string => outcome !== null)
      return { live: tools.length - failures.length, total: tools.length, failures }
    }),
    unregister: () => {
      controller.abort()
      // The shared plan belongs to the registered tool set; a stale plan
      // must not survive into the next registration.
      clearMissionPlan()
    },
  }
}
