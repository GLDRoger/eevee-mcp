// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'

vi.mock('./api', () => ({
  api: {
    readState: vi.fn(() => Promise.reject(new Error('never read'))),
  },
}))

import type { AppletActionDefinition } from '@/domain/applet-action'
import { api } from './api'
import { rehearseAction } from './rehearsal'

const action: AppletActionDefinition = {
  name: 'set_credit_hold',
  title: 'Set credit hold',
  description: 'Toggle a hold.',
  inputs: [],
  effects: ['state:read', 'state:write'],
  authority: 'human',
}

describe('rehearseAction', () => {
  it('resolves as unavailable, never rejects, when the signal is already aborted', async () => {
    const controller = new AbortController()
    controller.abort()
    // The promise must settle even though no state was read and no frame was
    // created; a rejection here left decision cards stuck on "Rehearsing…".
    await expect(
      rehearseAction(
        crypto.randomUUID(),
        '<!doctype html><html><head></head><body></body></html>',
        crypto.randomUUID(),
        action,
        { customer_id: 'c101', hold: true },
        crypto.randomUUID(),
        controller.signal,
      ),
    ).resolves.toEqual({ verdict: 'unavailable', error: 'The rehearsal was cancelled' })
    expect(api.readState).not.toHaveBeenCalled()
    expect(document.querySelector('iframe')).toBeNull()
  })

  it('reports an unreadable state instead of hanging', async () => {
    await expect(
      rehearseAction(
        crypto.randomUUID(),
        '<!doctype html><html><head></head><body></body></html>',
        crypto.randomUUID(),
        action,
        {},
        crypto.randomUUID(),
      ),
    ).resolves.toEqual({ verdict: 'unavailable', error: 'The current state could not be read' })
  })
})
