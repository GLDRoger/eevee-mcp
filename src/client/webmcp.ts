import { z } from 'zod'
import {
  createAppletSchema,
  createCorrectionSchema,
  createRunSchema,
  createVersionSchema,
} from '@/domain/applet'
import { isPublishableQuality } from '@/domain/quality'
import {
  createEvaluationSuiteSchema,
  startEvaluationSchema,
} from '@/domain/evaluation'
import { api } from './api'
import { emitToolActivity } from './tool-activity'
import { evaluateAppletVersion } from './evaluation-worker'
import { pdfEditRequestSchema } from '@/domain/pdf'
import { workbookSaveRequestSchema } from '@/office/sheets/shared/desktop-api'

const appletIdSchema = z.strictObject({ appletId: z.uuid() })
const runCorrectionSchema = createCorrectionSchema.extend({ runId: z.uuid() })
const versionReviewSchema = z.strictObject({ appletId: z.uuid(), versionId: z.uuid() })
const evaluationSuiteToolSchema = createEvaluationSuiteSchema.extend({ appletId: z.uuid() })
const evaluationToolSchema = startEvaluationSchema.extend({ appletId: z.uuid() })
const evaluationRunToolSchema = z.strictObject({ runId: z.uuid() })
const officeFileToolSchema = z.strictObject({ fileId: z.uuid() })
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
    fileId: z.uuid(),
    baseVersionId: z.uuid(),
    edits: workbookSaveShape.edits,
    structuralOps: workbookSaveShape.structuralOps,
    chartEdits: workbookSaveShape.chartEdits,
    visualEdits: workbookSaveShape.visualEdits,
    visualAdditions: workbookSaveShape.visualAdditions,
    tableAdditions: workbookSaveShape.tableAdditions,
    pivotAdditions: workbookSaveShape.pivotAdditions,
    sheetOps: workbookSaveShape.sheetOps,
    sheetOrder: workbookSaveShape.sheetOrder,
    filterStates: workbookSaveShape.filterStates,
    hyperlinkEdits: workbookSaveShape.hyperlinkEdits,
    cfStates: workbookSaveShape.cfStates,
    dvStates: workbookSaveShape.dvStates,
    pageSetupStates: workbookSaveShape.pageSetupStates,
    noteStates: workbookSaveShape.noteStates,
    formulaValues: workbookSaveShape.formulaValues,
    pivotCacheRefreshPaths: workbookSaveShape.pivotCacheRefreshPaths,
    pivotRefreshUpdates: workbookSaveShape.pivotRefreshUpdates,
    sheetProtections: workbookSaveShape.sheetProtections,
    sparklineAdditions: workbookSaveShape.sparklineAdditions,
    definedNamesState: workbookSaveShape.definedNamesState,
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

export const EEVEE_TOOL_COUNT = 18

const inputSchema = (schema: z.ZodType): object =>
  z.toJSONSchema(schema, { target: 'draft-7', io: 'input' })

/**
 * The full edit_spreadsheet contract renders to a ~35 KB JSON schema (~9,000
 * tokens), which every agent would pay on every page load just to see the tool
 * list. The tool therefore advertises this compact summary; execute() still
 * validates the complete contract and returns exact field-level errors, and
 * inspect_spreadsheet_contract serves the full schema on demand.
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
    'At least one operation is required. Call inspect_spreadsheet_contract for the complete field-level schema; invalid requests return exact validation errors.',
}

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

export const registerEeveeTools = (): {
  ready: Promise<boolean>
  unregister: () => void
} => {
  const context = document.modelContext
  if (!context) return { ready: Promise.resolve(false), unregister: () => undefined }

  const tools: WebMcpTool[] = [
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
        'Inspect one Office file and its immutable version register, with same-origin content URLs for the stored bytes.',
      inputSchema: inputSchema(officeFileToolSchema),
      annotations: { readOnlyHint: true, untrustedContentHint: true },
      execute: async (input, { signal }) => {
        const { fileId } = officeFileToolSchema.parse(input)
        const response = await api.inspectFile(fileId, signal)
        const contentPath = `/api/files/${encodeURIComponent(fileId)}/content`
        return {
          detail: response.detail,
          contentUrl: new URL(contentPath, window.location.origin).href,
          versions: response.detail.versions.map((version) => ({
            ...version,
            contentUrl: new URL(
              `${contentPath}?versionId=${encodeURIComponent(version.id)}`,
              window.location.origin,
            ).href,
          })),
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
        const { name, contentBase64 } = createOfficeFileToolSchema.parse(input)
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
        const { fileId, baseVersionId, contentBase64 } = replaceOfficeFileToolSchema.parse(input)
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
        'Apply validated cell, formula, style, row/column, sheet, filter, validation, note, page-layout, chart, table, pivot, drawing, and sparkline edits to an XLSX. The save uses the same full gateway as the Sheets editor and creates an immutable version. Call inspect_spreadsheet_contract first for the complete field-level input schema.',
      inputSchema: spreadsheetEditAdvertisedSchema,
      annotations: { readOnlyHint: false, untrustedContentHint: true },
      execute: async (input, { signal }) => {
        const parsed = spreadsheetEditToolSchema.parse(input)
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
      name: 'inspect_spreadsheet_contract',
      title: 'Inspect spreadsheet edit contract',
      description:
        'Return the complete JSON schema for edit_spreadsheet, including every operation family and its field-level constraints. Call this before composing a complex spreadsheet edit.',
      inputSchema: inputSchema(z.strictObject({})),
      annotations: { readOnlyHint: true, untrustedContentHint: false },
      execute: async () => ({ inputSchema: inputSchema(spreadsheetEditToolSchema) }),
    },
    {
      name: 'edit_pdf',
      title: 'Edit PDF',
      description:
        'Rotate or delete one page in a PDF and save the result as a new immutable version. Inspect the file first and pass its current version id.',
      inputSchema: inputSchema(pdfEditToolSchema),
      annotations: { readOnlyHint: false, untrustedContentHint: true },
      execute: async (input, { signal }) => {
        const { fileId, baseVersionId, edit } = pdfEditToolSchema.parse(input)
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
      name: 'inspect_applet',
      title: 'Inspect applet',
      description:
        'Inspect one applet, its typed inputs, immutable versions, behavioral suites and evidence, recent runs, and proposed corrections. Open corrections are the standing brief for the next version.',
      inputSchema: inputSchema(appletIdSchema),
      annotations: { readOnlyHint: true, untrustedContentHint: true },
      execute: async (input, { signal }) => {
        const { appletId } = appletIdSchema.parse(input)
        return api.inspectApplet(appletId, signal)
      },
    },
    {
      name: 'inspect_applet_version',
      title: 'Inspect applet version',
      description:
        'Inspect one immutable version with its typed inputs, React source files, and evaluation evidence before creating a correction or successor. Applet code can read Library files at run time through window.eevee.files: list(), read(fileId) for raw base64 bytes, table(fileId) for typed spreadsheet rows (cached formula results included), and text(fileId) for document, presentation, or spreadsheet text. File reads fail during behavioral evaluation to keep verdicts deterministic, so applets must tolerate that failure.',
      inputSchema: inputSchema(versionReviewSchema),
      annotations: { readOnlyHint: true, untrustedContentHint: true },
      execute: async (input, { signal }) => {
        const { appletId, versionId } = versionReviewSchema.parse(input)
        return api.inspectAppletVersion(appletId, versionId, signal)
      },
    },
    {
      name: 'create_applet',
      title: 'Create applet',
      description:
        'Create a durable draft applet. Web app versions use bounded React source; other media remain typed drafts until their executors are available.',
      inputSchema: inputSchema(createAppletSchema),
      annotations: { readOnlyHint: false, untrustedContentHint: true },
      execute: async (input, { signal }) => {
        const created = await api.createApplet(createAppletSchema.parse(input), signal)
        emitChanged(created.applet.id)
        return created
      },
    },
    {
      name: 'create_react_app_version',
      title: 'Create React app version',
      description:
        'Create an immutable web applet version from a typed React source bundle and input definition. EEVEE compiles and evaluates it before a person can publish it. If this version answers open correction proposals from inspect_applet, pass their ids in resolvesCorrections to mark them applied.',
      inputSchema: inputSchema(createVersionSchema.extend({ appletId: z.uuid() })),
      annotations: { readOnlyHint: false, untrustedContentHint: true },
      execute: async (input, { signal }) => {
        const parsed = createVersionSchema.extend({ appletId: z.uuid() }).parse(input)
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
        'Create an immutable behavioral scenario suite for a web applet using bounded fill, click, key, restart, storage, and assertion steps.',
      inputSchema: inputSchema(evaluationSuiteToolSchema),
      annotations: { readOnlyHint: false, untrustedContentHint: true },
      execute: async (input, { signal }) => {
        const parsed = evaluationSuiteToolSchema.parse(input)
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
        'Run a version through its browser scenarios. When a published version exists, EEVEE executes the same suite against both versions and records regressions.',
      inputSchema: inputSchema(evaluationToolSchema),
      annotations: { readOnlyHint: false, untrustedContentHint: true },
      execute: async (input, { signal }) => {
        const { appletId, versionId, suiteId } = evaluationToolSchema.parse(input)
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
        const { runId } = evaluationRunToolSchema.parse(input)
        return api.inspectEvaluation(runId, signal)
      },
    },
    {
      name: 'request_version_review',
      title: 'Request version review',
      description:
        'Bring a passing draft version to the person for review. This tool never publishes or bypasses the human approval gate.',
      inputSchema: inputSchema(versionReviewSchema),
      annotations: { readOnlyHint: true, untrustedContentHint: false },
      execute: async (input, { signal }) => {
        const detail = versionReviewSchema.parse(input)
        const inspected = await api.inspectApplet(detail.appletId, signal)
        const version = inspected.detail.versions.find(({ id }) => id === detail.versionId)
        if (!version) throw new Error('The requested version does not exist in this applet')
        if (!isPublishableQuality(version.qualityReport)) {
          throw new Error('The requested version has not passed its required quality checks')
        }
        const expectedBaseline = inspected.detail.applet.activeVersionId
        const evaluated = inspected.detail.evaluationRuns.some(
          (run) =>
            run.candidateVersionId === version.id &&
            run.baselineVersionId === expectedBaseline &&
            run.suiteId === inspected.detail.evaluationSuites[0]?.id &&
            run.state === 'passed',
        )
        if (!evaluated) {
          throw new Error('The requested version has not passed its behavioral evaluation')
        }
        window.dispatchEvent(new CustomEvent('eevee:review-version', { detail }))
        return {
          status: 'requires-human-approval',
          ...detail,
          message: 'The version is open for review. A person must approve and publish it.',
        }
      },
    },
    {
      name: 'run_applet',
      title: 'Run applet',
      description:
        'Run the currently published version with validated input values and return the durable run record.',
      inputSchema: inputSchema(createRunSchema.extend({ appletId: z.uuid() })),
      annotations: { readOnlyHint: false, untrustedContentHint: true },
      execute: async (input, { signal }) => {
        const parsed = createRunSchema.extend({ appletId: z.uuid() }).parse(input)
        const { appletId, ...run } = parsed
        const created = await api.runApplet(appletId, run, signal)
        emitChanged(appletId)
        const { output, ...record } = created.run
        return { run: { ...record, outputAvailable: output !== null } }
      },
    },
    {
      name: 'record_correction',
      title: 'Record correction',
      description:
        'Record a person-observed problem and desired result for a successful run. This creates an open proposal: treat it as the brief for the next create_react_app_version call and resolve it there via resolvesCorrections.',
      inputSchema: inputSchema(runCorrectionSchema),
      annotations: { readOnlyHint: false, untrustedContentHint: true },
      execute: async (input, { signal }) => {
        const parsed = runCorrectionSchema.parse(input)
        const { runId, ...correction } = parsed
        const created = await api.createCorrection(runId, correction, signal)
        emitChanged(created.correction.appletId)
        return created
      },
    },
  ]
  const instrument = (tool: WebMcpTool): WebMcpTool => ({
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
        const value = await tool.execute(input, options)
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
        emitToolActivity({
          id,
          tool: tool.name,
          title,
          phase: 'failed',
          at: new Date().toISOString(),
          durationMs: Math.round(performance.now() - startedAt),
          error: error instanceof Error ? error.message.slice(0, 200) : 'The tool call failed',
        })
        throw error
      }
    },
  })

  const controller = new AbortController()
  const registrations = tools.map((tool) =>
    context.registerTool(instrument(tool), { signal: controller.signal }),
  )

  return {
    ready: Promise.all(registrations).then(() => true),
    unregister: () => controller.abort(),
  }
}
