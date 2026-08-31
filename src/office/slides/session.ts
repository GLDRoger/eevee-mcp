/**
 * Client-side slides session: snapshot undo + RenderSlide rebuild.
 * Browser session state for the absorbed Slides editor.
 */
import { materializeSlide, type OpenedPptx, type Slide } from '@/office/engines/pptx'
import {
  buildRenderSlide,
  type FontMetricsProvider,
  type RenderSlide,
} from '@/office/engines/pptx-render'
import { tiffToPng } from './tiff-decode'

export interface Session {
  path: string
  opened: OpenedPptx
  fitWidthPx: number
  undoStack: HistorySnapshot[]
  redoStack: HistorySnapshot[]
  metaDirty?: boolean
  htmlPages?: unknown[] | null
  transformPreview?: boolean
  masterEdit?: { partPath: string; slide: Slide } | null
}

export interface HistorySnapshot {
  slides: Slide[]
  entries: Map<string, Uint8Array>
  size: { cx: number; cy: number }
  metaDirty: boolean
}

const MAX_HISTORY = 50
const blobUrls = new Set<string>()

let fontMetrics: FontMetricsProvider | null = null

export function setFontMetrics(metrics: FontMetricsProvider): void {
  fontMetrics = metrics
}

export function getFontMetrics(): FontMetricsProvider {
  if (!fontMetrics) throw new Error('slides font metrics are not ready')
  return fontMetrics
}

function trimHistory(stack: HistorySnapshot[]): void {
  while (stack.length > MAX_HISTORY) stack.shift()
}

export function takeSnapshot(session: Session): HistorySnapshot {
  return {
    slides: structuredClone(session.opened.deck.slides),
    entries: new Map(session.opened.archive.entries),
    size: { ...session.opened.deck.size },
    metaDirty: !!session.metaDirty,
  }
}

function cloneSnapshot(snap: HistorySnapshot): HistorySnapshot {
  return {
    slides: structuredClone(snap.slides),
    entries: new Map(snap.entries),
    size: { ...snap.size },
    metaDirty: snap.metaDirty,
  }
}

export function pushHistory(session: Session): void {
  session.undoStack.push(takeSnapshot(session))
  trimHistory(session.undoStack)
  session.redoStack = []
  session.htmlPages = null
}

export function carryHistoryForReplacement(
  previous: Session | undefined,
  replacement: Session,
): void {
  if (!previous) return
  pushHistory(previous)
  replacement.undoStack = previous.undoStack
  replacement.redoStack = previous.redoStack
}

export function restoreSnapshot(session: Session, snap: HistorySnapshot): void {
  const fresh = cloneSnapshot(snap)
  session.opened.deck.slides = fresh.slides
  session.opened.deck.size = fresh.size
  session.metaDirty = fresh.metaDirty
  const entries = session.opened.archive.entries
  entries.clear()
  for (const [k, v] of fresh.entries) entries.set(k, v)
}

const DISPLAY_MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  bmp: 'image/bmp',
  webp: 'image/webp',
  svg: 'image/svg+xml',
}

function revokeBlobUrls(): void {
  for (const url of blobUrls) URL.revokeObjectURL(url)
  blobUrls.clear()
}

function blobUrlFor(bytes: Uint8Array, mime: string): string {
  const copy = bytes.slice()
  const url = URL.createObjectURL(new Blob([copy], { type: mime }))
  blobUrls.add(url)
  return url
}

export function makeMediaResolver(opened: OpenedPptx) {
  const cache = new Map<string, string | undefined>()
  return (mediaRef: string): string | undefined => {
    if (cache.has(mediaRef)) return cache.get(mediaRef)
    const bytes = opened.archive.readBytes(mediaRef)
    let url: string | undefined
    if (bytes) {
      const ext = mediaRef.split('.').pop()?.toLowerCase() ?? 'png'
      if (ext === 'tif' || ext === 'tiff') {
        const decoded = tiffToPng(bytes)
        if (decoded) url = blobUrlFor(decoded.png, 'image/png')
      } else {
        url = blobUrlFor(bytes, DISPLAY_MIME[ext] ?? 'image/png')
      }
    }
    cache.set(mediaRef, url)
    return url
  }
}

export function disposeMediaUrls(): void {
  revokeBlobUrls()
}

export function buildAllRenderSlides(opened: OpenedPptx, fitWidthPx: number): RenderSlide[] {
  const media = makeMediaResolver(opened)
  return opened.deck.slides.map((s, i) =>
    buildRenderSlide(s, opened.deck.size, {
      fitWidthPx,
      media,
      metrics: getFontMetrics(),
      slideNo: i + 1,
    }),
  )
}

export function rebuildSlide(session: Session, slideIndex: number): RenderSlide | null {
  const slide = session.opened.deck.slides[slideIndex]
  if (!slide) return null
  return buildRenderSlide(slide, session.opened.deck.size, {
    fitWidthPx: session.fitWidthPx,
    media: makeMediaResolver(session.opened),
    metrics: getFontMetrics(),
    slideNo: slideIndex + 1,
  })
}

export function rebuildSlideWithReparse(session: Session, slideIndex: number): RenderSlide | null {
  const fresh = materializeSlide(session.opened, slideIndex)
  if (!fresh) return null
  return buildRenderSlide(fresh, session.opened.deck.size, {
    fitWidthPx: session.fitWidthPx,
    media: makeMediaResolver(session.opened),
    metrics: getFontMetrics(),
    slideNo: slideIndex + 1,
  })
}

export function sessionDirty(session: Session): boolean {
  return (
    !!session.metaDirty ||
    session.opened.deck.slides.some(
      (s) => s.structureDirty || s.elements.some((el) => el.dirty || el.dirtyTransform),
    )
  )
}
