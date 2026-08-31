import 'server-only'
import { and, desc, eq, sql } from 'drizzle-orm'
import {
  appletActionRequestSchema,
  validateAppletActionInput,
  type AppletActionDefinition,
  type AppletActionRequest,
  type CreateAppletActionRequestInput,
} from '@/domain/applet-action'
import { appletVersionDefinitionSchema } from '@/domain/applet'
import { assertStateValueSize, StateLimitError } from '@/domain/applet-store'
import { jsonValueSchema, type JsonValue } from '@/domain/json'
import { getDatabase } from './db/client'
import { appletActionRequest, appletRun, appletVersion } from './db/schema'
import { RequestFailure } from './http'

const iso = (value: Date): string => value.toISOString()

const requestView = (row: typeof appletActionRequest.$inferSelect): AppletActionRequest =>
  appletActionRequestSchema.parse({
    id: row.id,
    appletId: row.appletId,
    runId: row.runId,
    appletVersionId: row.appletVersionId,
    action: row.action,
    state: row.state,
    input: row.input,
    result: row.result ?? null,
    error: row.error ?? null,
    createdAt: iso(row.createdAt),
    decidedAt: row.decidedAt ? iso(row.decidedAt) : null,
    completedAt: row.completedAt ? iso(row.completedAt) : null,
  })

const actionFromVersion = (
  definitionInput: typeof appletVersion.$inferSelect.definition,
  actionName: string,
): AppletActionDefinition => {
  const definition = appletVersionDefinitionSchema.parse(definitionInput)
  const action = definition.actions.find(({ name }) => name === actionName)
  if (!action) {
    throw new RequestFailure(
      404,
      'applet_action_not_found',
      'The published applet version does not declare this action',
    )
  }
  return action
}

export const listAppletActionRequests = async (
  workspaceId: string,
  runId: string,
): Promise<AppletActionRequest[]> => {
  const rows = await getDatabase()
    .select()
    .from(appletActionRequest)
    .where(
      and(
        eq(appletActionRequest.workspaceId, workspaceId),
        eq(appletActionRequest.runId, runId),
      ),
    )
    .orderBy(desc(appletActionRequest.createdAt))
    .limit(50)
  return rows.map(requestView)
}

export const getAppletActionRequest = async (
  workspaceId: string,
  requestId: string,
): Promise<AppletActionRequest> => {
  const [row] = await getDatabase()
    .select()
    .from(appletActionRequest)
    .where(
      and(
        eq(appletActionRequest.workspaceId, workspaceId),
        eq(appletActionRequest.id, requestId),
      ),
    )
    .limit(1)
  if (!row) {
    throw new RequestFailure(404, 'applet_action_request_not_found', 'This action request was not found')
  }
  return requestView(row)
}

export const createAppletActionRequest = async (
  workspaceId: string,
  runId: string,
  input: CreateAppletActionRequestInput,
): Promise<AppletActionRequest> => {
  const [run] = await getDatabase()
    .select({
      run: appletRun,
      definition: appletVersion.definition,
    })
    .from(appletRun)
    .innerJoin(
      appletVersion,
      and(
        eq(appletVersion.workspaceId, appletRun.workspaceId),
        eq(appletVersion.appletId, appletRun.appletId),
        eq(appletVersion.id, appletRun.appletVersionId),
      ),
    )
    .where(and(eq(appletRun.workspaceId, workspaceId), eq(appletRun.id, runId)))
    .limit(1)
  if (!run) throw new RequestFailure(404, 'run_not_found', 'This applet run was not found')
  if (run.run.state !== 'running' && run.run.state !== 'succeeded') {
    throw new RequestFailure(409, 'run_not_actionable', 'This applet run is not active')
  }
  const action = actionFromVersion(run.definition, input.actionName)
  const validated = validateAppletActionInput(action, input.input)
  if (!validated.ok) {
    throw new RequestFailure(
      400,
      'invalid_applet_action_input',
      validated.issues.map(({ key, message }) => `${key}: ${message}`).join('\n'),
    )
  }
  const automatic = action.authority === 'automatic'
  const now = new Date()
  const [created] = await getDatabase()
    .insert(appletActionRequest)
    .values({
      workspaceId,
      appletId: run.run.appletId,
      runId: run.run.id,
      appletVersionId: run.run.appletVersionId,
      action,
      state: automatic ? 'approved' : 'pending',
      input: validated.values,
      decidedAt: automatic ? now : null,
    })
    .returning()
  if (!created) throw new Error('PostgreSQL did not return the action request')
  return requestView(created)
}

const decideAppletActionRequest = async (
  workspaceId: string,
  requestId: string,
  decision: 'approved' | 'rejected',
): Promise<AppletActionRequest> =>
  getDatabase().transaction(async (transaction) => {
    await transaction.execute(sql`select pg_advisory_xact_lock(hashtext(${`action:${requestId}`}))`)
    const [current] = await transaction
      .select()
      .from(appletActionRequest)
      .where(
        and(
          eq(appletActionRequest.workspaceId, workspaceId),
          eq(appletActionRequest.id, requestId),
        ),
      )
      .limit(1)
    if (!current) {
      throw new RequestFailure(404, 'applet_action_request_not_found', 'This action request was not found')
    }
    if (current.state === decision) return requestView(current)
    if (current.state !== 'pending') {
      throw new RequestFailure(
        409,
        'applet_action_already_decided',
        'This action request is no longer awaiting a decision',
      )
    }
    const [updated] = await transaction
      .update(appletActionRequest)
      .set({ state: decision, decidedAt: new Date(), ...(decision === 'rejected' ? { completedAt: new Date() } : {}) })
      .where(eq(appletActionRequest.id, requestId))
      .returning()
    if (!updated) throw new Error('PostgreSQL did not return the decided action request')
    return requestView(updated)
  })

export const approveAppletActionRequest = (workspaceId: string, requestId: string) =>
  decideAppletActionRequest(workspaceId, requestId, 'approved')

export const rejectAppletActionRequest = (workspaceId: string, requestId: string) =>
  decideAppletActionRequest(workspaceId, requestId, 'rejected')

export const startAppletActionRequest = async (
  workspaceId: string,
  requestId: string,
): Promise<AppletActionRequest> =>
  getDatabase().transaction(async (transaction) => {
    await transaction.execute(sql`select pg_advisory_xact_lock(hashtext(${`action:${requestId}`}))`)
    const [current] = await transaction
      .select()
      .from(appletActionRequest)
      .where(
        and(
          eq(appletActionRequest.workspaceId, workspaceId),
          eq(appletActionRequest.id, requestId),
        ),
      )
      .limit(1)
    if (!current) {
      throw new RequestFailure(404, 'applet_action_request_not_found', 'This action request was not found')
    }
    if (current.state !== 'approved') {
      throw new RequestFailure(
        409,
        'applet_action_not_approved',
        'This action request is not approved for execution',
      )
    }
    const [started] = await transaction
      .update(appletActionRequest)
      .set({ state: 'running' })
      .where(
        and(
          eq(appletActionRequest.id, requestId),
          eq(appletActionRequest.state, 'approved'),
        ),
      )
      .returning()
    if (!started) {
      throw new RequestFailure(409, 'applet_action_already_started', 'This action already started')
    }
    return requestView(started)
  })

export const completeAppletActionRequest = async (
  workspaceId: string,
  requestId: string,
  resultInput: unknown,
): Promise<AppletActionRequest> => {
  const result = jsonValueSchema.parse(resultInput)
  try {
    assertStateValueSize(result)
  } catch (error) {
    if (error instanceof StateLimitError) {
      throw new RequestFailure(413, 'applet_action_result_too_large', 'Action results cannot exceed 64 KB')
    }
    throw error
  }
  const storedResult = result === null ? sql<JsonValue>`'null'::jsonb` : result
  const [completed] = await getDatabase()
    .update(appletActionRequest)
    .set({ state: 'succeeded', result: storedResult, completedAt: new Date() })
    .where(
      and(
        eq(appletActionRequest.workspaceId, workspaceId),
        eq(appletActionRequest.id, requestId),
        eq(appletActionRequest.state, 'running'),
      ),
    )
    .returning()
  if (!completed) {
    throw new RequestFailure(409, 'applet_action_not_running', 'This action request is not running')
  }
  return requestView(completed)
}

export const failAppletActionRequest = async (
  workspaceId: string,
  requestId: string,
  error: string,
): Promise<AppletActionRequest> => {
  const [failed] = await getDatabase()
    .update(appletActionRequest)
    .set({ state: 'failed', error, completedAt: new Date() })
    .where(
      and(
        eq(appletActionRequest.workspaceId, workspaceId),
        eq(appletActionRequest.id, requestId),
        eq(appletActionRequest.state, 'running'),
      ),
    )
    .returning()
  if (!failed) {
    throw new RequestFailure(409, 'applet_action_not_running', 'This action request is not running')
  }
  return requestView(failed)
}
