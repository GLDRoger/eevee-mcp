'use client'

import { z } from 'zod'
import type { AppletRunOutput } from '@/domain/applet'
import type {
  EvaluationCaseDefinition,
  EvaluationCaseEvidenceInput,
  EvaluationPlan,
  EvaluationStep,
  EvaluationStepEvidence,
  EvaluationTarget,
  EvaluationVersionEvidenceInput,
} from '@/domain/evaluation'
import type { JsonValue } from '@/domain/json'
import { createBoundedMemoryStore, type BoundedMemoryStore } from '@/domain/applet-store'
import { api } from './api'
import { appletMessageSchema, evaluationMessageSchema } from './applet-messages'

const READY_TIMEOUT_MS = 8_000
const COMMAND_TIMEOUT_MS = 3_000

const inspectResultSchema = z.strictObject({
  count: z.number().int().nonnegative(),
  text: z.string(),
  value: z.string().nullable(),
})

const settleResultSchema = z.strictObject({
  settled: z.boolean(),
  cycles: z.number().int().nonnegative(),
})

type EvaluationCommand =
  | Extract<EvaluationStep, { action: 'click' | 'fill' | 'press' }>
  | { action: 'inspect'; selector: string }
  | { action: 'settle' }

/**
 * The transport a case runs over. The browser worker implements it with a
 * sandboxed iframe; tests can supply another transport (for example a jsdom
 * document) and still run the same step semantics.
 */
export type EvaluationCaseTransport = {
  command: (value: EvaluationCommand) => Promise<unknown>
  restart: () => Promise<void>
}

type PendingCommand = {
  resolve: (value: unknown) => void
  reject: (error: Error) => void
  timer: number
}

const boundedMessage = (error: unknown): string => {
  const message = error instanceof Error ? error.message : 'The browser worker failed'
  return message.length > 500 ? `${message.slice(0, 497)}...` : message
}

const delay = (milliseconds: number, signal: AbortSignal): Promise<void> =>
  new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new Error('The evaluation was cancelled'))
      return
    }
    const aborted = () => {
      window.clearTimeout(timer)
      reject(new Error('The evaluation was cancelled'))
    }
    const timer = window.setTimeout(() => {
      signal.removeEventListener('abort', aborted)
      resolve()
    }, milliseconds)
    signal.addEventListener('abort', aborted, { once: true })
  })

const equalJson = (left: JsonValue | undefined, right: JsonValue): boolean => {
  if (left === right) return true
  if (left === undefined || left === null || right === null) return false
  if (Array.isArray(left) || Array.isArray(right)) {
    return (
      Array.isArray(left) &&
      Array.isArray(right) &&
      left.length === right.length &&
      left.every((value, index) => equalJson(value, right[index]))
    )
  }
  if (typeof left !== 'object' || typeof right !== 'object') return false
  const leftKeys = Object.keys(left).sort()
  const rightKeys = Object.keys(right).sort()
  return (
    leftKeys.length === rightKeys.length &&
    leftKeys.every((key, index) => key === rightKeys[index] && equalJson(left[key], right[key]))
  )
}

const createCaseHarness = (
  output: AppletRunOutput,
  memory: BoundedMemoryStore,
  signal: AbortSignal,
) => {
  let frame: HTMLIFrameElement | null = null
  let readyResolve: (() => void) | null = null
  let readyReject: ((error: Error) => void) | null = null
  let readyTimer = 0
  let sequence = 0
  let evaluationToken: string | null = null
  const pending = new Map<string, PendingCommand>()

  const settleReady = (error?: Error) => {
    window.clearTimeout(readyTimer)
    readyTimer = 0
    const resolve = readyResolve
    const reject = readyReject
    readyResolve = null
    readyReject = null
    if (error) reject?.(error)
    else resolve?.()
  }

  const respond = (
    message: { channel: string; id: string },
    result: { ok: true; value: unknown } | { ok: false; error: string },
  ) => {
    frame?.contentWindow?.postMessage(
      { source: 'eevee-harness', channel: message.channel, id: message.id, ...result },
      '*',
    )
  }

  const rejectPending = (error: Error) => {
    for (const item of pending.values()) {
      window.clearTimeout(item.timer)
      item.reject(error)
    }
    pending.clear()
  }

  const receive = (event: MessageEvent<unknown>) => {
    if (!frame || event.source !== frame.contentWindow) return
    const appletMessage = appletMessageSchema.safeParse(event.data)
    if (appletMessage.success && appletMessage.data.channel === output.channel) {
      const message = appletMessage.data
      if (message.action === 'ready') {
        evaluationToken = message.evaluationToken
        settleReady()
        return
      }
      if (message.action === 'revoke') {
        const error = new Error(message.reason)
        settleReady(error)
        rejectPending(error)
        return
      }
      if (
        message.action === 'files-list' ||
        message.action === 'files-read' ||
        message.action === 'files-table' ||
        message.action === 'files-text'
      ) {
        // Behavioral evaluation is deterministic and isolated: live Library
        // contents must not influence a verdict. Applets should tolerate this
        // failure and render their file-independent behavior.
        respond(message, {
          ok: false,
          error: 'Library files are not available during behavioral evaluation',
        })
        return
      }
      if (message.action === 'all') {
        respond(message, { ok: true, value: memory.all() })
        return
      }
      if (message.action === 'get') {
        try {
          respond(message, { ok: true, value: memory.get(message.payload.key) })
        } catch (error) {
          respond(message, { ok: false, error: boundedMessage(error) })
        }
        return
      }
      try {
        respond(message, {
          ok: true,
          value: memory.set(message.payload.key, message.payload.value),
        })
      } catch (error) {
        respond(message, { ok: false, error: boundedMessage(error) })
      }
      return
    }
    const evaluationMessage = evaluationMessageSchema.safeParse(event.data)
    if (!evaluationMessage.success || evaluationMessage.data.channel !== output.channel) return
    const message = evaluationMessage.data
    if (message.evaluationToken !== evaluationToken) return
    const item = pending.get(message.id)
    if (!item) return
    window.clearTimeout(item.timer)
    pending.delete(message.id)
    if (message.ok) item.resolve(message.value)
    else item.reject(new Error(message.error))
  }

  const start = (): Promise<void> => {
    if (signal.aborted) return Promise.reject(new Error('The evaluation was cancelled'))
    settleReady(new Error('The previous applet start was replaced'))
    evaluationToken = null
    const ready = new Promise<void>((resolve, reject) => {
      readyResolve = resolve
      readyReject = reject
    })
    const nextFrame = document.createElement('iframe')
    nextFrame.title = 'Automated applet evaluation'
    nextFrame.setAttribute('sandbox', 'allow-scripts allow-forms')
    nextFrame.setAttribute('referrerpolicy', 'no-referrer')
    nextFrame.setAttribute('aria-hidden', 'true')
    Object.assign(nextFrame.style, {
      border: '0',
      height: '720px',
      left: '-10000px',
      opacity: '0',
      pointerEvents: 'none',
      position: 'fixed',
      top: '0',
      width: '1280px',
    })
    nextFrame.srcdoc = output.html
    frame = nextFrame
    document.body.append(nextFrame)
    readyTimer = window.setTimeout(
      () => settleReady(new Error('The applet did not become ready in time')),
      READY_TIMEOUT_MS,
    )
    return ready
  }

  const command = (value: EvaluationCommand): Promise<unknown> => {
    if (signal.aborted) return Promise.reject(new Error('The evaluation was cancelled'))
    const currentFrame = frame
    if (!currentFrame?.contentWindow) return Promise.reject(new Error('The applet frame is unavailable'))
    if (!evaluationToken) return Promise.reject(new Error('The applet evaluator is not ready'))
    const id = String(++sequence)
    return new Promise((resolve, reject) => {
      const timer = window.setTimeout(() => {
        pending.delete(id)
        reject(new Error('The applet evaluation command timed out'))
      }, COMMAND_TIMEOUT_MS)
      pending.set(id, { resolve, reject, timer })
      currentFrame.contentWindow?.postMessage(
        {
          source: 'eevee-evaluator',
          channel: output.channel,
          evaluationToken,
          id,
          command: value,
        },
        '*',
      )
    })
  }

  const restart = async (): Promise<void> => {
    if (signal.aborted) throw new Error('The evaluation was cancelled')
    frame?.remove()
    frame = null
    settleReady(new Error('The applet runtime restarted'))
    rejectPending(new Error('The applet runtime restarted'))
    await start()
  }

  const destroyWith = (error: Error) => {
    settleReady(error)
    rejectPending(error)
    frame?.remove()
    frame = null
    evaluationToken = null
    window.removeEventListener('message', receive)
    signal.removeEventListener('abort', abort)
  }
  const abort = () => destroyWith(new Error('The evaluation was cancelled'))
  const destroy = () => destroyWith(new Error('The applet evaluation finished'))

  window.addEventListener('message', receive)
  signal.addEventListener('abort', abort, { once: true })
  return { command, destroy, restart, start }
}

const evidence = (
  index: number,
  step: EvaluationStep,
  verdict: 'pass' | 'fail',
  detail: string,
  startedAt: number,
): EvaluationStepEvidence => ({
  index,
  action: step.action,
  verdict,
  detail: detail.slice(0, 500),
  durationMs: Math.min(30_000, Math.max(0, Math.round(performance.now() - startedAt))),
})

/**
 * After an interaction, wait until the applet runtime reports no in-flight
 * bridge requests (storage reads and writes started by the interaction) so
 * the next step observes committed state instead of racing a pending write.
 * Runtimes without the settle command fall back to a fixed grace period.
 */
const settleInteraction = async (
  harness: EvaluationCaseTransport,
  signal: AbortSignal,
): Promise<string> => {
  let outcome: unknown
  try {
    outcome = await harness.command({ action: 'settle' })
  } catch (error) {
    if (signal.aborted) throw error
    await delay(50, signal)
    return '; settled by grace period'
  }
  const parsed = settleResultSchema.safeParse(outcome)
  if (!parsed.success) return ''
  return parsed.data.settled ? '; bridge requests settled' : '; bridge requests still pending after the settle timeout'
}

export const executeStep = async (
  harness: EvaluationCaseTransport,
  memory: BoundedMemoryStore,
  step: EvaluationStep,
  signal: AbortSignal,
): Promise<string> => {
  switch (step.action) {
    case 'click':
    case 'fill':
    case 'press':
      {
        const result = await harness.command(step)
        const settled = await settleInteraction(harness, signal)
        const method = typeof result === 'string'
          ? ` using ${result}`
          : step.action === 'click' && typeof result === 'object' && result !== null && 'submitted' in result
            ? `; form found: ${'formFound' in result ? String(result.formFound) : 'unknown'}; form submitted: ${String(result.submitted)}`
            : ''
        return `${step.action} completed for ${step.selector}${method}${settled}.`
      }
    case 'wait':
      await delay(step.milliseconds, signal)
      return `Waited ${step.milliseconds} milliseconds.`
    case 'restart':
      await harness.restart()
      return 'The applet restarted with its case storage preserved.'
    case 'assert-text': {
      const result = inspectResultSchema.parse(
        await harness.command({ action: 'inspect', selector: step.selector }),
      )
      if (result.count === 0 || !result.text.includes(step.contains)) {
        throw new Error(`Expected matching text in ${step.selector}`)
      }
      return `Matching text is present in ${step.selector}.`
    }
    case 'assert-count': {
      const result = inspectResultSchema.parse(
        await harness.command({ action: 'inspect', selector: step.selector }),
      )
      if (result.count !== step.count) {
        throw new Error(`Expected ${step.count} matches for ${step.selector}; found ${result.count}`)
      }
      return `${step.selector} has ${step.count} matching elements.`
    }
    case 'assert-value': {
      const result = inspectResultSchema.parse(
        await harness.command({ action: 'inspect', selector: step.selector }),
      )
      if (result.count === 0 || result.value !== step.value) {
        throw new Error(`Expected the declared value in ${step.selector}`)
      }
      return `${step.selector} has the expected value.`
    }
    case 'assert-stored-value':
      if (!equalJson(memory.has(step.key) ? memory.get(step.key) : undefined, step.value)) {
        throw new Error(`Stored value ${step.key} does not match the expectation`)
      }
      return `Stored value ${step.key} matches the expectation.`
    default: {
      const unreachable: never = step
      return unreachable
    }
  }
}

const runCase = async (
  definition: EvaluationCaseDefinition,
  output: AppletRunOutput,
  signal: AbortSignal,
): Promise<EvaluationCaseEvidenceInput> => {
  const memory = createBoundedMemoryStore()
  const harness = createCaseHarness(output, memory, signal)
  const steps: EvaluationStepEvidence[] = []
  try {
    await harness.start()
    for (const [index, step] of definition.steps.entries()) {
      const startedAt = performance.now()
      try {
        const detail = await executeStep(harness, memory, step, signal)
        steps.push(evidence(index, step, 'pass', detail, startedAt))
      } catch (error) {
        if (signal.aborted) throw error
        steps.push(evidence(index, step, 'fail', boundedMessage(error), startedAt))
      }
    }
  } catch (error) {
    if (signal.aborted) throw error
    definition.steps.forEach((step, index) => {
      steps.push(evidence(index, step, 'fail', boundedMessage(error), performance.now()))
    })
  } finally {
    harness.destroy()
  }
  return { caseId: definition.id, steps }
}

const runVersion = async (
  plan: EvaluationPlan,
  target: EvaluationTarget,
  versionId: string,
  signal: AbortSignal,
  onProgress?: (message: string) => void,
): Promise<EvaluationVersionEvidenceInput> => {
  const cases: EvaluationCaseEvidenceInput[] = []
  for (const [index, definition] of plan.suite.cases.entries()) {
    if (signal.aborted) throw new Error('The evaluation was cancelled')
    onProgress?.(`${target === 'candidate' ? 'Candidate' : 'Baseline'} case ${index + 1} of ${plan.suite.cases.length}`)
    const response = await api.evaluationExecution(plan.run.id, target, definition.id, signal)
    cases.push(await runCase(definition, response.execution.output, signal))
  }
  return { versionId, cases }
}

export const evaluateAppletVersion = async (
  appletId: string,
  versionId: string,
  suiteId?: string,
  signal = new AbortController().signal,
  onProgress?: (message: string) => void,
) => {
  const { plan } = await api.startEvaluation(
    appletId,
    { versionId, ...(suiteId ? { suiteId } : {}) },
    signal,
  )
  try {
    const candidate = await runVersion(
      plan,
      'candidate',
      plan.run.candidateVersionId,
      signal,
      onProgress,
    )
    const baseline = plan.run.baselineVersionId
      ? await runVersion(plan, 'baseline', plan.run.baselineVersionId, signal, onProgress)
      : null
    return await api.completeEvaluation(plan.run.id, { candidate, baseline }, signal)
  } catch (error) {
    const message = boundedMessage(error)
    await api.failEvaluation(plan.run.id, message).catch(() => undefined)
    throw error
  }
}
