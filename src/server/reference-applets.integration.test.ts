import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { MAX_APPLET_ACTIONS } from '@/domain/applet-action'
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

  it('installs Meridian Ops once with a multi-folder source tree and 32 governed actions', async () => {
    const first = await installReferenceApplet(workspaceId, 'meridian')
    const second = await installReferenceApplet(workspaceId, 'meridian')
    expect(second.id).toBe(first.id)

    const detail = await getApplet(workspaceId, first.id)
    expect(detail).toMatchObject({
      applet: { name: 'Meridian Ops', medium: 'web-app', versionCount: 1 },
      evaluationSuites: [{ name: 'Meridian order-to-cash behavior' }],
    })
    const version = detail.versions[0]
    expect(version?.qualityReport.verdict).toBe('pass')
    expect(
      version?.qualityReport.checks.filter(({ criticality, verdict }) => criticality === 'required' && verdict === 'fail'),
    ).toEqual([])
    const stored = await getDatabase().query.appletVersion.findFirst({
      where: (table, { eq: equals }) => equals(table.id, version?.id ?? ''),
    })
    const paths = stored?.definition.files.map(({ path }) => path) ?? []
    expect(paths).toHaveLength(15)
    expect(paths).toContain('src/lib/logic.ts')
    expect(paths).toContain('src/lib/persist.ts')
    expect(paths).toContain('src/modules/orders.tsx')
    expect(paths).toContain('src/components/ui.tsx')
    const actions = stored?.definition.actions ?? []
    expect(actions).toHaveLength(MAX_APPLET_ACTIONS)
    const reads = actions.filter(({ authority }) => authority === 'automatic')
    expect(reads).toHaveLength(13)
    expect(actions.map(({ name }) => name)).toEqual(
      expect.arrayContaining(['get_order', 'get_invoice', 'set_credit_hold', 'update_product', 'update_customer']),
    )
    expect(actions.map(({ name }) => name)).not.toContain('toggle_credit_hold')
    // Every description says what the action returns.
    expect(actions.every(({ description }) => /\bReturns\b/.test(description))).toBe(true)
    // Enumerated inputs are choices; whole-unit inputs declare a step of 1.
    const inputs = actions.flatMap(({ inputs: fields }) => fields)
    expect(inputs.filter(({ key }) => ['category', 'terms', 'state'].includes(key)).every(({ kind }) => kind === 'choice')).toBe(true)
    expect(
      inputs
        .filter(({ key }) => ['qty', 'delta', 'reorder_point', 'limit', 'offset'].includes(key))
        .every((field) => field.kind === 'number' && field.step === 1),
    ).toBe(true)
  })
})
