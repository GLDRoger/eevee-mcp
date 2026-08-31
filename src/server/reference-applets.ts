import 'server-only'
import { and, eq, sql } from 'drizzle-orm'
import type { AppletSummary } from '@/domain/api'
import type { ReferenceAppletSlug } from '@/domain/reference-applet'
import { isPublishableQuality } from '@/domain/quality'
import {
  SPARKBENCH_REFERENCE,
  sparkbenchEvaluation,
  sparkbenchVersion,
} from '@/reference-applets/sparkbench'
import {
  FABLECUT_REFERENCE,
  fablecutEvaluation,
  fablecutVersion,
} from '@/reference-applets/fablecut'
import { getDatabase } from './db/client'
import { applet, appletVersion, evaluationSuite } from './db/schema'
import { compileReactApp } from './react-compiler'
import { evaluateReactApp } from './react-app-quality'
import { listApplets } from './applets'

const referencePackage = (slug: ReferenceAppletSlug) => {
  switch (slug) {
    case 'sparkbench':
      return {
        identity: SPARKBENCH_REFERENCE,
        medium: 'web-app' as const,
        version: sparkbenchVersion,
        evaluation: sparkbenchEvaluation,
      }
    case 'fablecut':
      return {
        identity: FABLECUT_REFERENCE,
        medium: 'video' as const,
        version: fablecutVersion,
        evaluation: fablecutEvaluation,
      }
    default: {
      const unreachable: never = slug
      return unreachable
    }
  }
}

export const installReferenceApplet = async (
  workspaceId: string,
  slug: ReferenceAppletSlug,
): Promise<AppletSummary> => {
  const reference = referencePackage(slug)
  const existing = (await listApplets(workspaceId)).find(
    ({ name, description }) =>
      name === reference.identity.name && description === reference.identity.description,
  )
  if (existing) return existing

  const compilation = await compileReactApp(reference.version.definition)
  const quality = await evaluateReactApp(reference.version.definition, compilation)
  if (!compilation.artifact || !isPublishableQuality(quality)) {
    throw new Error(`The ${reference.identity.name} reference package did not pass its static gate`)
  }

  const appletId = await getDatabase().transaction(async (transaction) => {
    await transaction.execute(
      sql`select pg_advisory_xact_lock(hashtext(${`reference:${workspaceId}:${slug}`}))`,
    )
    const [installed] = await transaction
      .select({ id: applet.id })
      .from(applet)
      .where(
        and(
          eq(applet.workspaceId, workspaceId),
          eq(applet.name, reference.identity.name),
          eq(applet.description, reference.identity.description),
        ),
      )
      .limit(1)
    if (installed) return installed.id

    const [created] = await transaction
      .insert(applet)
      .values({
        workspaceId,
        name: reference.identity.name,
        description: reference.identity.description,
        medium: reference.medium,
      })
      .returning({ id: applet.id })
    if (!created) throw new Error('PostgreSQL did not return the reference applet')
    await Promise.all([
      transaction.insert(appletVersion).values({
        workspaceId,
        appletId: created.id,
        version: 1,
        note: reference.version.note,
        inputs: reference.version.inputs,
        definition: reference.version.definition,
        artifact: compilation.artifact,
        qualityReport: quality,
      }),
      transaction.insert(evaluationSuite).values({
        workspaceId,
        appletId: created.id,
        revision: 1,
        name: reference.evaluation.name,
        cases: reference.evaluation.cases,
      }),
    ])
    return created.id
  })

  const installed = (await listApplets(workspaceId)).find(({ id }) => id === appletId)
  if (!installed) throw new Error('The installed reference applet could not be read')
  return installed
}
