'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { z } from 'zod'
import type { AppletRun } from '@/domain/applet'
import type { AppletDetail, AppletSummary } from '@/domain/api'
import { sensitiveFindingIdsSchema } from '@/domain/document-review'
import type { OfficeFileDetail, OfficeFileSummary } from '@/domain/office-file'
import { api } from '@/client/api'
import { EEVEE_TOOL_COUNT, registerEeveeTools } from '@/client/webmcp'
import { AgentActivity } from './agent-activity'
import { AppletInspector } from './applet-inspector'
import { AppletLedger } from './applet-ledger'
import { FileExplorer } from './file-explorer'
import { FileInspector } from './file-inspector'
import { LibraryLedger } from './library-ledger'
import { StudioLedger } from './studio-ledger'

const reviewEventSchema = z.strictObject({ appletId: z.uuid(), versionId: z.uuid() })
const fileReviewEventSchema = z.strictObject({
  fileId: z.uuid(),
  findingIds: sensitiveFindingIdsSchema,
})
type WorkspaceSurface = 'applets' | 'library' | 'studio'

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
  const [toolsLive, setToolsLive] = useState<boolean | null>(null)
  const selectedRef = useRef<string | null>(null)
  const selectedFileRef = useRef<string | null>(null)

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
            .catch(() => setToolsLive(false))
        }
        return Promise.all([
          refresh(undefined, controller.signal),
          refreshFiles(undefined, controller.signal),
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

  const createFile = async (name: string, bytes: Uint8Array) => {
    setError('')
    try {
      const response = await api.uploadFile(name, bytes)
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

  return (
    <main className="workbench">
      <header className="topbar">
        <Link className="wordmark" href="/" aria-label="EEVEE MCP home">EEVEE</Link>
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
        </nav>
        <span className="topbar-status">
          {toolsLive === null ? null : toolsLive ? (
            <span className="webmcp-chip is-live" title="A WebMCP-capable browser agent can use every EEVEE tool on this page.">
              WebMCP · {EEVEE_TOOL_COUNT} tools live
            </span>
          ) : (
            <span
              className="webmcp-chip is-off"
              title="This browser did not expose document.modelContext. In Chrome 149+, enable chrome://flags/#enable-webmcp-testing and relaunch."
            >
              WebMCP unavailable
            </span>
          )}
          <span>Public build · 01</span>
        </span>
      </header>
      <div className="workbench-body">
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
            onCreate={createFile}
          />
        ) : (
          <AppletLedger
            applets={applets}
            selectedId={detail?.applet.id ?? null}
            onSelect={selectApplet}
            onInstallReference={async (slug) => {
              const response = await api.installReferenceApplet(slug)
              await refresh(response.applet.id)
            }}
          />
        )}
        <section
          className={surface === 'studio' ? 'bench is-library' : 'bench'}
          aria-live="polite"
        >
          {loading ? (
            <div className="bench-message"><h2>Opening the ledger</h2><p>Loading durable state.</p></div>
          ) : error ? (
            <div className="bench-message is-error"><h2>The workbench did not open</h2><p>{error}</p></div>
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
          ) : surface === 'applets' && detail ? (
            <AppletInspector
              detail={detail}
              run={run}
              reviewVersionId={reviewVersionId}
              onRun={completed}
              onReviewVersion={setReviewVersionId}
              onChanged={changed}
            />
          ) : surface === 'library' ? (
            <div className="bench-message is-empty">
              <span>01</span>
              <h2>Bring the work itself into EEVEE.</h2>
              <p>
                Import a Word document, spreadsheet, presentation, or PDF. EEVEE keeps the
                original bytes and every saved version, and the Studio opens each one with its
                full editor.
              </p>
            </div>
          ) : surface === 'studio' ? (
            <div className="bench-message is-empty">
              <span>01</span>
              <h2>Open the full editors.</h2>
              <p>
                Start a blank document, spreadsheet, or presentation — or pick a Library file.
                Every save lands in the same immutable version register.
              </p>
            </div>
          ) : (
            <div className="bench-message is-empty">
              <span>01</span>
              <h2>Give the agent a result worth repeating.</h2>
              <p>
                Ask it to create a typed interactive applet and behavioral suite. EEVEE will compile,
                compare, keep every result, and wait here for your approval.
              </p>
              <StarterPrompt toolsLive={toolsLive} />
            </div>
          )}
        </section>
      </div>
      <AgentActivity />
    </main>
  )
}

const STARTER_PROMPT =
  'Create an interactive React project task register in EEVEE. Give it a required project-name input, persistent tasks, keyboard-friendly controls, responsive layout, and no network dependencies. Create a required browser scenario that adds a task, restarts the applet, and proves the task remains. Evaluate it, show me the evidence and rendered version for approval, then run it with the project name "WebMCP launch".'

function StarterPrompt({ toolsLive }: { toolsLive: boolean | null }) {
  const [copied, setCopied] = useState(false)

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(STARTER_PROMPT)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    } catch {
      setCopied(false)
    }
  }

  return (
    <>
      <div className="starter-prompt">
        <p>Try this first ask</p>
        <code>{STARTER_PROMPT}</code>
        <button className="text-action" type="button" onClick={() => void copy()}>
          {copied ? 'Copied' : 'Copy prompt'}
        </button>
      </div>
      {toolsLive === false ? (
        <p className="starter-warning">
          This browser has not exposed WebMCP. In Chrome 149 or later, enable
          chrome://flags/#enable-webmcp-testing and relaunch to let an agent use these tools.
        </p>
      ) : null}
    </>
  )
}
