import 'server-only'
import { and, eq, inArray, sql } from 'drizzle-orm'
import type {
  AppletRun,
  CompleteRunInput,
  CreateRunInput,
  FailRunInput,
  AppletRunOutput,
} from '@/domain/applet'
import { validateAppletInputs } from '@/domain/input'
import { prepareAppletRuntime } from '@/domain/applet-runtime'
import { getDatabase } from './db/client'
import { appletActionRequest, appletDeployment, appletRun, appletVersion } from './db/schema'
import { RequestFailure } from './http'

const iso = (value: Date): string => value.toISOString()

const runView = (row: typeof appletRun.$inferSelect): AppletRun => ({
  id: row.id,
  appletId: row.appletId,
  appletVersionId: row.appletVersionId,
  state: row.state,
  input: row.input,
  output: row.output ?? null,
  error: row.error ?? null,
  createdAt: iso(row.createdAt),
  completedAt: row.completedAt ? iso(row.completedAt) : null,
})

export const getRun = async (workspaceId: string, runId: string): Promise<AppletRun> => {
  const [row] = await getDatabase()
    .select()
    .from(appletRun)
    .where(and(eq(appletRun.workspaceId, workspaceId), eq(appletRun.id, runId)))
    .limit(1)
  if (!row) throw new RequestFailure(404, 'run_not_found', 'This run was not found')
  return runView(row)
}

type Transaction = Parameters<Parameters<ReturnType<typeof getDatabase>['transaction']>[0]>[0]

/**
 * Only the newest run is on the person's screen, so only it can host a
 * decision or an execution. Open requests on earlier runs of an applet would
 * otherwise sit in the decisions queue with no card able to approve them.
 */
export const supersedeOpenActionRequests = async (
  transaction: Transaction,
  workspaceId: string,
  appletId: string,
): Promise<number> => {
  const superseded = await transaction
    .update(appletActionRequest)
    .set({
      state: 'failed',
      error: 'A newer run of this applet superseded this request before it completed',
      completedAt: new Date(),
    })
    .where(
      and(
        eq(appletActionRequest.workspaceId, workspaceId),
        eq(appletActionRequest.appletId, appletId),
        inArray(appletActionRequest.state, ['pending', 'approved', 'running']),
      ),
    )
    .returning({ id: appletActionRequest.id })
  return superseded.length
}

export const runApplet = async (
  workspaceId: string,
  appletId: string,
  request: CreateRunInput,
): Promise<AppletRun> => {
  const [active] = await getDatabase()
    .select({ version: appletVersion })
    .from(appletDeployment)
    .innerJoin(
      appletVersion,
      and(
        eq(appletVersion.workspaceId, appletDeployment.workspaceId),
        eq(appletVersion.appletId, appletDeployment.appletId),
        eq(appletVersion.id, appletDeployment.versionId),
      ),
    )
    .where(
      and(eq(appletDeployment.workspaceId, workspaceId), eq(appletDeployment.appletId, appletId)),
    )
    .limit(1)
  if (!active) {
    throw new RequestFailure(409, 'applet_not_published', 'Publish a passing version before running')
  }
  if (!active.version.artifact) {
    throw new RequestFailure(
      409,
      'artifact_unavailable',
      'The published version has no executable artifact',
    )
  }
  const validated = validateAppletInputs(active.version.inputs, request.input)
  if (!validated.ok) {
    throw new RequestFailure(
      400,
      'invalid_run_input',
      validated.issues.map(({ key, message }) => `${key}: ${message}`).join('\n'),
    )
  }
  const channel = crypto.randomUUID()
  const output: AppletRunOutput = (() => {
    switch (active.version.definition.kind) {
      case 'video-editor':
        return {
          kind: 'video',
          channel,
          project: active.version.definition.project,
          html: prepareAppletRuntime(
            active.version.artifact.html,
            channel,
            validated.values,
            active.version.definition.actions,
            { project: active.version.definition.project },
          ),
        }
      case 'react-app':
        return {
          kind: 'web-app',
          channel,
          html: prepareAppletRuntime(
            active.version.artifact.html,
            channel,
            validated.values,
            active.version.definition.actions,
          ),
        }
      default: {
        const unreachable: never = active.version.definition
        return unreachable
      }
    }
  })()
  return getDatabase().transaction(async (transaction) => {
    await supersedeOpenActionRequests(transaction, workspaceId, appletId)
    const [row] = await transaction
      .insert(appletRun)
      .values({
        workspaceId,
        appletId,
        appletVersionId: active.version.id,
        state: 'running',
        input: validated.values,
        output,
      })
      .returning()
    if (!row) throw new Error('PostgreSQL did not return the created run')
    return runView(row)
  })
}

export const completeRun = async (
  workspaceId: string,
  runId: string,
  input: CompleteRunInput,
): Promise<AppletRun> => {
  const database = getDatabase()
  return database.transaction(async (transaction) => {
    await transaction.execute(sql`select pg_advisory_xact_lock(hashtext(${`run:${runId}`}))`)
    const [current] = await transaction
      .select()
      .from(appletRun)
      .where(and(eq(appletRun.workspaceId, workspaceId), eq(appletRun.id, runId)))
      .limit(1)
    if (!current) throw new RequestFailure(404, 'run_not_found', 'This run was not found')
    if (current.output?.channel !== input.channel) {
      throw new RequestFailure(403, 'invalid_run_channel', 'The runtime channel does not match')
    }
    if (current.state === 'succeeded') return runView(current)
    if (current.state !== 'running') {
      throw new RequestFailure(409, 'run_not_completable', 'This run is not awaiting a runtime')
    }
    const [completed] = await transaction
      .update(appletRun)
      .set({ state: 'succeeded', completedAt: new Date() })
      .where(
        and(
          eq(appletRun.workspaceId, workspaceId),
          eq(appletRun.id, runId),
          eq(appletRun.state, 'running'),
        ),
      )
      .returning()
    if (!completed) throw new Error('PostgreSQL did not return the completed run')
    return runView(completed)
  })
}

export const failRun = async (
  workspaceId: string,
  runId: string,
  input: FailRunInput,
): Promise<AppletRun> => {
  const database = getDatabase()
  return database.transaction(async (transaction) => {
    await transaction.execute(sql`select pg_advisory_xact_lock(hashtext(${`run:${runId}`}))`)
    const [current] = await transaction
      .select()
      .from(appletRun)
      .where(and(eq(appletRun.workspaceId, workspaceId), eq(appletRun.id, runId)))
      .limit(1)
    if (!current) throw new RequestFailure(404, 'run_not_found', 'This run was not found')
    if (current.output?.channel !== input.channel) {
      throw new RequestFailure(403, 'invalid_run_channel', 'The runtime channel does not match')
    }
    if (current.state === 'failed' || current.state === 'succeeded') return runView(current)
    if (current.state !== 'running') {
      throw new RequestFailure(409, 'run_not_failable', 'This run is not awaiting a runtime')
    }
    const [failed] = await transaction
      .update(appletRun)
      .set({ state: 'failed', error: input.error, completedAt: new Date() })
      .where(
        and(
          eq(appletRun.workspaceId, workspaceId),
          eq(appletRun.id, runId),
          eq(appletRun.state, 'running'),
        ),
      )
      .returning()
    if (!failed) throw new Error('PostgreSQL did not return the failed run')
    // A dead run can never host a decision or an execution, so its open
    // action requests resolve now instead of waiting forever in the queue.
    await transaction
      .update(appletActionRequest)
      .set({
        state: 'failed',
        error: 'The run ended before this action completed',
        completedAt: new Date(),
      })
      .where(
        and(
          eq(appletActionRequest.workspaceId, workspaceId),
          eq(appletActionRequest.runId, runId),
          inArray(appletActionRequest.state, ['pending', 'approved', 'running']),
        ),
      )
    return runView(failed)
  })
}
