import { z } from 'zod'
import { appletActionRequestSchema } from './applet-action'

export const autonomyLeaseSchema = z.strictObject({
  leaseId: z.uuid(),
  appletId: z.uuid(),
  runId: z.uuid(),
  grantedWrites: z.number().int().min(1).max(20),
  remainingWrites: z.number().int().min(0).max(20),
  expiresAt: z.iso.datetime({ offset: true }),
  grantedAt: z.iso.datetime({ offset: true }),
})

export type AutonomyLease = z.infer<typeof autonomyLeaseSchema>

export const autonomyLeaseSpendResponseSchema = z.strictObject({
  request: appletActionRequestSchema,
  lease: autonomyLeaseSchema,
})

export const LEASE_CHOICES = [
  { writes: 3, minutes: 5, label: '3 writes · 5 min' },
  { writes: 10, minutes: 15, label: '10 writes · 15 min' },
] as const

export const leaseActive = (lease: AutonomyLease | null): lease is AutonomyLease =>
  lease !== null && lease.remainingWrites > 0 && Date.parse(lease.expiresAt) > Date.now()
