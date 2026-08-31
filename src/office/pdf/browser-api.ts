import { ownedArrayBuffer } from '@/domain/bytes'
import { downloadFile } from '../host/download'
import type { DriveFileHandle, HostStorage } from '../host/storage'
import { applySaveRequest, extractPagesBytes, insertPdfBytes } from './save-pdf'
import type {
  ExportImagesRequest,
  ExtractPagesRequest,
  ExtractPagesResult,
  InsertPdfRequest,
  InsertPdfResult,
  SavePdfRequest,
  SavePdfResult,
} from './ipc'

export interface PdfBrowserApi {
  readFile(handle: DriveFileHandle): Promise<ArrayBuffer>
  save(request: SavePdfRequest): Promise<SavePdfResult>
  extractPages(request: ExtractPagesRequest): Promise<ExtractPagesResult>
  insertPdf(request: InsertPdfRequest): Promise<InsertPdfResult>
  exportImages(request: ExportImagesRequest): Promise<{ ok: true } | { ok: false; error: string }>
  choosePdf(): Promise<Uint8Array | null>
  requestName(initialName: string): Promise<string | null>
}

export interface PdfBrowserApiOptions {
  storage: HostStorage
  choosePdf(): Promise<Uint8Array | null>
  requestName(initialName: string): Promise<string | null>
}

const dataUriBytes = (image: string): Uint8Array => {
  const decoded = window.atob(image)
  return Uint8Array.from(decoded, (character) => character.charCodeAt(0))
}

const pdfName = (name: string): string =>
  name.toLocaleLowerCase('en-US').endsWith('.pdf') ? name : `${name}.pdf`

export const createPdfBrowserApi = (options: PdfBrowserApiOptions): PdfBrowserApi => ({
  async readFile(handle) {
    return ownedArrayBuffer(await options.storage.open(handle))
  },
  async save(request) {
    try {
      const bytes = await applySaveRequest(await options.storage.open(request.handle), request)
      if (request.targetName) await options.storage.saveAs(pdfName(request.targetName), bytes)
      else await options.storage.save(request.handle, bytes)
      return { ok: true }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  },
  async extractPages(request) {
    try {
      const requested = await options.requestName(request.suggestedName)
      if (!requested) return { ok: true, canceled: true }
      const name = pdfName(requested)
      const bytes = await extractPagesBytes(await options.storage.open(request.handle), request.pages)
      const handle = await options.storage.saveAs(name, bytes)
      downloadFile(name, bytes, 'application/pdf')
      return { ok: true, savedPath: handle.id }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  },
  async insertPdf(request) {
    try {
      const incoming = await options.choosePdf()
      if (!incoming) return { ok: true, canceled: true }
      const current = await options.storage.open(request.handle)
      const { merged, count } = await insertPdfBytes(current, incoming, request.afterPageIndex)
      await options.storage.save(request.handle, merged)
      return { ok: true, insertedCount: count }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  },
  async exportImages(request) {
    try {
      const prefix = await options.requestName(request.baseName)
      if (!prefix) return { ok: true }
      request.images.forEach((image, index) => {
        const name = `${prefix}-page-${request.pageNumbers[index] ?? index + 1}.png`
        downloadFile(name, dataUriBytes(image), 'image/png')
      })
      return { ok: true }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  },
  choosePdf: options.choosePdf,
  requestName: options.requestName,
})
