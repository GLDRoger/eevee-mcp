import { z } from 'zod'
import { sensitiveFindingIdsSchema } from './document-review'
import { appletActionRequestSchema } from './applet-action'
import { officeFileSummarySchema } from './office-file'
import { autonomyLeaseSchema } from './autonomy-lease'

export const autonomyLeaseAuthorityScopeSchema = z.strictObject({
  kind: z.literal('autonomy-lease'),
  appletId: z.uuid(),
  runId: z.uuid(),
  writes: z.number().int().min(1).max(20),
  minutes: z.number().int().min(1).max(30),
})

export const humanAuthorityScopeSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('publish-version'),
    appletId: z.uuid(),
    versionId: z.uuid(),
  }),
  z.strictObject({
    kind: z.literal('action-decision'),
    requestId: z.uuid(),
    decision: z.enum(['approve', 'reject']),
    // A rejection can carry the person's reason so the agent learns why and
    // can adjust; it is part of the passkey-bound scope like everything else.
    reason: z.string().trim().min(1).max(300).optional(),
  }),
  z.strictObject({
    kind: z.literal('redact-document'),
    fileId: z.uuid(),
    baseVersionId: z.uuid(),
    findingIds: sensitiveFindingIdsSchema,
  }),
  autonomyLeaseAuthorityScopeSchema,
])

export const humanAuthorityChallengeKindSchema = z.enum(['registration', 'authorization'])

export const humanAuthorityStatusSchema = z.strictObject({
  enrolled: z.boolean(),
  createdAt: z.iso.datetime({ offset: true }).nullable(),
})

export const humanAuthorityOptionsEnvelopeSchema = z.strictObject({
  challengeId: z.uuid(),
  summary: z.string().trim().min(1).max(240),
  options: z.object({ challenge: z.string() }).loose(),
})

export const humanAuthorityRegistrationVerifySchema = z.strictObject({
  challengeId: z.uuid(),
  response: z.unknown(),
})

export const humanAuthorityAuthorizationOptionsSchema = z.strictObject({
  scope: humanAuthorityScopeSchema,
})

export const humanAuthorityAuthorizationVerifySchema = z.strictObject({
  challengeId: z.uuid(),
  response: z.unknown(),
})

export const humanAuthorityResultSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('publish-version'), published: z.literal(true) }),
  z.strictObject({
    kind: z.literal('action-decision'),
    request: appletActionRequestSchema,
  }),
  z.strictObject({ kind: z.literal('redact-document'), file: officeFileSummarySchema }),
  z.strictObject({
    kind: z.literal('autonomy-lease'),
    lease: autonomyLeaseSchema,
  }),
])

export type HumanAuthorityScope = z.infer<typeof humanAuthorityScopeSchema>
export type HumanAuthorityStatus = z.infer<typeof humanAuthorityStatusSchema>
export type HumanAuthorityResult = z.infer<typeof humanAuthorityResultSchema>
