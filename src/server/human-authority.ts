import 'server-only'
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type AuthenticatorTransportFuture,
  type RegistrationResponseJSON,
} from '@simplewebauthn/server'
import { and, eq, sql } from 'drizzle-orm'
import {
  humanAuthorityScopeSchema,
  type HumanAuthorityScope,
  type HumanAuthorityStatus,
} from '@/domain/human-authority'
import { autonomyLeaseSchema, type AutonomyLease } from '@/domain/autonomy-lease'
import { approveAppletActionRequest, rejectAppletActionRequest } from './applet-actions'
import { getRun } from './applet-runs'
import { publishVersion } from './applets'
import { getDatabase } from './db/client'
import {
  humanAuthorityChallenge,
  humanAuthorityCredential,
  humanAuthorityLease,
} from './db/schema'
import { applyDocumentRedactions } from './document-review'
import { RequestFailure } from './http'

const CHALLENGE_TTL_MS = 5 * 60_000

const expiresAt = (): Date => new Date(Date.now() + CHALLENGE_TTL_MS)

const passkeyResponse = <Value>(value: unknown, kind: 'registration' | 'authentication'): Value => {
  if (!value || typeof value !== 'object') {
    throw new RequestFailure(400, 'invalid_passkey_response', `The ${kind} response is not valid`)
  }
  return value as Value
}

const clearChallenges = async (workspaceId: string): Promise<void> => {
  await getDatabase()
    .delete(humanAuthorityChallenge)
    .where(eq(humanAuthorityChallenge.workspaceId, workspaceId))
}

const summaryForScope = (scope: HumanAuthorityScope): string => {
  switch (scope.kind) {
    case 'publish-version':
      return 'Publish this exact applet version'
    case 'action-decision':
      return `${scope.decision === 'approve' ? 'Approve' : 'Reject'} this exact applet action`
    case 'redact-document':
      return `Create a new document version with ${scope.findingIds.length} selected redaction${scope.findingIds.length === 1 ? '' : 's'}`
    case 'autonomy-lease':
      return `Grant this run ${scope.writes} governed writes for ${scope.minutes} minutes`
    default: {
      const unreachable: never = scope
      return unreachable
    }
  }
}

export const getHumanAuthorityStatus = async (
  workspaceId: string,
): Promise<HumanAuthorityStatus> => {
  const credential = await getDatabase().query.humanAuthorityCredential.findFirst({
    where: (table, { eq: equals }) => equals(table.workspaceId, workspaceId),
  })
  return {
    enrolled: credential !== undefined,
    createdAt: credential?.createdAt.toISOString() ?? null,
  }
}

export const beginHumanAuthorityRegistration = async (
  workspaceId: string,
  rpId: string,
  origin: string,
) => {
  const existing = await getHumanAuthorityStatus(workspaceId)
  if (existing.enrolled) {
    throw new RequestFailure(409, 'human_authority_already_enrolled', 'This workspace already has a human passkey')
  }
  await clearChallenges(workspaceId)
  const options = await generateRegistrationOptions({
    rpName: 'EEVEE',
    rpID: rpId,
    userID: new TextEncoder().encode(workspaceId),
    userName: `workspace-${workspaceId.slice(0, 8)}`,
    userDisplayName: 'EEVEE decision owner',
    attestationType: 'none',
    // The browser gives up after this instead of leaving "Creating passkey…"
    // on screen forever when no authenticator answers.
    timeout: 60_000,
    authenticatorSelection: {
      residentKey: 'preferred',
      userVerification: 'required',
    },
  })
  const [challenge] = await getDatabase()
    .insert(humanAuthorityChallenge)
    .values({
      workspaceId,
      kind: 'registration',
      challenge: options.challenge,
      scope: null,
      rpId,
      origin,
      expiresAt: expiresAt(),
    })
    .returning({ id: humanAuthorityChallenge.id })
  if (!challenge) throw new Error('PostgreSQL did not return the passkey registration challenge')
  return { challengeId: challenge.id, summary: 'Create the human passkey for this workspace', options }
}

export const completeHumanAuthorityRegistration = async (
  workspaceId: string,
  challengeId: string,
  responseInput: unknown,
): Promise<HumanAuthorityStatus> =>
  getDatabase().transaction(async (transaction) => {
    await transaction.execute(sql`select pg_advisory_xact_lock(hashtext(${`human-challenge:${challengeId}`}))`)
    const [challenge] = await transaction
      .select()
      .from(humanAuthorityChallenge)
      .where(
        and(
          eq(humanAuthorityChallenge.id, challengeId),
          eq(humanAuthorityChallenge.workspaceId, workspaceId),
          eq(humanAuthorityChallenge.kind, 'registration'),
        ),
      )
      .limit(1)
    if (!challenge || challenge.expiresAt.getTime() <= Date.now()) {
      throw new RequestFailure(409, 'human_authority_challenge_expired', 'Start passkey setup again')
    }
    const verification = await verifyRegistrationResponse({
      response: passkeyResponse<RegistrationResponseJSON>(responseInput, 'registration'),
      expectedChallenge: challenge.challenge,
      expectedOrigin: challenge.origin,
      expectedRPID: challenge.rpId,
      requireUserVerification: true,
    }).catch(() => {
      throw new RequestFailure(400, 'human_authority_verification_failed', 'The passkey response could not be verified')
    })
    if (!verification.verified || !verification.registrationInfo.userVerified) {
      throw new RequestFailure(403, 'human_authority_user_not_verified', 'The passkey did not verify a person')
    }
    const { credential, credentialDeviceType, credentialBackedUp } = verification.registrationInfo
    await transaction
      .insert(humanAuthorityCredential)
      .values({
        workspaceId,
        credentialId: credential.id,
        publicKey: Uint8Array.from(credential.publicKey),
        counter: credential.counter,
        transports: credential.transports ?? [],
        deviceType: credentialDeviceType,
        backedUp: credentialBackedUp,
      })
      .onConflictDoNothing({ target: humanAuthorityCredential.workspaceId })
    await transaction
      .delete(humanAuthorityChallenge)
      .where(eq(humanAuthorityChallenge.id, challenge.id))
    const [stored] = await transaction
      .select({ createdAt: humanAuthorityCredential.createdAt })
      .from(humanAuthorityCredential)
      .where(eq(humanAuthorityCredential.workspaceId, workspaceId))
      .limit(1)
    if (!stored) throw new Error('The human passkey was not stored')
    return { enrolled: true, createdAt: stored.createdAt.toISOString() }
  })

export const beginHumanAuthorization = async (
  workspaceId: string,
  rpId: string,
  origin: string,
  scopeInput: HumanAuthorityScope,
) => {
  const scope = humanAuthorityScopeSchema.parse(scopeInput)
  const credential = await getDatabase().query.humanAuthorityCredential.findFirst({
    where: (table, { eq: equals }) => equals(table.workspaceId, workspaceId),
  })
  if (!credential) {
    throw new RequestFailure(428, 'human_authority_not_enrolled', 'Set up the workspace passkey before making human decisions')
  }
  if (scope.kind === 'autonomy-lease') {
    const run = await getRun(workspaceId, scope.runId)
    if (run.appletId !== scope.appletId || (run.state !== 'running' && run.state !== 'succeeded')) {
      throw new RequestFailure(409, 'run_not_actionable', 'This run cannot receive an autonomy lease')
    }
  }
  await clearChallenges(workspaceId)
  const options = await generateAuthenticationOptions({
    rpID: rpId,
    allowCredentials: [
      {
        id: credential.credentialId,
        transports: credential.transports as AuthenticatorTransportFuture[],
      },
    ],
    userVerification: 'required',
    timeout: 60_000,
  })
  const [challenge] = await getDatabase()
    .insert(humanAuthorityChallenge)
    .values({
      workspaceId,
      kind: 'authorization',
      challenge: options.challenge,
      scope,
      rpId,
      origin,
      expiresAt: expiresAt(),
    })
    .returning({ id: humanAuthorityChallenge.id })
  if (!challenge) throw new Error('PostgreSQL did not return the passkey authorization challenge')
  return { challengeId: challenge.id, summary: summaryForScope(scope), options }
}

const executeAuthorizedScope = async (workspaceId: string, scope: HumanAuthorityScope) => {
  switch (scope.kind) {
    case 'publish-version':
      await publishVersion(workspaceId, scope.appletId, scope.versionId)
      return { kind: scope.kind, published: true as const }
    case 'action-decision': {
      const request = scope.decision === 'approve'
        ? await approveAppletActionRequest(workspaceId, scope.requestId)
        : await rejectAppletActionRequest(workspaceId, scope.requestId, scope.reason)
      return { kind: scope.kind, request }
    }
    case 'redact-document': {
      const file = await applyDocumentRedactions(workspaceId, scope.fileId, {
        baseVersionId: scope.baseVersionId,
        findingIds: scope.findingIds,
      })
      return { kind: scope.kind, file }
    }
    case 'autonomy-lease':
      {
        const grantedAt = new Date()
        const [row] = await getDatabase()
          .insert(humanAuthorityLease)
          .values({
            workspaceId,
            appletId: scope.appletId,
            runId: scope.runId,
            grantedWrites: scope.writes,
            remainingWrites: scope.writes,
            expiresAt: new Date(grantedAt.getTime() + scope.minutes * 60_000),
            grantedAt,
          })
          .returning()
        if (!row) throw new Error('PostgreSQL did not return the human-authorized lease')
        return { kind: scope.kind, lease: leaseView(row) }
      }
    default: {
      const unreachable: never = scope
      return unreachable
    }
  }
}

const leaseView = (row: typeof humanAuthorityLease.$inferSelect): AutonomyLease =>
  autonomyLeaseSchema.parse({
    leaseId: row.id,
    appletId: row.appletId,
    runId: row.runId,
    grantedWrites: row.grantedWrites,
    remainingWrites: row.remainingWrites,
    expiresAt: row.expiresAt.toISOString(),
    grantedAt: row.grantedAt.toISOString(),
  })

export const revokeHumanAuthorityLease = async (
  workspaceId: string,
  leaseId: string,
): Promise<void> => {
  // The spend path decrements under the lease's advisory lock; taking the
  // same lock here means a revoke and a spend serialize instead of racing.
  await getDatabase().transaction(async (transaction) => {
    await transaction.execute(sql`select pg_advisory_xact_lock(hashtext(${`human-lease:${leaseId}`}))`)
    await transaction
      .update(humanAuthorityLease)
      .set({ revokedAt: new Date(), remainingWrites: 0 })
      .where(
        and(
          eq(humanAuthorityLease.workspaceId, workspaceId),
          eq(humanAuthorityLease.id, leaseId),
        ),
      )
  })
}

export const completeHumanAuthorization = async (
  workspaceId: string,
  challengeId: string,
  responseInput: unknown,
) => {
  const scope = await getDatabase().transaction(async (transaction) => {
    await transaction.execute(sql`select pg_advisory_xact_lock(hashtext(${`human-challenge:${challengeId}`}))`)
    const [challenge] = await transaction
      .select()
      .from(humanAuthorityChallenge)
      .where(
        and(
          eq(humanAuthorityChallenge.id, challengeId),
          eq(humanAuthorityChallenge.workspaceId, workspaceId),
          eq(humanAuthorityChallenge.kind, 'authorization'),
        ),
      )
      .limit(1)
    if (!challenge || challenge.expiresAt.getTime() <= Date.now() || !challenge.scope) {
      throw new RequestFailure(409, 'human_authority_challenge_expired', 'Start this decision again')
    }
    const scope = humanAuthorityScopeSchema.parse(challenge.scope)
    const [credential] = await transaction
      .select()
      .from(humanAuthorityCredential)
      .where(eq(humanAuthorityCredential.workspaceId, workspaceId))
      .limit(1)
    const response = passkeyResponse<AuthenticationResponseJSON>(responseInput, 'authentication')
    if (!credential || response.id !== credential.credentialId) {
      throw new RequestFailure(403, 'human_authority_credential_mismatch', 'This passkey does not control the workspace')
    }
    const verification = await verifyAuthenticationResponse({
      response,
      expectedChallenge: challenge.challenge,
      expectedOrigin: challenge.origin,
      expectedRPID: challenge.rpId,
      credential: {
        id: credential.credentialId,
        publicKey: Uint8Array.from(credential.publicKey),
        counter: credential.counter,
        transports: credential.transports as AuthenticatorTransportFuture[],
      },
      requireUserVerification: true,
    }).catch(() => {
      throw new RequestFailure(400, 'human_authority_verification_failed', 'The passkey response could not be verified')
    })
    if (!verification.verified || !verification.authenticationInfo.userVerified) {
      throw new RequestFailure(403, 'human_authority_user_not_verified', 'The passkey did not verify a person')
    }
    await transaction
      .update(humanAuthorityCredential)
      .set({
        counter: verification.authenticationInfo.newCounter,
        deviceType: verification.authenticationInfo.credentialDeviceType,
        backedUp: verification.authenticationInfo.credentialBackedUp,
        updatedAt: new Date(),
      })
      .where(eq(humanAuthorityCredential.workspaceId, workspaceId))
    await transaction
      .delete(humanAuthorityChallenge)
      .where(eq(humanAuthorityChallenge.id, challenge.id))
    return scope
  })
  return executeAuthorizedScope(workspaceId, scope)
}

export const requireHumanAuthority = (): never => {
  throw new RequestFailure(
    403,
    'human_authority_required',
    'This decision requires the workspace passkey through the visible human control',
  )
}
