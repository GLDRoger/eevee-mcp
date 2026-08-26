import { parse, type DefaultTreeAdapterTypes } from 'parse5'
import type { QualityCheck, QualityReport } from './quality'

type Node = DefaultTreeAdapterTypes.Node
type Element = DefaultTreeAdapterTypes.Element

const elementsOf = (root: Node): Element[] => {
  const visit = (node: Node): Element[] => {
    const current = 'tagName' in node ? [node] : []
    const children = 'childNodes' in node ? node.childNodes.flatMap(visit) : []
    return [...current, ...children]
  }
  return visit(root)
}

const attribute = (element: Element, name: string): string | undefined =>
  element.attrs.find((candidate) => candidate.name.toLowerCase() === name)?.value

const textOf = (node: Node): string => {
  if ('value' in node && node.nodeName === '#text') return node.value
  return 'childNodes' in node ? node.childNodes.map(textOf).join('') : ''
}

const check = (
  id: string,
  label: string,
  status: QualityCheck['status'],
  blocking: boolean,
  detail: string,
): QualityCheck => ({ id, label, status, blocking, detail })

const externalReference = (element: Element): boolean =>
  element.attrs.some(({ name, value }) => {
    if (!['src', 'href', 'action', 'poster'].includes(name.toLowerCase())) return false
    const trimmed = value.trim()
    if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('data:') || trimmed.startsWith('blob:')) {
      return false
    }
    return true
  })

const interactiveElement = (element: Element): boolean =>
  ['button', 'input', 'select', 'textarea'].includes(element.tagName) ||
  (element.tagName === 'a' && attribute(element, 'href') !== undefined)

const accessibleName = (element: Element, labelledInputIds: ReadonlySet<string>): boolean => {
  if (element.tagName === 'input' && attribute(element, 'type') === 'hidden') return true
  const id = attribute(element, 'id')
  return Boolean(
    attribute(element, 'aria-label')?.trim() ||
      attribute(element, 'aria-labelledby')?.trim() ||
      attribute(element, 'title')?.trim() ||
      textOf(element).trim() ||
      (id && labelledInputIds.has(id)),
  )
}

export const evaluateWebAppHtml = (
  html: string,
  evaluatedAt = new Date(),
): QualityReport => {
  const parseErrors: string[] = []
  const document = parse(html, {
    sourceCodeLocationInfo: true,
    onParseError: ({ code }) => {
      parseErrors.push(code)
    },
  })
  const elements = elementsOf(document)
  const tags = new Set(elements.map(({ tagName }) => tagName))
  const explicitTags = new Set(
    elements
      .filter(({ sourceCodeLocation }) => sourceCodeLocation?.startTag !== undefined)
      .map(({ tagName }) => tagName),
  )
  const labels = elements.filter(({ tagName }) => tagName === 'label')
  const labelledInputIds = new Set(
    labels.map((label) => attribute(label, 'for')).filter((value) => value !== undefined),
  )
  const interactive = elements.filter(interactiveElement)
  const unnamed = interactive.filter((element) => !accessibleName(element, labelledInputIds))
  const hasDoctype = document.childNodes.some((node) => node.nodeName === '#documentType')
  const title = elements.find(({ tagName }) => tagName === 'title')
  const viewport = elements.find(
    (element) => element.tagName === 'meta' && attribute(element, 'name')?.toLowerCase() === 'viewport',
  )
  const authorCsp = elements.some(
    (element) =>
      element.tagName === 'meta' &&
      attribute(element, 'http-equiv')?.toLowerCase() === 'content-security-policy',
  )
  const usesNetworkApi = /\b(fetch|XMLHttpRequest|WebSocket|EventSource|sendBeacon)\s*\(/.test(html)
  const containsExternalUrl = /https?:\/\//i.test(html)
  const containsProtocolRelativeUrl = /["'`]\/\/[a-z0-9]/i.test(html)
  const writesLocation = /\b(?:(?:window|self)\.)?location(?:\.href)?\s*=/.test(html)
  const usesNavigationApi = /\b(?:location\.(?:assign|replace)|window\.open)\s*\(/.test(html)
  const hasExternalReference = elements.some(externalReference)
  const hasMetaRefresh = elements.some(
    (element) =>
      element.tagName === 'meta' && attribute(element, 'http-equiv')?.toLowerCase() === 'refresh',
  )

  const checks: QualityCheck[] = [
    check(
      'document-structure',
      'Complete document structure',
      hasDoctype &&
        explicitTags.has('html') &&
        explicitTags.has('head') &&
        explicitTags.has('body') &&
        parseErrors.length === 0
        ? 'passed'
        : 'failed',
      true,
      hasDoctype &&
        explicitTags.has('html') &&
        explicitTags.has('head') &&
        explicitTags.has('body') &&
        parseErrors.length === 0
        ? 'The source is a complete parseable HTML document.'
        : `The source must include doctype, html, head, and body without parse errors${parseErrors.length > 0 ? ` (${parseErrors.slice(0, 3).join(', ')})` : ''}.`,
    ),
    check(
      'self-contained',
      'Self-contained and offline',
      hasExternalReference ||
        usesNetworkApi ||
        containsExternalUrl ||
        containsProtocolRelativeUrl ||
        writesLocation ||
        usesNavigationApi ||
        hasMetaRefresh ||
        authorCsp
        ? 'failed'
        : 'passed',
      true,
      hasExternalReference ||
        usesNetworkApi ||
        containsExternalUrl ||
        containsProtocolRelativeUrl ||
        writesLocation ||
        usesNavigationApi ||
        hasMetaRefresh ||
        authorCsp
        ? 'External URLs, network or navigation APIs, meta refresh, and author-defined CSP are not allowed.'
        : 'The app uses no external resources, network APIs, or navigation APIs; the harness owns its CSP.',
    ),
    check(
      'document-landmarks',
      'Readable document landmarks',
      title && textOf(title).trim() && tags.has('main') && tags.has('h1') ? 'passed' : 'failed',
      true,
      title && textOf(title).trim() && tags.has('main') && tags.has('h1')
        ? 'The app has a title, main landmark, and primary heading.'
        : 'Add a non-empty title, one main landmark, and one primary heading.',
    ),
    check(
      'accessible-controls',
      'Named interactive controls',
      unnamed.length === 0 ? 'passed' : 'failed',
      true,
      unnamed.length === 0
        ? `${interactive.length} interactive control${interactive.length === 1 ? '' : 's'} have accessible names.`
        : `${unnamed.length} interactive control${unnamed.length === 1 ? '' : 's'} need an accessible name.`,
    ),
    check(
      'responsive-viewport',
      'Responsive viewport',
      viewport ? 'passed' : 'warning',
      false,
      viewport
        ? 'The document declares a responsive viewport.'
        : 'Add a viewport meta tag so the app scales correctly on narrow screens.',
    ),
    check(
      'eevee-runtime',
      'EEVEE runtime usage',
      html.includes('window.eevee') ? 'passed' : 'warning',
      false,
      html.includes('window.eevee')
        ? 'The app reads inputs or durable storage from the EEVEE runtime.'
        : 'The app is valid, but it does not use its declared EEVEE inputs or durable store.',
    ),
  ]
  const score = Math.max(
    0,
    100 -
      checks.filter(({ status, blocking }) => status === 'failed' && blocking).length * 25 -
      checks.filter(({ status }) => status === 'warning').length * 7,
  )
  return {
    evaluator: 'eevee.web-app-static@2',
    score,
    checks,
    evaluatedAt: evaluatedAt.toISOString(),
  }
}
