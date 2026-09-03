'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { AppletActionRequest } from '@/domain/applet-action'
import { api } from '@/client/api'
import { TOOL_ACTIVITY_EVENT } from '@/client/tool-activity'

const POLL_MS = 8000
/** Dispatched by the action ledger whenever a request is created or decided. */
export const DECISIONS_CHANGED_EVENT = 'eevee:decisions-changed'

const age = (iso: string): string => {
  const seconds = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000))
  if (seconds < 60) return `${seconds}s ago`
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`
  return `${Math.floor(seconds / 3600)}h ago`
}

export function useDecisionQueue(): AppletActionRequest[] {
  const [pending, setPending] = useState<AppletActionRequest[]>([])
  const inFlight = useRef(false)

  const refresh = useCallback(async () => {
    if (inFlight.current) return
    inFlight.current = true
    try {
      const response = await api.listPendingActionRequests()
      // An identical queue keeps the same array so downstream consumers do
      // not re-render every poll tick.
      setPending((current) =>
        current.length === response.requests.length &&
        current.every(
          (request, index) =>
            request.id === response.requests[index]?.id &&
            request.state === response.requests[index]?.state,
        )
          ? current
          : response.requests,
      )
    } catch {
      // The queue is advisory; a failed poll keeps the last known state.
    } finally {
      inFlight.current = false
    }
  }, [])

  useEffect(() => {
    const timer = window.setInterval(() => void refresh(), POLL_MS)
    const nudge = () => void refresh()
    // First load goes through the same listener path so the effect body
    // itself never touches state.
    const kickoff = window.setTimeout(nudge, 0)
    window.addEventListener(TOOL_ACTIVITY_EVENT, nudge)
    window.addEventListener('eevee:changed', nudge)
    // The ledger announces a new or decided request the moment it exists;
    // tool activity alone fires "started" before the request is stored and
    // "succeeded" only after the person decides.
    window.addEventListener(DECISIONS_CHANGED_EVENT, nudge)
    return () => {
      window.clearTimeout(kickoff)
      window.clearInterval(timer)
      window.removeEventListener(TOOL_ACTIVITY_EVENT, nudge)
      window.removeEventListener('eevee:changed', nudge)
      window.removeEventListener(DECISIONS_CHANGED_EVENT, nudge)
    }
  }, [refresh])

  return pending
}

export function DecisionsChip({
  pending,
  open,
  onToggle,
}: {
  pending: readonly AppletActionRequest[]
  open: boolean
  onToggle: () => void
}) {
  // One pulse when a new decision arrives; a count going down stays quiet.
  const previous = useRef(pending.length)
  const [arrived, setArrived] = useState(false)
  useEffect(() => {
    const grew = pending.length > previous.current
    previous.current = pending.length
    if (!grew) return
    setArrived(true)
    const timer = window.setTimeout(() => setArrived(false), 1800)
    return () => window.clearTimeout(timer)
  }, [pending.length])
  return (
    <button
      type="button"
      className={['decisions-chip', pending.length > 0 ? 'has-pending' : '', arrived ? 'is-arrived' : '']
        .filter(Boolean)
        .join(' ')}
      aria-expanded={open}
      onClick={onToggle}
    >
      <strong>{pending.length}</strong>
      <span>{pending.length === 1 ? 'decision waiting' : 'decisions waiting'}</span>
    </button>
  )
}

export function DecisionsPanel({
  pending,
  onOpen,
}: {
  pending: readonly AppletActionRequest[]
  onOpen: (request: AppletActionRequest) => void
}) {
  return (
    <section className="decisions-panel" aria-label="Decisions waiting on you">
      <header>
        <h2>Waiting on you</h2>
        <span>{pending.length} pending</span>
      </header>
      <p className="decisions-note">
        Open a decision to see its rehearsal, the exact before and after, then approve or reject
        with your passkey.
      </p>
      {pending.length === 0 ? (
        <p className="decisions-empty">
          Nothing is waiting. When the agent asks a published applet to change saved data, the
          request appears here until you decide.
        </p>
      ) : (
        <ol>
          {pending.map((request) => (
            <li key={request.id}>
              <button type="button" className="decision-entry" onClick={() => onOpen(request)}>
                <strong>{request.action.title}</strong>
                <code>{JSON.stringify(request.input)}</code>
                <span>
                  {request.action.effects.includes('state:write') ? 'writes saved data' : 'no saved-data change'} · {age(request.createdAt)}
                </span>
              </button>
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}
