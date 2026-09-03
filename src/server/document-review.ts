import 'server-only'
import { unzipSync, zipSync } from 'fflate'
import type {
  DocumentReview,
  SensitiveFinding,
  ApplyDocumentRedactionsInput,
} from '@/domain/document-review'
import { RequestFailure } from './http'
import { getOfficeFileSummary, readOfficeFileBytes, saveOfficeFile } from './office-files'
import { privateDigest } from './session'
import { decodeXmlText } from './xml-text'

const decoder = new TextDecoder()
const encoder = new TextEncoder()
const MAX_FINDINGS = 250
// A fixed-width block: matching the original length would leak how long the
// removed value was into the redacted immutable version.
const REDACTION_BLOCK = '█'.repeat(6)

type FindingMatch = SensitiveFinding & {
  path: string
  nodeIndex: number
  start: number
  end: number
  value: string
}

const encodeXmlText = (value: string): string =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;')

const luhnValid = (value: string): boolean => {
  const digits = value.replaceAll(/\D/g, '')
  if (digits.length < 13 || digits.length > 19 || /^(\d)\1+$/.test(digits)) return false
  const sum = [...digits]
    .reverse()
    .map(Number)
    .reduce((total, digit, index) => {
      if (index % 2 === 0) return total + digit
      const doubled = digit * 2
      return total + (doubled > 9 ? doubled - 9 : doubled)
    }, 0)
  return sum % 10 === 0
}

const detectors: ReadonlyArray<{
  type: SensitiveFinding['type']
  pattern: RegExp
  accepts?: (value: string) => boolean
  mask: (value: string) => string
}> = [
  {
    type: 'email',
    pattern: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi,
    mask: (value) => {
      const [local = '', domain = ''] = value.split('@')
      const [host = '', suffix = ''] = domain.split(/\.(?=[^.]+$)/)
      return `${local.slice(0, 1)}•••@${host.slice(0, 1)}•••${suffix ? `.${suffix}` : ''}`
    },
  },
  {
    type: 'government-id',
    pattern: /\b\d{3}-\d{2}-\d{4}\b/g,
    mask: (value) => `•••-••-${value.slice(-4)}`,
  },
  {
    type: 'phone',
    pattern: /(?<!\d)(?:\+?\d{1,3}[ .-]?)?(?:\(?\d{3}\)?[ .-]?)\d{3}[ .-]?\d{4}(?!\d)/g,
    mask: (value) => `••• ••• ${value.replaceAll(/\D/g, '').slice(-4)}`,
  },
  {
    type: 'payment-card',
    pattern: /(?<!\d)(?:\d[ -]?){13,19}(?!\d)/g,
    accepts: luhnValid,
    mask: (value) => `•••• •••• •••• ${value.replaceAll(/\D/g, '').slice(-4)}`,
  },
]

const partLabel = (path: string): string =>
  path === 'word/document.xml'
    ? 'Document body'
    : path
        .replace(/^word\//, '')
        .replace(/\.xml$/, '')
        .replace(/([a-z])([A-Z])/g, '$1 $2')
        .replace(/^./, (value) => value.toUpperCase())

const findingId = (
  context: string,
  path: string,
  nodeIndex: number,
  start: number,
  type: string,
  value: string,
): string =>
  privateDigest('document-review-finding', `${context}\0${path}\0${nodeIndex}\0${start}\0${type}\0${value}`)

const matchesInText = (
  context: string,
  path: string,
  nodeIndex: number,
  text: string,
): FindingMatch[] => {
  const matches = detectors.flatMap((detector) =>
    [...text.matchAll(detector.pattern)].flatMap((match) => {
      const value = match[0]
      if (!value || (detector.accepts && !detector.accepts(value))) return []
      const start = match.index
      return [
        {
          id: findingId(context, path, nodeIndex, start, detector.type, value),
          type: detector.type,
          masked: detector.mask(value),
          part: partLabel(path),
          occurrence: 0,
          path,
          nodeIndex,
          start,
          end: start + value.length,
          value,
        } satisfies FindingMatch,
      ]
    }),
  )
  const occurrences = new Map<string, number>()
  return matches.map((finding) => {
    const key = `${finding.type}:${finding.masked}`
    const occurrence = (occurrences.get(key) ?? 0) + 1
    occurrences.set(key, occurrence)
    return { ...finding, occurrence }
  })
}

const isReviewablePart = (path: string): boolean =>
  /^word\/(?:document|header\d+|footer\d+|footnotes|endnotes|comments)\.xml$/.test(path)

const reviewableParts = (archive: Record<string, Uint8Array>): string[] =>
  Object.keys(archive).filter(isReviewablePart).sort()

type TextRun = { start: number; end: number; attributes: string; body: string }
type Paragraph = { runs: TextRun[] }

/**
 * Word splits one sentence across many <w:t> runs whenever formatting,
 * spell-check state, or revision marks change, so an email can straddle a run
 * boundary. Runs are grouped by their innermost <w:p> and scanned as one
 * string: a finding's nodeIndex is the paragraph index and its offsets are
 * offsets into that paragraph's joined text. Text boxes nest paragraphs inside
 * runs, so a stack tracks the innermost open paragraph; a run outside any
 * paragraph forms a group of its own.
 */
const paragraphsOf = (xml: string): Paragraph[] => {
  const groups: Paragraph[] = []
  const open: Paragraph[] = []
  // <w:p\b excludes <w:pPr>; <w:t\b excludes <w:tab>, <w:tbl>, <w:tc>, <w:tr>;
  // the lookbehind skips self-closing <w:t/> and <w:p/>.
  const token = /<w:p\b(?:[^>]*?)(\/?)>|<\/w:p>|<w:t\b([^>]*?)(?<!\/)>([\s\S]*?)<\/w:t>/g
  let match: RegExpExecArray | null
  while ((match = token.exec(xml)) !== null) {
    const [whole, selfClosing, attributes, body] = match
    if (whole === '</w:p>') {
      open.pop()
      continue
    }
    if (whole.startsWith('<w:p')) {
      if (selfClosing === '/') continue
      const paragraph: Paragraph = { runs: [] }
      groups.push(paragraph)
      open.push(paragraph)
      continue
    }
    const run: TextRun = {
      start: match.index,
      end: match.index + whole.length,
      attributes: attributes ?? '',
      body: body ?? '',
    }
    const current = open.at(-1)
    if (current) current.runs.push(run)
    else groups.push({ runs: [run] })
  }
  return groups
}

const paragraphText = (paragraph: Paragraph): string =>
  paragraph.runs.map((run) => decodeXmlText(run.body)).join('')

const scanArchive = (archive: Record<string, Uint8Array>, context: string): FindingMatch[] => {
  const findings: FindingMatch[] = []
  for (const path of reviewableParts(archive)) {
    const xml = decoder.decode(archive[path])
    paragraphsOf(xml).forEach((paragraph, nodeIndex) => {
      if (paragraph.runs.length === 0) return
      findings.push(...matchesInText(context, path, nodeIndex, paragraphText(paragraph)))
      if (findings.length > MAX_FINDINGS) {
        throw new RequestFailure(
          413,
          'too_many_sensitive_findings',
          `Review stops after ${MAX_FINDINGS} sensitive findings`,
        )
      }
    })
  }
  return findings
}

const archiveOf = (bytes: Uint8Array): Record<string, Uint8Array> => {
  try {
    return unzipSync(bytes)
  } catch {
    throw new RequestFailure(409, 'document_unreadable', 'This document archive could not be read')
  }
}

const publicFindings = (findings: readonly FindingMatch[]): SensitiveFinding[] =>
  findings.map(({ id, type, masked, part, occurrence }) => ({
    id,
    type,
    masked,
    part,
    occurrence,
  }))

export const scanDocxBytes = (bytes: Uint8Array, context: string): SensitiveFinding[] =>
  publicFindings(scanArchive(archiveOf(bytes), context))

export const scanDocumentReview = async (
  workspaceId: string,
  fileId: string,
): Promise<DocumentReview> => {
  const { file, bytes } = await readOfficeFileBytes(workspaceId, fileId)
  if (file.medium !== 'document') {
    return {
      fileId,
      versionId: file.versionId,
      supported: false,
      limitation: 'Private review currently rewrites DOCX text. Other media remain available in Studio.',
      findings: [],
    }
  }
  const context = `${workspaceId}:${fileId}:${file.versionId}`
  const findings = scanDocxBytes(bytes, context)
  return {
    fileId,
    versionId: file.versionId,
    supported: true,
    limitation:
      'Detection covers emails, phone numbers, US government IDs, and checksum-valid payment cards in DOCX paragraph text, including values Word split across formatting runs. Text inside images and embedded objects is not scanned.',
    findings,
  }
}

const stale = (): RequestFailure =>
  new RequestFailure(409, 'finding_set_stale', 'A selected finding moved inside its document part')

/**
 * Rewrite the runs of every paragraph that holds a selected finding. A finding
 * that spans several runs is cut out of each of them and the block is written
 * once, into the first run it touched, so the surrounding formatting survives.
 */
const redactXmlPart = (
  xml: string,
  selected: ReadonlyMap<number, readonly FindingMatch[]>,
): string => {
  const paragraphs = paragraphsOf(xml)
  const rewrites: Array<{ start: number; end: number; markup: string }> = []
  for (const [nodeIndex, findings] of selected) {
    const paragraph = paragraphs[nodeIndex]
    if (!paragraph || findings.length === 0) throw stale()
    const texts = paragraph.runs.map((run) => decodeXmlText(run.body))
    const joined = texts.join('')
    for (const finding of findings) {
      if (joined.slice(finding.start, finding.end) !== finding.value) throw stale()
    }
    let offset = 0
    const bounds = texts.map((text) => {
      const range = [offset, offset + text.length] as const
      offset += text.length
      return range
    })
    // Highest offset first, so earlier slice positions stay valid.
    for (const finding of [...findings].sort((left, right) => right.start - left.start)) {
      let placed = false
      texts.forEach((text, index) => {
        const [runStart, runEnd] = bounds[index] ?? [0, 0]
        const from = Math.max(finding.start, runStart) - runStart
        const to = Math.min(finding.end, runEnd) - runStart
        if (from >= to) return
        texts[index] = `${text.slice(0, from)}${placed ? '' : REDACTION_BLOCK}${text.slice(to)}`
        placed = true
      })
    }
    paragraph.runs.forEach((run, index) => {
      const text = texts[index] ?? ''
      const needsPreserve = /^\s|\s$/.test(text) && !/xml:space=/.test(run.attributes)
      const attributes = needsPreserve ? `${run.attributes} xml:space="preserve"` : run.attributes
      rewrites.push({ start: run.start, end: run.end, markup: `<w:t${attributes}>${encodeXmlText(text)}</w:t>` })
    })
  }
  let output = xml
  for (const rewrite of rewrites.sort((left, right) => right.start - left.start)) {
    output = `${output.slice(0, rewrite.start)}${rewrite.markup}${output.slice(rewrite.end)}`
  }
  return output
}

const isWordXmlPart = (path: string): boolean => /^word\/.*\.xml$/.test(path)
const isWordRelationshipPart = (path: string): boolean => /^word\/_rels\/[^/]+\.rels$/.test(path)
const isDocumentPropertiesPart = (path: string): boolean => /^docProps\/[^/]+\.xml$/.test(path)
const isXmlPart = (path: string): boolean => /\.(?:xml|rels)$/i.test(path)

const blockValues = (text: string, values: readonly string[]): string =>
  values.reduce((current, value) => current.replaceAll(value, REDACTION_BLOCK), text)

// Hyperlink targets are URIs, so the value is dropped (plain or percent
// encoded) rather than replaced with a block that would not be a valid URI.
const dropUriValues = (target: string, values: readonly string[]): string =>
  values.reduce(
    (current, value) => current.replaceAll(value, '').replaceAll(encodeURIComponent(value), ''),
    target,
  )

// Field codes and tracked deletions echo hyperlink and removed text outside
// <w:t>, where the finding scan does not look.
const scrubRunText = (xml: string, values: readonly string[]): string =>
  xml.replaceAll(
    /<w:(instrText|delText)\b([^>]*)>([\s\S]*?)<\/w:\1>/g,
    (whole, tag: string, attributes: string, body: string) => {
      const text = decodeXmlText(body)
      const scrubbed = blockValues(text, values)
      return scrubbed === text ? whole : `<w:${tag}${attributes}>${encodeXmlText(scrubbed)}</w:${tag}>`
    },
  )

const scrubRelationshipTargets = (xml: string, values: readonly string[]): string =>
  xml.replaceAll(/\bTarget="([^"]*)"/g, (whole, target: string) => {
    const decoded = decodeXmlText(target)
    const scrubbed = dropUriValues(decoded, values)
    return scrubbed === decoded ? whole : `Target="${encodeXmlText(scrubbed)}"`
  })

const scrubTextNodes = (xml: string, values: readonly string[]): string =>
  xml.replaceAll(/>([^<]+)</g, (whole, body: string) => {
    const text = decodeXmlText(body)
    const scrubbed = blockValues(text, values)
    return scrubbed === text ? whole : `>${encodeXmlText(scrubbed)}<`
  })

const scrubSecondaryParts = (archive: Record<string, Uint8Array>, values: readonly string[]): void => {
  for (const path of Object.keys(archive)) {
    const scrub = isWordXmlPart(path)
      ? scrubRunText
      : isWordRelationshipPart(path)
        ? scrubRelationshipTargets
        : isDocumentPropertiesPart(path)
          ? scrubTextNodes
          : null
    if (!scrub) continue
    const xml = decoder.decode(archive[path])
    const scrubbed = scrub(xml, values)
    if (scrubbed !== xml) archive[path] = encoder.encode(scrubbed)
  }
}

// Unselected occurrences legitimately survive inside <w:t> of reviewed parts
// (each is its own finding), so those runs are excluded from the sweep.
const survivingValue = (path: string, xml: string, values: readonly string[]): string | undefined => {
  const inspected = isReviewablePart(path) ? xml.replaceAll(/<w:t\b[^>]*>[\s\S]*?<\/w:t>/g, '') : xml
  const text = decodeXmlText(inspected)
  return values.find((value) => text.includes(value) || text.includes(encodeURIComponent(value)))
}

const assertRedactionComplete = (archive: Record<string, Uint8Array>, values: readonly string[]): void => {
  for (const path of Object.keys(archive)) {
    if (!isXmlPart(path)) continue
    if (survivingValue(path, decoder.decode(archive[path]), values) === undefined) continue
    throw new RequestFailure(
      409,
      'redaction_incomplete',
      `A selected finding still appears in ${path}, so the redacted version was not saved`,
    )
  }
}

export const applyDocumentRedactions = async (
  workspaceId: string,
  fileId: string,
  input: ApplyDocumentRedactionsInput,
) => {
  const current = await getOfficeFileSummary(workspaceId, fileId)
  if (current.medium !== 'document') {
    throw new RequestFailure(409, 'review_medium_mismatch', 'Private review currently requires a DOCX file')
  }
  if (current.versionId !== input.baseVersionId) {
    throw new RequestFailure(
      409,
      'file_version_conflict',
      'This document changed after it was reviewed. Scan the current version again.',
    )
  }
  const { bytes } = await readOfficeFileBytes(workspaceId, fileId, input.baseVersionId)
  const context = `${workspaceId}:${fileId}:${input.baseVersionId}`
  const { bytes: redacted, redactedCount } = redactDocxBytes(bytes, input.findingIds, context)
  return saveOfficeFile(
    workspaceId,
    fileId,
    input.baseVersionId,
    redacted,
    `Private review removed ${redactedCount} sensitive finding${redactedCount === 1 ? '' : 's'}`,
  )
}

export const redactDocxBytes = (
  bytes: Uint8Array,
  findingIds: readonly string[],
  context: string,
): { bytes: Uint8Array; redactedCount: number } => {
  const archive = archiveOf(bytes)
  const findings = scanArchive(archive, context)
  const selectedIds = new Set(findingIds)
  const selected = findings.filter(({ id }) => selectedIds.has(id))
  if (selected.length !== selectedIds.size) {
    throw new RequestFailure(
      409,
      'finding_set_stale',
      'One or more selected findings no longer exist in this document version',
    )
  }
  const byPart = Map.groupBy(selected, ({ path }) => path)
  for (const [path, partFindings] of byPart) {
    const bytes = archive[path]
    if (!bytes) throw new RequestFailure(409, 'document_part_missing', 'A reviewed document part is missing')
    const byNode = Map.groupBy(partFindings, ({ nodeIndex }) => nodeIndex)
    archive[path] = encoder.encode(redactXmlPart(decoder.decode(bytes), byNode))
  }
  const values = [...new Set(selected.map(({ value }) => value))]
  scrubSecondaryParts(archive, values)
  assertRedactionComplete(archive, values)
  return { bytes: zipSync(archive, { level: 6 }), redactedCount: selected.length }
}
