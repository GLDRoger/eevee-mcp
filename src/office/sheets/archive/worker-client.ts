import type { ArchiveCommand, ArchiveRequestEnvelope, ArchiveResponseEnvelope } from './worker'

const PROTOCOL_VERSION = 1 as const

export interface BrowserArchiveWorker {
  postMessage(message: ArchiveRequestEnvelope): void
  terminate(): void
  onmessage: ((event: MessageEvent<ArchiveResponseEnvelope>) => void) | null
  onerror: ((event: ErrorEvent) => void) | null
}

interface PendingRequest {
  readonly resolve: (value: unknown) => void
  readonly reject: (error: Error) => void
}

/** Browser counterpart to the desktop sidecar client. */
export class ArchiveWorkerClient {
  private readonly pending = new Map<string, PendingRequest>()

  constructor(private readonly worker: BrowserArchiveWorker = createWorker()) {
    this.worker.onmessage = (event) => this.handleResponse(event.data)
    this.worker.onerror = () => this.rejectPending(new Error('Workbook archive worker failed.'))
  }

  request(command: ArchiveCommand): Promise<unknown> {
    const requestId = crypto.randomUUID()
    const request: ArchiveRequestEnvelope = {
      version: PROTOCOL_VERSION,
      requestId,
      ...command,
    }
    return new Promise((resolve, reject) => {
      this.pending.set(requestId, { resolve, reject })
      this.worker.postMessage(request)
    })
  }

  async open(bytes: Uint8Array, name?: string): Promise<unknown> {
    return this.request({ command: 'open', bytes, ...(name ? { name } : {}) })
  }

  async readRange(input: {
    readonly sessionId: string
    readonly sheetId: string
    readonly range: {
      readonly startRow: number
      readonly endRow: number
      readonly startColumn: number
      readonly endColumn: number
    }
  }): Promise<unknown> {
    return this.request({ command: 'read_range', ...input })
  }

  async readFormulaCells(input: {
    readonly sessionId: string
    readonly sheetId: string
  }): Promise<unknown> {
    return this.request({ command: 'read_formula_cells', ...input })
  }

  async readMedia(input: {
    readonly sessionId: string
    readonly visualId: string
  }): Promise<unknown> {
    return this.request({ command: 'read_media', ...input })
  }

  async close(sessionId: string): Promise<void> {
    await this.request({ command: 'close', sessionId })
  }

  async archiveManifest(bytes: Uint8Array): Promise<unknown> {
    return this.request({ command: 'archive_manifest', bytes })
  }

  async readEntries(bytes: Uint8Array, entries: readonly string[]): Promise<unknown> {
    return this.request({ command: 'read_entries', bytes, entries })
  }

  async scanEntries(
    bytes: Uint8Array,
    entries: readonly string[],
    needle: string,
  ): Promise<unknown> {
    return this.request({ command: 'scan_entries', bytes, entries, needle })
  }

  async saveArchive(input: {
    readonly sourceBytes: Uint8Array
    readonly replacements: readonly { readonly name: string; readonly content: Uint8Array }[]
    readonly removals: readonly string[]
    readonly additions: readonly { readonly name: string; readonly content: Uint8Array }[]
  }): Promise<unknown> {
    return this.request({ command: 'save_archive', ...input })
  }

  dispose(): void {
    this.worker.terminate()
    this.rejectPending(new Error('Workbook archive worker stopped.'))
  }

  private handleResponse(response: ArchiveResponseEnvelope): void {
    if (
      response.version !== PROTOCOL_VERSION ||
      typeof response.requestId !== 'string' ||
      typeof response.ok !== 'boolean'
    ) {
      this.rejectPending(new Error('Workbook archive worker returned an invalid response.'))
      return
    }
    const pending = this.pending.get(response.requestId)
    if (!pending) return
    this.pending.delete(response.requestId)
    if (response.ok) pending.resolve(response.result)
    else pending.reject(new Error(response.error?.message ?? 'Workbook archive request failed.'))
  }

  private rejectPending(error: Error): void {
    for (const pending of this.pending.values()) pending.reject(error)
    this.pending.clear()
  }
}

function createWorker(): BrowserArchiveWorker {
  return new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })
}
