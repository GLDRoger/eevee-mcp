'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { z } from 'zod'
import type { AppletRun } from '@/domain/applet'
import type { AppletActionRequest } from '@/domain/applet-action'
import { leaseActive, type AutonomyLease } from '@/domain/autonomy-lease'
import type { AppletDetail, AppletSummary } from '@/domain/api'
import { sensitiveFindingIdsSchema } from '@/domain/document-review'
import type { OfficeFileDetail, OfficeFileSummary } from '@/domain/office-file'
import type { HumanAuthorityStatus } from '@/domain/human-authority'
import { api } from '@/client/api'
import { EEVEE_TOOL_COUNT, registerEeveeTools, type ToolRegistration } from '@/client/webmcp'
import { publishWorkbenchState } from '@/client/workbench-state'
import { AgentActivity } from './agent-activity'
import { AppletInspector } from './applet-inspector'
import { AppletLedger } from './applet-ledger'
import { DecisionsChip, DecisionsPanel, useDecisionQueue } from './decisions'
import { FileExplorer } from './file-explorer'
import { FileInspector } from './file-inspector'
import { LibraryLedger } from './library-ledger'
import { StudioLedger } from './studio-ledger'
import { HumanAuthorityControl } from './human-authority-control'
import { WorkspaceMenu } from './workspace-menu'
import { AppletsHome, Guide, LibraryHome, StudioHome } from './workbench-home'

const reviewEventSchema = z.strictObject({ appletId: z.uuid(), versionId: z.uuid() })
const fileReviewEventSchema = z.strictObject({
  fileId: z.uuid(),
  findingIds: sensitiveFindingIdsSchema,
})
type WorkspaceSurface = 'applets' | 'library' | 'studio' | 'guide'

export function Workbench() {
  const [surface, setSurface] = useState<WorkspaceSurface>('applets')
  const [applets, setApplets] = useState<AppletSummary[]>([])
  const [files, setFiles] = useState<OfficeFileSummary[]>([])
  const [fileDetail, setFileDetail] = useState<OfficeFileDetail | null>(null)
  const [detail, setDetail] = useState<AppletDetail | null>(null)
  const [run, setRun] = useState<AppletRun | null>(null)
  const [reviewVersionId, setReviewVersionId] = useState<string | null>(null)
  const [fileReviewFindingIds, setFileReviewFindingIds] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [toolsLive, setToolsLive] = useState<ToolRegistration | null>(null)
  const [humanAuthority, setHumanAuthority] = useState<HumanAuthorityStatus | null>(null)
  const [decisionsOpen, setDecisionsOpen] = useState(false)
  // Escape and a click outside close the decisions panel, like any popover.
  useEffect(() => {
    if (!decisionsOpen) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setDecisionsOpen(false)
    }
    const onPointer = (event: PointerEvent) => {
      const target = event.target
      if (target instanceof Element && target.closest('.decisions-panel, .decisions-chip')) return
      setDecisionsOpen(false)
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('pointerdown', onPointer)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('pointerdown', onPointer)
    }
  }, [decisionsOpen])
  const [ledgerOpen, setLedgerOpen] = useState(true)
  const [stageView, setStageView] = useState<'app' | 'code'>('app')
  // The agent rail starts closed so the app or document owns the width; the
  // topbar chip still counts live tools and waiting decisions, and the rail
  // opens on demand for the shared plan and tool activity.
  const [railOpen, setRailOpen] = useState(false)
  // The autonomy lease is owned here, not by the preview component, so a
  // granted lease survives App/Code toggles and surface changes. The lease
  // names its run; a lease for any other run is simply never active.
  const [lease, setLease] = useState<AutonomyLease | null>(null)
  // Set when the person opens a pending decision from the topbar queue; the
  // mounted preview scrolls that request's card into view.
  const [focusRequestId, setFocusRequestId] = useState<string | null>(null)
  const pendingDecisions = useDecisionQueue()
  const selectedRef = useRef<string | null>(null)
  const selectedFileRef = useRef<string | null>(null)
  // The bench opens on the Applets home, never on whichever applet happens
  // to be first in the ledger; an explicit target (a click, an agent event, a
  // decision jump) selects one, and Close returns here.
  const dismissedRef = useRef(true)

  const openFile = useCallback(async (fileId: string, signal?: AbortSignal) => {
    selectedFileRef.current = fileId
    const response = await api.inspectFile(fileId, signal)
    setFileDetail(response.detail)
  }, [])

  const refreshFiles = useCallback(
    async (preferredId?: string, signal?: AbortSignal) => {
      const response = await api.listFiles(signal)
      setFiles(response.files)
      const candidate = preferredId ?? selectedFileRef.current
      const nextId = response.files.some(({ id }) => id === candidate)
        ? candidate
        : response.files[0]?.id
      if (!nextId) {
        selectedFileRef.current = null
        setFileDetail(null)
        return
      }
      await openFile(nextId, signal)
    },
    [openFile],
  )

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
      // An explicit target (agent event, decision jump) overrides dismissal;
      // a background refresh respects it and keeps the bench bare.
      if (preferredId) dismissedRef.current = false
      if (dismissedRef.current) return
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

  const closeApplet = () => {
    dismissedRef.current = true
    selectedRef.current = null
    setDetail(null)
    setRun(null)
    setReviewVersionId(null)
  }

  // The agent's get_workbench_state tool reads this; it is the same picture
  // the person has, published on every change.
  useEffect(() => {
    const latestVersionId = detail?.versions[0]?.id ?? null
    publishWorkbenchState({
      surface,
      applet: detail
        ? {
            id: detail.applet.id,
            name: detail.applet.name,
            activeVersionId: detail.applet.activeVersionId,
            latestVersionId,
            view: stageView,
          }
        : null,
      run: run ? { id: run.id, state: run.state, appletVersionId: run.appletVersionId } : null,
      reviewVersionId,
      file: fileDetail
        ? { id: fileDetail.file.id, name: fileDetail.file.name, medium: fileDetail.file.medium }
        : null,
      pendingDecisions: pendingDecisions.length,
      lease: lease && leaseActive(lease) ? lease : null,
      passkeyEnrolled: humanAuthority?.enrolled ?? null,
      toolsLive: toolsLive?.live ?? null,
    })
  }, [
    detail,
    fileDetail,
    humanAuthority,
    lease,
    pendingDecisions.length,
    reviewVersionId,
    run,
    stageView,
    surface,
    toolsLive,
  ])

  useEffect(() => {
    const controller = new AbortController()
    let unregister: (() => void) | null = null
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
      // The person may be anywhere in the workspace when the agent requests
      // review; bring the review surface to them or the approval gate stays
      // invisible.
      setSurface('applets')
      setReviewVersionId(parsed.data.versionId)
      void refresh(parsed.data.appletId)
    }
    const filesChanged = (event: Event) => {
      const custom = event instanceof CustomEvent ? event.detail : null
      const fileId =
        typeof custom === 'object' && custom !== null && 'fileId' in custom &&
        typeof custom.fileId === 'string'
          ? custom.fileId
          : undefined
      const selectChangedFile =
        typeof custom === 'object' && custom !== null && 'select' in custom && custom.select === true
      void refreshFiles(selectChangedFile ? fileId : undefined).catch((reason) => {
        setError(reason instanceof Error ? reason.message : 'EEVEE could not refresh the Library')
      })
    }
    const reviewFile = (event: Event) => {
      if (!(event instanceof CustomEvent)) return
      const parsed = fileReviewEventSchema.safeParse(event.detail)
      if (!parsed.success) return
      setSurface('library')
      setFileReviewFindingIds(parsed.data.findingIds)
      void refreshFiles(parsed.data.fileId)
    }
    window.addEventListener('eevee:changed', changed)
    window.addEventListener('eevee:review-version', review)
    window.addEventListener('eevee:files-changed', filesChanged)
    window.addEventListener('eevee:review-file', reviewFile)
    void api
      .session(controller.signal)
      .then(() => {
        // The workspace cookie now exists, so every tool request joins this
        // workspace. Registering earlier would let an agent's first call and
        // the session request race each other into two different workspaces.
        if (!controller.signal.aborted) {
          const registration = registerEeveeTools()
          unregister = registration.unregister
          void registration.ready
            .then((registered) => setToolsLive(registered))
            .catch(() => setToolsLive({ live: 0, total: EEVEE_TOOL_COUNT, failures: [] }))
        }
        return Promise.all([
          refresh(undefined, controller.signal),
          refreshFiles(undefined, controller.signal),
          api.humanAuthorityStatus(controller.signal).then(setHumanAuthority),
        ])
      })
      .catch((reason) => {
        if (!controller.signal.aborted) {
          setError(reason instanceof Error ? reason.message : 'EEVEE could not open the workspace')
        }
      })
      .finally(() => setLoading(false))
    return () => {
      controller.abort()
      unregister?.()
      window.removeEventListener('eevee:changed', changed)
      window.removeEventListener('eevee:review-version', review)
      window.removeEventListener('eevee:files-changed', filesChanged)
      window.removeEventListener('eevee:review-file', reviewFile)
    }
  }, [refresh, refreshFiles])

  const selectApplet = (appletId: string) => {
    dismissedRef.current = false
    setSurface('applets')
    setReviewVersionId(null)
    setError('')
    void openApplet(appletId).catch((reason) => {
      setError(reason instanceof Error ? reason.message : 'This applet could not be opened')
    })
  }

  const selectFile = (fileId: string) => {
    setFileReviewFindingIds([])
    setError('')
    void openFile(fileId).catch((reason) => {
      setError(reason instanceof Error ? reason.message : 'This file could not be opened')
    })
  }

  const uploadFile = async (file: File) => {
    setError('')
    try {
      const response = await api.uploadFile(file.name, new Uint8Array(await file.arrayBuffer()))
      await refreshFiles(response.file.id)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'This file could not be imported')
      throw reason
    }
  }

  const createFile = async (name: string, bytes: Uint8Array, note?: string) => {
    setError('')
    try {
      const response = await api.uploadFile(name, bytes, undefined, note)
      await refreshFiles(response.file.id)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'This file could not be created')
      throw reason
    }
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

  const runLease = lease && lease.runId === run?.id && leaseActive(lease) ? lease : null

  const openDecision = (request: AppletActionRequest) => {
    setDecisionsOpen(false)
    setSurface('applets')
    setReviewVersionId(null)
    setFocusRequestId(request.id)
    void refresh(request.appletId).catch((reason) => {
      setError(reason instanceof Error ? reason.message : 'This applet could not be opened')
    })
  }

  const showApplet = surface === 'applets' && detail !== null

  return (
    <main className="workbench">
      <header className="topbar">
        <Link className="wordmark" href="/" aria-label="EEVEE MCP home">
          EEVEE
          <small>agents build the app · you hold the key</small>
        </Link>
        <nav className="workspace-nav" aria-label="Workspace">
          <button
            type="button"
            aria-current={surface === 'applets' ? 'page' : undefined}
            onClick={() => setSurface('applets')}
          >Applets</button>
          <button
            type="button"
            aria-current={surface === 'library' ? 'page' : undefined}
            onClick={() => setSurface('library')}
          >Library</button>
          <button
            type="button"
            aria-current={surface === 'studio' ? 'page' : undefined}
            onClick={() => setSurface('studio')}
          >Studio</button>
          <button
            type="button"
            aria-current={surface === 'guide' ? 'page' : undefined}
            title="How EEVEE works, with prompts you can paste to your agent"
            onClick={() => setSurface('guide')}
          >Guide</button>
        </nav>
        <span className="topbar-status">
          <HumanAuthorityControl status={humanAuthority} onStatus={setHumanAuthority} />
          {runLease ? (
            <span
              className="topbar-lease"
              title="The open run may spend these writes on your standing decision. Every spend lands in the record."
            >
              Lease · {runLease.remainingWrites} of {runLease.grantedWrites} writes · until{' '}
              {new Date(runLease.expiresAt).toLocaleTimeString([], {
                hour: '2-digit',
                minute: '2-digit',
              })}
            </span>
          ) : null}
          <DecisionsChip
            pending={pendingDecisions}
            open={decisionsOpen}
            onToggle={() => setDecisionsOpen((current) => !current)}
          />
          <WorkspaceMenu />
        </span>
      </header>
      <div
        className={[
          'workbench-body',
          ledgerOpen ? '' : 'is-ledger-closed',
          railOpen ? '' : 'is-rail-closed',
        ].filter(Boolean).join(' ')}
      >
        {decisionsOpen ? (
          <DecisionsPanel pending={pendingDecisions} onOpen={openDecision} />
        ) : null}
        <div className="side-shell" data-closed={!ledgerOpen}>
          {surface === 'library' ? (
            <LibraryLedger
              files={files}
              selectedId={fileDetail?.file.id ?? null}
              onSelect={selectFile}
              onUpload={uploadFile}
            />
          ) : surface === 'studio' ? (
            <StudioLedger
              files={files}
              selectedId={fileDetail?.file.id ?? null}
              onSelect={selectFile}
              onCreate={(name, bytes) => createFile(name, bytes, 'Created in Studio')}
            />
          ) : (
            <AppletLedger
              applets={applets}
              selectedId={showApplet ? detail.applet.id : null}
              onSelect={selectApplet}
              onInstallReference={async (slug) => {
                const response = await api.installReferenceApplet(slug)
                setSurface('applets')
                await refresh(response.applet.id)
              }}
            />
          )}
        </div>
        <button
          type="button"
          className="side-toggle is-left"
          aria-expanded={ledgerOpen}
          title={ledgerOpen ? 'Hide the list' : 'Show the list'}
          onClick={() => setLedgerOpen((current) => !current)}
        >
          <span aria-hidden="true">{ledgerOpen ? '⟨' : '⟩'}</span>
          <span className="side-toggle-label">
            {surface === 'library' ? 'Library' : surface === 'studio' ? 'Studio' : 'Applets'}
          </span>
        </button>
        <section
          className={
            surface === 'studio'
              ? 'bench is-library'
              : showApplet && !loading && !error
                ? 'bench is-stage'
                : 'bench'
          }
          aria-live="polite"
        >
          {loading ? (
            <div className="bench-message"><h2>Opening your workspace</h2><p>Loading…</p></div>
          ) : error ? (
            <div className="bench-message is-error">
              <h2>The workbench did not open</h2>
              <p>{error}</p>
              <button type="button" className="primary-action" onClick={() => window.location.reload()}>
                Try again
              </button>
            </div>
          ) : surface === 'studio' && fileDetail ? (
            <FileInspector detail={fileDetail} />
          ) : surface === 'library' && fileDetail ? (
            <FileExplorer
              detail={fileDetail}
              onOpenInStudio={() => setSurface('studio')}
              onChanged={() => {
                void refreshFiles(fileDetail.file.id).catch((reason) => {
                  setError(
                    reason instanceof Error ? reason.message : 'EEVEE could not refresh the Library',
                  )
                })
              }}
              reviewFindingIds={fileReviewFindingIds}
            />
          ) : showApplet ? (
            <AppletInspector
              detail={detail}
              run={run}
              reviewVersionId={reviewVersionId}
              lease={runLease}
              onLeaseChange={setLease}
              focusRequestId={focusRequestId}
              onRun={completed}
              onReviewVersion={setReviewVersionId}
              onChanged={changed}
              onClose={closeApplet}
              onViewChange={setStageView}
            />
          ) : surface === 'library' ? (
            <LibraryHome onUpload={uploadFile} />
          ) : surface === 'studio' ? (
            <StudioHome />
          ) : surface === 'guide' ? (
            <Guide toolsLive={toolsLive} humanAuthority={humanAuthority} />
          ) : (
            <AppletsHome
              toolsLive={toolsLive}
              humanAuthority={humanAuthority}
              hasApplets={applets.length > 0}
              onSurface={setSurface}
              onOpenApplets={() => {
                setSurface('applets')
                dismissedRef.current = false
                void refresh()
              }}
            />
          )}
        </section>
        <button
          type="button"
          className="side-toggle is-right"
          aria-expanded={railOpen}
          title={railOpen ? 'Hide agent activity' : 'Show agent activity'}
          onClick={() => setRailOpen((current) => !current)}
        >
          <span aria-hidden="true">{railOpen ? '⟩' : '⟨'}</span>
          <span className="side-toggle-label">Agent</span>
        </button>
        <div className="side-shell" data-closed={!railOpen}>
          <AgentActivity toolsLive={toolsLive} />
        </div>
      </div>
    </main>
  )
}
