import { z } from 'zod'
import { jsonValueSchema } from '@/domain/json'

const appletMessageBase = {
  source: z.literal('eevee-applet'),
  channel: z.uuid(),
  invocation: z
    .strictObject({ requestId: z.uuid(), name: z.string().min(1).max(23) })
    .nullable()
    .optional(),
}

export const appletMessageSchema = z.discriminatedUnion('action', [
  z.strictObject({
    ...appletMessageBase,
    action: z.literal('ready'),
    evaluationToken: z.uuid(),
  }),
  z.strictObject({
    ...appletMessageBase,
    action: z.literal('revoke'),
    reason: z.string().min(1).max(500),
  }),
  z.strictObject({
    ...appletMessageBase,
    id: z.string().min(1).max(100),
    action: z.literal('get'),
    payload: z.strictObject({ key: z.string().min(1).max(128) }),
  }),
  z.strictObject({
    ...appletMessageBase,
    id: z.string().min(1).max(100),
    action: z.literal('set'),
    payload: z.strictObject({ key: z.string().min(1).max(128), value: jsonValueSchema }),
  }),
  z.strictObject({
    ...appletMessageBase,
    id: z.string().min(1).max(100),
    action: z.literal('all'),
    payload: z.strictObject({}),
  }),
  z.strictObject({
    ...appletMessageBase,
    id: z.string().min(1).max(100),
    action: z.literal('files-list'),
    payload: z.strictObject({}),
  }),
  z.strictObject({
    ...appletMessageBase,
    id: z.string().min(1).max(100),
    action: z.literal('files-read'),
    payload: z.strictObject({ fileId: z.uuid() }),
  }),
  z.strictObject({
    ...appletMessageBase,
    id: z.string().min(1).max(100),
    action: z.literal('files-table'),
    payload: z.strictObject({ fileId: z.uuid() }),
  }),
  z.strictObject({
    ...appletMessageBase,
    id: z.string().min(1).max(100),
    action: z.literal('files-text'),
    payload: z.strictObject({ fileId: z.uuid() }),
  }),
])

const evaluationMessageBase = {
  source: z.literal('eevee-applet-evaluation'),
  channel: z.uuid(),
  evaluationToken: z.uuid(),
  id: z.string().min(1).max(100),
}

export const evaluationMessageSchema = z.discriminatedUnion('ok', [
  z.strictObject({ ...evaluationMessageBase, ok: z.literal(true), value: z.unknown() }),
  z.strictObject({
    ...evaluationMessageBase,
    ok: z.literal(false),
    error: z.string().min(1).max(2_000),
  }),
])

const appletActionMessageBase = {
  source: z.literal('eevee-applet-action'),
  channel: z.uuid(),
  requestId: z.uuid(),
}

export const appletActionMessageSchema = z.discriminatedUnion('ok', [
  z.strictObject({ ...appletActionMessageBase, ok: z.literal(true), value: jsonValueSchema }),
  z.strictObject({
    ...appletActionMessageBase,
    ok: z.literal(false),
    error: z.string().min(1).max(500),
  }),
])
