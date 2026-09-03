import 'server-only'
import { and, desc, eq, inArray, max, sql } from 'drizzle-orm'
import type {
  AppletMedium,
  AppletVersionDefinition,
  Correction,
  CreateAppletInput,
  CreateCorrectionInput,
  CreateVersionInput,
  ReviseVersionInput,
  AppletRunOutput,
} from '@/domain/applet'
import { appletVersionDefinitionSchema } from '@/domain/applet'
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

const mediumForDefinition = (
  definitionKind: CreateVersionInput['definition']['kind'],
): AppletMedium => {
  switch (definitionKind) {
    case 'react-app':
      return 'web-app'
    case 'video-editor':
      return 'video'
    default: {
      const unreachable: never = definitionKind
      return unreachable
    }
  }
}

const requireVersionTarget = (
  target: { medium: AppletMedium } | undefined,
  definitionKind: CreateVersionInput['definition']['kind'],
): void => {
  if (!target) throw new RequestFailure(404, 'applet_not_found', 'This applet was not found')
  const expectedMedium = mediumForDefinition(definitionKind)
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

const summaryRows = async (workspaceId: string, appletId?: string) =>
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
    .where(
      appletId
        ? and(eq(applet.workspaceId, workspaceId), eq(applet.id, appletId))
        : eq(applet.workspaceId, workspaceId),
    )
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
  const [result] = await summaryRows(workspaceId, appletId)
  if (!result) throw new RequestFailure(404, 'applet_not_found', 'This applet was not found')
  return summary(result)
}

// Version listings skip the definition and artifact columns, which can be
// megabytes per row, and read the definition kind straight from JSON.
const versionRows = async (workspaceId: string, appletId: string) =>
  getDatabase()
    .select({
      id: appletVersion.id,
      version: appletVersion.version,
      state: appletVersion.state,
      note: appletVersion.note,
      inputs: appletVersion.inputs,
      definitionKind: sql<
        AppletVersionDefinition['kind']
      >`${appletVersion.definition}->>'kind'`,
      qualityReport: appletVersion.qualityReport,
      createdAt: appletVersion.createdAt,
    })
    .from(appletVersion)
    .where(and(eq(appletVersion.workspaceId, workspaceId), eq(appletVersion.appletId, appletId)))
    .orderBy(desc(appletVersion.version))

const versionSummary = (
  row: Awaited<ReturnType<typeof versionRows>>[number],
): AppletVersionSummary => ({
  id: row.id,
  version: row.version,
  state: row.state,
  note: row.note,
  inputs: row.inputs,
  definitionKind: row.definitionKind,
  qualityReport: row.qualityReport,
  createdAt: iso(row.createdAt),
})

const fullVersionSummary = (row: typeof appletVersion.$inferSelect): AppletVersionSummary =>
  versionSummary({ ...row, definitionKind: row.definition.kind })

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
    versionRows(workspaceId, appletId),
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
  return { version: fullVersionSummary(row), definition: row.definition }
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
    version: fullVersionSummary(created),
    publishable: false,
  }
}

/**
 * Delta revision: merge changed/deleted files over an existing version's
 * React definition and create the merged result as a new immutable version.
 * Validation, compilation, quality gating, and locking all flow through
 * createVersion so there is exactly one write path.
 */
export const reviseVersion = async (
  workspaceId: string,
  appletId: string,
  value: ReviseVersionInput,
): Promise<{ version: AppletVersionSummary; publishable: boolean }> => {
  const base = await getAppletVersion(workspaceId, appletId, value.baseVersionId)
  if (base.definition.kind !== 'react-app') {
    throw new RequestFailure(
      422,
      'unsupported_base',
      'Only React app versions can be revised by delta; send a full definition instead',
    )
  }
  const merged = new Map(base.definition.files.map((file) => [file.path, file]))
  const unknownDeletes = value.deletedPaths.filter((path) => !merged.has(path))
  if (unknownDeletes.length > 0) {
    throw new RequestFailure(
      422,
      'deleted_path_not_found',
      `deletedPaths names files the base version does not have: ${unknownDeletes.join(', ')}`,
    )
  }
  for (const path of value.deletedPaths) merged.delete(path)
  for (const file of value.changedFiles) merged.set(file.path, file)
  if (!merged.has(base.definition.entry)) {
    throw new RequestFailure(
      422,
      'entry_deleted',
      `${base.definition.entry} is the entry file and must remain in the version`,
    )
  }
  const [baseRow] = await getDatabase()
    .select({ inputs: appletVersion.inputs })
    .from(appletVersion)
    .where(
      and(
        eq(appletVersion.workspaceId, workspaceId),
        eq(appletVersion.appletId, appletId),
        eq(appletVersion.id, value.baseVersionId),
      ),
    )
    .limit(1)
  if (!baseRow) throw new RequestFailure(404, 'version_not_found', 'This version was not found')
  const parsedDefinition = appletVersionDefinitionSchema.safeParse({
    kind: 'react-app',
    entry: base.definition.entry,
    files: [...merged.values()],
    actions: value.actions ?? base.definition.actions,
  })
  if (!parsedDefinition.success) {
    // The merged tree broke a definition rule (deleted entry file, too many
    // files, oversized source, invalid actions). The agent needs the reason,
    // not an opaque 500.
    throw new RequestFailure(
      400,
      'invalid_merged_definition',
      parsedDefinition.error.issues[0]?.message ?? 'The merged definition is invalid',
    )
  }
  const definition = parsedDefinition.data
  return createVersion(workspaceId, appletId, {
    note: value.note,
    inputs: value.inputs ?? baseRow.inputs,
    definition,
    resolvesCorrections: value.resolvesCorrections,
  })
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
  switch (version.definition.kind) {
    case 'video-editor':
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
    case 'react-app':
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
    default: {
      const unreachable: never = version.definition
      return unreachable
    }
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
