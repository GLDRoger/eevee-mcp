import 'server-only'
import { and, desc, eq, isNull, lt, sql } from 'drizzle-orm'
import type {
  CompleteEvaluationInput,
  EvaluationCaseDefinition,
  EvaluationExecution,
  EvaluationPlan,
  EvaluationRun,
  EvaluationTarget,
  StartEvaluationInput,
} from '@/domain/evaluation'
import { validateAppletInputs, type InputDefinition } from '@/domain/input'
import { prepareAppletRuntime } from '@/domain/applet-runtime'
import type { WebAppArtifact } from '@/domain/react-app'
import type { AppletActionDefinition } from '@/domain/applet-action'
import { getDatabase } from './db/client'
import {
  appletDeployment,
  appletVersion,
  evaluationRun,
  evaluationSuite,
} from './db/schema'
import { RequestFailure } from './http'
import { buildEvaluationReport } from './evaluation-report'
import { evaluationSuiteView } from './evaluation-suites'

const MAX_RUNNING_EVALUATIONS = 3
const EVALUATION_LEASE_MS = 10 * 60 * 1_000
const iso = (value: Date): string => value.toISOString()

const runView = (row: typeof evaluationRun.$inferSelect): EvaluationRun => ({
  id: row.id,
  appletId: row.appletId,
  candidateVersionId: row.candidateVersionId,
  baselineVersionId: row.baselineVersionId ?? null,
  suiteId: row.suiteId,
  state: row.state,
  report: row.report ?? null,
  error: row.error ?? null,
  createdAt: iso(row.createdAt),
  leaseExpiresAt: iso(row.leaseExpiresAt),
  completedAt: row.completedAt ? iso(row.completedAt) : null,
})

export const listEvaluationRuns = async (
  workspaceId: string,
  appletId: string,
): Promise<EvaluationRun[]> =>
  (
    await getDatabase()
      .select()
      .from(evaluationRun)
      .where(
        and(eq(evaluationRun.workspaceId, workspaceId), eq(evaluationRun.appletId, appletId)),
      )
      .orderBy(desc(evaluationRun.createdAt))
      .limit(25)
  ).map(runView)

type ExecutableVersion = {
  id: string
  inputs: InputDefinition
  artifact: WebAppArtifact
  actions: AppletActionDefinition[]
}

const validatedCaseInputs = (
  version: ExecutableVersion,
  evaluationCase: EvaluationCaseDefinition,
): ReturnType<typeof validateAppletInputs> & { ok: true } => {
  const validated = validateAppletInputs(version.inputs, evaluationCase.input)
  if (!validated.ok) {
    throw new RequestFailure(
      409,
      'suite_input_mismatch',
      `${evaluationCase.id}: ${validated.issues.map(({ key, message }) => `${key}: ${message}`).join('; ')}`,
    )
  }
  return validated
}

const executionFor = (
  version: ExecutableVersion,
  evaluationCase: EvaluationCaseDefinition,
): EvaluationExecution => {
  const validated = validatedCaseInputs(version, evaluationCase)
  const channel = crypto.randomUUID()
  return {
    caseId: evaluationCase.id,
    output: {
      kind: 'web-app',
      channel,
      html: prepareAppletRuntime(version.artifact.html, channel, validated.values, version.actions),
    },
  }
}

const executableVersion = (
  row: Pick<typeof appletVersion.$inferSelect, 'id' | 'inputs' | 'artifact' | 'definition'> | undefined,
  missingCode: string,
): ExecutableVersion => {
  if (!row) throw new RequestFailure(404, missingCode, 'This applet version was not found')
  if (!row.artifact) {
    throw new RequestFailure(
      409,
      'artifact_unavailable',
      'The evaluated version has no executable artifact',
    )
  }
  return {
    id: row.id,
    inputs: row.inputs,
    artifact: row.artifact,
    actions: row.definition.actions,
  }
}

export const startEvaluation = async (
  workspaceId: string,
  appletId: string,
  input: StartEvaluationInput,
): Promise<EvaluationPlan> => {
  const database = getDatabase()
  const prepared = await database.transaction(async (transaction) => {
    await transaction.execute(sql`select pg_advisory_xact_lock(hashtext(${`evaluation:${appletId}`}))`)
    const now = new Date()
    await transaction
      .update(evaluationRun)
      .set({ state: 'failed', error: 'The browser worker lease expired', completedAt: now })
      .where(
        and(
          eq(evaluationRun.workspaceId, workspaceId),
          eq(evaluationRun.appletId, appletId),
          eq(evaluationRun.state, 'running'),
          lt(evaluationRun.leaseExpiresAt, now),
        ),
      )
    const [running] = await transaction
      .select({ total: sql<number>`count(*)` })
      .from(evaluationRun)
      .where(
        and(
          eq(evaluationRun.workspaceId, workspaceId),
          eq(evaluationRun.appletId, appletId),
          eq(evaluationRun.state, 'running'),
        ),
      )
    if (Number(running?.total ?? 0) >= MAX_RUNNING_EVALUATIONS) {
      throw new RequestFailure(
        409,
        'evaluation_capacity_reached',
        'Wait for an active evaluation to finish before starting another',
      )
    }
    const suiteWhere = input.suiteId
      ? and(
          eq(evaluationSuite.workspaceId, workspaceId),
          eq(evaluationSuite.appletId, appletId),
          eq(evaluationSuite.id, input.suiteId),
        )
      : and(
          eq(evaluationSuite.workspaceId, workspaceId),
          eq(evaluationSuite.appletId, appletId),
        )
    const suiteQuery = transaction
      .select()
      .from(evaluationSuite)
      .where(suiteWhere)
      .orderBy(desc(evaluationSuite.revision))
      .limit(1)
    const [suite, candidateRow, deployment] = await Promise.all([
      suiteQuery.then(([row]) => row),
      transaction
        .select({
          id: appletVersion.id,
          inputs: appletVersion.inputs,
          artifact: appletVersion.artifact,
          definition: appletVersion.definition,
        })
        .from(appletVersion)
        .where(
          and(
            eq(appletVersion.workspaceId, workspaceId),
            eq(appletVersion.appletId, appletId),
            eq(appletVersion.id, input.versionId),
          ),
        )
        .limit(1)
        .then(([row]) => row),
      transaction
        .select({ versionId: appletDeployment.versionId })
        .from(appletDeployment)
        .where(
          and(
            eq(appletDeployment.workspaceId, workspaceId),
            eq(appletDeployment.appletId, appletId),
          ),
        )
        .limit(1)
        .then(([row]) => row),
    ])
    if (!suite) {
      throw new RequestFailure(
        409,
        'evaluation_suite_missing',
        'Create an evaluation suite before evaluating this applet',
      )
    }
    const candidate = executableVersion(candidateRow, 'version_not_found')
    const baselineId = deployment?.versionId === candidate.id ? null : deployment?.versionId ?? null
    const baselineRow = baselineId
      ? await transaction
          .select({
            id: appletVersion.id,
            inputs: appletVersion.inputs,
            artifact: appletVersion.artifact,
            definition: appletVersion.definition,
          })
          .from(appletVersion)
          .where(
            and(
              eq(appletVersion.workspaceId, workspaceId),
              eq(appletVersion.appletId, appletId),
              eq(appletVersion.id, baselineId),
            ),
          )
          .limit(1)
          .then(([row]) => row)
      : undefined
    const baseline = baselineId ? executableVersion(baselineRow, 'baseline_not_found') : null
    suite.cases.forEach((item) => {
      validatedCaseInputs(candidate, item)
      if (baseline) validatedCaseInputs(baseline, item)
    })
    const leaseExpiresAt = new Date(now.getTime() + EVALUATION_LEASE_MS)
    const [created] = await transaction
      .insert(evaluationRun)
      .values({
        workspaceId,
        appletId,
        candidateVersionId: candidate.id,
        baselineVersionId: baseline?.id ?? null,
        suiteId: suite.id,
        leaseExpiresAt,
      })
      .returning()
    if (!created) throw new Error('PostgreSQL did not return the evaluation run')
    return { suite, candidate, baseline, run: created }
  })
  return {
    run: runView(prepared.run),
    suite: evaluationSuiteView(prepared.suite),
  }
}

export const getEvaluationExecution = async (
  workspaceId: string,
  runId: string,
  target: EvaluationTarget,
  caseId: string,
): Promise<EvaluationExecution> => {
  const [current] = await getDatabase()
    .select()
    .from(evaluationRun)
    .where(and(eq(evaluationRun.workspaceId, workspaceId), eq(evaluationRun.id, runId)))
    .limit(1)
  if (!current) throw new RequestFailure(404, 'evaluation_not_found', 'This evaluation was not found')
  if (current.state !== 'running' || current.leaseExpiresAt.getTime() < Date.now()) {
    throw new RequestFailure(409, 'evaluation_not_running', 'This evaluation is no longer running')
  }
  const versionId = target === 'candidate' ? current.candidateVersionId : current.baselineVersionId
  if (!versionId) {
    throw new RequestFailure(409, 'evaluation_baseline_missing', 'This evaluation has no baseline')
  }
  const [[suite], [versionRow]] = await Promise.all([
    getDatabase()
      .select()
      .from(evaluationSuite)
      .where(
        and(
          eq(evaluationSuite.workspaceId, workspaceId),
          eq(evaluationSuite.appletId, current.appletId),
          eq(evaluationSuite.id, current.suiteId),
        ),
      )
      .limit(1),
    getDatabase()
      .select({
        id: appletVersion.id,
        inputs: appletVersion.inputs,
        artifact: appletVersion.artifact,
        definition: appletVersion.definition,
      })
      .from(appletVersion)
      .where(
        and(
          eq(appletVersion.workspaceId, workspaceId),
          eq(appletVersion.appletId, current.appletId),
          eq(appletVersion.id, versionId),
        ),
      )
      .limit(1),
  ])
  if (!suite) throw new Error('The evaluation suite was removed while its run existed')
  const evaluationCase = suite.cases.find(({ id }) => id === caseId)
  if (!evaluationCase) {
    throw new RequestFailure(404, 'evaluation_case_not_found', 'This evaluation case was not found')
  }
  return executionFor(executableVersion(versionRow, 'version_not_found'), evaluationCase)
}

export const completeEvaluation = async (
  workspaceId: string,
  runId: string,
  input: CompleteEvaluationInput,
): Promise<EvaluationRun> => {
  const database = getDatabase()
  return database.transaction(async (transaction) => {
    await transaction.execute(sql`select pg_advisory_xact_lock(hashtext(${`evaluation-run:${runId}`}))`)
    const [current] = await transaction
      .select()
      .from(evaluationRun)
      .where(and(eq(evaluationRun.workspaceId, workspaceId), eq(evaluationRun.id, runId)))
      .limit(1)
    if (!current) throw new RequestFailure(404, 'evaluation_not_found', 'This evaluation was not found')
    if (current.state !== 'running') return runView(current)
    if (current.leaseExpiresAt.getTime() < Date.now()) {
      const [expired] = await transaction
        .update(evaluationRun)
        .set({
          state: 'failed',
          error: 'The browser evaluation lease expired',
          completedAt: new Date(),
        })
        .where(
          and(
            eq(evaluationRun.workspaceId, workspaceId),
            eq(evaluationRun.id, runId),
            eq(evaluationRun.state, 'running'),
          ),
        )
        .returning()
      return runView(expired ?? current)
    }
    const [suite] = await transaction
      .select()
      .from(evaluationSuite)
      .where(
        and(
          eq(evaluationSuite.workspaceId, workspaceId),
          eq(evaluationSuite.appletId, current.appletId),
          eq(evaluationSuite.id, current.suiteId),
        ),
      )
      .limit(1)
    if (!suite) throw new Error('The evaluation suite was removed while its run existed')
    const report = buildEvaluationReport(
      current.candidateVersionId,
      current.baselineVersionId,
      suite.cases,
      input,
    )
    const [completed] = await transaction
      .update(evaluationRun)
      .set({
        state: report.verdict === 'pass' ? 'passed' : 'failed',
        report,
        completedAt: new Date(),
      })
      .where(
        and(
          eq(evaluationRun.workspaceId, workspaceId),
          eq(evaluationRun.id, runId),
          eq(evaluationRun.state, 'running'),
        ),
      )
      .returning()
    if (!completed) throw new Error('PostgreSQL did not return the completed evaluation')
    return runView(completed)
  })
}

export const failEvaluation = async (
  workspaceId: string,
  runId: string,
  error: string,
): Promise<EvaluationRun> => {
  return getDatabase().transaction(async (transaction) => {
    await transaction.execute(sql`select pg_advisory_xact_lock(hashtext(${`evaluation-run:${runId}`}))`)
    const [current] = await transaction
      .select()
      .from(evaluationRun)
      .where(and(eq(evaluationRun.workspaceId, workspaceId), eq(evaluationRun.id, runId)))
      .limit(1)
    if (!current) {
      throw new RequestFailure(404, 'evaluation_not_found', 'This evaluation was not found')
    }
    if (current.state !== 'running') return runView(current)
    const [failed] = await transaction
      .update(evaluationRun)
      .set({ state: 'failed', error, completedAt: new Date() })
      .where(
        and(
          eq(evaluationRun.workspaceId, workspaceId),
          eq(evaluationRun.id, runId),
          eq(evaluationRun.state, 'running'),
        ),
      )
      .returning()
    if (!failed) throw new Error('PostgreSQL did not return the failed evaluation')
    return runView(failed)
  })
}

export const getEvaluationRun = async (
  workspaceId: string,
  runId: string,
): Promise<EvaluationRun> => {
  const [row] = await getDatabase()
    .select()
    .from(evaluationRun)
    .where(and(eq(evaluationRun.workspaceId, workspaceId), eq(evaluationRun.id, runId)))
    .limit(1)
  if (!row) throw new RequestFailure(404, 'evaluation_not_found', 'This evaluation was not found')
  return runView(row)
}

export const hasPassingBehavioralEvaluation = async (
  workspaceId: string,
  appletId: string,
  versionId: string,
): Promise<boolean> => {
  const [deployment, latestSuite] = await Promise.all([
    getDatabase()
      .select({ versionId: appletDeployment.versionId })
      .from(appletDeployment)
      .where(
        and(
          eq(appletDeployment.workspaceId, workspaceId),
          eq(appletDeployment.appletId, appletId),
        ),
      )
      .limit(1)
      .then(([row]) => row),
    getDatabase()
      .select({ id: evaluationSuite.id })
      .from(evaluationSuite)
      .where(
        and(
          eq(evaluationSuite.workspaceId, workspaceId),
          eq(evaluationSuite.appletId, appletId),
        ),
      )
      .orderBy(desc(evaluationSuite.revision))
      .limit(1)
      .then(([row]) => row),
  ])
  if (!latestSuite) return false
  const baselineId = deployment?.versionId === versionId ? null : deployment?.versionId ?? null
  const [passing] = await getDatabase()
    .select({ id: evaluationRun.id })
    .from(evaluationRun)
    .where(
      and(
        eq(evaluationRun.workspaceId, workspaceId),
        eq(evaluationRun.appletId, appletId),
        eq(evaluationRun.candidateVersionId, versionId),
        eq(evaluationRun.suiteId, latestSuite.id),
        eq(evaluationRun.state, 'passed'),
        baselineId
          ? eq(evaluationRun.baselineVersionId, baselineId)
          : isNull(evaluationRun.baselineVersionId),
      ),
    )
    .limit(1)
  return passing !== undefined
}
