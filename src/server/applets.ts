import 'server-only'
import { and, desc, eq, inArray, max, sql } from 'drizzle-orm'
import type {
  AppletMedium,
  Correction,
  CreateAppletInput,
  CreateCorrectionInput,
  CreateVersionInput,
  AppletRunOutput,
} from '@/domain/applet'
import type {
  AppletDetail,
  AppletSummary,
  AppletVersionSummary,
  RunSummary,
} from '@/domain/api'
import type { InputDefinition } from '@/domain/input'
import { jsonValueSchema, type JsonObject, type JsonValue } from '@/domain/json'
import {
  MAX_STATE_KEYS,
  StateLimitError,
  assertStateKey,
  assertStateValueSize,
} from '@/domain/applet-store'
import { prepareAppletRuntime } from '@/domain/applet-runtime'
import { isPublishableQuality } from '@/domain/quality'
import { evaluateReactApp } from './react-app-quality'
import { getDatabase } from './db/client'
import {
  applet,
  appletDeployment,
  appletRun,
  appletValue,
  appletVersion,
  correction,
  evaluationRun,
  workspace,
} from './db/schema'
import { RequestFailure } from './http'
import { compileReactApp } from './react-compiler'
import {
  hasPassingBehavioralEvaluation,
  listEvaluationRuns,
} from './evaluations'
import { listEvaluationSuites } from './evaluation-suites'

const iso = (value: Date): string => value.toISOString()

const requireVersionTarget = (
  target: { medium: AppletMedium } | undefined,
  definitionKind: CreateVersionInput['definition']['kind'],
): void => {
  if (!target) throw new RequestFailure(404, 'applet_not_found', 'This applet was not found')
  const expectedMedium: AppletMedium = definitionKind === 'react-app' ? 'web-app' : 'video'
  if (target.medium !== expectedMedium) {
    throw new RequestFailure(
      409,
      'medium_mismatch',
      `A ${target.medium} applet cannot use a ${definitionKind} definition`,
    )
  }
}

export const ensureWorkspace = async (workspaceId: string): Promise<void> => {
  await getDatabase().insert(workspace).values({ id: workspaceId }).onConflictDoNothing()
}

const summaryRows = async (workspaceId: string) =>
  getDatabase()
    .select({
      id: applet.id,
      name: applet.name,
      description: applet.description,
      medium: applet.medium,
      state: applet.state,
      activeVersionId: appletDeployment.versionId,
      versionCount: sql<number>`(
        select count(*) from ${appletVersion}
        where ${appletVersion.workspaceId} = ${applet.workspaceId}
          and ${appletVersion.appletId} = ${applet.id}
      )`,
      runCount: sql<number>`(
        select count(*) from ${appletRun}
        where ${appletRun.workspaceId} = ${applet.workspaceId}
          and ${appletRun.appletId} = ${applet.id}
      )`,
      correctionCount: sql<number>`(
        select count(*) from ${correction}
        where ${correction.workspaceId} = ${applet.workspaceId}
          and ${correction.appletId} = ${applet.id}
      )`,
      evaluationCount: sql<number>`(
        select count(*) from ${evaluationRun}
        where ${evaluationRun.workspaceId} = ${applet.workspaceId}
          and ${evaluationRun.appletId} = ${applet.id}
      )`,
      createdAt: applet.createdAt,
      updatedAt: applet.updatedAt,
    })
    .from(applet)
    .leftJoin(
      appletDeployment,
      and(
        eq(appletDeployment.workspaceId, applet.workspaceId),
        eq(appletDeployment.appletId, applet.id),
      ),
    )
    .where(eq(applet.workspaceId, workspaceId))
    .orderBy(desc(applet.updatedAt))

const summary = (
  row: Awaited<ReturnType<typeof summaryRows>>[number],
): AppletSummary => ({
  ...row,
  versionCount: Number(row.versionCount),
  runCount: Number(row.runCount),
  correctionCount: Number(row.correctionCount),
  evaluationCount: Number(row.evaluationCount),
  createdAt: iso(row.createdAt),
  updatedAt: iso(row.updatedAt),
})

export const listApplets = async (workspaceId: string): Promise<AppletSummary[]> =>
  (await summaryRows(workspaceId)).map(summary)

const getSummary = async (workspaceId: string, appletId: string): Promise<AppletSummary> => {
  const result = (await summaryRows(workspaceId)).find(({ id }) => id === appletId)
  if (!result) throw new RequestFailure(404, 'applet_not_found', 'This applet was not found')
  return summary(result)
}

const versionSummary = (
  row: typeof appletVersion.$inferSelect,
): AppletVersionSummary => ({
  id: row.id,
  version: row.version,
  state: row.state,
  note: row.note,
  inputs: row.inputs,
  definitionKind: row.definition.kind,
  qualityReport: row.qualityReport,
  createdAt: iso(row.createdAt),
})

const runSummary = (row: typeof appletRun.$inferSelect): RunSummary => ({
  id: row.id,
  appletVersionId: row.appletVersionId,
  state: row.state,
  createdAt: iso(row.createdAt),
  completedAt: row.completedAt ? iso(row.completedAt) : null,
})

const correctionView = (row: typeof correction.$inferSelect): Correction => ({
  id: row.id,
  appletId: row.appletId,
  runId: row.runId,
  state: row.state,
  instruction: row.instruction,
  observedIssue: row.observedIssue,
  desiredOutcome: row.desiredOutcome,
  createdAt: iso(row.createdAt),
})

export const getApplet = async (
  workspaceId: string,
  appletId: string,
): Promise<AppletDetail> => {
  const [appletSummary, versions, runs, corrections, evaluationSuites, evaluationRuns] = await Promise.all([
    getSummary(workspaceId, appletId),
    getDatabase()
      .select()
      .from(appletVersion)
      .where(
        and(eq(appletVersion.workspaceId, workspaceId), eq(appletVersion.appletId, appletId)),
      )
      .orderBy(desc(appletVersion.version)),
    getDatabase()
      .select()
      .from(appletRun)
      .where(and(eq(appletRun.workspaceId, workspaceId), eq(appletRun.appletId, appletId)))
      .orderBy(desc(appletRun.createdAt))
      .limit(25),
    getDatabase()
      .select()
      .from(correction)
      .where(and(eq(correction.workspaceId, workspaceId), eq(correction.appletId, appletId)))
      .orderBy(desc(correction.createdAt))
      .limit(25),
    listEvaluationSuites(workspaceId, appletId),
    listEvaluationRuns(workspaceId, appletId),
  ])
  return {
    applet: appletSummary,
    versions: versions.map(versionSummary),
    runs: runs.map(runSummary),
    corrections: corrections.map(correctionView),
    evaluationSuites,
    evaluationRuns,
  }
}

export const getAppletVersion = async (
  workspaceId: string,
  appletId: string,
  versionId: string,
): Promise<{ version: AppletVersionSummary; definition: CreateVersionInput['definition'] }> => {
  const [row] = await getDatabase()
    .select()
    .from(appletVersion)
    .where(
      and(
        eq(appletVersion.workspaceId, workspaceId),
        eq(appletVersion.appletId, appletId),
        eq(appletVersion.id, versionId),
      ),
    )
    .limit(1)
  if (!row) throw new RequestFailure(404, 'version_not_found', 'This version was not found')
  return { version: versionSummary(row), definition: row.definition }
}

export const createApplet = async (
  workspaceId: string,
  value: CreateAppletInput,
): Promise<AppletSummary> => {
  const [created] = await getDatabase()
    .insert(applet)
    .values({ workspaceId, ...value })
    .returning({ id: applet.id })
  if (!created) throw new Error('PostgreSQL did not return the created applet')
  return getSummary(workspaceId, created.id)
}

export const createVersion = async (
  workspaceId: string,
  appletId: string,
  value: CreateVersionInput,
): Promise<{ version: AppletVersionSummary; publishable: boolean }> => {
  const database = getDatabase()
  const [target] = await database
    .select({ medium: applet.medium })
    .from(applet)
    .where(and(eq(applet.workspaceId, workspaceId), eq(applet.id, appletId)))
    .limit(1)
  requireVersionTarget(target, value.definition.kind)
  const compilation = await compileReactApp(value.definition)
  const qualityReport = await evaluateReactApp(value.definition, compilation)
  const created = await database.transaction(async (transaction) => {
    await transaction.execute(sql`select pg_advisory_xact_lock(hashtext(${appletId}))`)
    const [owned] = await transaction
      .select({ id: applet.id, medium: applet.medium })
      .from(applet)
      .where(and(eq(applet.workspaceId, workspaceId), eq(applet.id, appletId)))
      .limit(1)
    requireVersionTarget(owned, value.definition.kind)
    const [current] = await transaction
      .select({ version: max(appletVersion.version) })
      .from(appletVersion)
      .where(
        and(eq(appletVersion.workspaceId, workspaceId), eq(appletVersion.appletId, appletId)),
      )
    const [row] = await transaction
      .insert(appletVersion)
      .values({
        workspaceId,
        appletId,
        version: (current?.version ?? 0) + 1,
        note: value.note,
        inputs: value.inputs,
        definition: value.definition,
        artifact: compilation.artifact,
        qualityReport,
      })
      .returning()
    if (!row) throw new Error('PostgreSQL did not return the created version')
    if (value.resolvesCorrections?.length) {
      // The new version answers these proposals; only open proposals on this
      // applet can transition, so a stale or foreign id is a silent no-op
      // rather than a cross-applet write.
      await transaction
        .update(correction)
        .set({ state: 'applied' })
        .where(
          and(
            eq(correction.workspaceId, workspaceId),
            eq(correction.appletId, appletId),
            eq(correction.state, 'proposed'),
            inArray(correction.id, value.resolvesCorrections),
          ),
        )
    }
    await transaction
      .update(applet)
      .set({ updatedAt: new Date() })
      .where(and(eq(applet.workspaceId, workspaceId), eq(applet.id, appletId)))
    return row
  })
  return {
    version: versionSummary(created),
    publishable: false,
  }
}

export const publishVersion = async (
  workspaceId: string,
  appletId: string,
  versionId: string,
): Promise<void> => {
  const database = getDatabase()
  await database.transaction(async (transaction) => {
    await transaction.execute(sql`select pg_advisory_xact_lock(hashtext(${`publish:${appletId}`}))`)
    const [version] = await transaction
      .select()
      .from(appletVersion)
      .where(
        and(
          eq(appletVersion.workspaceId, workspaceId),
          eq(appletVersion.appletId, appletId),
          eq(appletVersion.id, versionId),
        ),
      )
      .limit(1)
    if (!version) throw new RequestFailure(404, 'version_not_found', 'This version was not found')
    if (!version.artifact) {
      throw new RequestFailure(
        409,
        'artifact_unavailable',
        'This version did not compile into an executable artifact',
      )
    }
    if (!isPublishableQuality(version.qualityReport)) {
      throw new RequestFailure(
        409,
        'quality_gate_failed',
        'This version has not passed its required quality checks',
      )
    }
    if (!(await hasPassingBehavioralEvaluation(workspaceId, appletId, versionId))) {
      throw new RequestFailure(
        409,
        'behavioral_evaluation_required',
        'Run a passing behavioral evaluation against the current published version first',
      )
    }
    await transaction
      .update(appletVersion)
      .set({ state: 'approved' })
      .where(eq(appletVersion.id, version.id))
    await transaction
      .insert(appletDeployment)
      .values({ workspaceId, appletId, versionId })
      .onConflictDoUpdate({
        target: [appletDeployment.workspaceId, appletDeployment.appletId],
        set: { versionId, publishedAt: new Date() },
      })
    await transaction
      .update(applet)
      .set({ updatedAt: new Date() })
      .where(and(eq(applet.workspaceId, workspaceId), eq(applet.id, appletId)))
  })
}

const previewInputs = (inputs: InputDefinition): JsonObject =>
  Object.fromEntries(
    inputs.map((field): readonly [string, JsonValue] => {
      if (field.defaultValue !== undefined) return [field.key, field.defaultValue]
      switch (field.kind) {
        case 'text':
          return [field.key, field.label]
        case 'number':
          return [
            field.key,
            field.minimum ?? (field.maximum !== undefined && field.maximum < 0 ? field.maximum : 0),
          ]
        case 'boolean':
          return [field.key, false]
        case 'choice': {
          const first = field.options[0]
          if (!first) throw new Error('A choice input has no options')
          return [field.key, first.value]
        }
        default: {
          const unreachable: never = field
          return unreachable
        }
      }
    }),
  )

export const previewVersion = async (
  workspaceId: string,
  appletId: string,
  versionId: string,
): Promise<AppletRunOutput> => {
  const [version] = await getDatabase()
    .select({
      artifact: appletVersion.artifact,
      inputs: appletVersion.inputs,
      definition: appletVersion.definition,
    })
    .from(appletVersion)
    .where(
      and(
        eq(appletVersion.workspaceId, workspaceId),
        eq(appletVersion.appletId, appletId),
        eq(appletVersion.id, versionId),
      ),
    )
    .limit(1)
  if (!version) throw new RequestFailure(404, 'version_not_found', 'This version was not found')
  if (!version.artifact) {
    throw new RequestFailure(
      409,
      'artifact_unavailable',
      'This version did not compile into an executable artifact',
    )
  }
  const channel = crypto.randomUUID()
  const inputs = previewInputs(version.inputs)
  if (version.definition.kind === 'video-editor') {
    return {
      kind: 'video',
      channel,
      project: version.definition.project,
      html: prepareAppletRuntime(
        version.artifact.html,
        channel,
        inputs,
        version.definition.actions,
        { project: version.definition.project },
      ),
    }
  }
  return {
    kind: 'web-app',
    channel,
    html: prepareAppletRuntime(
      version.artifact.html,
      channel,
      inputs,
      version.definition.actions,
    ),
  }
}

const stateKey = (value: string): string => {
  try {
    return assertStateKey(value)
  } catch (error) {
    if (error instanceof StateLimitError) {
      throw new RequestFailure(400, error.code, error.message)
    }
    throw error
  }
}

export const readAppletValues = async (
  workspaceId: string,
  appletId: string,
): Promise<JsonObject> => {
  const rows = await getDatabase()
    .select({ key: appletValue.key, value: appletValue.value })
    .from(appletValue)
    .where(
      and(eq(appletValue.workspaceId, workspaceId), eq(appletValue.appletId, appletId)),
    )
  return Object.fromEntries(rows.map(({ key, value }) => [key, value]))
}

export const writeAppletValue = async (
  workspaceId: string,
  appletId: string,
  keyInput: string,
  input: unknown,
): Promise<JsonValue> => {
  const key = stateKey(keyInput)
  const value = jsonValueSchema.parse(input)
  try {
    assertStateValueSize(value)
  } catch (error) {
    if (error instanceof StateLimitError) {
      throw new RequestFailure(413, error.code, error.message)
    }
    throw error
  }
  const storedValue = value === null ? sql<JsonValue>`'null'::jsonb` : value
  await getDatabase().transaction(async (transaction) => {
    const [owned] = await transaction
      .select({ id: applet.id })
      .from(applet)
      .where(and(eq(applet.workspaceId, workspaceId), eq(applet.id, appletId)))
      .limit(1)
    if (!owned) throw new RequestFailure(404, 'applet_not_found', 'This applet was not found')

    await transaction.execute(
      sql`select pg_advisory_xact_lock(hashtext(${`${workspaceId}:${appletId}`}))`,
    )
    const [existing] = await transaction
      .select({ key: appletValue.key })
      .from(appletValue)
      .where(
        and(
          eq(appletValue.workspaceId, workspaceId),
          eq(appletValue.appletId, appletId),
          eq(appletValue.key, key),
        ),
      )
      .limit(1)
    if (!existing) {
      const [current] = await transaction
        .select({ total: sql<number>`count(*)` })
        .from(appletValue)
        .where(
          and(eq(appletValue.workspaceId, workspaceId), eq(appletValue.appletId, appletId)),
        )
      if (Number(current?.total ?? 0) >= MAX_STATE_KEYS) {
        throw new RequestFailure(
          409,
          'state_key_limit_reached',
          `One applet can store at most ${MAX_STATE_KEYS} state keys`,
        )
      }
    }
    await transaction
      .insert(appletValue)
      .values({ workspaceId, appletId, key, value: storedValue })
      .onConflictDoUpdate({
        target: [appletValue.workspaceId, appletValue.appletId, appletValue.key],
        set: { value: storedValue, updatedAt: new Date() },
      })
  })
  return value
}

export const createCorrection = async (
  workspaceId: string,
  runId: string,
  value: CreateCorrectionInput,
): Promise<Correction> => {
  const [run] = await getDatabase()
    .select({ appletId: appletRun.appletId, state: appletRun.state })
    .from(appletRun)
    .where(and(eq(appletRun.workspaceId, workspaceId), eq(appletRun.id, runId)))
    .limit(1)
  if (!run) throw new RequestFailure(404, 'run_not_found', 'This run was not found')
  if (run.state !== 'succeeded') {
    throw new RequestFailure(409, 'run_not_correctable', 'Only successful runs can be corrected')
  }
  const [row] = await getDatabase()
    .insert(correction)
    .values({ workspaceId, appletId: run.appletId, runId, ...value })
    .returning()
  if (!row) throw new Error('PostgreSQL did not return the correction')
  return correctionView(row)
}

export const dismissCorrection = async (
  workspaceId: string,
  correctionId: string,
): Promise<Correction> => {
  const [row] = await getDatabase()
    .update(correction)
    .set({ state: 'dismissed' })
    .where(
      and(
        eq(correction.workspaceId, workspaceId),
        eq(correction.id, correctionId),
        eq(correction.state, 'proposed'),
      ),
    )
    .returning()
  if (!row) {
    throw new RequestFailure(
      404,
      'correction_not_open',
      'This correction was not found or is no longer open',
    )
  }
  return correctionView(row)
}
