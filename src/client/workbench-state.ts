import { z } from 'zod'
import { autonomyLeaseSchema } from '@/domain/autonomy-lease'

/**
 * What the person currently sees. The workbench publishes it on every change
 * and the get_workbench_state tool reads it, so an agent can orient itself
 * ("which applet is open, is a run live, what is waiting on the person")
 * without guessing from side effects.
 */
export const workbenchStateSchema = z.strictObject({
  surface: z.enum(['applets', 'library', 'studio', 'guide']),
  applet: z
    .strictObject({
      id: z.uuid(),
      name: z.string(),
      activeVersionId: z.uuid().nullable(),
      latestVersionId: z.uuid().nullable(),
      view: z.enum(['app', 'code']),
    })
    .nullable(),
  run: z
    .strictObject({
      id: z.uuid(),
      state: z.enum(['queued', 'running', 'succeeded', 'failed']),
      appletVersionId: z.uuid(),
    })
    .nullable(),
  reviewVersionId: z.uuid().nullable(),
  file: z.strictObject({ id: z.uuid(), name: z.string(), medium: z.string() }).nullable(),
  pendingDecisions: z.number().int().nonnegative(),
  lease: autonomyLeaseSchema.nullable(),
  passkeyEnrolled: z.boolean().nullable(),
  toolsLive: z.number().int().nonnegative().nullable(),
})

export type WorkbenchState = z.infer<typeof workbenchStateSchema>

const initial: WorkbenchState = {
  surface: 'applets',
  applet: null,
  run: null,
  reviewVersionId: null,
  file: null,
  pendingDecisions: 0,
  lease: null,
  passkeyEnrolled: null,
  toolsLive: null,
}

let current: WorkbenchState = initial

export const readWorkbenchState = (): WorkbenchState => current

export const publishWorkbenchState = (patch: Partial<WorkbenchState>): void => {
  current = workbenchStateSchema.parse({ ...current, ...patch })
}

export const resetWorkbenchState = (): void => {
  current = initial
}
