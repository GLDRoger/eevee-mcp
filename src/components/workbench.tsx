'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { z } from 'zod'
import type { AppletRun } from '@/domain/applet'
import type { AppletDetail, AppletSummary } from '@/domain/api'
import { api } from '@/client/api'
import { registerEeveeTools } from '@/client/webmcp'
import { AppletInspector } from './applet-inspector'
import { AppletLedger } from './applet-ledger'
import { ToolRegister } from './tool-register'

const reviewEventSchema = z.strictObject({ appletId: z.uuid(), versionId: z.uuid() })

export function Workbench() {
  const [applets, setApplets] = useState<AppletSummary[]>([])
  const [detail, setDetail] = useState<AppletDetail | null>(null)
  const [run, setRun] = useState<AppletRun | null>(null)
  const [reviewVersionId, setReviewVersionId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [webMcpSupported, setWebMcpSupported] = useState(false)
  const [workspaceId, setWorkspaceId] = useState<string | null>(null)
  const selectedRef = useRef<string | null>(null)

  const openApplet = useCallback(async (appletId: string, signal?: AbortSignal) => {
    selectedRef.current = appletId
    const response = await api.inspectApplet(appletId, signal)
    setDetail(response.detail)
    const latestRun = response.detail.runs.find(
      ({ state }) => state === 'running' || state === 'succeeded',
    )
    if (!latestRun) {
      setRun(null)
      return
    }
    const runResponse = await api.inspectRun(latestRun.id, signal)
    setRun(runResponse.run)
  }, [])

  const refresh = useCallback(
    async (preferredId?: string, signal?: AbortSignal) => {
      const response = await api.listApplets(signal)
      setApplets(response.applets)
      const candidate = preferredId ?? selectedRef.current
      const nextId = response.applets.some(({ id }) => id === candidate)
        ? candidate
        : response.applets[0]?.id
      if (!nextId) {
        selectedRef.current = null
        setDetail(null)
        setRun(null)
        return
      }
      await openApplet(nextId, signal)
    },
    [openApplet],
  )

  useEffect(() => {
    const controller = new AbortController()
    const registration = registerEeveeTools()
    void registration.ready
      .then((supported) => {
        if (!controller.signal.aborted) setWebMcpSupported(supported)
      })
      .catch(() => {
        if (!controller.signal.aborted) setWebMcpSupported(false)
      })
    const changed = (event: Event) => {
      const custom = event instanceof CustomEvent ? event.detail : null
      const appletId =
        typeof custom === 'object' && custom !== null && 'appletId' in custom &&
        typeof custom.appletId === 'string'
          ? custom.appletId
          : undefined
      void refresh(appletId).catch((reason) => {
        setError(reason instanceof Error ? reason.message : 'EEVEE could not refresh')
      })
    }
    const review = (event: Event) => {
      if (!(event instanceof CustomEvent)) return
      const parsed = reviewEventSchema.safeParse(event.detail)
      if (!parsed.success) return
      setReviewVersionId(parsed.data.versionId)
      void refresh(parsed.data.appletId)
    }
    window.addEventListener('eevee:changed', changed)
    window.addEventListener('eevee:review-version', review)
    void api
      .session(controller.signal)
      .then((session) => {
        setWorkspaceId(session.workspaceId)
        return refresh(undefined, controller.signal)
      })
      .catch((reason) => {
        if (!controller.signal.aborted) {
          setError(reason instanceof Error ? reason.message : 'EEVEE could not open the workspace')
        }
      })
      .finally(() => setLoading(false))
    return () => {
      controller.abort()
      registration.unregister()
      window.removeEventListener('eevee:changed', changed)
      window.removeEventListener('eevee:review-version', review)
    }
  }, [refresh])

  const selectApplet = (appletId: string) => {
    setReviewVersionId(null)
    setError('')
    void openApplet(appletId).catch((reason) => {
      setError(reason instanceof Error ? reason.message : 'This applet could not be opened')
    })
  }

  const changed = () => {
    void refresh().catch((reason) => {
      setError(reason instanceof Error ? reason.message : 'EEVEE could not refresh')
    })
  }

  const completed = (completedRun: AppletRun) => {
    setRun(completedRun)
    changed()
  }

  return (
    <main className="workbench">
      <header className="topbar">
        <Link className="wordmark" href="/" aria-label="EEVEE MCP home">EEVEE</Link>
        <p>Durable work for people and browser agents</p>
        <span>Public build · 01</span>
      </header>
      <div className="workbench-body">
        <AppletLedger
          applets={applets}
          selectedId={detail?.applet.id ?? null}
          onSelect={selectApplet}
        />
        <section className="bench" aria-live="polite">
          {loading ? (
            <div className="bench-message"><h2>Opening the ledger</h2><p>Loading durable state.</p></div>
          ) : error ? (
            <div className="bench-message is-error"><h2>The workbench did not open</h2><p>{error}</p></div>
          ) : detail ? (
            <AppletInspector
              detail={detail}
              run={run}
              reviewVersionId={reviewVersionId}
              onRun={completed}
              onReviewVersion={setReviewVersionId}
              onChanged={changed}
            />
          ) : (
            <div className="bench-message is-empty">
              <span>01</span>
              <h2>Give the agent a result worth repeating.</h2>
              <p>
                Ask it to create a typed web applet. EEVEE will evaluate the source, keep every
                version, and wait here for your approval.
              </p>
            </div>
          )}
        </section>
      </div>
      <ToolRegister supported={webMcpSupported} workspaceId={workspaceId} />
    </main>
  )
}
