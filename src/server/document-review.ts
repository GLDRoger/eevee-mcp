import 'server-only'
import { createHash } from 'node:crypto'
import { unzipSync, zipSync } from 'fflate'
import type {
  DocumentReview,
  SensitiveFinding,
  ApplyDocumentRedactionsInput,
} from '@/domain/document-review'
import { RequestFailure } from './http'
import { getOfficeFileSummary, readOfficeFileBytes, saveOfficeFile } from './office-files'

const decoder = new TextDecoder()
const encoder = new TextEncoder()
const MAX_FINDINGS = 250

type FindingMatch = SensitiveFinding & {
  path: string
  nodeIndex: number
  value: string
}

const decodeXmlText = (value: string): string =>
  value
    .replaceAll(/&lt;/g, '<')
    .replaceAll(/&gt;/g, '>')
    .replaceAll(/&quot;/g, '"')
    .replaceAll(/&apos;/g, "'")
    .replaceAll(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replaceAll(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replaceAll(/&amp;/g, '&')

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

const findingId = (path: string, nodeIndex: number, type: string, value: string): string =>
  createHash('sha256').update(`${path}\0${nodeIndex}\0${type}\0${value}`).digest('hex')

const matchesInText = (path: string, nodeIndex: number, text: string): FindingMatch[] => {
  const matches = detectors.flatMap((detector) =>
    [...text.matchAll(detector.pattern)].flatMap((match) => {
      const value = match[0]
      if (!value || (detector.accepts && !detector.accepts(value))) return []
      return [
        {
          id: findingId(path, nodeIndex, detector.type, value),
          type: detector.type,
          masked: detector.mask(value),
          part: partLabel(path),
          occurrence: 0,
          path,
          nodeIndex,
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

const reviewableParts = (archive: Record<string, Uint8Array>): string[] =>
  Object.keys(archive)
    .filter((path) => /^word\/(?:document|header\d+|footer\d+|footnotes|endnotes|comments)\.xml$/.test(path))
    .sort()

const scanArchive = (archive: Record<string, Uint8Array>): FindingMatch[] => {
  const findings: FindingMatch[] = []
  for (const path of reviewableParts(archive)) {
    const xml = decoder.decode(archive[path])
    let nodeIndex = 0
    const textPattern = /<w:t\b[^>]*>([\s\S]*?)<\/w:t>/g
    let match: RegExpExecArray | null
    while ((match = textPattern.exec(xml)) !== null) {
      findings.push(...matchesInText(path, nodeIndex, decodeXmlText(match[1] ?? '')))
      nodeIndex += 1
      if (findings.length > MAX_FINDINGS) {
        throw new RequestFailure(
          413,
          'too_many_sensitive_findings',
          `Review stops after ${MAX_FINDINGS} sensitive findings`,
        )
      }
    }
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

export const scanDocxBytes = (bytes: Uint8Array): SensitiveFinding[] =>
  publicFindings(scanArchive(archiveOf(bytes)))

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
  const findings = scanDocxBytes(bytes)
  return {
    fileId,
    versionId: file.versionId,
    supported: true,
    limitation:
      'Detection covers emails, phone numbers, US government IDs, and checksum-valid payment cards stored within individual DOCX text runs.',
    findings,
  }
}

const redactXmlPart = (
  xml: string,
  selected: ReadonlyMap<number, readonly FindingMatch[]>,
): string => {
  let nodeIndex = 0
  return xml.replaceAll(/<w:t\b([^>]*)>([\s\S]*?)<\/w:t>/g, (whole, attributes: string, body: string) => {
    const findings = selected.get(nodeIndex)
    nodeIndex += 1
    if (!findings?.length) return whole
    let text = decodeXmlText(body)
    for (const finding of findings) {
      text = text.replace(finding.value, '█'.repeat(Math.max(4, finding.value.length)))
    }
    return `<w:t${attributes}>${encodeXmlText(text)}</w:t>`
  })
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
  const { bytes: redacted, redactedCount } = redactDocxBytes(bytes, input.findingIds)
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
): { bytes: Uint8Array; redactedCount: number } => {
  const archive = archiveOf(bytes)
  const findings = scanArchive(archive)
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
  return { bytes: zipSync(archive, { level: 6 }), redactedCount: selected.length }
}
