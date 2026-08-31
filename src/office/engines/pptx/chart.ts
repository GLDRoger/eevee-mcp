/**
 * Chart parsing (ppt/charts/chartN.xml → ChartModel).
 *
 * Read-only semantic parsing: on a slide a chart is a separate part referenced by
 * a <p:graphicFrame>; byte fidelity is guaranteed by passing the graphicFrame's
 * anchor bytes through verbatim, and the chart part is never rewritten.
 *
 * Supports data + explicit styling (series colors, axis label styles, gridlines)
 * for lineChart / barChart (incl. horizontal bars) / pieChart (incl. doughnut) /
 * areaChart / scatterChart / radarChart; missing styles fall back to the theme
 * palette. bar/area/line can be combined in one plotArea (column+line combo);
 * combined series carry plotKind and the primary type is picked bar > area > line;
 * series on the secondary value axis (axPos=r, not deleted, matched by the plot's
 * c:axId) carry secondaryAxis, with the secondary axis style/range parsed into
 * valAxis2.
 */
import { XMLParser } from 'fast-xml-parser'
import { type Theme } from './theme'
import { resolveColorNode } from './color'
import { asXmlNode, xmlArray, type XmlNode } from './xml-utils'

const chartParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  trimValues: false,
  parseTagValue: false,
  isArray: (name) => ['c:ser', 'c:pt', 'c:lvl', 'c:dPt'].includes(name),
})

export type ChartKind = 'line' | 'bar' | 'pie' | 'area' | 'scatter' | 'radar' | 'unknown'

export interface ChartSeries {
  name?: string
  /** Series main color #RRGGBB (explicit spPr color; render layer fills in from the theme palette otherwise) */
  color?: string
  values: Array<number | null>
  /** Combo chart (e.g. bar+line): the plot type this series belongs to; default = ChartModel.kind */
  plotKind?: 'line' | 'bar' | 'area'
  /** Scatter: x values (c:xVal numeric cache; y values in values). Empty → render layer uses ordinals 1..n */
  xValues?: Array<number | null>
  /** Line: smoothed curve */
  smooth?: boolean
  /** Whether to draw data point markers (line defaults to false; scatter/radar default
   *  comes from the style; only set when <c:marker><c:symbol> is explicit) */
  marker?: boolean
  /** Explicit per-point colors <c:dPt> (common for pies; render layer palette otherwise) */
  pointColors?: Array<string | undefined>
  /** Combo dual axes: this series is on the secondary value axis (independent right-side range; decided by the plot's c:axId) */
  secondaryAxis?: boolean
}

export interface ChartAxisStyle {
  /** Explicit min/max (render layer computes a nice range from the data otherwise) */
  min?: number
  max?: number
  labelColor?: string
  labelSizePt?: number
  lineColor?: string
  gridColor?: string
  gridDash?: boolean
  title?: string
  /** <c:orientation val="maxMin"/>: categories/values reversed (common for bar charts with the first category on top) */
  reversed?: boolean
}

export interface ChartModel {
  kind: ChartKind
  /** bar only: col = vertical columns, bar = horizontal bars */
  barDir?: 'col' | 'bar'
  grouping?: 'clustered' | 'stacked' | 'percentStacked' | 'standard'
  /** Gap between bars (% of bar width, c:gapWidth, default 150) */
  gapWidthPct?: number
  categories: string[]
  series: ChartSeries[]
  /** Legend position (undefined when there is no c:legend) */
  legendPos?: 't' | 'b' | 'l' | 'r' | 'tr'
  valAxis?: ChartAxisStyle
  /** Secondary value axis (right side, combo column+line dual axes; undefined without a right value axis or style info) */
  valAxis2?: ChartAxisStyle
  catAxis?: ChartAxisStyle
  /** Doughnut hole (% of radius, c:holeSize; pie = 0) */
  holePct?: number
  /** First slice start angle (degrees, 12 o'clock = 0, clockwise; c:firstSliceAng) */
  firstSliceAngDeg?: number
  /** Scatter style (c:scatterStyle: line/lineMarker/marker/smooth/smoothMarker/none) */
  scatterStyle?: string
  /** Radar style (c:radarStyle) */
  radarStyle?: 'standard' | 'marker' | 'filled'
  /** Data labels (showVal or showPercent on plot/ser-level c:dLbls) */
  dataLabels?: boolean
  /** Data labels show percentages only (showPercent only, common for pies) */
  dataLabelsPct?: boolean
  /** Chart title (concatenated rich text of c:chart/c:title) */
  title?: string
}

const child = (node: XmlNode, key: string): XmlNode => asXmlNode(node[key])
const attribute = (node: XmlNode, key = '@_val'): string | undefined => {
  const value = node[key]
  return value == null ? undefined : String(value)
}

/** Parse one chartN.xml. Returns null for unrecognized plot types (caller falls back to a placeholder chip). */
export function parseChartXml(xml: string, theme?: Theme): ChartModel | null {
  let doc: XmlNode
  try {
    doc = asXmlNode(chartParser.parse(xml))
  } catch {
    return null
  }
  const chart = child(child(doc, 'c:chartSpace'), 'c:chart')
  const plotArea = child(chart, 'c:plotArea')
  if (Object.keys(plotArea).length === 0) return null

  // Cartesian types (bar/area/line) may coexist combined (e.g. column+line combo); pie/scatter/radar stand alone.
  const cartesian: Array<{ kind: 'bar' | 'area' | 'line'; plot: XmlNode }> = []
  if (plotArea['c:barChart']) cartesian.push({ kind: 'bar', plot: child(plotArea, 'c:barChart') })
  if (plotArea['c:areaChart']) cartesian.push({ kind: 'area', plot: child(plotArea, 'c:areaChart') })
  if (plotArea['c:lineChart']) cartesian.push({ kind: 'line', plot: child(plotArea, 'c:lineChart') })

  let kind: ChartKind
  let plot: XmlNode
  if (cartesian.length) {
    // Primary type is the first (bar > area > line): axis/bar params read from it; other combo series carry plotKind
    kind = cartesian[0]!.kind
    plot = cartesian[0]!.plot
  } else if (plotArea['c:pieChart'] || plotArea['c:doughnutChart']) {
    kind = 'pie'
    plot = child(plotArea, plotArea['c:pieChart'] ? 'c:pieChart' : 'c:doughnutChart')
  } else if (plotArea['c:scatterChart']) {
    kind = 'scatter'
    plot = child(plotArea, 'c:scatterChart')
  } else if (plotArea['c:radarChart']) {
    kind = 'radar'
    plot = child(plotArea, 'c:radarChart')
  } else {
    return null
  }

  // Extract value axis nodes up front: combo dual axes need the secondary value
  // axis's axId (axPos=r and not deleted) first, so series parsing can decide
  // "primary or secondary axis" by the owning plot's c:axId
  const valAxes = xmlArray(plotArea['c:valAx'])
  const secValAxNode =
    kind !== 'scatter' && cartesian.length > 1
      ? valAxes.find(
          (axis) =>
            attribute(child(axis, 'c:axPos')) === 'r' &&
            attribute(child(axis, 'c:delete')) !== '1',
        )
      : undefined
  const secAxId = secValAxNode ? attribute(child(secValAxNode, 'c:axId')) : undefined
  // Axes attached to a plot node (two c:axIds: category axis + value axis)
  const plotAxIds = (plotNode: XmlNode): string[] =>
    xmlArray(plotNode['c:axId']).flatMap((axis) => {
      const id = attribute(axis)
      return id ? [id] : []
    })

  const series: ChartSeries[] = []
  let categories: string[] = []
  const parsePlotSeries = (
    plotNode: XmlNode,
    plotKind: ChartKind,
    tagPlotKind: boolean,
    secondary = false,
  ) => {
    const sers = xmlArray(plotNode['c:ser'])
    for (const ser of sers) {
      // Scatter: y values in c:yVal, x values in c:xVal; other types use c:val
      const s: ChartSeries = {
        values: readNumPoints(plotKind === 'scatter' ? ser['c:yVal'] : ser['c:val']),
      }
      if (tagPlotKind) s.plotKind = plotKind as 'line' | 'bar' | 'area'
      if (secondary) s.secondaryAxis = true
      if (plotKind === 'scatter') {
        const xs = readNumPoints(ser['c:xVal'])
        if (xs.length) s.xValues = xs
      }
      const name = readStrPoints(ser['c:tx'])[0]
      if (name != null) s.name = name
      const color = serColor(ser, theme)
      if (color) s.color = color
      if (attribute(child(ser, 'c:smooth')) === '1') s.smooth = true
      const markerSym = attribute(child(child(ser, 'c:marker'), 'c:symbol'))
      if (plotKind === 'line') s.marker = markerSym != null && markerSym !== 'none'
      // scatter/radar: default marker decided by style; only set for explicit symbol (none → false)
      else if ((plotKind === 'scatter' || plotKind === 'radar') && markerSym != null)
        s.marker = markerSym !== 'none'
      // Per-data-point colors (one color per pie slice)
      const dPts = xmlArray(ser['c:dPt'])
      if (dPts.length) {
        const pointColors: Array<string | undefined> = []
        for (const dPt of dPts) {
          const idx = parseInt(attribute(child(dPt, 'c:idx')) ?? '', 10)
          if (Number.isNaN(idx)) continue
          const c = resolveColorNode(child(dPt, 'c:spPr')['a:solidFill'], theme)
          if (c != null) pointColors[idx] = c
        }
        if (pointColors.length) s.pointColors = pointColors
      }
      series.push(s)
      // Categories: take the first non-empty series' cat
      if (!categories.length) categories = readStrPoints(ser['c:cat'])
    }
  }
  if (cartesian.length > 1) {
    for (const c of cartesian)
      parsePlotSeries(c.plot, c.kind, true, secAxId != null && plotAxIds(c.plot).includes(secAxId))
  } else parsePlotSeries(plot, kind, false)
  if (!series.length) return null
  if (!categories.length) {
    // With no category cache, keep names empty (length from the longest series); never inject placeholders
    const n = Math.max(...series.map((s) => s.values.length), 0)
    categories = Array.from({ length: n }, () => '')
  }

  const model: ChartModel = { kind, categories, series }

  if (kind === 'bar') {
    const dir = attribute(child(plot, 'c:barDir'))
    model.barDir = dir === 'bar' ? 'bar' : 'col'
    const grouping = attribute(child(plot, 'c:grouping'))
    if (
      grouping === 'clustered' ||
      grouping === 'stacked' ||
      grouping === 'percentStacked' ||
      grouping === 'standard'
    ) {
      model.grouping = grouping
    }
    const gap = attribute(child(plot, 'c:gapWidth'))
    model.gapWidthPct = gap != null ? parseInt(gap, 10) : 150
  }

  if (kind === 'pie') {
    const hole = attribute(child(plot, 'c:holeSize'))
    model.holePct = hole != null ? parseInt(hole, 10) || 0 : plotArea['c:doughnutChart'] ? 50 : 0
    const first = attribute(child(plot, 'c:firstSliceAng'))
    if (first != null) model.firstSliceAngDeg = parseInt(first, 10) || 0
  }

  if (kind === 'scatter') {
    const st = attribute(child(plot, 'c:scatterStyle'))
    if (st) model.scatterStyle = String(st)
  }

  if (kind === 'radar') {
    const st = attribute(child(plot, 'c:radarStyle'))
    model.radarStyle = st === 'filled' ? 'filled' : st === 'marker' ? 'marker' : 'standard'
  }

  const legendPos = attribute(child(child(chart, 'c:legend'), 'c:legendPos'))
  if (chart['c:legend']) {
    model.legendPos =
      legendPos === 't' ||
      legendPos === 'b' ||
      legendPos === 'l' ||
      legendPos === 'r' ||
      legendPos === 'tr'
        ? legendPos
        : 'r'
  }

  const chartTitle = collectText(child(child(chart, 'c:title'), 'c:tx')['c:rich'])
  if (chartTitle) model.title = chartTitle

  // Data labels: plot-level or any series-level c:dLbls (delete=1 counts as none)
  const dLblsInfo = (owner: XmlNode): { on: boolean; pct: boolean } => {
    const d = child(owner, 'c:dLbls')
    if (Object.keys(d).length === 0 || attribute(child(d, 'c:delete')) === '1')
      return { on: false, pct: false }
    const showVal = attribute(child(d, 'c:showVal')) === '1'
    const showPct = attribute(child(d, 'c:showPercent')) === '1'
    return { on: showVal || showPct, pct: showPct && !showVal }
  }
  const dLblOwners = (cartesian.length > 1 ? cartesian.map((entry) => entry.plot) : [plot]).flatMap(
    (owner) => [owner, ...xmlArray(owner['c:ser'])],
  )
  const found = dLblOwners.map(dLblsInfo).find((r) => r.on)
  if (found) {
    model.dataLabels = true
    if (found.pct) model.dataLabelsPct = true
  }

  // Axes: scatter charts have dual value axes (x at the bottom axPos=b, y on the left); the x axis goes in the catAxis slot
  if (kind === 'scatter' && valAxes.length >= 2) {
    const xAxNode =
      valAxes.find((axis) => attribute(child(axis, 'c:axPos')) === 'b') ?? valAxes[0]
    const yAxNode = valAxes.find((a) => a !== xAxNode) ?? valAxes[1]
    const xAx = parseAxis(xAxNode, theme)
    if (xAx) model.catAxis = xAx
    const yAx = parseAxis(yAxNode, theme)
    if (yAx) model.valAxis = yAx
  } else {
    // A combo chart (column + line secondary axis) has two axis pairs in plotArea:
    // the value axis is the left primary (axPos=l), the category axis is the
    // non-deleted one (c:delete≠1); the secondary system's hidden category axis is skipped
    const valAxNode =
      valAxes.find((axis) => attribute(child(axis, 'c:axPos')) === 'l') ?? valAxes[0]
    const valAx = parseAxis(valAxNode, theme)
    if (valAx) model.valAxis = valAx
    // Secondary value axis (combo dual axes): min/max/style handed to the render layer to draw the right-side ticks
    if (secValAxNode) {
      const valAx2 = parseAxis(secValAxNode, theme)
      if (valAx2) model.valAxis2 = valAx2
    }
    const catAxes = xmlArray(plotArea['c:catAx'])
    const catAxNode =
      catAxes.find((axis) => attribute(child(axis, 'c:delete')) !== '1') ?? catAxes[0]
    const catAx = parseAxis(catAxNode, theme)
    if (catAx) model.catAxis = catAx
  }

  return model
}

/** Numeric cache inside <c:val>/<c:cat>/<c:tx> → number[] (idx order kept, empty points null). */
function readNumPoints(value: unknown): Array<number | null> {
  const node = asXmlNode(value)
  const cache = child(child(node, 'c:numRef'), 'c:numCache')
  const source = Object.keys(cache).length > 0 ? cache : child(node, 'c:numLit')
  if (Object.keys(source).length === 0) return []
  return readPoints(source).map((v) => {
    if (v == null || v === '') return null
    const n = Number(v)
    return Number.isFinite(n) ? n : null
  })
}

/** String cache (strRef/strCache or the innermost lvl of multiLvlStrRef) → string[]. */
function readStrPoints(value: unknown): string[] {
  const node = asXmlNode(value)
  const strCache = child(child(node, 'c:strRef'), 'c:strCache')
  if (Object.keys(strCache).length > 0) return readPoints(strCache).map((v) => v ?? '')
  const multi = child(child(node, 'c:multiLvlStrRef'), 'c:multiLvlStrCache')
  if (Object.keys(multi).length > 0) {
    const lvls = xmlArray(multi['c:lvl'])
    // The innermost (first lvl) holds the leaf categories
    if (lvls.length) return readPoints(lvls[0]).map((v) => v ?? '')
  }
  const numCache = child(child(node, 'c:numRef'), 'c:numCache')
  if (Object.keys(numCache).length > 0) return readPoints(numCache).map((v) => v ?? '')
  return []
}

/** c:pt list → value array ordered by idx. */
function readPoints(cache: XmlNode): Array<string | null> {
  const pts = xmlArray(cache['c:pt'])
  const count = attribute(child(cache, 'c:ptCount'))
  const n = count != null ? parseInt(count, 10) : pts.length
  const out: Array<string | null> = new Array(Math.max(n, pts.length)).fill(null)
  for (const pt of pts) {
    const idx = parseInt(attribute(pt, '@_idx') ?? '', 10) || 0
    const v = pt['c:v']
    out[idx] =
      typeof v === 'string'
        ? v
        : v != null
          ? String(asXmlNode(v)['#text'] ?? v)
          : null
  }
  return out
}

/** Series main color: ln stroke first (lines), otherwise solidFill (bars/pies). */
function serColor(ser: XmlNode, theme?: Theme): string | undefined {
  const spPr = child(ser, 'c:spPr')
  if (Object.keys(spPr).length === 0) return undefined
  const lnColor = resolveColorNode(child(spPr, 'a:ln')['a:solidFill'], theme)
  const fillColor = resolveColorNode(spPr['a:solidFill'], theme)
  return lnColor ?? fillColor
}

function parseAxis(value: unknown, theme?: Theme): ChartAxisStyle | undefined {
  const ax = asXmlNode(value)
  if (Object.keys(ax).length === 0) return undefined
  const out: ChartAxisStyle = {}
  const scaling = child(ax, 'c:scaling')
  const minimum = attribute(child(scaling, 'c:min'))
  const maximum = attribute(child(scaling, 'c:max'))
  if (minimum != null) out.min = Number(minimum)
  if (maximum != null) out.max = Number(maximum)
  if (attribute(child(scaling, 'c:orientation')) === 'maxMin') out.reversed = true
  const defRPr =
    xmlArray(child(ax, 'c:txPr')['a:p'])
      .map((paragraph) => child(child(paragraph, 'a:pPr'), 'a:defRPr'))
      .find((node) => Object.keys(node).length > 0) ?? {}
  if (Object.keys(defRPr).length > 0) {
    const c = resolveColorNode(defRPr['a:solidFill'], theme)
    if (c) out.labelColor = c
    const size = attribute(defRPr, '@_sz')
    if (size) out.labelSizePt = parseInt(size, 10) / 100
  }
  const lineColor = resolveColorNode(child(child(ax, 'c:spPr'), 'a:ln')['a:solidFill'], theme)
  if (lineColor) out.lineColor = lineColor
  // A self-closing <c:majorGridlines/> (no spPr) parses to an empty string; still counts as having gridlines
  const grid = ax['c:majorGridlines']
  if (grid !== undefined) {
    const spPr = child(asXmlNode(grid), 'c:spPr')
    const gc = resolveColorNode(child(spPr, 'a:ln')['a:solidFill'], theme)
    out.gridColor = gc ?? '#E6E6E6'
    if (attribute(child(child(spPr, 'a:ln'), 'a:prstDash')) === 'dash') out.gridDash = true
  }
  // Axis title (all a:t inside c:title/c:tx/c:rich concatenated)
  const title = collectText(child(child(ax, 'c:title'), 'c:tx')['c:rich'])
  if (title) out.title = title
  return Object.keys(out).length ? out : undefined
}

/** Collect all a:t inside a rich text node. */
function collectText(value: unknown): string | undefined {
  const rich = asXmlNode(value)
  if (Object.keys(rich).length === 0) return undefined
  const paras = xmlArray(rich['a:p'])
  const parts: string[] = []
  for (const p of paras) {
    const runs = xmlArray(p['a:r'])
    for (const r of runs) {
      const t = r['a:t']
      parts.push(typeof t === 'string' ? t : String(asXmlNode(t)['#text'] ?? ''))
    }
  }
  const s = parts.join('')
  return s.trim() ? s : undefined
}
