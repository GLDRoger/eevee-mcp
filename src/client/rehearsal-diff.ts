import type { JsonValue } from '@/domain/json'
import type { RehearsalWrite } from './rehearsal'

/**
 * One consequence of a rehearsed write, in words a person can approve.
 *
 * `path` stays machine-exact (`customers.0[c101].hold`). `group`, `subject`,
 * and `field` are the human reading: the collection the change lives in, the
 * entity it belongs to (by name, title, sku, number, or id), and the field
 * that changes. A whole entity arriving or leaving is one change, not one
 * line per field.
 */
export type RehearsalChange = {
  path: string
  before: JsonValue
  after: JsonValue
  kind: 'changed' | 'added' | 'removed'
  group: string
  subject: string | null
  field: string | null
}

type Scope = { group: string; subject: string | null }

const record = (value: JsonValue): value is Record<string, JsonValue> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const entityId = (value: JsonValue): string | null =>
  record(value) && typeof value.id === 'string' ? value.id : null

const SUBJECT_KEYS = ['name', 'title', 'sku', 'number', 'entry', 'label', 'id'] as const

/** The word a person would use for this entity. */
export const subjectOf = (value: JsonValue): string | null => {
  if (!record(value)) return null
  for (const key of SUBJECT_KEYS) {
    const candidate = value[key]
    if (typeof candidate === 'string' && candidate.trim()) return candidate.trim().slice(0, 80)
    if (typeof candidate === 'number') return String(candidate)
  }
  return null
}

/** `creditLimit`, `credit_limit`, `customers.0` all read as plain words. */
export const humanize = (segment: string): string =>
  segment
    .replace(/\.\d+$/, '')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replaceAll(/[_-]+/g, ' ')
    .toLowerCase()
    .trim()

const pushChanges = (
  path: string,
  before: JsonValue,
  after: JsonValue,
  scope: Scope,
  changes: RehearsalChange[],
  limit: number,
): void => {
  if (changes.length >= limit || JSON.stringify(before) === JSON.stringify(after)) return
  if (record(before) && record(after)) {
    const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort()
    for (const key of keys) {
      if (changes.length >= limit) return
      const beforeValue = before[key] ?? null
      const afterValue = after[key] ?? null
      const nested = Array.isArray(beforeValue) || Array.isArray(afterValue)
      pushChanges(
        path ? `${path}.${key}` : key,
        beforeValue,
        afterValue,
        nested ? { group: humanize(key), subject: null } : scope,
        changes,
        limit,
      )
    }
    return
  }
  if (before === null && record(after)) {
    changes.push({ path, before, after, kind: 'added', group: scope.group, subject: subjectOf(after), field: null })
    return
  }
  if (record(before) && after === null) {
    changes.push({ path, before, after, kind: 'removed', group: scope.group, subject: subjectOf(before), field: null })
    return
  }
  if (Array.isArray(before) && Array.isArray(after)) {
    const beforeIds = before.map(entityId)
    const afterIds = after.map(entityId)
    if ([...beforeIds, ...afterIds].every((id) => id !== null)) {
      const beforeById = new Map(before.map((value, index) => [beforeIds[index] as string, value]))
      const afterById = new Map(after.map((value, index) => [afterIds[index] as string, value]))
      const ids = [...new Set([...beforeById.keys(), ...afterById.keys()])]
      for (const id of ids) {
        if (changes.length >= limit) return
        const beforeValue = beforeById.get(id) ?? null
        const afterValue = afterById.get(id) ?? null
        pushChanges(
          `${path}[${id}]`,
          beforeValue,
          afterValue,
          { group: scope.group, subject: subjectOf(afterValue) ?? subjectOf(beforeValue) ?? id },
          changes,
          limit,
        )
      }
      return
    }
    const length = Math.max(before.length, after.length)
    for (let index = 0; index < length && changes.length < limit; index += 1) {
      const beforeValue = before[index] ?? null
      const afterValue = after[index] ?? null
      pushChanges(
        `${path}[${index}]`,
        beforeValue,
        afterValue,
        { group: scope.group, subject: subjectOf(afterValue) ?? subjectOf(beforeValue) ?? `#${index + 1}` },
        changes,
        limit,
      )
    }
    return
  }
  const field = humanize(path.split(/[.[]/).at(-1)?.replace(/\]$/, '') ?? '')
  changes.push({ path, before, after, kind: 'changed', group: scope.group, subject: scope.subject, field })
}

export const rehearsalChanges = (
  writes: readonly RehearsalWrite[],
  limit = 12,
): RehearsalChange[] => {
  const changes: RehearsalChange[] = []
  for (const write of writes) {
    pushChanges(write.key, write.before, write.after, { group: humanize(write.key), subject: null }, changes, limit)
    if (changes.length >= limit) break
  }
  return changes
}

/** One sentence for the card header: "2 customers change, 1 audit entry added". */
export const summarizeChanges = (changes: readonly RehearsalChange[]): string => {
  if (changes.length === 0) return 'no durable fields change'
  const counts = new Map<string, number>()
  for (const change of changes) {
    const key =
      change.kind === 'changed'
        ? `${change.group} field${changes.filter((c) => c.kind === 'changed' && c.group === change.group).length === 1 ? '' : 's'} change`
        : `${change.group} ${change.kind}`
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  return [...counts].map(([key, count]) => `${count} ${key}`).join(', ')
}
