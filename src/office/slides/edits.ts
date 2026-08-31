/**
 * Browser-native edit handlers for the absorbed Slides editor.
 * Session is client-side; Electron dialogs and native clipboard stay out.
 */
import {
  addChart,
  addElement,
  addMedia,
  addPicture,
  addSlideComment,
  addSmartArt,
  applyHeaderFooter,
  applyThemeToArchive,
  remapDeckColors,
  addTable,
  copyElementData,
  editPictureSrcRect,
  groupElements,
  ungroupElement,
  findGroupChild,
  editGroupChildTransform,
  patchGroupChildText,
  setGroupChildFont,
  editGroupChildFill,
  editGroupChildStroke,
  patchBodyPrAutofit,
  getElementLink,
  getSlideLinks,
  getRunLinks,
  ensureRunLinkRels,
  readHeaderFooter,
  setElementLink,
  deleteElement,
  deleteSlide,
  deleteSlideComment,
  duplicateSlide,
  copySlide,
  pasteSlide,
  insertBlankSlide,
  insertSlideWithLayout,
  listSlideLayouts,
  editTableCellText,
  editTableStructure,
  editTableStyle,
  ensureTableStylePart,
  editChartElement,
  markChartEditable,
  getChartElementData,
  materializeSlide,
  listMasterParts,
  parseMasterPart,
  patchSlideXml,
  TABLE_STYLE_PRESETS,
  setTableColWidth,
  type TableStructureOp,
  type TableStyleEdit,
  EMU_PER_PT,
  getSlideComments,
  getSlideNotes,
  getSlideTransition,
  elementSpid,
  getSlideAnimations,
  setSlideAnimations,
  type SlideAnimation,
  parseTheme,
  pasteElements,
  reorderElement,
  reparseDeck,
  commitSaved,
  setElementFont,
  replaceAllInDeck,
  mergeTableCells,
  setSlideLayout,
  resetSlideLayout,
  setSlideSize,
  setPictureOpacity,
  setElementConnection,
  updateConnectorsForMoved,
  setElementTextAnchor,
  setTableRowHeight,
  resizeTable,
  setTableCellAnchor,
  setElementParagraphFormat,
  setGroupChildParagraphFormat,
  setSlideBackground,
  setSlideAdvanceTime,
  setSlideHidden,
  setSlideNotes,
  setSlideTransition,
  getSections,
  setSections,
  addSection,
  renameSection,
  removeSection,
  moveSection,
  moveSlide,
  type SectionInfo,
  type ElementClipboardItem,
  type OpenedPptx,
  type Paragraph,
  type Slide,
  type TextElement,
} from '@/office/engines/pptx'
import { buildRenderSlide, EMU_PER_PX_96, type RenderSlide } from '@/office/engines/pptx-render'
import { applyEditParagraphs, collectParagraphFormatPatches, levelsChanged } from './edit-text'
import {
  buildAllRenderSlides,
  getFontMetrics,
  makeMediaResolver,
  pushHistory,
  rebuildSlide,
  rebuildSlideWithReparse,
  restoreSnapshot,
  takeSnapshot,
  type Session,
} from './session'
import type {
  AddChartOp,
  AddCommentOp,
  AddElementOp,
  AddImageBytesOp,
  AddInkOp,
  AddMediaBytesOp,
  AddBlankSlideOp,
  AddSlideOp,
  PasteSlideOp,
  RepasteSlideOp,
  AddSlideWithLayoutOp,
  AddSmartArtOp,
  AddTableOp,
  ApplyThemeOp,
  HeaderFooterOp,
  SetLinkOp,
  CopyElementsOp,
  DeleteCommentOp,
  DeleteElementOp,
  EditBackgroundOp,
  EditFillOp,
  EditStrokeOp,
  FlipElementOp,
  EditPictureSrcRectOp,
  GroupElementsOp,
  UngroupElementOp,
  BatchEditTransformOp,
  EditTextOp,
  EditTransformOp,
  EditConnectorEndpointsOp,
  SetElementFontOp,
  SetElementParagraphFormatOp,
  FindReplaceOp,
  TableMergeIpcOp,
  SetSlideLayoutOp,
  SetSlideSizeOp,
  MasterEditTextOp,
  MasterEditTransformOp,
  MasterEditFillOp,
  MasterEditStrokeOp,
  MasterDeleteElementOp,
  MasterEnterResult,
  EditPictureOpacityOp,
  PasteElementsOp,
  DuplicateElementsOp,
  EditTableCellOp,
  EditTableStyleOp,
  EditChartOp,
  SetTableColWidthOp,
  SetTableRowHeightOp,
  SetTableCellAnchorOp,
  TableStructureIpcOp,
  ReorderElementOp,
  SetAdvanceTimesOp,
  SetAnimationsOp,
  SetNotesOp,
  SetSlideHiddenOp,
  SetTransitionOp,
  AddSectionOp,
  RenameSectionOp,
  RemoveSectionOp,
  MoveSectionOp,
  MoveSlideOp,
  AnimationItem,
  ShapeKey,
} from './shared/ipc'

export interface HandlerCtx {
  session: Session | null
  setSession(session: Session): void
  elementClipboard: { items: ElementClipboardItem[]; pasteCount: number } | null
  lastSlidePaste: { afterIndex: number; undoLen: number } | null
}

function tMain(key: string, params?: Record<string, string | number>): string {
  const table: Record<string, string> = {
    schemeThemeDefault: 'Theme Default',
    schemeColorful: 'Colorful',
    schemeColorful2: 'Colorful 2',
    schemeMono: 'Monochromatic {n}',
    labelTextBox: 'Text Box',
    labelShape: 'Shape',
    labelPicture: 'Picture',
    labelGroup: 'Group',
    labelTable: 'Table',
    labelChart: 'Chart',
    labelObject: 'Object',
    chartSimplifyTitle: 'Editing will simplify this chart',
    chartSimplifyBody:
      'This chart came from another file. Editing rebuilds it in this app and drops some formatting.',
    chartSimplifyOk: 'Continue editing',
    untitledDeck: 'Untitled Presentation',
  }
  let s = table[key] ?? key
  if (params) {
    for (const [k, v] of Object.entries(params)) s = s.replace(`{${k}}`, String(v))
  }
  return s
}

function decodeBase64(value: string): Uint8Array {
  const binary = atob(value)
  const out = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i)
  return out
}

const mediaBlobUrls: string[] = []
function bytesToBlobUrl(bytes: Uint8Array, mime: string): string {
  const url = URL.createObjectURL(new Blob([bytes.slice()], { type: mime }))
  mediaBlobUrls.push(url)
  return url
}

let slideClipboard: { bundle: import('@/office/engines/pptx').SlideBundle; png?: string } | null =
  null

/** Theme body (minor) Latin font: fallback shown in the ribbon font box when the selection has no text element. */
export function deckDefaultFont(opened: OpenedPptx): string | undefined {
  try {
    const slidePath = opened.archive.readPresentation().slidePaths[0]
    if (!slidePath) return undefined
    const themePath = opened.archive.resolveSlideChain(slidePath).themePath
    const xml = themePath ? opened.archive.readText(themePath) : undefined
    return xml ? parseTheme(xml).minorFont : undefined
  } catch {
    return undefined
  }
}

function commentAuthorName(): string {
  return 'User'
}

function recolorFullBleedBackdrops(
  slide: Slide,
  size: { cx: number; cy: number },
  color: string,
): void {
  for (const el of slide.elements) {
    if (el.type !== 'shape' && el.type !== 'text') continue
    const shaped = el as TextElement
    const fillType = shaped.fill?.type
    if (fillType !== 'solid' && fillType !== 'gradient') continue
    if (shaped.text?.paragraphs.some((p) => p.runs.some((r) => r.text.trim()))) continue
    const { x, y, cx, cy } = el.transform.offset
    const coversX = x <= size.cx * 0.05 && x + cx >= size.cx * 0.95
    const coversY = y <= size.cy * 0.05 && y + cy >= size.cy * 0.95
    if (!coversX || !coversY) continue
    shaped.fill = { type: 'solid', color }
    shaped.dirtyFill = true
  }
}

function buildMasterRenderSlide(session: Session): RenderSlide | null {
  const me = session.masterEdit
  if (!me) return null
  return buildRenderSlide(me.slide, session.opened.deck.size, {
    fitWidthPx: session.fitWidthPx,
    media: makeMediaResolver(session.opened),
    metrics: getFontMetrics(),
  })
}

function commitMasterEdit(session: Session): void {
  const me = session.masterEdit!
  session.opened.archive.entries.set(me.partPath, new TextEncoder().encode(patchSlideXml(me.slide)))
  for (let i = 0; i < session.opened.deck.slides.length; i++) materializeSlide(session.opened, i)
  session.metaDirty = true
}

function findEl(slide: Slide, sourceId: string): TextElement | undefined {
  const el = slide.elements.find((e) => e.id === sourceId)
  if (el && (el.type === 'text' || el.type === 'shape')) return el as TextElement
  return undefined
}

/**
 * spAutoFit (autofit='resize', "resize shape to fit text"): after a text change, the box height
 * grows/shrinks with the content and is written back to cy. rendered = the
 * rebuilt result after this change; when the height changed, update the transform and rebuild
 * once more. Top-level elements only (group children use a different coordinate system, skip).
 */
function applyAutofitResize(
  session: Session,
  slideIndex: number,
  sourceId: string,
  rendered: RenderSlide | null,
): RenderSlide | null {
  if (!rendered) return rendered
  const slide = session.opened.deck.slides[slideIndex]
  const el = slide ? findEl(slide, sourceId) : undefined
  if (!el?.text || el.text.autofit !== 'resize') return rendered
  const node = rendered.nodes.find((n) => n.sourceId === sourceId)
  if (!node || (node.type !== 'shape' && node.type !== 'text') || !node.text) return rendered
  const needH = node.text.contentHeight + node.text.insets.t + node.text.insets.b
  if (Math.abs(needH - node.box.h) < 1) return rendered
  const baseWidthPx = session.opened.deck.size.cx / EMU_PER_PX_96
  const scale = session.fitWidthPx / baseWidthPx
  el.transform = {
    ...el.transform,
    offset: {
      ...el.transform.offset,
      cy: Math.max(Math.round((needH / scale) * EMU_PER_PX_96), 1),
    },
  }
  el.dirtyTransform = true
  return rebuildSlide(session, slideIndex)
}

/**
 * normAutofit fontScale write-back: when the shrink ratio the layout actually used after a text
 * edit (≤ the stored cap, shrink-only) differs from the stored model value, sync the model and
 * patch the bodyPr attribute — only then does PowerPoint show the same size on open.
 * Triggered only by text edits (resize gestures do not write: the layout cap locks the stored
 * value, and writing back during a gesture would ratchet one way); top-level elements only.
 */
function syncAutofitScale(
  session: Session,
  slideIndex: number,
  sourceId: string,
  rendered: RenderSlide | null,
): RenderSlide | null {
  if (!rendered) return rendered
  const slide = session.opened.deck.slides[slideIndex]
  const el = slide ? findEl(slide, sourceId) : undefined
  if (!el?.text || el.text.autofit !== 'shrink') return rendered
  const node = rendered.nodes.find((n) => n.sourceId === sourceId)
  if (!node || (node.type !== 'shape' && node.type !== 'text') || !node.text) return rendered
  const effective = node.text.fontScale
  const effectiveRed = node.text.lnSpcReduction ?? 0
  if (
    Math.abs(effective - (el.text.fontScale ?? 1)) < 0.005 &&
    Math.abs(effectiveRed - (el.text.lnSpcReduction ?? 0)) < 0.005
  )
    return rendered
  el.text.fontScale = effective
  if (effectiveRed) el.text.lnSpcReduction = effectiveRed
  else delete el.text.lnSpcReduction
  el.anchor.originalXml = patchBodyPrAutofit(el.anchor.originalXml, effective, effectiveRed)
  slide!.structureDirty = true
  return rendered // The layout already rendered with the effective value; no rebuild needed
}

/** Legacy fixed color schemes retained for old files. */
const CHART_COLOR_SCHEMES: Record<string, string[]> = {
  default: [],
  blue: ['#2E75B6', '#4472C4', '#5B9BD5', '#70AD47', '#ED7D31'],
  warm: ['#ED7D31', '#FFC000', '#FF0000', '#C55A11', '#833C00'],
  cool: ['#0070C0', '#00B0F0', '#00B0A0', '#7030A0', '#2E75B6'],
  mono: ['#404040', '#666666', '#888888', '#AAAAAA', '#CCCCCC'],
}

/** PowerPoint default theme accent sequence (fallback when the deck has no theme colors). */
const FALLBACK_ACCENTS = ['#4472C4', '#ED7D31', '#A5A5A5', '#FFC000', '#5B9BD5', '#70AD47']

/** Mix a hex color with black/white by ratio (for mono-gradient steps). */
function mixHex(hex: string, target: number, ratio: number): string {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(hex)
  if (!m) return hex
  const v = parseInt(m[1]!, 16)
  const ch = (x: number) => Math.round(x + (target - x) * ratio)
  const r = ch((v >> 16) & 255)
  const g = ch((v >> 8) & 255)
  const b = ch(v & 255)
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0').toUpperCase()}`
}

/** Current deck's theme accent1..6 (read from the theme part of the first slide's inheritance chain). */
function deckAccents(opened: OpenedPptx): string[] {
  const slide = opened.deck.slides[0]
  if (!slide) return FALLBACK_ACCENTS
  try {
    const chain = opened.archive.resolveSlideChain(slide.path)
    const xml = chain.themePath ? opened.archive.readText(chain.themePath) : null
    const colors = xml ? parseTheme(xml).colors : undefined
    const acc = ['accent1', 'accent2', 'accent3', 'accent4', 'accent5', 'accent6']
      .map((k) => colors?.[k])
      .filter((c): c is string => !!c)
    return acc.length >= 3 ? acc : FALLBACK_ACCENTS
  } catch {
    return FALLBACK_ACCENTS
  }
}

/** Theme-derived color schemes for the chart "Change Colors" gallery: two colorful sets + one mono gradient per accent. */
function chartColorSchemes(
  opened: OpenedPptx,
): Array<{ key: string; label: string; colors: string[] }> {
  const acc = deckAccents(opened)
  const rot = [...acc.slice(3), ...acc.slice(0, 3)]
  const mono = (c: string) => [
    mixHex(c, 0, 0.25),
    c,
    mixHex(c, 255, 0.25),
    mixHex(c, 255, 0.45),
    mixHex(c, 255, 0.65),
  ]
  return [
    { key: 'default', label: tMain('schemeThemeDefault'), colors: [] },
    { key: 'colorful', label: tMain('schemeColorful'), colors: acc },
    { key: 'colorful2', label: tMain('schemeColorful2'), colors: rot },
    ...acc.map((c, i) => ({
      key: `mono-accent${i + 1}`,
      label: tMain('schemeMono', { n: i + 1 }),
      colors: mono(c),
    })),
  ]
}

function performSlidePaste(
  session: Session,
  op: PasteSlideOp,
): { slides: RenderSlide[]; index: number; sourceId?: string } | null {
  if (!slideClipboard) return null
  if (op.mode === 'picture') {
    const { deck } = session.opened
    const anchorIndex = Math.min(Math.max(op.afterIndex, 0), deck.slides.length - 1)
    const slide = deck.slides[anchorIndex]
    if (!slide || !slideClipboard.png) return null
    const el = addPicture(session.opened, slide, {
      bytes: decodeBase64(slideClipboard.png),
      ext: 'png',
      offset: { x: 0, y: 0, cx: deck.size.cx, cy: deck.size.cy },
    })
    if (!el) return null
    session.fitWidthPx = op.fitWidthPx
    return {
      slides: buildAllRenderSlides(session.opened, op.fitWidthPx),
      index: anchorIndex,
      sourceId: el.id,
    }
  }
  const slide = pasteSlide(session.opened, op.afterIndex, slideClipboard.bundle, {
    keepSourceFormatting: op.mode === 'source',
  })
  if (!slide) return null
  session.fitWidthPx = op.fitWidthPx
  return {
    slides: buildAllRenderSlides(session.opened, op.fitWidthPx),
    index: session.opened.deck.slides.indexOf(slide),
  }
}

const AV_MIME: Record<string, string> = {
  mp4: 'video/mp4',
  m4v: 'video/mp4',
  // Chromium refuses to even load video/quicktime, but demuxes QuickTime bytes
  // fine through the ISO-BMFF path when served as video/mp4
  mov: 'video/mp4',
  webm: 'video/webm',
  avi: 'video/x-msvideo',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  m4a: 'audio/mp4',
  aac: 'audio/aac',
  ogg: 'audio/ogg',
}

export function createEditHandlers(ctx: HandlerCtx) {
  return {
    editText(op: EditTextOp) {
      const session = ctx.session
      if (!session) return null
      const slide = session.opened.deck.slides[op.slideIndex]
      if (!slide) return null
      // In-group editing: after updating a child's paragraphs, patch the text of the child slice inside the group's originalXml
      if (op.groupId) {
        const found = findGroupChild(slide, op.groupId, op.sourceId)
        const child = found?.child
        if (!child || (child.type !== 'text' && child.type !== 'shape')) return null
        const textChild = child as TextElement
        if (!textChild.text) return null
        pushHistory(session)
        textChild.text.paragraphs = applyEditParagraphs(textChild.text.paragraphs, op.paragraphs)
        ensureRunLinkRels(session.opened, op.slideIndex, textChild.text.paragraphs)
        if (!patchGroupChildText(slide, op.groupId, textChild)) {
          restoreSnapshot(session, session.undoStack.pop()!) // Slice not located: roll back the already-modified model
          return null
        }
        for (const { index, patch } of collectParagraphFormatPatches(op.paragraphs)) {
          setGroupChildParagraphFormat(slide, op.groupId, op.sourceId, patch, [index])
        }
        return rebuildSlide(session, op.slideIndex)
      }
      const el = findEl(slide, op.sourceId)
      if (!el || !el.text) return null
      pushHistory(session)
      // Run-level rich-text rebuild: srcPara/srcRun back-tracing + preserving unedited fields, see applyEditParagraphs
      const levelDirty = levelsChanged(el.text.paragraphs, op.paragraphs)
      el.text.paragraphs = applyEditParagraphs(el.text.paragraphs, op.paragraphs)
      ensureRunLinkRels(session.opened, op.slideIndex, el.text.paragraphs)
      el.dirty = true
      // Per-paragraph bullets/spacing marked on the editor selection
      for (const { index, patch } of collectParagraphFormatPatches(op.paragraphs)) {
        setElementParagraphFormat(slide, op.sourceId, patch, [index])
      }
      if (levelDirty) {
        // Level changes affect inheritance (font size/bullet/indent take master defaults by lvl); bake into bytes then reparse
        el.dirtyPPr = { ...el.dirtyPPr, level: true, indents: true }
        materializeSlide(session.opened, op.slideIndex)
        return rebuildSlide(session, op.slideIndex)
      }
      const rendered = applyAutofitResize(
        session,
        op.slideIndex,
        op.sourceId,
        rebuildSlide(session, op.slideIndex),
      )
      return syncAutofitScale(session, op.slideIndex, op.sourceId, rendered)
    },
    setElementFont(op: SetElementFontOp) {
      const session = ctx.session
      if (!session) return null
      const slide = session.opened.deck.slides[op.slideIndex]
      if (!slide) return null
      pushHistory(session)
      let changed = false
      for (const id of op.sourceIds) {
        const ok = op.groupId
          ? setGroupChildFont(slide, op.groupId, id, {
              fontFamily: op.fontFamily,
              fontSizePt: op.fontSizePt,
              strike: op.strike,
              bold: op.bold,
              italic: op.italic,
              underline: op.underline,
              color: op.color,
            })
          : setElementFont(slide, id, {
              fontFamily: op.fontFamily,
              fontSizePt: op.fontSizePt,
              strike: op.strike,
              bold: op.bold,
              italic: op.italic,
              underline: op.underline,
              color: op.color,
            })
        if (ok) changed = true
      }
      if (!changed) {
        session.undoStack.pop() // All non-text elements (images etc.): nothing happened, pop the just-pushed history
        return null
      }
      let rendered = rebuildSlide(session, op.slideIndex)
      for (const id of op.sourceIds) {
        rendered = applyAutofitResize(session, op.slideIndex, id, rendered)
        rendered = syncAutofitScale(session, op.slideIndex, id, rendered)
      }
      return rendered
    },
    setElementParagraphFormat(op: SetElementParagraphFormatOp) {
      const session = ctx.session
      if (!session) return null
      const slide = session.opened.deck.slides[op.slideIndex]
      if (!slide) return null
      pushHistory(session)
      const patch = {
        bullet: op.bullet,
        bulletChar: op.bulletChar,
        bulletHangEmu: op.bulletHangEmu,
        bulletSizePct: op.bulletSizePct,
        bulletColor: op.bulletColor,
        lineSpacingPct: op.lineSpacingPct,
        spaceBeforePt: op.spaceBeforePt,
        spaceAfterPt: op.spaceAfterPt,
        align: op.align,
        indentDelta: op.indentDelta,
      }
      let changed = false
      for (const id of op.sourceIds) {
        const ok = op.groupId
          ? setGroupChildParagraphFormat(slide, op.groupId, id, patch)
          : setElementParagraphFormat(slide, id, patch)
        if (ok) changed = true
      }
      if (!changed) {
        session.undoStack.pop()
        return null
      }
      if (op.indentDelta) {
        // Level changes affect inherited defaults; bake into bytes then reparse
        materializeSlide(session.opened, op.slideIndex)
        return rebuildSlide(session, op.slideIndex)
      }
      let rendered = rebuildSlide(session, op.slideIndex)
      for (const id of op.sourceIds) {
        rendered = applyAutofitResize(session, op.slideIndex, id, rendered)
        rendered = syncAutofitScale(session, op.slideIndex, id, rendered)
      }
      return rendered
    },
    editTransform(op: EditTransformOp) {
      const session = ctx.session
      if (!session) return null
      const slide = session.opened.deck.slides[op.slideIndex]
      if (!slide) return null
      const el = op.groupId ? null : slide.elements.find((x) => x.id === op.sourceId)
      const grpChild = op.groupId ? findGroupChild(slide, op.groupId, op.sourceId) : null
      if (!el && !grpChild) return null
      // Undo semantics for preview gestures: one whole drag = one undo step.
      // The first preview pushes a pre-gesture snapshot; later previews and the final commit do not.
      if (op.preview) {
        if (!session.transformPreview) {
          pushHistory(session)
          session.transformPreview = true
        }
      } else if (session.transformPreview) {
        session.transformPreview = false
      } else {
        pushHistory(session)
      }
      // px -> EMU (inverting the viewport scale)
      const baseWidthPx = session.opened.deck.size.cx / EMU_PER_PX_96
      const scale = op.fitWidthPx / baseWidthPx
      const toEmu = (px: number) => Math.round((px / scale) * EMU_PER_PX_96)
      // In-group editing: the pixel box is in group-local coords (with ext/chExt scaling baked in); divide out the group scale first, then convert back to the child EMU coordinate system
      if (grpChild) {
        const ch = grpChild.grp.childOffset
        const chX = ch?.x ?? grpChild.grp.transform.offset.x
        const chY = ch?.y ?? grpChild.grp.transform.offset.y
        const gExt = grpChild.grp.transform.offset
        const gsx = ch?.cx ? gExt.cx / ch.cx : 1
        const gsy = ch?.cy ? gExt.cy / ch.cy : 1
        const ok = editGroupChildTransform(
          slide,
          op.groupId!,
          op.sourceId,
          {
            x: toEmu(op.xPx / gsx) + chX,
            y: toEmu(op.yPx / gsy) + chY,
            cx: toEmu(op.wPx / gsx),
            cy: toEmu(op.hPx / gsy),
          },
          op.rotationDeg,
        )
        if (!ok) {
          session.undoStack.pop() // Slice not located: model untouched, pop the just-pushed history
          return null
        }
        return rebuildSlide(session, op.slideIndex)
      }
      // Tables: redistribute gridCol widths / tr heights so the file matches the
      // frame instead of keeping the old grid under a new a:ext
      const isTable = el!.type === 'table'
      if (isTable) resizeTable(slide, op.sourceId, toEmu(op.wPx), toEmu(op.hPx))
      el!.transform = {
        ...el!.transform,
        offset: {
          x: toEmu(op.xPx),
          y: toEmu(op.yPx),
          // resizeTable synced cx/cy to the redistributed sums
          cx: isTable ? el!.transform.offset.cx : toEmu(op.wPx),
          cy: isTable ? el!.transform.offset.cy : toEmu(op.hPx),
        },
        rot: Math.round(op.rotationDeg * 60000),
      }
      el!.dirtyTransform = true
      updateConnectorsForMoved(slide, [op.sourceId])
      return rebuildSlide(session, op.slideIndex)
    },
    editConnectorEndpoints(op: EditConnectorEndpointsOp) {
      const session = ctx.session
      if (!session) return null
      const slide = session.opened.deck.slides[op.slideIndex]
      if (!slide) return null
      const el = slide.elements.find((x) => x.id === op.sourceId)
      if (!el) return null
      pushHistory(session)
      const baseWidthPx = session.opened.deck.size.cx / EMU_PER_PX_96
      const scale = op.fitWidthPx / baseWidthPx
      const toEmu = (px: number) => Math.round((px / scale) * EMU_PER_PX_96)
      const p1 = { x: toEmu(op.x1Px), y: toEmu(op.y1Px) }
      const p2 = { x: toEmu(op.x2Px), y: toEmu(op.y2Px) }
      el.transform = {
        ...el.transform,
        offset: {
          x: Math.min(p1.x, p2.x),
          y: Math.min(p1.y, p2.y),
          cx: Math.abs(p2.x - p1.x),
          cy: Math.abs(p2.y - p1.y),
        },
        rot: 0,
        flipH: p1.x > p2.x,
        flipV: p1.y > p2.y,
      }
      el.dirtyTransform = true
      const toRef = (
        v: { targetId: string; idx: number } | null | undefined,
      ): { id: number; idx: number } | null | undefined => {
        if (v === undefined) return undefined
        if (v === null) return null
        const target = slide.elements.find((x) => x.id === v.targetId)
        const spid = target ? elementSpid(target) : null
        return spid != null ? { id: spid, idx: v.idx } : null
      }
      setElementConnection(slide, op.sourceId, { start: toRef(op.start), end: toRef(op.end) })
      return rebuildSlide(session, op.slideIndex)
    },
    getRenderSlides() {
      const session = ctx.session
      if (!session) return null
      return session.opened.deck.slides.map((_, i) => rebuildSlide(session, i))
    },
    batchEditTransform(op: BatchEditTransformOp) {
      const session = ctx.session
      if (!session) return null
      const slide = session.opened.deck.slides[op.slideIndex]
      if (!slide) return null
      const baseWidthPx = session.opened.deck.size.cx / EMU_PER_PX_96
      const scale = op.fitWidthPx / baseWidthPx
      const toEmu = (px: number) => Math.round((px / scale) * EMU_PER_PX_96)
      // Validate: every element must exist
      const pairs: Array<{
        el: (typeof slide.elements)[0]
        item: BatchEditTransformOp['items'][0]
      }> = []
      for (const item of op.items) {
        const el = slide.elements.find((x) => x.id === item.sourceId)
        if (!el) return null
        pairs.push({ el, item })
      }
      pushHistory(session)
      for (const { el, item } of pairs) {
        el.transform = {
          ...el.transform,
          offset: {
            x: toEmu(item.xPx),
            y: toEmu(item.yPx),
            cx: toEmu(item.wPx),
            cy: toEmu(item.hPx),
          },
          rot: Math.round(item.rotationDeg * 60000),
        }
        el.dirtyTransform = true
      }
      updateConnectorsForMoved(
        slide,
        op.items.map((i) => i.sourceId),
      )
      return rebuildSlide(session, op.slideIndex)
    },
    addElement(op: AddElementOp) {
      const session = ctx.session
      if (!session) return null
      const slide = session.opened.deck.slides[op.slideIndex]
      if (!slide) return null
      pushHistory(session)
      const baseWidthPx = session.opened.deck.size.cx / EMU_PER_PX_96
      const scale = op.fitWidthPx / baseWidthPx
      const toEmu = (px: number) => Math.round((px / scale) * EMU_PER_PX_96)
      const paragraphs: Paragraph[] | undefined = op.paragraphs?.length
        ? (op.paragraphs as Paragraph[])
        : op.text
          ? op.text.split('\n').map((line) => ({ runs: [{ text: line }] }))
          : undefined
      const el = addElement(slide, {
        kind: op.kind,
        offset: { x: toEmu(op.xPx), y: toEmu(op.yPx), cx: toEmu(op.wPx), cy: toEmu(op.hPx) },
        ...(paragraphs ? { paragraphs } : {}),
        ...(op.fillColor ? { fillColor: op.fillColor } : {}),
        ...(op.stroke
          ? {
              stroke: {
                color: op.stroke.color,
                widthEmu: Math.round(op.stroke.widthPt * EMU_PER_PT),
              },
            }
          : {}),
      })
      const rebuilt = rebuildSlide(session, op.slideIndex)
      return rebuilt ? { slide: rebuilt, sourceId: el.id } : null
    },
    deleteElement(op: DeleteElementOp) {
      const session = ctx.session
      if (!session) return null
      const slide = session.opened.deck.slides[op.slideIndex]
      if (!slide) return null
      if (!slide.elements.some((x) => x.id === op.sourceId)) return null
      pushHistory(session)
      if (!deleteElement(slide, op.sourceId)) return null
      return rebuildSlide(session, op.slideIndex)
    },
    editStroke(op: EditStrokeOp) {
      const session = ctx.session
      if (!session) return null
      const slide = session.opened.deck.slides[op.slideIndex]
      if (!slide) return null
      if (op.groupId) {
        pushHistory(session)
        const stroke = op.stroke
          ? {
              color: op.stroke.color,
              widthEmu: Math.round(op.stroke.widthPt * EMU_PER_PT),
              ...(op.stroke.dash ? { dash: op.stroke.dash } : {}),
            }
          : null
        if (!editGroupChildStroke(slide, op.groupId, op.sourceId, stroke)) {
          session.undoStack.pop()
          return null
        }
        return rebuildSlide(session, op.slideIndex)
      }
      const el = findEl(slide, op.sourceId)
      if (!el) return null
      pushHistory(session)
      el.stroke = op.stroke
        ? {
            fill: { type: 'solid', color: op.stroke.color },
            width: Math.round(op.stroke.widthPt * EMU_PER_PT),
            ...(op.stroke.dash ? { dash: op.stroke.dash } : {}),
          }
        : undefined
      el.dirtyStroke = true
      return rebuildSlide(session, op.slideIndex)
    },
    flipElements(op: FlipElementOp) {
      const session = ctx.session
      if (!session) return null
      const slide = session.opened.deck.slides[op.slideIndex]
      if (!slide) return null
      const targets = op.sourceIds
        .map((id) =>
          op.groupId ? findGroupChild(slide, op.groupId, id)?.child : findEl(slide, id),
        )
        .filter((el): el is NonNullable<typeof el> => !!el)
      if (targets.length === 0) return null
      pushHistory(session)
      for (const el of targets) {
        if (op.axis === 'h') el.transform.flipH = !el.transform.flipH
        else el.transform.flipV = !el.transform.flipV
        el.dirtyTransform = true
      }
      updateConnectorsForMoved(
        slide,
        targets.map((el) => el.id),
      )
      return rebuildSlide(session, op.slideIndex)
    },
    editPictureSrcRect(op: EditPictureSrcRectOp) {
      const session = ctx.session
      if (!session) return null
      const slide = session.opened.deck.slides[op.slideIndex]
      if (!slide) return null
      pushHistory(session)
      if (!editPictureSrcRect(slide, op.sourceId, op.srcRect)) {
        session.undoStack.pop()
        return null
      }
      return rebuildSlide(session, op.slideIndex)
    },
    groupElements(op: GroupElementsOp) {
      const session = ctx.session
      if (!session) return null
      pushHistory(session)
      const result = groupElements(session.opened, op.slideIndex, op.sourceIds)
      if (!result) {
        session.undoStack.pop()
        return null
      }
      // groupElements already updated deck.slides[slideIndex] internally via materializeSlide
      const renderSlide = rebuildSlide(session, op.slideIndex)
      return renderSlide ? { slide: renderSlide, groupId: result.groupId } : null
    },
    ungroupElement(op: UngroupElementOp) {
      const session = ctx.session
      if (!session) return null
      pushHistory(session)
      const fresh = ungroupElement(session.opened, op.slideIndex, op.sourceId)
      if (!fresh) {
        session.undoStack.pop()
        return null
      }
      // ungroupElement already updated deck.slides[slideIndex] internally
      return rebuildSlide(session, op.slideIndex)
    },
    editBackground(op: EditBackgroundOp) {
      const session = ctx.session
      if (!session) return null
      const slides = session.opened.deck.slides
      const targets = op.slideIndex === -1 ? slides : [slides[op.slideIndex]].filter(Boolean)
      if (targets.length === 0) return null
      pushHistory(session)
      for (const s of targets) {
        setSlideBackground(s!, op.color)
        recolorFullBleedBackdrops(s!, session.opened.deck.size, op.color)
      }
      session.fitWidthPx = op.fitWidthPx
      return buildAllRenderSlides(session.opened, op.fitWidthPx)
    },
    editFill(op: EditFillOp) {
      const session = ctx.session
      if (!session) return null
      const slide = session.opened.deck.slides[op.slideIndex]
      if (!slide) return null
      if (op.groupId) {
        pushHistory(session)
        const fill =
          typeof op.fill === 'string'
            ? op.fill
            : {
                stops: [
                  { pos: 0, color: op.fill.gradient.from },
                  { pos: 1, color: op.fill.gradient.to },
                ],
                ...(op.fill.gradient.radial
                  ? { radial: true }
                  : { angle: Math.round((op.fill.gradient.angleDeg ?? 0) * 60000) }),
              }
        if (!editGroupChildFill(slide, op.groupId, op.sourceId, fill)) {
          session.undoStack.pop()
          return null
        }
        return rebuildSlide(session, op.slideIndex)
      }
      const el = findEl(slide, op.sourceId)
      if (!el) return null
      pushHistory(session)
      if (typeof op.fill === 'string') {
        el.fill = op.fill === 'none' ? { type: 'none' } : { type: 'solid', color: op.fill }
      } else {
        const g = op.fill.gradient
        el.fill = {
          type: 'gradient',
          stops: [
            { pos: 0, color: g.from },
            { pos: 1, color: g.to },
          ],
          ...(g.radial
            ? { path: 'circle' as const }
            : { angle: Math.round((g.angleDeg ?? 0) * 60000) }),
        }
      }
      el.dirtyFill = true
      return rebuildSlide(session, op.slideIndex)
    },
    addSlide(op: AddSlideOp) {
      const session = ctx.session
      if (!session) return null
      pushHistory(session)
      const slide = duplicateSlide(session.opened, op.sourceIndex, { clearText: !!op.clearText })
      if (!slide) {
        session.undoStack.pop()
        return null
      }
      session.fitWidthPx = op.fitWidthPx
      session.metaDirty = true
      return {
        slides: buildAllRenderSlides(session.opened, op.fitWidthPx),
        index: op.sourceIndex + 1,
      }
    },
    copySlide(slideIndex: number, pngBase64?: string) {
      const session = ctx.session
      if (!session) return false
      const bundle = copySlide(session.opened, slideIndex)
      if (!bundle) return false
      slideClipboard = { bundle, ...(pngBase64 ? { png: pngBase64 } : {}) }
      // Marker so plain ⌘V knows the latest copy was a slide (element copies / external copies overwrite it)

      return true
    },
    hasSlideClipboard() {
      return slideClipboard !== null
    },
    pasteSlide(op: PasteSlideOp) {
      const session = ctx.session
      if (!session || !slideClipboard) return null
      pushHistory(session)
      const r = performSlidePaste(session, op)
      if (!r) {
        session.undoStack.pop()
        return null
      }
      session.metaDirty = true
      ctx.lastSlidePaste = {
        afterIndex: op.afterIndex,
        undoLen: session.undoStack.length,
      }
      return r
    },
    repasteSlide(op: RepasteSlideOp) {
      const session = ctx.session
      const rec = ctx.lastSlidePaste
      if (!session || !slideClipboard || !rec) return null
      if (session.undoStack.length !== rec.undoLen) return null
      const snap = session.undoStack.pop()
      if (!snap) return null
      restoreSnapshot(session, snap)
      pushHistory(session)
      const r = performSlidePaste(session, {
        afterIndex: rec.afterIndex,
        fitWidthPx: op.fitWidthPx,
        mode: op.mode,
      })
      if (!r) {
        session.undoStack.pop()
        return null
      }
      session.metaDirty = true
      rec.undoLen = session.undoStack.length
      return r
    },
    addBlankSlide(op: AddBlankSlideOp) {
      const session = ctx.session
      if (!session) return null
      pushHistory(session)
      const slide = insertBlankSlide(session.opened, op.sourceIndex)
      if (!slide) {
        session.undoStack.pop()
        return null
      }
      session.fitWidthPx = op.fitWidthPx
      session.metaDirty = true
      return {
        slides: buildAllRenderSlides(session.opened, op.fitWidthPx),
        index: op.sourceIndex + 1,
      }
    },
    addSlideWithLayout(op: AddSlideWithLayoutOp) {
      const session = ctx.session
      if (!session) return null
      pushHistory(session)
      const slide = insertSlideWithLayout(session.opened, op.sourceIndex, op.layoutPath)
      if (!slide) {
        session.undoStack.pop()
        return null
      }
      session.fitWidthPx = op.fitWidthPx
      session.metaDirty = true
      return {
        slides: buildAllRenderSlides(session.opened, op.fitWidthPx),
        index: op.sourceIndex + 1,
      }
    },
    getLayouts() {
      const session = ctx.session
      if (!session) return null
      const layouts = listSlideLayouts(session.opened.archive)
      return { layouts }
    },
    masterEnter(fitWidthPx: number): MasterEnterResult | null {
      const session = ctx.session
      if (!session) return null
      session.fitWidthPx = fitWidthPx
      const items: MasterEnterResult['items'] = []
      for (const p of listMasterParts(session.opened.archive)) {
        const slide = parseMasterPart(session.opened.archive, p.partPath)
        if (!slide) continue
        const rendered = buildRenderSlide(slide, session.opened.deck.size, {
          fitWidthPx,
          media: makeMediaResolver(session.opened),
          metrics: getFontMetrics(),
        })
        items.push({ partPath: p.partPath, kind: p.kind, name: p.name, slide: rendered })
        if (!session.masterEdit) session.masterEdit = { partPath: p.partPath, slide }
      }
      return items.length ? { items } : null
    },
    masterOpen(partPath: string) {
      const session = ctx.session
      if (!session) return null
      const slide = parseMasterPart(session.opened.archive, partPath)
      if (!slide) return null
      session.masterEdit = { partPath, slide }
      return buildMasterRenderSlide(session)
    },
    masterClose() {
      const session = ctx.session
      if (!session) return null
      session.masterEdit = null
      // Edits were materialized one by one; here we only fetch the full render tree
      return buildAllRenderSlides(session.opened, session.fitWidthPx)
    },
    masterEditText(op: MasterEditTextOp) {
      const session = ctx.session
      const me = session?.masterEdit
      if (!session || !me) return null
      const el = findEl(me.slide, op.sourceId)
      if (!el?.text) return null
      pushHistory(session)
      el.text.paragraphs = applyEditParagraphs(el.text.paragraphs, op.paragraphs)
      el.dirty = true
      commitMasterEdit(session)
      return buildMasterRenderSlide(session)
    },
    masterEditTransform(op: MasterEditTransformOp) {
      const session = ctx.session
      const me = session?.masterEdit
      if (!session || !me) return null
      const el = me.slide.elements.find((x) => x.id === op.sourceId)
      if (!el) return null
      if (op.preview) {
        if (!session.transformPreview) {
          pushHistory(session)
          session.transformPreview = true
        }
      } else if (session.transformPreview) {
        session.transformPreview = false
      } else {
        pushHistory(session)
      }
      const baseWidthPx = session.opened.deck.size.cx / EMU_PER_PX_96
      const scale = op.fitWidthPx / baseWidthPx
      const toEmu = (px: number) => Math.round((px / scale) * EMU_PER_PX_96)
      el.transform = {
        ...el.transform,
        offset: { x: toEmu(op.xPx), y: toEmu(op.yPx), cx: toEmu(op.wPx), cy: toEmu(op.hPx) },
        rot: Math.round(op.rotationDeg * 60000),
      }
      el.dirtyTransform = true
      // Previews are not persisted (only the final commit at drag end writes the entry + full reparse)
      if (!op.preview) commitMasterEdit(session)
      return buildMasterRenderSlide(session)
    },
    masterEditFill(op: MasterEditFillOp) {
      const session = ctx.session
      const me = session?.masterEdit
      if (!session || !me) return null
      const el = findEl(me.slide, op.sourceId)
      if (!el) return null
      pushHistory(session)
      if (typeof op.fill === 'string') {
        el.fill = op.fill === 'none' ? { type: 'none' } : { type: 'solid', color: op.fill }
      } else {
        const g = op.fill.gradient
        el.fill = {
          type: 'gradient',
          stops: [
            { pos: 0, color: g.from },
            { pos: 1, color: g.to },
          ],
          ...(g.radial
            ? { path: 'circle' as const }
            : { angle: Math.round((g.angleDeg ?? 0) * 60000) }),
        }
      }
      el.dirtyFill = true
      commitMasterEdit(session)
      return buildMasterRenderSlide(session)
    },
    masterEditStroke(op: MasterEditStrokeOp) {
      const session = ctx.session
      const me = session?.masterEdit
      if (!session || !me) return null
      const el = findEl(me.slide, op.sourceId)
      if (!el) return null
      pushHistory(session)
      el.stroke = op.stroke
        ? {
            fill: { type: 'solid', color: op.stroke.color },
            width: Math.round(op.stroke.widthPt * EMU_PER_PT),
          }
        : undefined
      el.dirtyStroke = true
      commitMasterEdit(session)
      return buildMasterRenderSlide(session)
    },
    masterDeleteElement(op: MasterDeleteElementOp) {
      const session = ctx.session
      const me = session?.masterEdit
      if (!session || !me) return null
      if (!me.slide.elements.some((x) => x.id === op.sourceId)) return null
      pushHistory(session)
      if (!deleteElement(me.slide, op.sourceId)) {
        session.undoStack.pop()
        return null
      }
      commitMasterEdit(session)
      return buildMasterRenderSlide(session)
    },
    editPictureOpacity(op: EditPictureOpacityOp) {
      const session = ctx.session
      if (!session) return null
      const slide = session.opened.deck.slides[op.slideIndex]
      if (!slide) return null
      pushHistory(session)
      if (!setPictureOpacity(slide, op.sourceId, op.opacity)) {
        session.undoStack.pop()
        return null
      }
      return rebuildSlide(session, op.slideIndex)
    },
    setSlideSize(op: SetSlideSizeOp) {
      const session = ctx.session
      if (!session) return null
      pushHistory(session)
      if (!setSlideSize(session.opened, op.cx, op.cy)) {
        session.undoStack.pop()
        return null
      }
      session.metaDirty = true
      return buildAllRenderSlides(session.opened, session.fitWidthPx)
    },
    getSlideSize() {
      const session = ctx.session
      return session ? { ...session.opened.deck.size } : null
    },
    setSlideLayout(op: SetSlideLayoutOp) {
      const session = ctx.session
      if (!session) return null
      pushHistory(session)
      const r = op.layoutPath
        ? setSlideLayout(session.opened, op.slideIndex, op.layoutPath)
        : resetSlideLayout(session.opened, op.slideIndex)
      if (!r) {
        session.undoStack.pop()
        return null
      }
      return rebuildSlide(session, op.slideIndex)
    },
    findReplace(op: FindReplaceOp) {
      const session = ctx.session
      if (!session) return null
      pushHistory(session)
      const { count } = replaceAllInDeck(session.opened.deck, op.find, op.replace, {
        matchCase: op.matchCase,
        firstOnly: op.firstOnly,
        slideIndex: op.slideIndex,
        elementId: op.elementId,
      })
      if (!count) {
        session.undoStack.pop()
        return { count: 0, slides: null }
      }
      return { count, slides: buildAllRenderSlides(session.opened, session.fitWidthPx) }
    },
    deleteSlide(slideIndex: number) {
      const session = ctx.session
      if (!session) return null
      pushHistory(session)
      if (!deleteSlide(session.opened, slideIndex)) {
        session.undoStack.pop()
        return null
      }
      session.metaDirty = true
      return buildAllRenderSlides(session.opened, session.fitWidthPx)
    },
    editTableCell(op: EditTableCellOp) {
      const session = ctx.session
      if (!session) return null
      const slide = session.opened.deck.slides[op.slideIndex]
      if (!slide) return null
      pushHistory(session)
      if (!editTableCellText(slide, op.sourceId, op.row, op.col, op.paragraphs as Paragraph[])) {
        session.undoStack.pop()
        return null
      }
      return rebuildSlide(session, op.slideIndex)
    },
    tableMerge(op: TableMergeIpcOp) {
      const session = ctx.session
      if (!session) return null
      pushHistory(session)
      const r = mergeTableCells(session.opened, op.slideIndex, op.sourceId, {
        kind: op.kind,
        row: op.row,
        col: op.col,
      })
      if (!r) {
        session.undoStack.pop()
        return null
      }
      const rebuilt = rebuildSlide(session, op.slideIndex)
      return rebuilt ? { slide: rebuilt, sourceId: r.elementId } : null
    },
    tableStructure(op: TableStructureIpcOp) {
      const session = ctx.session
      if (!session) return null
      pushHistory(session)
      const r = editTableStructure(session.opened, op.slideIndex, op.sourceId, {
        kind: op.kind,
        index: op.index,
        ...(op.before ? { before: true } : {}),
      } as TableStructureOp)
      if (!r) {
        session.undoStack.pop()
        return null
      }
      const rebuilt = rebuildSlide(session, op.slideIndex)
      return rebuilt ? { slide: rebuilt, sourceId: r.elementId } : null
    },
    setTableRowHeight(op: SetTableRowHeightOp) {
      const session = ctx.session
      if (!session) return null
      const slide = session.opened.deck.slides[op.slideIndex]
      if (!slide) return null
      const baseWidthPx = session.opened.deck.size.cx / EMU_PER_PX_96
      const scale = op.fitWidthPx / baseWidthPx
      pushHistory(session)
      if (!setTableRowHeight(slide, op.sourceId, op.row, (op.hPx / scale) * EMU_PER_PX_96)) {
        session.undoStack.pop()
        return null
      }
      return rebuildSlide(session, op.slideIndex)
    },
    setTableCellAnchor(op: SetTableCellAnchorOp) {
      const session = ctx.session
      if (!session) return null
      const slide = session.opened.deck.slides[op.slideIndex]
      if (!slide) return null
      pushHistory(session)
      if (!setTableCellAnchor(slide, op.sourceId, op.row, op.col, op.anchor)) {
        session.undoStack.pop()
        return null
      }
      return rebuildSlide(session, op.slideIndex)
    },
    setTableColWidth(op: SetTableColWidthOp) {
      const session = ctx.session
      if (!session) return null
      const slide = session.opened.deck.slides[op.slideIndex]
      if (!slide) return null
      const baseWidthPx = session.opened.deck.size.cx / EMU_PER_PX_96
      const scale = op.fitWidthPx / baseWidthPx
      pushHistory(session)
      if (!setTableColWidth(slide, op.sourceId, op.col, (op.wPx / scale) * EMU_PER_PX_96)) {
        session.undoStack.pop()
        return null
      }
      return rebuildSlide(session, op.slideIndex)
    },
    editTableStyle(op: EditTableStyleOp) {
      const session = ctx.session
      if (!session) return null
      const slide = session.opened.deck.slides[op.slideIndex]
      if (!slide) return null
      // A reparse regenerates element ids: look up the new id by element index; the renderer uses it to keep the selection
      const elIdx = slide.elements.findIndex((el) => el.id === op.sourceId)
      pushHistory(session)
      // Parse op -> TableStyleEdit
      let edit: TableStyleEdit
      if (op.styleName && TABLE_STYLE_PRESETS[op.styleName]) {
        const preset = TABLE_STYLE_PRESETS[op.styleName]!
        // Inject fixed-color presets' style definitions into tableStyles.xml (built-in GUIDs track theme colors, so colors would drift)
        if (preset.styleId && preset.styleDefXml) {
          ensureTableStylePart(session.opened, preset.styleId, preset.styleDefXml)
        }
        // Applying a style-gallery preset in PowerPoint clears cells' direct fills/borders; otherwise direct formatting hides the style
        edit = {
          tblPrXml: preset.tblPrXml,
          clearDirectFormatting: true,
          // Grid-style presets use direct borders (the style mechanism only has inner lines and cannot draw the outer frame)
          ...(preset.border
            ? {
                borderPreset: 'all' as const,
                borderColor: preset.border.color,
                borderWidthEmu: preset.border.widthEmu,
              }
            : {}),
        }
      } else {
        const borderColor = op.borderColor ?? undefined
        const borderWidthEmu =
          op.borderWidthPt != null ? Math.round(op.borderWidthPt * EMU_PER_PT) : undefined
        edit = {
          ...(op.firstRow !== undefined ? { firstRow: op.firstRow } : {}),
          ...(op.bandRow !== undefined ? { bandRow: op.bandRow } : {}),
          ...(op.shadingColor !== undefined ? { shadingColor: op.shadingColor } : {}),
          ...(op.borderPreset !== undefined ? { borderPreset: op.borderPreset } : {}),
          ...(borderColor !== undefined ? { borderColor } : {}),
          ...(borderWidthEmu !== undefined ? { borderWidthEmu } : {}),
          ...(op.cells ? { cells: op.cells } : {}),
        }
      }
      if (!editTableStyle(slide, op.sourceId, edit)) {
        session.undoStack.pop()
        return null
      }
      // The patch is written on anchor.originalXml; a materialize reparse is needed before it shows in the render model
      const rebuilt = rebuildSlideWithReparse(session, op.slideIndex)
      if (!rebuilt) return null
      const newId = session.opened.deck.slides[op.slideIndex]?.elements[elIdx]?.id ?? null
      return { slide: rebuilt, sourceId: newId }
    },
    async editChart(op: EditChartOp) {
      const session = ctx.session
      if (!session) return null
      const slide = session.opened.deck.slides[op.slideIndex]
      if (!slide) return null
      // A reparse regenerates element ids: look up the new id by element index; the renderer uses it to keep the selection
      const elIdx = slide.elements.findIndex((el) => el.id === op.sourceId)
      // Confirm before the first edit of a chart from an imported file: editing rebuilds it from the template,
      // and unmodeled fine-grained formatting (number formats/trendlines/error bars/per-point styles) is lost
      const chartEl = slide.elements[elIdx] as { type?: string; descr?: string } | undefined
      if (chartEl?.type === 'chart' && chartEl.descr !== 'aislides-chart') {
        if (!window.confirm(`${tMain('chartSimplifyTitle')}\n\n${tMain('chartSimplifyBody')}`)) {
          return null
        }
      }
      pushHistory(session)
      // Mark aislides-chart on first edit (the conversion itself is lossless; no re-prompt after one confirmation)
      markChartEditable(slide, op.sourceId)
      const patch: Parameters<typeof editChartElement>[3] = {
        ...(op.kind ? { kind: op.kind === 'barH' ? 'bar' : op.kind } : {}),
        ...(op.kind === 'barH' ? { barDir: 'bar' as const } : {}),
        ...(op.categories ? { categories: op.categories } : {}),
        ...(op.series ? { series: op.series } : {}),
        ...(op.title !== undefined ? { title: op.title } : {}),
        ...(op.colorScheme
          ? {
              colorScheme:
                chartColorSchemes(session.opened).find((s) => s.key === op.colorScheme)?.colors ??
                CHART_COLOR_SCHEMES[op.colorScheme],
            }
          : {}),
        ...(op.legendPos ? { legendPos: op.legendPos } : {}),
        ...(op.dataLabels !== undefined ? { dataLabels: op.dataLabels } : {}),
        ...(op.gridlines !== undefined ? { gridlines: op.gridlines } : {}),
        ...(op.catAxisTitle !== undefined ? { catAxisTitle: op.catAxisTitle } : {}),
        ...(op.valAxisTitle !== undefined ? { valAxisTitle: op.valAxisTitle } : {}),
        ...(op.gapWidthPct !== undefined ? { gapWidthPct: op.gapWidthPct } : {}),
        ...(op.switchRowCol ? { switchRowCol: true } : {}),
        ...(op.pointColors ? { pointColors: op.pointColors } : {}),
      }
      if (!editChartElement(session.opened, op.slideIndex, op.sourceId, patch)) {
        session.undoStack.pop()
        return null
      }
      // The chart part XML is updated; reparse the whole page to refresh the model
      const rebuilt = rebuildSlideWithReparse(session, op.slideIndex)
      if (!rebuilt) return null
      const newId = session.opened.deck.slides[op.slideIndex]?.elements[elIdx]?.id ?? null
      return { slide: rebuilt, sourceId: newId }
    },
    getChartColorSchemes() {
      const session = ctx.session
      return session ? chartColorSchemes(session.opened) : null
    },
    getChartData(slideIndex: number, sourceId: string) {
      const session = ctx.session
      if (!session) return null
      const slide = session.opened.deck.slides[slideIndex]
      if (!slide) return null
      return getChartElementData(slide, sourceId)
    },
    reorderElement(op: ReorderElementOp) {
      const session = ctx.session
      if (!session) return null
      const slide = session.opened.deck.slides[op.slideIndex]
      if (!slide) return null
      pushHistory(session)
      if (!reorderElement(slide, op.sourceId, op.dir)) {
        session.undoStack.pop()
        return null
      }
      return rebuildSlide(session, op.slideIndex)
    },
    setTextAnchor(op: {
      slideIndex: number
      sourceId: string
      anchor: 'top' | 'middle' | 'bottom'
    }) {
      const session = ctx.session
      if (!session) return null
      const slide = session.opened.deck.slides[op.slideIndex]
      if (!slide) return null
      pushHistory(session)
      if (!setElementTextAnchor(slide, op.sourceId, op.anchor)) {
        session.undoStack.pop()
        return null
      }
      return rebuildSlide(session, op.slideIndex)
    },
    copyElements(op: CopyElementsOp) {
      const session = ctx.session
      if (!session) return 0
      const slide = session.opened.deck.slides[op.slideIndex]
      if (!slide) return 0
      const items = op.sourceIds
        .map((id) => slide.elements.find((el) => el.id === id))
        .filter((el): el is NonNullable<typeof el> => !!el)
        .map((el) => copyElementData(session.opened, slide, el))
      if (items.length) {
        ctx.elementClipboard = { items, pasteCount: 0 }
        // Write our marker to the OS clipboard: an external copy overwrites it, so at paste time it tells whether internal or external is newer
      }
      return items.length
    },
    pasteElements(op: PasteElementsOp) {
      const session = ctx.session
      const clip = ctx.elementClipboard
      if (!session || !clip?.items.length) return null
      if (!session.opened.deck.slides[op.slideIndex]) return null
      const baseWidthPx = session.opened.deck.size.cx / EMU_PER_PX_96
      const scale = op.fitWidthPx / baseWidthPx
      // Cascading offset: each paste shifts another 16px relative to the original
      const shift = Math.round(((16 * (clip.pasteCount + 1)) / scale) * EMU_PER_PX_96)
      pushHistory(session)
      const r = pasteElements(session.opened, op.slideIndex, clip.items, { dx: shift, dy: shift })
      if (!r) {
        session.undoStack.pop()
        return null
      }
      clip.pasteCount++
      session.fitWidthPx = op.fitWidthPx
      const rebuilt = rebuildSlide(session, op.slideIndex)
      return rebuilt ? { slide: rebuilt, sourceIds: r.elementIds } : null
    },
    duplicateElements(op: DuplicateElementsOp) {
      const session = ctx.session
      if (!session) return null
      const slide = session.opened.deck.slides[op.slideIndex]
      if (!slide) return null
      const items = op.sourceIds
        .map((id) => slide.elements.find((el) => el.id === id))
        .filter((el): el is NonNullable<typeof el> => !!el)
        .map((el) => copyElementData(session.opened, slide, el))
      if (!items.length) return null
      const baseWidthPx = session.opened.deck.size.cx / EMU_PER_PX_96
      const scale = op.fitWidthPx / baseWidthPx
      const toEmu = (px: number) => Math.round((px / scale) * EMU_PER_PX_96)
      pushHistory(session)
      const r = pasteElements(session.opened, op.slideIndex, items, {
        dx: toEmu(op.dxPx),
        dy: toEmu(op.dyPx),
      })
      if (!r) {
        session.undoStack.pop()
        return null
      }
      session.fitWidthPx = op.fitWidthPx
      const rebuilt = rebuildSlide(session, op.slideIndex)
      return rebuilt ? { slide: rebuilt, sourceIds: r.elementIds } : null
    },
    addTable(op: AddTableOp) {
      const session = ctx.session
      if (!session) return null
      if (!session.opened.deck.slides[op.slideIndex]) return null
      const baseWidthPx = session.opened.deck.size.cx / EMU_PER_PX_96
      const scale = op.fitWidthPx / baseWidthPx
      const toEmu = (px: number) => Math.round((px / scale) * EMU_PER_PX_96)
      pushHistory(session)
      const r = addTable(session.opened, op.slideIndex, {
        rows: op.rows,
        cols: op.cols,
        offset: { x: toEmu(op.xPx), y: toEmu(op.yPx), cx: toEmu(op.wPx), cy: toEmu(op.hPx) },
      })
      if (!r) {
        session.undoStack.pop()
        return null
      }
      session.fitWidthPx = op.fitWidthPx
      const rebuilt = rebuildSlide(session, op.slideIndex)
      return rebuilt ? { slide: rebuilt, sourceId: r.elementId } : null
    },
    addInk(op: AddInkOp) {
      const session = ctx.session
      if (!session) return null
      const slide = session.opened.deck.slides[op.slideIndex]
      if (!slide) return null
      const baseWidthPx = session.opened.deck.size.cx / EMU_PER_PX_96
      const scale = op.fitWidthPx / baseWidthPx
      const toEmu = (px: number) => Math.round((px / scale) * EMU_PER_PX_96)
      pushHistory(session)
      const el = addPicture(session.opened, slide, {
        bytes: new Uint8Array(decodeBase64(op.base64)),
        ext: 'png',
        offset: {
          x: toEmu(op.xPx),
          y: toEmu(op.yPx),
          cx: Math.max(1, toEmu(op.wPx)),
          cy: Math.max(1, toEmu(op.hPx)),
        },
        name: `aislides-ink ${Date.now().toString(36)}`,
        descr: op.payload,
      })
      if (!el) {
        session.undoStack.pop()
        return null
      }
      session.fitWidthPx = op.fitWidthPx
      const rebuilt = rebuildSlide(session, op.slideIndex)
      return rebuilt ? { slide: rebuilt, sourceId: el.id } : null
    },
    addChart(op: AddChartOp) {
      const session = ctx.session
      if (!session || !session.opened.deck.slides[op.slideIndex]) return null
      const baseWidthPx = session.opened.deck.size.cx / EMU_PER_PX_96
      const scale = op.fitWidthPx / baseWidthPx
      const toEmu = (px: number) => Math.round((px / scale) * EMU_PER_PX_96)
      pushHistory(session)
      const r = addChart(session.opened, op.slideIndex, {
        kind: op.kind === 'barH' ? 'bar' : op.kind,
        ...(op.kind === 'barH' ? { barDir: 'bar' as const } : {}),
        ...(op.title ? { title: op.title } : {}),
        categories: op.categories,
        series: op.series,
        offset: { x: toEmu(op.xPx), y: toEmu(op.yPx), cx: toEmu(op.wPx), cy: toEmu(op.hPx) },
      })
      if (!r) {
        session.undoStack.pop()
        return null
      }
      session.fitWidthPx = op.fitWidthPx
      const rebuilt = rebuildSlide(session, op.slideIndex)
      return rebuilt ? { slide: rebuilt, sourceId: r.elementId } : null
    },
    addSmartArt(op: AddSmartArtOp) {
      const session = ctx.session
      if (!session || !session.opened.deck.slides[op.slideIndex]) return null
      const baseWidthPx = session.opened.deck.size.cx / EMU_PER_PX_96
      const scale = op.fitWidthPx / baseWidthPx
      const toEmu = (px: number) => Math.round((px / scale) * EMU_PER_PX_96)
      pushHistory(session)
      const r = addSmartArt(session.opened, op.slideIndex, {
        layout: op.layout,
        items: op.items,
        offset: { x: toEmu(op.xPx), y: toEmu(op.yPx), cx: toEmu(op.wPx), cy: toEmu(op.hPx) },
      })
      if (!r) {
        session.undoStack.pop()
        return null
      }
      session.fitWidthPx = op.fitWidthPx
      const rebuilt = rebuildSlide(session, op.slideIndex)
      return rebuilt ? { slide: rebuilt, sourceId: r.elementId } : null
    },
    addImageBytes(op: AddImageBytesOp) {
      const session = ctx.session
      if (!session) return null
      const slide = session.opened.deck.slides[op.slideIndex]
      if (!slide) return null
      const baseWidthPx = session.opened.deck.size.cx / EMU_PER_PX_96
      const scale = op.fitWidthPx / baseWidthPx
      const toEmu = (px: number) => Math.round((px / scale) * EMU_PER_PX_96)
      pushHistory(session)
      const el = addPicture(session.opened, slide, {
        bytes: new Uint8Array(decodeBase64(op.base64)),
        ext: op.ext,
        offset: {
          x: toEmu(op.xPx),
          y: toEmu(op.yPx),
          cx: Math.max(1, toEmu(op.wPx)),
          cy: Math.max(1, toEmu(op.hPx)),
        },
        ...(op.name ? { name: op.name } : {}),
      })
      if (!el) {
        session.undoStack.pop()
        return { error: 'unsupported' as const, ext: op.ext }
      }
      session.fitWidthPx = op.fitWidthPx
      const rebuilt = rebuildSlide(session, op.slideIndex)
      return rebuilt ? { slide: rebuilt, sourceId: el.id } : null
    },
    getMediaData(slideIndex: number, sourceId: string) {
      const session = ctx.session
      const slide = session?.opened.deck.slides[slideIndex]
      if (!session || !slide) return null
      const el = slide.elements.find((x) => x.id === sourceId)
      if (!el || el.type !== 'picture') return null
      const media = (
        el as { media?: { kind: 'video' | 'audio'; target?: string; external?: boolean } }
      ).media
      if (!media?.target) return null
      if (media.external) return { kind: media.kind, dataUrl: media.target }
      const bytes = session.opened.archive.readBytes(media.target)
      if (!bytes) return null
      const ext = media.target.split('.').pop()?.toLowerCase() ?? ''
      const mime = AV_MIME[ext] ?? (media.kind === 'video' ? 'video/mp4' : 'audio/mpeg')
      return {
        kind: media.kind,
        dataUrl: bytesToBlobUrl(bytes, mime),
      }
    },
    addMediaBytes(op: AddMediaBytesOp) {
      const session = ctx.session
      if (!session || !session.opened.deck.slides[op.slideIndex]) return null
      const deckSize = session.opened.deck.size
      const cx = Math.round(deckSize.cx * 0.6)
      const cy = Math.round((cx * 9) / 16)
      pushHistory(session)
      const added = addMedia(session.opened, op.slideIndex, {
        kind: op.kind,
        bytes: new Uint8Array(decodeBase64(op.base64)),
        ext: op.ext,
        offset: {
          x: Math.round((deckSize.cx - cx) / 2),
          y: Math.round((deckSize.cy - cy) / 2),
          cx,
          cy,
        },
        ...(op.name ? { name: op.name } : {}),
      })
      if (!added) {
        session.undoStack.pop()
        return null
      }
      session.fitWidthPx = op.fitWidthPx
      const rebuilt = rebuildSlide(session, op.slideIndex)
      return rebuilt ? { slide: rebuilt, sourceId: added.elementId } : null
    },
    setLink(op: SetLinkOp) {
      const session = ctx.session
      if (!session || !session.opened.deck.slides[op.slideIndex]) return null
      pushHistory(session)
      const fresh = setElementLink(session.opened, op.slideIndex, op.sourceId, op.target)
      if (!fresh) {
        session.undoStack.pop()
        return null
      }
      return rebuildSlide(session, op.slideIndex)
    },
    getLink(slideIndex: number, sourceId: string) {
      const session = ctx.session
      if (!session) return null
      return getElementLink(session.opened, slideIndex, sourceId)
    },
    getSlideLinks(slideIndex: number) {
      const session = ctx.session
      if (!session) return []
      return getSlideLinks(session.opened, slideIndex).map(({ elementId, target }) => ({
        sourceId: elementId,
        target,
      }))
    },
    getRunLinks(slideIndex: number) {
      const session = ctx.session
      if (!session) return []
      return getRunLinks(session.opened, slideIndex).map(({ elementId, ...rest }) => ({
        sourceId: elementId,
        ...rest,
      }))
    },
    applyHeaderFooter(op: HeaderFooterOp) {
      const session = ctx.session
      if (!session) return null
      pushHistory(session)
      const changed = applyHeaderFooter(session.opened, {
        footer: op.footer ?? null,
        slideNum: !!op.slideNum,
        date: op.date ?? null,
        ...(op.dateAuto ? { dateAuto: true } : {}),
      })
      if (!changed) {
        session.undoStack.pop()
        return null
      }
      session.fitWidthPx = op.fitWidthPx
      return buildAllRenderSlides(session.opened, op.fitWidthPx)
    },
    getHeaderFooter(slideIndex: number) {
      const session = ctx.session
      const slide = session?.opened.deck.slides[slideIndex]
      return slide ? readHeaderFooter(slide) : { footer: null, slideNum: false, date: null }
    },
    async applyTheme(op: ApplyThemeOp) {
      const session = ctx.session
      if (!session) return null
      pushHistory(session)
      const spec = {
        name: op.name,
        colors: op.colors,
        ...(op.majorFont ? { majorFont: op.majorFont } : {}),
        ...(op.minorFont ? { minorFont: op.minorFont } : {}),
      }
      try {
        // 1) Bake unsaved edits into the entries first: the color surgery edits entries
        //    directly, and dirty elements left for a later save would overwrite the surgery
        //    result with stale slices. In-memory (commitSaved/reparseDeck) instead of
        //    savePptx -> openPptx: the zip roundtrip's contiguous buffer fails on large decks
        commitSaved(session.opened)
        // 2) Pure entry surgery: theme parts + explicit color remapping
        const patched = applyThemeToArchive(session.opened, spec)
        const remapped = remapDeckColors(session.opened, spec)
        if (patched === 0 && remapped === 0) {
          session.undoStack.pop()
          return null
        }
        // 3) Reparse so every element's resolved colors/fonts refresh
        session.opened = reparseDeck(session.opened)
      } catch (err) {
        restoreSnapshot(session, session.undoStack.pop()!)
        return { error: err instanceof Error ? err.message : String(err) }
      }
      // Pages without any background definition fall back to the theme base color (so dark themes don't leave a white background)
      const lt1 = op.colors.lt1
      if (lt1) {
        for (const s of session.opened.deck.slides) {
          if (!s.background) setSlideBackground(s, `#${lt1.replace(/^#/, '')}`)
        }
      }
      // Reopening cleared element-level dirty; the session-level flag preserves the "unsaved" state (reset on save)
      session.metaDirty = true
      session.fitWidthPx = op.fitWidthPx
      return buildAllRenderSlides(session.opened, op.fitWidthPx)
    },
    setTransition(op: SetTransitionOp) {
      const session = ctx.session
      if (!session) return false
      const slides = session.opened.deck.slides
      const targets = op.slideIndex === -1 ? slides : [slides[op.slideIndex]].filter(Boolean)
      if (targets.length === 0) return false
      pushHistory(session)
      for (const s of targets) setSlideTransition(s!, op.kind)
      return true
    },
    getTransition(slideIndex: number) {
      const session = ctx.session
      const slide = session?.opened.deck.slides[slideIndex]
      return slide ? getSlideTransition(slide) : 'none'
    },
    setAdvanceTimes(op: SetAdvanceTimesOp) {
      const session = ctx.session
      if (!session) return false
      const slides = session.opened.deck.slides
      const targets = op.times.filter((t) => slides[t.slideIndex])
      if (targets.length === 0) return false
      pushHistory(session)
      for (const t of targets) setSlideAdvanceTime(slides[t.slideIndex]!, t.ms)
      return true
    },
    getAnimations(slideIndex: number): AnimationItem[] {
      const session = ctx.session
      const slide = session?.opened.deck.slides[slideIndex]
      if (!slide) return []
      const bySpid = new Map<number, (typeof slide.elements)[number]>()
      for (const el of slide.elements) {
        const spid = elementSpid(el)
        if (spid != null && !bySpid.has(spid)) bySpid.set(spid, el)
      }
      const typeLabel: Record<string, string> = {
        text: tMain('labelTextBox'),
        shape: tMain('labelShape'),
        picture: tMain('labelPicture'),
        group: tMain('labelGroup'),
        table: tMain('labelTable'),
        chart: tMain('labelChart'),
        passthrough: tMain('labelObject'),
      }
      const out: AnimationItem[] = []
      for (const a of getSlideAnimations(slide)) {
        const el = bySpid.get(a.spid)
        if (!el) continue // Leftover animations whose target shape was deleted are not echoed back
        out.push({
          sourceId: el.id,
          targetName: el.name || typeLabel[el.type] || tMain('labelObject'),
          effect: a.effect,
          trigger: a.trigger,
          durationMs: a.durationMs,
          delayMs: a.delayMs,
          ...(a.motionPath != null ? { motionPath: a.motionPath } : {}),
          ...(a.paragraph != null ? { paragraph: a.paragraph } : {}),
        })
      }
      return out
    },
    getShapeKeys(slideIndex: number): ShapeKey[] {
      const session = ctx.session
      const slide = session?.opened.deck.slides[slideIndex]
      if (!slide) return []
      return slide.elements.map((el) => ({
        sourceId: el.id,
        spid: elementSpid(el),
        name: el.name ?? '',
      }))
    },
    setAnimations(op: SetAnimationsOp) {
      const session = ctx.session
      const slide = session?.opened.deck.slides[op.slideIndex]
      if (!session || !slide) return false
      const anims: SlideAnimation[] = []
      for (const it of op.items) {
        const el = slide.elements.find((x) => x.id === it.sourceId)
        const spid = el ? elementSpid(el) : null
        if (spid == null) continue
        anims.push({
          spid,
          effect: it.effect,
          trigger: it.trigger,
          durationMs: Math.max(0, Math.round(it.durationMs)),
          delayMs: Math.max(0, Math.round(it.delayMs)),
          ...(it.motionPath != null ? { motionPath: it.motionPath } : {}),
          ...(it.paragraph != null ? { paragraph: it.paragraph } : {}),
        })
      }
      pushHistory(session)
      setSlideAnimations(slide, anims)
      return true
    },
    setSlideHidden(op: SetSlideHiddenOp) {
      const session = ctx.session
      if (!session) return null
      const slide = session.opened.deck.slides[op.slideIndex]
      if (!slide) return null
      pushHistory(session)
      setSlideHidden(slide, op.hidden)
      return rebuildSlide(session, op.slideIndex)
    },
    getSections() {
      const session = ctx.session
      return session ? getSections(session.opened) : []
    },
    setSections(sections: SectionInfo[]) {
      const session = ctx.session
      if (!session) return null
      pushHistory(session)
      setSections(session.opened, sections)
      session.metaDirty = true
      return getSections(session.opened)
    },
    addSection(op: AddSectionOp) {
      const session = ctx.session
      if (!session) return null
      pushHistory(session)
      const r = addSection(session.opened, op.atSlideIndex, op.name)
      if (!r) {
        session.undoStack.pop()
        return null
      }
      session.metaDirty = true
      return r
    },
    renameSection(op: RenameSectionOp) {
      const session = ctx.session
      if (!session) return null
      pushHistory(session)
      const r = renameSection(session.opened, op.id, op.name)
      if (!r) {
        session.undoStack.pop()
        return null
      }
      session.metaDirty = true
      return r
    },
    removeSection(op: RemoveSectionOp) {
      const session = ctx.session
      if (!session) return null
      pushHistory(session)
      const r = removeSection(session.opened, op.id)
      if (!r) {
        session.undoStack.pop()
        return null
      }
      session.metaDirty = true
      return r
    },
    moveSlide(op: MoveSlideOp) {
      const session = ctx.session
      if (!session) return null
      pushHistory(session)
      if (!moveSlide(session.opened, op.fromIndex, op.toIndex)) {
        session.undoStack.pop()
        return null
      }
      session.metaDirty = true
      return {
        slides: buildAllRenderSlides(session.opened, session.fitWidthPx),
        sections: getSections(session.opened),
      }
    },
    moveSection(op: MoveSectionOp) {
      const session = ctx.session
      if (!session) return null
      pushHistory(session)
      const sections = moveSection(session.opened, op.id, op.dir)
      if (!sections) {
        session.undoStack.pop()
        return null
      }
      session.metaDirty = true
      return {
        slides: buildAllRenderSlides(session.opened, session.fitWidthPx),
        sections,
      }
    },
    getNotes(slideIndex: number) {
      const session = ctx.session
      const slide = session?.opened.deck.slides[slideIndex]
      return session && slide ? getSlideNotes(session.opened.archive, slide.path) : ''
    },
    setNotes(op: SetNotesOp) {
      const session = ctx.session
      if (!session || !session.opened.deck.slides[op.slideIndex]) return false
      pushHistory(session)
      const ok = setSlideNotes(session.opened, op.slideIndex, op.text)
      if (!ok) session.undoStack.pop()
      else session.metaDirty = true
      return ok
    },
    getComments(slideIndex: number) {
      const session = ctx.session
      const slide = session?.opened.deck.slides[slideIndex]
      return session && slide ? getSlideComments(session.opened.archive, slide.path) : []
    },
    addComment(op: AddCommentOp) {
      const session = ctx.session
      const slide = session?.opened.deck.slides[op.slideIndex]
      if (!session || !slide) return null
      pushHistory(session)
      const author = commentAuthorName()
      const added = addSlideComment(session.opened, op.slideIndex, { author, text: op.text })
      if (!added) {
        session.undoStack.pop()
        return null
      }
      session.metaDirty = true
      return getSlideComments(session.opened.archive, slide.path)
    },
    deleteComment(op: DeleteCommentOp) {
      const session = ctx.session
      const slide = session?.opened.deck.slides[op.slideIndex]
      if (!session || !slide) return null
      pushHistory(session)
      if (
        !deleteSlideComment(session.opened, op.slideIndex, { authorId: op.authorId, idx: op.idx })
      ) {
        session.undoStack.pop()
        return null
      }
      session.metaDirty = true
      return getSlideComments(session.opened.archive, slide.path)
    },
    undo() {
      const session = ctx.session
      // Undo disabled in master view: the masterEdit.slide model cannot roll back with snapshots (v1 trade-off; undoable after exiting)
      if (!session || session.masterEdit) return null
      if (session.undoStack.length === 0) return null
      session.redoStack.push(takeSnapshot(session))
      restoreSnapshot(session, session.undoStack.pop()!)
      return buildAllRenderSlides(session.opened, session.fitWidthPx)
    },
    redo() {
      const session = ctx.session
      if (!session || session.masterEdit) return null
      if (session.redoStack.length === 0) return null
      session.undoStack.push(takeSnapshot(session))
      restoreSnapshot(session, session.redoStack.pop()!)
      return buildAllRenderSlides(session.opened, session.fitWidthPx)
    },
    isDirty() {
      const session = ctx.session
      if (!session) return false
      return (
        !!session.metaDirty ||
        session.opened.deck.slides.some(
          (s) => s.structureDirty || s.elements.some((el) => el.dirty || el.dirtyTransform),
        )
      )
    },
  }
}
