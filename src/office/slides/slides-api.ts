/**
 * Client-side SlidesApi: drive-backed open/save + session undo + rebuildSlide.
 */
import {
  addMedia,
  addModel3d,
  addPicture,
  commitSaved,
  createBlankPptx,
  openPptx,
  savePptx,
  setElementImageFill,
  type ElementClipboardItem,
} from '@/office/engines/pptx'
import type { MenuCommand, OpenResult, SlidesApi } from './shared/ipc'
import type { DriveFileHandle, HostStorage } from '../host/storage'
import { printOfficeRoot } from '../host/print'
import { cfbKind, isCfbHeader } from './cfb-sniff'
import { unplayableAudioCodec } from './mp4-audio-sniff'
import { createEditHandlers, deckDefaultFont, type HandlerCtx } from './edits'
import {
  buildAllRenderSlides,
  disposeMediaUrls,
  pushHistory,
  rebuildSlide,
  setFontMetrics,
  type Session,
} from './session'
import { tiffToPng } from './tiff-decode'
import { loadOfficeFontMetrics } from './fonts'

export interface PickedBytes {
  name: string
  bytes: Uint8Array
}

export interface SlidesApiHost {
  storage: HostStorage
  pendingFileId: string | null
  pickImage(): Promise<PickedBytes | null>
  pickMedia(kind: 'video' | 'audio'): Promise<PickedBytes | null>
  pickModel(): Promise<PickedBytes | null>
  requestName(initialName: string): Promise<string | null>
}

function decodeBase64(value: string): Uint8Array {
  const binary = atob(value)
  const out = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i)
  return out
}

function imageSize(bytes: Uint8Array): Promise<{ width: number; height: number }> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(new Blob([bytes.slice()]))
    const img = new Image()
    img.onload = () => {
      resolve({ width: img.naturalWidth || 4, height: img.naturalHeight || 3 })
      URL.revokeObjectURL(url)
    }
    img.onerror = () => {
      resolve({ width: 4, height: 3 })
      URL.revokeObjectURL(url)
    }
    img.src = url
  })
}

export function createSlidesApi(host: SlidesApiHost): SlidesApi {
  const ctx: HandlerCtx = {
    session: null,
    setSession(next) {
      ctx.session = next
    },
    elementClipboard: null,
    lastSlidePaste: null,
  }
  const rawEdits = createEditHandlers(ctx)
  const edits = Object.fromEntries(
    Object.entries(rawEdits).map(([key, fn]) => [
      key,
      (...args: never[]) => Promise.resolve((fn as (...a: never[]) => unknown)(...args)),
    ]),
  ) as unknown as typeof rawEdits
  const openedListeners = new Set<(result: OpenResult) => void>()
  const menuListeners = new Set<(command: MenuCommand) => void>()
  const closeSaveListeners = new Set<() => void>()
  const renamedListeners = new Set<(path: string) => void>()
  let handle: DriveFileHandle | null = null
  let pending = host.pendingFileId
  /** Host-owned draft: save/saveAs must not create a drive file. */
  let sessionOwned = false

  const openBytes = async (
    bytes: Uint8Array,
    path: string,
    fitWidthPx: number,
  ): Promise<OpenResult> => {
    if (bytes.length >= 8 && isCfbHeader(bytes.subarray(0, 8))) {
      throw new Error(
        cfbKind(bytes) === 'encrypted'
          ? 'Encrypted presentations cannot be opened'
          : 'Legacy .ppt files cannot be opened',
      )
    }
    disposeMediaUrls()
    setFontMetrics(await loadOfficeFontMetrics())
    const opened = await openPptx(bytes)
    const session: Session = { path, opened, fitWidthPx, undoStack: [], redoStack: [] }
    ctx.session = session
    return {
      path,
      slides: buildAllRenderSlides(opened, fitWidthPx),
      size: { cx: opened.deck.size.cx, cy: opened.deck.size.cy },
      defaultFont: deckDefaultFont(opened),
    }
  }

  const api: SlidesApi = {
    ...(edits as unknown as SlidesApi),
    getLanguage: async () => 'en',
    onLanguageChanged: () => () => {},
    async openPptx(fitWidthPx) {
      const files = (await host.storage.list()).filter((f) =>
        f.handle.name.toLowerCase().endsWith('.pptx'),
      )
      const first = files[0]
      if (!first) return null
      sessionOwned = false
      handle = first.handle
      return openBytes(await host.storage.open(first.handle), first.handle.id, fitWidthPx)
    },
    async openPptxPath(path, fitWidthPx) {
      const listed = await host.storage.list()
      const found = listed.find((f) => f.handle.id === path || f.handle.name === path)
      if (!found) return null
      sessionOwned = false
      handle = found.handle
      return openBytes(await host.storage.open(found.handle), found.handle.id, fitWidthPx)
    },
    async consumePendingOpen(fitWidthPx) {
      const id = pending
      pending = null
      if (!id) return null
      const listed = await host.storage.list()
      const found = listed.find((f) => f.handle.id === id)
      if (!found) return null
      sessionOwned = false
      handle = found.handle
      return openBytes(await host.storage.open(found.handle), found.handle.id, fitWidthPx)
    },
    async newBlank(fitWidthPx) {
      const bytes = await createBlankPptx()
      const created = await host.storage.create('Untitled.pptx', bytes)
      sessionOwned = false
      handle = created
      return openBytes(bytes, created.id, fitWidthPx)
    },
    async openFromBytes(bytes, path, fitWidthPx) {
      sessionOwned = true
      handle = null
      return openBytes(bytes, path, fitWidthPx)
    },
    async exportBytes() {
      const session = ctx.session
      if (!session) throw new Error('The presentation is not ready to publish')
      return savePptx(session.opened)
    },
    async editImageFill(op) {
      const session = ctx.session
      const slide = session?.opened.deck.slides[op.slideIndex]
      if (!session || !slide) return null
      const picked = await host.pickImage()
      if (!picked) return null
      const ext = picked.name.split('.').pop()?.toLowerCase() ?? 'png'
      pushHistory(session)
      if (!setElementImageFill(session.opened, slide, op.sourceId, picked.bytes, ext)) {
        session.undoStack.pop()
        return null
      }
      return rebuildSlide(session, op.slideIndex)
    },
    async clipboardExternal() {
      if (ctx.elementClipboard) return { kind: 'internal' as const }
      try {
        const text = await navigator.clipboard.readText()
        if (text.trim()) return { kind: 'text' as const, text }
      } catch {
        /* clipboard permission */
      }
      return { kind: 'none' as const }
    },
    async insertImage(slideIndex, fitWidthPx) {
      const session = ctx.session
      const slide = session?.opened.deck.slides[slideIndex]
      if (!session || !slide) return null
      const picked = await host.pickImage()
      if (!picked) return null
      const ext = picked.name.split('.').pop()?.toLowerCase() ?? 'png'
      let natural = { width: 4, height: 3 }
      if (ext === 'tif' || ext === 'tiff') {
        const decoded = tiffToPng(picked.bytes)
        if (decoded) natural = { width: decoded.width, height: decoded.height }
      } else {
        natural = await imageSize(picked.bytes)
      }
      const deckSize = session.opened.deck.size
      const scale = Math.min(deckSize.cx / 2 / natural.width, deckSize.cy / 2 / natural.height)
      const cx = Math.round(natural.width * scale)
      const cy = Math.round(natural.height * scale)
      pushHistory(session)
      const el = addPicture(session.opened, slide, {
        bytes: picked.bytes,
        ext,
        offset: {
          x: Math.round((deckSize.cx - cx) / 2),
          y: Math.round((deckSize.cy - cy) / 2),
          cx,
          cy,
        },
      })
      if (!el) {
        session.undoStack.pop()
        return { error: 'unsupported' as const, ext }
      }
      session.fitWidthPx = fitWidthPx
      const rebuilt = rebuildSlide(session, slideIndex)
      return rebuilt ? { slide: rebuilt, sourceId: el.id } : null
    },
    async insertMedia(slideIndex, kind, fitWidthPx) {
      const session = ctx.session
      if (!session?.opened.deck.slides[slideIndex]) return null
      const picked = await host.pickMedia(kind)
      if (!picked) return null
      const ext = picked.name.split('.').pop()?.toLowerCase() ?? (kind === 'video' ? 'mp4' : 'mp3')
      if (kind === 'video' && (ext === 'mp4' || ext === 'm4v' || ext === 'mov')) {
        const codec = unplayableAudioCodec(picked.bytes)
        if (codec)
          window.alert(`This video's audio codec (${codec}) may play silently in the browser.`)
      }
      const deckSize = session.opened.deck.size
      const offset =
        kind === 'video'
          ? {
              x: Math.round(deckSize.cx * 0.2),
              y: Math.round(deckSize.cy * 0.2),
              cx: Math.round(deckSize.cx * 0.6),
              cy: Math.round((deckSize.cx * 0.6 * 9) / 16),
            }
          : {
              x: Math.round(deckSize.cx * 0.38),
              y: Math.round(deckSize.cy * 0.455),
              cx: Math.round(deckSize.cx * 0.24),
              cy: Math.round(deckSize.cy * 0.09),
            }
      pushHistory(session)
      const added = addMedia(session.opened, slideIndex, {
        kind,
        bytes: picked.bytes,
        ext,
        offset,
        name: picked.name,
      })
      if (!added) {
        session.undoStack.pop()
        return null
      }
      session.fitWidthPx = fitWidthPx
      const rebuilt = rebuildSlide(session, slideIndex)
      return rebuilt ? { slide: rebuilt, sourceId: added.elementId } : null
    },
    async insertModel3d(slideIndex, fitWidthPx) {
      const session = ctx.session
      if (!session?.opened.deck.slides[slideIndex]) return null
      const picked = await host.pickModel()
      if (!picked) return null
      const ext = picked.name.split('.').pop()?.toLowerCase() ?? 'glb'
      const deckSize = session.opened.deck.size
      const cx = Math.round(deckSize.cx * 0.4)
      pushHistory(session)
      const added = addModel3d(session.opened, slideIndex, {
        bytes: picked.bytes,
        ext,
        offset: {
          x: Math.round((deckSize.cx - cx) / 2),
          y: Math.round((deckSize.cy - cx) / 2),
          cx,
          cy: cx,
        },
        name: picked.name,
      })
      if (!added) {
        session.undoStack.pop()
        return null
      }
      session.fitWidthPx = fitWidthPx
      const rebuilt = rebuildSlide(session, slideIndex)
      return rebuilt ? { slide: rebuilt, sourceId: added.elementId } : null
    },
    nativeClipboard: async (op) => {
      if (op === 'cut') document.execCommand('cut')
      else if (op === 'copy') document.execCommand('copy')
      else document.execCommand('paste')
    },
    async pickExportDir() {
      return (await host.requestName('slides-export')) ?? null
    },
    async exportImages(op) {
      try {
        const pad = op.pngsBase64.length >= 100 ? 3 : 2
        const paths: string[] = []
        for (let i = 0; i < op.pngsBase64.length; i++) {
          const name = `${op.baseName}-${String(i + 1).padStart(pad, '0')}.png`
          const saved = await host.storage.saveAs(name, decodeBase64(op.pngsBase64[i]!))
          paths.push(saved.id)
        }
        return { ok: true, paths }
      } catch (err) {
        return { ok: false, error: String(err) }
      }
    },
    pickExportPdfPath: async (defaultName) => host.requestName(defaultName),
    exportPdf: async () => {
      printOfficeRoot('office-slides')
      return { ok: true, path: 'print' }
    },
    printSlides: async () => {
      printOfficeRoot('office-slides')
      return { ok: true }
    },
    async save() {
      const session = ctx.session
      if (!session) return { ok: false, error: 'no file open' }
      if (sessionOwned) return { ok: false, error: 'session mode' }
      try {
        const bytes = await savePptx(session.opened)
        if (!handle) handle = await host.storage.create('Untitled.pptx', bytes)
        else await host.storage.save(handle, bytes)
        session.path = handle.id
        commitSaved(session.opened)
        session.metaDirty = false
        return {
          ok: true,
          path: handle.id,
          slides: buildAllRenderSlides(session.opened, session.fitWidthPx),
        }
      } catch (err) {
        return { ok: false, error: String(err) }
      }
    },
    async saveAs(defaultName) {
      const session = ctx.session
      if (!session) return { ok: false, error: 'no file open' }
      if (sessionOwned) return { ok: false, error: 'session mode' }
      const name = await host.requestName(
        defaultName.endsWith('.pptx') ? defaultName : `${defaultName}.pptx`,
      )
      if (!name) return { ok: false }
      try {
        const bytes = await savePptx(session.opened)
        handle = await host.storage.saveAs(name.endsWith('.pptx') ? name : `${name}.pptx`, bytes)
        session.path = handle.id
        commitSaved(session.opened)
        session.metaDirty = false
        return {
          ok: true,
          path: handle.id,
          slides: buildAllRenderSlides(session.opened, session.fitWidthPx),
        }
      } catch (err) {
        return { ok: false, error: String(err) }
      }
    },
    onCloseSaveRequest: (handler) => {
      closeSaveListeners.add(handler)
      return () => closeSaveListeners.delete(handler)
    },
    reportCloseSaveResult: () => {},
    setAutoSavePref: () => {},
    async getRecentFiles() {
      return (await host.storage.recent()).map((f) => f.handle.id)
    },
    onMenuCommand: (handler) => {
      menuListeners.add(handler)
      return () => menuListeners.delete(handler)
    },
    onOpened: (handler) => {
      openedListeners.add(handler)
      return () => openedListeners.delete(handler)
    },
    onRenamed: (handler) => {
      renamedListeners.add(handler)
      return () => renamedListeners.delete(handler)
    },
    presenterStart: async () => ({ audience: false }),
    presenterSync: () => {},
    presenterInk: () => {},
    presenterSwap: async () => false,
    presenterEnd: async () => {},
    audienceReady: async () => null,
    audienceNav: () => {},
    onShowSync: () => () => {},
    onShowInk: () => () => {},
    onAudienceNav: () => () => {},
  }

  return api
}

export type { ElementClipboardItem }
