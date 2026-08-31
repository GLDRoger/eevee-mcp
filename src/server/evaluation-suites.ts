import 'server-only'
import { and, desc, eq, max, sql } from 'drizzle-orm'
import type {
  CreateEvaluationSuiteInput,
  EvaluationSuite,
} from '@/domain/evaluation'
import { getDatabase } from './db/client'
import { applet, evaluationSuite } from './db/schema'
import { RequestFailure } from './http'

const iso = (value: Date): string => value.toISOString()

export const evaluationSuiteView = (
  row: typeof evaluationSuite.$inferSelect,
): EvaluationSuite => ({
  id: row.id,
  appletId: row.appletId,
  revision: row.revision,
  name: row.name,
  cases: row.cases,
  createdAt: iso(row.createdAt),
})

export const listEvaluationSuites = async (
  workspaceId: string,
  appletId: string,
): Promise<EvaluationSuite[]> =>
  (
    await getDatabase()
      .select()
      .from(evaluationSuite)
      .where(
        and(
          eq(evaluationSuite.workspaceId, workspaceId),
          eq(evaluationSuite.appletId, appletId),
        ),
      )
      .orderBy(desc(evaluationSuite.revision))
      .limit(20)
  ).map(evaluationSuiteView)

export const createEvaluationSuite = async (
  workspaceId: string,
  appletId: string,
  input: CreateEvaluationSuiteInput,
): Promise<EvaluationSuite> => {
  const database = getDatabase()
  const row = await database.transaction(async (transaction) => {
    await transaction.execute(sql`select pg_advisory_xact_lock(hashtext(${`suite:${appletId}`}))`)
    const [target] = await transaction
      .select({ medium: applet.medium })
      .from(applet)
      .where(and(eq(applet.workspaceId, workspaceId), eq(applet.id, appletId)))
      .limit(1)
    if (!target) throw new RequestFailure(404, 'applet_not_found', 'This applet was not found')
    if (target.medium !== 'web-app') {
      throw new RequestFailure(
        409,
        'evaluation_medium_unsupported',
        'Behavioral scenarios currently support web applets',
      )
    }
    const [latest] = await transaction
      .select({ revision: max(evaluationSuite.revision) })
      .from(evaluationSuite)
      .where(
        and(
          eq(evaluationSuite.workspaceId, workspaceId),
          eq(evaluationSuite.appletId, appletId),
        ),
      )
    const [created] = await transaction
      .insert(evaluationSuite)
      .values({
        workspaceId,
        appletId,
        revision: (latest?.revision ?? 0) + 1,
        name: input.name,
        cases: input.cases,
      })
      .returning()
    if (!created) throw new Error('PostgreSQL did not return the evaluation suite')
    await transaction
      .update(applet)
      .set({ updatedAt: new Date() })
      .where(and(eq(applet.workspaceId, workspaceId), eq(applet.id, appletId)))
    return created
  })
  return evaluationSuiteView(row)
}
