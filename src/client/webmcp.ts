import { z } from 'zod'
import {
  createAppletSchema,
  createCorrectionSchema,
  createRunSchema,
  createVersionSchema,
} from '@/domain/applet'
import { isPublishableQuality } from '@/domain/quality'
import { api } from './api'

const appletIdSchema = z.strictObject({ appletId: z.uuid() })
const runCorrectionSchema = createCorrectionSchema.extend({ runId: z.uuid() })
const versionReviewSchema = z.strictObject({ appletId: z.uuid(), versionId: z.uuid() })

const inputSchema = (schema: z.ZodType): object =>
  z.toJSONSchema(schema, { target: 'draft-7', io: 'input' })

const emitChanged = (appletId?: string): void => {
  window.dispatchEvent(new CustomEvent('eevee:changed', { detail: appletId ? { appletId } : {} }))
}

export const registerEeveeTools = (): {
  ready: Promise<boolean>
  unregister: () => void
} => {
  const context = document.modelContext
  if (!context) return { ready: Promise.resolve(false), unregister: () => undefined }

  const tools: WebMcpTool[] = [
    {
      name: 'list_applets',
      title: 'List applets',
      description:
        'List the durable applets in this EEVEE workspace with version, run, and correction counts.',
      inputSchema: inputSchema(z.strictObject({})),
      annotations: { readOnlyHint: true, untrustedContentHint: true },
      execute: async (_input, { signal }) => api.listApplets(signal),
    },
    {
      name: 'inspect_applet',
      title: 'Inspect applet',
      description:
        'Inspect one applet, its typed inputs, immutable versions, quality reports, recent runs, and proposed corrections.',
      inputSchema: inputSchema(appletIdSchema),
      annotations: { readOnlyHint: true, untrustedContentHint: true },
      execute: async (input, { signal }) => {
        const { appletId } = appletIdSchema.parse(input)
        return api.inspectApplet(appletId, signal)
      },
    },
    {
      name: 'create_applet',
      title: 'Create applet',
      description:
        'Create a durable draft applet. Use web-app for self-contained HTML; other media become typed drafts until their executor is available.',
      inputSchema: inputSchema(createAppletSchema),
      annotations: { readOnlyHint: false, untrustedContentHint: true },
      execute: async (input, { signal }) => {
        const created = await api.createApplet(createAppletSchema.parse(input), signal)
        emitChanged(created.applet.id)
        return created
      },
    },
    {
      name: 'create_web_app_version',
      title: 'Create web app version',
      description:
        'Create an immutable version of a web applet from one complete self-contained HTML document and a typed input definition. The harness evaluates it before a person can publish it.',
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
          throw new Error('The requested version has not passed its blocking quality checks')
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
        'Record a person-observed problem and desired result for a successful run. This creates a proposal; it does not mutate the live version.',
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
  const controller = new AbortController()
  const registrations = tools.map((tool) =>
    context.registerTool(tool, { signal: controller.signal }),
  )

  return {
    ready: Promise.all(registrations).then(() => true),
    unregister: () => controller.abort(),
  }
}
