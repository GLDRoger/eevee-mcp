/**
 * Browser font metrics: bundled office fonts via opentype.js, HeuristicMetrics fallback.
 * Unknown faces substitute to a bundled family before heuristics so measuring and
 * drawing use the same file. Harfbuzz is not wired — complex scripts stay heuristic.
 */
import * as opentype from 'opentype.js'
import {
  graphemes,
  HeuristicMetrics,
  OpentypeMetrics,
  type FontMetricsProvider,
  type OpentypeFontLike,
  type RunStyle,
} from '@/office/engines/pptx-render'

const FONT_BASE = '/fonts/office'

/** Floor for a space (or tab) in the heuristic path — ~0.25em, never collapse words. */
export const MIN_SPACE_EM = 0.25

interface FaceSpec {
  family: string
  file: string
  bold: boolean
  italic: boolean
  /** True only when a parseable TrueType/OpenType file is shipped for this face. */
  opentype?: boolean
}

const FACES: readonly FaceSpec[] = [
  { family: 'Carlito', file: 'Carlito-Regular.ttf', bold: false, italic: false },
  { family: 'Carlito', file: 'Carlito-Bold.ttf', bold: true, italic: false },
  { family: 'Carlito', file: 'Carlito-Italic.ttf', bold: false, italic: true },
  { family: 'Carlito', file: 'Carlito-BoldItalic.ttf', bold: true, italic: true },
  { family: 'Caladea', file: 'Caladea-Regular.ttf', bold: false, italic: false },
  { family: 'Caladea', file: 'Caladea-Bold.ttf', bold: true, italic: false },
  { family: 'Caladea', file: 'Caladea-Italic.ttf', bold: false, italic: true },
  { family: 'Caladea', file: 'Caladea-BoldItalic.ttf', bold: true, italic: true },
  { family: 'Liberation Sans', file: 'LiberationSans-Regular.ttf', bold: false, italic: false },
  { family: 'Liberation Sans', file: 'LiberationSans-Bold.ttf', bold: true, italic: false },
  { family: 'Liberation Sans', file: 'LiberationSans-Italic.ttf', bold: false, italic: true },
  { family: 'Liberation Sans', file: 'LiberationSans-BoldItalic.ttf', bold: true, italic: true },
  { family: 'Liberation Serif', file: 'LiberationSerif-Regular.ttf', bold: false, italic: false },
  { family: 'Liberation Serif', file: 'LiberationSerif-Bold.ttf', bold: true, italic: false },
  { family: 'Liberation Serif', file: 'LiberationSerif-Italic.ttf', bold: false, italic: true },
  { family: 'Liberation Serif', file: 'LiberationSerif-BoldItalic.ttf', bold: true, italic: true },
  { family: 'Liberation Mono', file: 'LiberationMono-Regular.ttf', bold: false, italic: false },
  { family: 'Liberation Mono', file: 'LiberationMono-Bold.ttf', bold: true, italic: false },
  { family: 'Liberation Mono', file: 'LiberationMono-Italic.ttf', bold: false, italic: true },
  { family: 'Liberation Mono', file: 'LiberationMono-BoldItalic.ttf', bold: true, italic: true },
]

const BUNDLED = new Set([
  'Carlito',
  'Caladea',
  'Liberation Sans',
  'Liberation Serif',
  'Liberation Mono',
])

/**
 * Office / system names → bundled metric-compatible family (docs cssFontFamily
 * and the desktop slides alias table). Keys are matched after norm().
 */
const ALIASES: Record<string, string> = {
  aptos: 'Carlito',
  aptosdisplay: 'Carlito',
  aptosnarrow: 'Carlito',
  calibri: 'Carlito',
  calibrilight: 'Carlito',
  cambria: 'Caladea',
  cambriamath: 'Caladea',
  arial: 'Liberation Sans',
  helvetica: 'Liberation Sans',
  helveticaneue: 'Liberation Sans',
  timesnewroman: 'Liberation Serif',
  times: 'Liberation Serif',
  couriernew: 'Liberation Mono',
  courier: 'Liberation Mono',
  carlito: 'Carlito',
  caladea: 'Caladea',
  liberationsans: 'Liberation Sans',
  liberationserif: 'Liberation Serif',
  liberationmono: 'Liberation Mono',
}

const SERIF_RE =
  /serif|roman|garamond|georgia|cambria|caladea|palatino|baskerville|caslon|minion|lora/i
const MONO_RE = /mono|courier|consolas|menlo|monaco|code|typewriter/i

function norm(name: string): string {
  return name
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\s\-_]/g, '')
}

/** Map an unknown/unbundled face to the closest bundled family. */
export function substituteFamily(requested: string): string {
  const trimmed = requested.trim()
  if (!trimmed) return 'Carlito'
  const aliased = ALIASES[norm(trimmed)]
  if (aliased) return aliased
  if (BUNDLED.has(trimmed)) return trimmed
  if (MONO_RE.test(trimmed)) return 'Liberation Mono'
  if (SERIF_RE.test(trimmed)) return 'Liberation Serif'
  return 'Carlito'
}

type FaceKey = `${string}|${number}${number}`

export function faceKey(family: string, bold: boolean, italic: boolean): FaceKey {
  return `${norm(family)}|${bold ? 1 : 0}${italic ? 1 : 0}`
}

let loaded: Map<FaceKey, OpentypeFontLike> | null = null
let loadPromise: Promise<Map<FaceKey, OpentypeFontLike>> | null = null

function parseOpenType(bytes: ArrayBuffer): OpentypeFontLike {
  return opentype.parse(bytes) as unknown as OpentypeFontLike
}

function canvasFace(family: string, bold: boolean, italic: boolean): OpentypeFontLike | null {
  if (typeof document === 'undefined') return null
  const ctx = document.createElement('canvas').getContext('2d')
  if (!ctx) return null
  const css = `${italic ? 'italic ' : ''}${bold ? 'bold ' : ''}`
  return {
    unitsPerEm: 1000,
    ascender: 800,
    descender: -200,
    getAdvanceWidth(text: string, fontSize: number) {
      ctx.font = `${css}${fontSize}px "${family}"`
      return ctx.measureText(text).width
    },
  }
}

async function parseFace(spec: FaceSpec): Promise<OpentypeFontLike | null> {
  // Only the WOFF2 faces ship under public/fonts/office, and opentype.js 2.0
  // cannot parse WOFF2 without an external decompressor, so the TrueType
  // fetch was twenty 404s per presentation followed by a fallback. The
  // fallback is the path: CSS @font-face loads the WOFF2 and canvas measures
  // it. A .ttf next to the .woff2 re-enables exact opentype metrics.
  if (typeof fetch === 'function' && spec.opentype) {
    try {
      const res = await fetch(`${FONT_BASE}/${spec.file}`)
      if (res.ok) return wrapSafeAdvance(parseOpenType(await res.arrayBuffer()))
    } catch {
      /* fall through to CSS fonts */
    }
  }
  if (typeof document !== 'undefined' && document.fonts) {
    try {
      await document.fonts.load(
        `${spec.italic ? 'italic ' : ''}${spec.bold ? '700 ' : '400 '}16px "${spec.family}"`,
      )
      const face = canvasFace(spec.family, spec.bold, spec.italic)
      if (face && face.getAdvanceWidth('m', 16) > 0) return face
    } catch {
      /* FontFace not ready */
    }
  }
  return null
}

/**
 * Bypass opentype.js shaping in getAdvanceWidth (throws on some GSUB lookups and
 * the caller then heuristics the whole run, swallowing inter-word spaces).
 */
function wrapSafeAdvance(font: OpentypeFontLike): OpentypeFontLike {
  const f = font as OpentypeFontLike & {
    charToGlyph?(ch: string): { advanceWidth?: number }
    getKerningValue?(a: unknown, b: unknown): number
  }
  if (typeof f.charToGlyph !== 'function') return font
  return {
    unitsPerEm: font.unitsPerEm,
    ascender: font.ascender,
    descender: font.descender,
    ...(font.charToGlyphIndex
      ? { charToGlyphIndex: (ch: string) => font.charToGlyphIndex!(ch) }
      : {}),
    getAdvanceWidth(text: string, fontSize: number): number {
      let units = 0
      let prev: unknown = null
      for (const ch of text) {
        const glyph = f.charToGlyph!(ch)
        units += glyph?.advanceWidth ?? 0
        if (prev && typeof f.getKerningValue === 'function') {
          try {
            units += f.getKerningValue(prev, glyph) || 0
          } catch {
            /* kern miss */
          }
        }
        prev = glyph
      }
      return (units / font.unitsPerEm) * fontSize
    },
  }
}

/** Heuristic path that never collapses a space to zero advance. */
export class SafeHeuristicMetrics extends HeuristicMetrics {
  measure(text: string, style: RunStyle): number {
    const minSpace = MIN_SPACE_EM * style.fontSizePx * (style.bold ? 1.04 : 1)
    let width = 0
    for (const g of graphemes(text)) {
      if (g === ' ' || g === '\t') width += Math.max(super.measure(g, style), minSpace)
      else width += super.measure(g, style)
    }
    return width
  }
}

export function createOfficeMetrics(faces: Map<FaceKey, OpentypeFontLike>): FontMetricsProvider {
  const fallback = new SafeHeuristicMetrics()
  if (faces.size === 0) return fallback
  const inner = new OpentypeMetrics((style: RunStyle) => {
    const family = substituteFamily(style.fontFamily)
    return (
      faces.get(faceKey(family, style.bold, style.italic)) ??
      faces.get(faceKey(family, style.bold, false)) ??
      faces.get(faceKey(family, false, false)) ??
      faces.get(faceKey('Carlito', style.bold, style.italic)) ??
      faces.get(faceKey('Carlito', false, false))
    )
  }, fallback)
  return {
    metrics: (style) => inner.metrics(style),
    measure: (text, style) => inner.measure(text, style),
    displayFamily: (style) => substituteFamily(style.fontFamily),
  }
}

export async function loadOfficeFontMetrics(): Promise<FontMetricsProvider> {
  if (loaded) return createOfficeMetrics(loaded)
  loadPromise ??= (async () => {
    const map = new Map<FaceKey, OpentypeFontLike>()
    await Promise.all(
      FACES.map(async (spec) => {
        const font = await parseFace(spec)
        if (font) map.set(faceKey(spec.family, spec.bold, spec.italic), font)
      }),
    )
    loaded = map
    return map
  })()
  return createOfficeMetrics(await loadPromise)
}

export function heuristicFontMetrics(): FontMetricsProvider {
  return new SafeHeuristicMetrics()
}
