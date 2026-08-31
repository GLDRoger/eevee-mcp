import JSZip from 'jszip'

import { hostStorage, saveSpreadsheetEdits, type DriveFileHandle } from '../host/storage'
import { openExternalUrl } from '../host/external-url'
import { ArchiveWorkerClient } from './archive/worker-client'
import type {
  DesktopApi,
  WorkbookFile,
  WorkbookMediaResult,
  WorkbookRecalcResult,
  WorkbookSaveResult,
} from './shared/desktop-api'

type WorkerWorkbook = Omit<WorkbookFile, 'sha256'>

interface Session {
  readonly workerSessionId: string
  handle: DriveFileHandle
  bytes: Uint8Array
  file: WorkbookFile
}

export interface WebDesktopApi extends DesktopApi {
  openHandle(handle: DriveFileHandle): Promise<WorkbookFile>
  openSession(name: string, bytes: Uint8Array): Promise<WorkbookFile>
  exportBytes(sessionId: string): Promise<Uint8Array>
  openBlank(): Promise<WorkbookFile>
  dispose(): void
}

export function createWebDesktopApi(
  options: { requestOpen?: () => Promise<DriveFileHandle | null> } = {},
): WebDesktopApi {
  const worker = new ArchiveWorkerClient()
  const sessions = new Map<string, Session>()
  const listeners = new Set<
    (action: 'open' | 'save' | 'save-as' | 'export-pdf' | 'undo' | 'redo') => void
  >()

  const openBytes = async (handle: DriveFileHandle, bytes: Uint8Array): Promise<WorkbookFile> => {
    const opened = await worker.open(bytes, handle.name)
    const raw = workbookFromWorker(opened)
    const file = { ...raw, sha256: await digest(bytes) }
    sessions.set(file.sessionId, {
      workerSessionId: file.sessionId,
      handle,
      bytes: bytes.slice(),
      file,
    })
    return file
  }

  const openHandle = async (handle: DriveFileHandle): Promise<WorkbookFile> =>
    openBytes(handle, await hostStorage.open(handle))
  const openSession = async (name: string, bytes: Uint8Array): Promise<WorkbookFile> =>
    openBytes({ id: `session-${crypto.randomUUID()}`, name }, bytes)

  const api: WebDesktopApi = {
    openHandle,
    openSession,
    async exportBytes(sessionId) {
      return sessionFor(sessions, sessionId).bytes.slice()
    },
    async openBlank() {
      const bytes = await blankWorkbook()
      return openBytes(await hostStorage.create('Untitled.xlsx', bytes), bytes)
    },
    async getLanguage() {
      return 'en'
    },
    onLanguageChanged() {
      return () => undefined
    },
    async selectWorkbook() {
      if (options.requestOpen) {
        const handle = await options.requestOpen()
        return handle ? openHandle(handle) : null
      }
      const files = await hostStorage.list()
      const candidate = files.find((file) => file.handle.name.toLowerCase().endsWith('.xlsx'))
      return candidate ? openHandle(candidate.handle) : null
    },
    async readWorkbookRange(request) {
      return worker.readRange(request) as Promise<
        ReturnType<DesktopApi['readWorkbookRange']> extends Promise<infer T> ? T : never
      >
    },
    async readWorkbookFormulas(request) {
      return worker.readFormulaCells(request) as Promise<
        ReturnType<DesktopApi['readWorkbookFormulas']> extends Promise<infer T> ? T : never
      >
    },
    async recalcWorkbook() {
      return { cells: [] } satisfies WorkbookRecalcResult
    },
    async readWorkbookMedia(request) {
      return worker.readMedia(request) as Promise<WorkbookMediaResult>
    },
    async readPivotDefinition() {
      throw new Error('Pivot refresh is unavailable in the browser editor.')
    },
    async readLocalImage() {
      throw new Error('Local image paths are unavailable in the browser editor.')
    },
    async saveWorkbookEdits(request) {
      const session = sessionFor(sessions, request.sessionId)
      if (request.mode === 'save-as') return { canceled: true } satisfies WorkbookSaveResult
      if (session.handle.id.startsWith('session-')) {
        throw new Error('Save the workbook to the Library before editing it.')
      }
      const saved = await saveSpreadsheetEdits(session.handle, request)
      sessions.delete(request.sessionId)
      await worker.close(session.workerSessionId)
      const reopened = await openBytes(session.handle, saved.bytes)
      return {
        canceled: false,
        file: reopened,
        touchedEntries: [...saved.touchedEntries],
      } satisfies WorkbookSaveResult
    },
    async writeWorkbookRecovery() {
      return { ok: false }
    },
    async autoRenameWorkbook(sessionId, baseName) {
      const session = sessionFor(sessions, sessionId)
      const name = `${safeName(baseName)}.xlsx`
      session.handle = { ...session.handle, name }
      return { renamed: true, name }
    },
    async exportPdf() {
      window.print()
      return { canceled: true }
    },
    async closeWorkbook(sessionId) {
      const session = sessions.get(sessionId)
      if (!session) return
      sessions.delete(sessionId)
      await worker.close(session.workerSessionId)
    },
    async openExternal(url) {
      openExternalUrl(url)
    },
    onMenuAction(callback) {
      listeners.add(callback)
      return () => listeners.delete(callback)
    },
    onWorkbookRenamed() {
      return () => undefined
    },
    notifyPendingEdits() {},
    onCloseSaveRequest() {
      return () => undefined
    },
    reportCloseSaveResult() {},
    async consumeNewBlankWorkbook() {
      return false
    },
    dispose() {
      worker.dispose()
      sessions.clear()
      listeners.clear()
    },
  }

  const shortcuts = (event: KeyboardEvent): void => {
    if (!event.metaKey && !event.ctrlKey) return
    const action = ({ s: 'save', o: 'open', p: 'export-pdf', z: 'undo', y: 'redo' } as const)[
      event.key.toLowerCase() as 's' | 'o' | 'p' | 'z' | 'y'
    ]
    if (!action || event.key.toLowerCase() === 'w' || event.key.toLowerCase() === 'n') return
    event.preventDefault()
    listeners.forEach((listener) =>
      listener(event.shiftKey && action === 'save' ? 'save-as' : action),
    )
  }
  window.addEventListener('keydown', shortcuts)
  const dispose = api.dispose.bind(api)
  api.dispose = () => {
    window.removeEventListener('keydown', shortcuts)
    dispose()
  }
  return api
}

function sessionFor(sessions: ReadonlyMap<string, Session>, sessionId: string): Session {
  const session = sessions.get(sessionId)
  if (!session) throw new Error('Unknown workbook session.')
  return session
}

function workbookFromWorker(value: unknown): WorkerWorkbook {
  if (!isRecord(value) || typeof value.sessionId !== 'string' || typeof value.name !== 'string')
    throw new Error('Workbook worker returned invalid metadata.')
  return value as WorkerWorkbook
}

async function digest(bytes: Uint8Array): Promise<string> {
  const copy = new Uint8Array(bytes.length)
  copy.set(bytes)
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', copy.buffer as ArrayBuffer))]
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('')
}

async function blankWorkbook(): Promise<Uint8Array> {
  const zip = new JSZip()
  zip.file(
    '[Content_Types].xml',
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>',
  )
  zip.file(
    '_rels/.rels',
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
  )
  zip.file(
    'xl/workbook.xml',
    '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets></workbook>',
  )
  zip.file(
    'xl/_rels/workbook.xml.rels',
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>',
  )
  zip.file(
    'xl/worksheets/sheet1.xml',
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData/></worksheet>',
  )
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' })
}


function safeName(value: string): string {
  return value.replace(/[\\/\0]/g, '').trim() || 'Untitled'
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
