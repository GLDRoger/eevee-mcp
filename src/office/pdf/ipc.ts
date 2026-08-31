import type { DriveFileHandle } from '../host/storage'

export type MarkupType = 'highlight' | 'underline' | 'strikeout'

/** A text markup to write; quads are 4-point groups in PDF coords (y up) [x1,yTop,x2,yTop,x1,yBottom,x2,yBottom] */
export interface MarkupInput {
  pageIndex: number
  type: MarkupType
  /** rgb normalized to 0-1 */
  color: [number, number, number]
  quads: number[][]
}

/** Drawing annotations (all coords in PDF user space, y up).
    One union member per kind; a union-literal kind would break TS narrowing. */
interface DrawBase {
  pageIndex: number
  color: [number, number, number]
  width: number
}

export type DrawingInput =
  | (DrawBase & {
      kind: 'ink'
      /** Each stroke as [x1,y1,x2,y2,...] */
      paths: number[][]
    })
  | (DrawBase & { kind: 'rect'; rect: [number, number, number, number] })
  | (DrawBase & { kind: 'ellipse'; rect: [number, number, number, number] })
  | (DrawBase & { kind: 'line'; from: [number, number]; to: [number, number] })
  | (DrawBase & { kind: 'arrow'; from: [number, number]; to: [number, number] })
  | {
      kind: 'note'
      pageIndex: number
      color: [number, number, number]
      at: [number, number]
      contents: string
    }

/**
 * Stamp layer (watermark/header/footer/page numbers all go through it).
 * The renderer rasterizes the bitmap via canvas (with rotation and fonts, bypassing
 * pdf-lib's lack of CJK support); the main process only embeds and positions it.
 */
export interface StampInput {
  pageIndex: number
  /** base64 PNG, without the data: prefix */
  image: string
  /** PDF user space [x1,y1,x2,y2] */
  rect: [number, number, number, number]
  opacity?: number
}

/** Document info; an empty string clears the field */
export interface MetadataInput {
  title?: string
  author?: string
  subject?: string
  keywords?: string
}

export interface FormValueInput {
  name: string
  kind: 'text' | 'checkbox' | 'radio' | 'choice'
  /** For radio: selected exportValue; for choice: selected option; empty string clears selection */
  value?: string
  checked?: boolean
}

export interface SavePdfRequest {
  handle: DriveFileHandle
  /**
   * Save As destination. When set, `path` is only read (source bytes) and the edited PDF
   * is written to this path instead — the original file must never be mutated.
   * Must match the target granted to the view by the main process (save dialog pick).
   */
  targetName?: string
  markups: MarkupInput[]
  drawings: DrawingInput[]
  formValues: FormValueInput[]
  stamps: StampInput[]
  /** Page rotation deltas (original page index → multiple of 90 clockwise) */
  rotations?: { pageIndex: number; delta: number }[]
  /** Pages to delete (original page indices) */
  deletedPages?: number[]
  /** New page order (array of original page indices, excluding deleted); omitted if unreordered */
  pageOrder?: number[]
  metadata?: MetadataInput
}

export type SavePdfResult = { ok: true } | { ok: false; error: string }

/** Extract pages into a new PDF: main process shows a save dialog; cancel returns canceled */
export interface ExtractPagesRequest {
  handle: DriveFileHandle
  /** Original page indices */
  pages: number[]
  suggestedName: string
}

export type ExtractPagesResult =
  { ok: true; savedPath: string } | { ok: true; canceled: true } | { ok: false; error: string }

/** Insert (merge) another PDF after a page of the current file: main process shows a picker and writes back immediately */
export interface InsertPdfRequest {
  handle: DriveFileHandle
  /** Insert after this original page index; -1 means front of the document */
  afterPageIndex: number
}

export type InsertPdfResult =
  { ok: true; insertedCount: number } | { ok: true; canceled: true } | { ok: false; error: string }

/** Export pages as PNG: renderer rasterizes the bitmaps, main process shows a dialog and writes to disk */
export interface ExportImagesRequest {
  /** base64 PNGs (without the data: prefix), in page order */
  images: string[]
  /** 1-based page numbers, same length as images, used for file names */
  pageNumbers: number[]
  baseName: string
}

export type ExportImagesResult =
  | { ok: true; savedDir: string; count: number }
  | { ok: true; canceled: true }
  | { ok: false; error: string }
