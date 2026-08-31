import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { getApplet, ensureWorkspace } from './applets'
import { getDatabase } from './db/client'
import { workspace } from './db/schema'
import { installReferenceApplet } from './reference-applets'

const databaseEnabled = Boolean(process.env.DATABASE_URL)
const describeDatabase = databaseEnabled ? describe : describe.skip

describeDatabase('reference applets', () => {
  const workspaceId = crypto.randomUUID()

  beforeAll(async () => {
    await ensureWorkspace(workspaceId)
  })

  afterAll(async () => {
    if (!databaseEnabled) return
    await getDatabase().delete(workspace).where(eq(workspace.id, workspaceId))
  })

  it('installs Sparkbench once with governed actions and a behavioral suite', async () => {
    const first = await installReferenceApplet(workspaceId, 'sparkbench')
    const second = await installReferenceApplet(workspaceId, 'sparkbench')
    expect(second.id).toBe(first.id)

    const detail = await getApplet(workspaceId, first.id)
    expect(detail).toMatchObject({
      applet: { name: 'Sparkbench', medium: 'web-app', versionCount: 1 },
      evaluationSuites: [{ name: 'Sparkbench shared-state behavior' }],
    })
    const version = detail.versions[0]
    expect(version?.qualityReport.verdict).toBe('pass')
    const inspected = await getDatabase().query.appletVersion.findFirst({
      where: (table, { eq: equals }) => equals(table.id, version?.id ?? ''),
    })
    expect(inspected?.definition.actions.map(({ name }) => name)).toEqual([
      'inspect_circuit',
      'read_measurements',
      'set_resistance',
      'toggle_switch',
      'reset_bench',
    ])
  })

  it('installs FableCut as a video applet with a bounded EDL', async () => {
    const installed = await installReferenceApplet(workspaceId, 'fablecut')
    const detail = await getApplet(workspaceId, installed.id)
    expect(detail).toMatchObject({
      applet: { name: 'FableCut', medium: 'video', versionCount: 1 },
      evaluationSuites: [{ name: 'FableCut timeline behavior' }],
    })
    const version = detail.versions[0]
    const stored = await getDatabase().query.appletVersion.findFirst({
      where: (table, { eq: equals }) => equals(table.id, version?.id ?? ''),
    })
    expect(stored?.definition.kind).toBe('video-editor')
    if (stored?.definition.kind !== 'video-editor') throw new Error('FableCut has no video definition')
    expect(stored.definition.project).toMatchObject({ durationMs: 18_000, fps: 30 })
    expect(stored.definition.actions).toHaveLength(5)
  })
})
