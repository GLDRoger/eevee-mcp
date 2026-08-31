import type { JsonValue } from './json'

export const MAX_STATE_KEYS = 128
export const MAX_STATE_VALUE_BYTES = 64_000
export const STATE_KEY_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/

export class StateLimitError extends Error {
  constructor(
    readonly code: 'invalid_state_key' | 'state_value_too_large' | 'state_key_limit_reached',
    message: string,
  ) {
    super(message)
    this.name = 'StateLimitError'
  }
}

export const assertStateKey = (key: string): string => {
  if (!STATE_KEY_PATTERN.test(key)) {
    throw new StateLimitError(
      'invalid_state_key',
      'State keys must be 1 to 128 safe characters',
    )
  }
  return key
}

export const assertStateValueSize = (value: JsonValue): JsonValue => {
  if (new TextEncoder().encode(JSON.stringify(value)).byteLength > MAX_STATE_VALUE_BYTES) {
    throw new StateLimitError(
      'state_value_too_large',
      'One stored value cannot exceed 64 KB',
    )
  }
  return value
}

export type BoundedMemoryStore = {
  get(key: string): JsonValue | null
  has(key: string): boolean
  set(key: string, value: JsonValue): JsonValue
  all(): Record<string, JsonValue>
}

/**
 * The in-memory store used by draft preview and behavioral evaluation. It
 * enforces the same key syntax, per-value size, and key-count budgets as the
 * durable server store, so an applet cannot pass review or its suite while
 * exceeding limits that the published runtime will reject.
 */
export const createBoundedMemoryStore = (): BoundedMemoryStore => {
  const memory = new Map<string, JsonValue>()
  return {
    get: (key) => memory.get(assertStateKey(key)) ?? null,
    has: (key) => memory.has(key),
    set: (key, value) => {
      assertStateKey(key)
      assertStateValueSize(value)
      if (!memory.has(key) && memory.size >= MAX_STATE_KEYS) {
        throw new StateLimitError(
          'state_key_limit_reached',
          `One applet can store at most ${MAX_STATE_KEYS} state keys`,
        )
      }
      memory.set(key, value)
      return value
    },
    all: () => Object.fromEntries(memory),
  }
}
