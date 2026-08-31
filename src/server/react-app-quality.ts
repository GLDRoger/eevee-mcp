import 'server-only'
import { parse, type Node } from 'acorn'
import { transform } from 'esbuild'
import { aggregateEvaluationVerdict, type QualityCheck, type QualityReport } from '@/domain/quality'
import type { ReactAppDefinition, ReactCompilation } from '@/domain/react-app'

/**
 * Static quality analysis over the applet's React source.
 *
 * Each .ts/.tsx file is lowered with the same esbuild that compiles the
 * artifact, so JSX becomes plain `jsx("tag", { ...props })` calls, and that
 * JavaScript is parsed with acorn. Checks read AST facts instead of matching
 * the raw text, so attribute order, arrow-function props, and formatting
 * cannot change a verdict.
 */

type AnyNode = Node & Record<string, unknown>

const isNode = (value: unknown): value is AnyNode =>
  typeof value === 'object' && value !== null && 'type' in value

const childNodes = (node: AnyNode): AnyNode[] => {
  const children: AnyNode[] = []
  for (const value of Object.values(node)) {
    if (isNode(value)) children.push(value)
    else if (Array.isArray(value)) {
      for (const item of value) if (isNode(item)) children.push(item)
    }
  }
  return children
}

type PropPresence =
  | { kind: 'absent' }
  | { kind: 'empty' }
  | { kind: 'literal'; value: string }
  | { kind: 'dynamic' }

type JsxProps = {
  presence: (name: string) => PropPresence
  hasSpread: boolean
  childrenNode: AnyNode | null
}

const readProps = (node: AnyNode | undefined): JsxProps => {
  const properties =
    node && node.type === 'ObjectExpression' && Array.isArray(node.properties)
      ? node.properties.filter(isNode)
      : []
  const named = new Map<string, AnyNode | null>()
  let hasSpread = false
  for (const property of properties) {
    if (property.type === 'SpreadElement') {
      hasSpread = true
      continue
    }
    if (property.type !== 'Property') continue
    const key = property.key
    const name = isNode(key)
      ? key.type === 'Identifier'
        ? String(key.name)
        : key.type === 'Literal'
          ? String(key.value)
          : null
      : null
    if (name !== null) named.set(name, isNode(property.value) ? property.value : null)
  }
  return {
    presence: (name) => {
      if (!named.has(name)) return { kind: 'absent' }
      const value = named.get(name) ?? null
      if (value?.type === 'Literal' && typeof value.value === 'string') {
        return value.value.trim() === '' ? { kind: 'empty' } : { kind: 'literal', value: value.value }
      }
      return { kind: 'dynamic' }
    },
    hasSpread,
    childrenNode: named.get('children') ?? null,
  }
}

type ControlFact = {
  tag: string
  props: JsxProps
  insideLabel: boolean
}

type SourceFacts = {
  tags: Set<string>
  controls: ControlFact[]
  labelForLiterals: Set<string>
  labelForDynamic: boolean
  presentationAttribute: boolean
}

const CONTROL_TAGS = new Set(['a', 'button', 'input', 'select', 'textarea'])

const jsxCallTag = (node: AnyNode, jsxNames: ReadonlySet<string>): string | null => {
  if (node.type !== 'CallExpression') return null
  const callee = node.callee
  if (!isNode(callee) || callee.type !== 'Identifier' || !jsxNames.has(String(callee.name))) {
    return null
  }
  const args = Array.isArray(node.arguments) ? node.arguments.filter(isNode) : []
  const first = args[0]
  return first?.type === 'Literal' && typeof first.value === 'string' ? first.value : null
}

const jsxRuntimeNames = (program: AnyNode): Set<string> => {
  const names = new Set<string>()
  const body = Array.isArray(program.body) ? program.body.filter(isNode) : []
  for (const statement of body) {
    if (statement.type !== 'ImportDeclaration') continue
    const source = statement.source
    if (!isNode(source) || source.value !== 'react/jsx-runtime') continue
    const specifiers = Array.isArray(statement.specifiers)
      ? statement.specifiers.filter(isNode)
      : []
    for (const specifier of specifiers) {
      if (specifier.type !== 'ImportSpecifier') continue
      const imported = specifier.imported
      const local = specifier.local
      if (!isNode(imported) || !isNode(local)) continue
      if (['jsx', 'jsxs', 'jsxDEV'].includes(String(imported.name))) {
        names.add(String(local.name))
      }
    }
  }
  return names
}

/** Name evidence inside an a/button children subtree: readable text or a named descendant. */
const childNameEvidence = (
  node: AnyNode | null,
  jsxNames: ReadonlySet<string>,
): { textLike: boolean; namedDescendant: boolean } => {
  if (!node) return { textLike: false, namedDescendant: false }
  let textLike = false
  let namedDescendant = false
  const visit = (current: AnyNode): void => {
    const tag = jsxCallTag(current, jsxNames)
    if (tag !== null) {
      const args = Array.isArray(current.arguments) ? current.arguments.filter(isNode) : []
      const props = readProps(args[1])
      if (
        props.presence('aria-label').kind === 'literal' ||
        props.presence('alt').kind === 'literal' ||
        props.presence('aria-label').kind === 'dynamic' ||
        props.presence('alt').kind === 'dynamic'
      ) {
        namedDescendant = true
      }
      const nested = props.childrenNode
      if (nested) visit(nested)
      return
    }
    if (current.type === 'Literal') {
      if (typeof current.value === 'string' && current.value.trim() !== '') textLike = true
      return
    }
    if (current.type === 'ArrayExpression') {
      for (const child of childNodes(current)) visit(child)
      return
    }
    // Any other expression as a child ({label}, {items.length}, ternaries...)
    // renders dynamic content, which is readable text.
    textLike = true
  }
  visit(node)
  return { textLike, namedDescendant }
}

const collectFacts = (program: AnyNode, facts: SourceFacts): void => {
  const jsxNames = jsxRuntimeNames(program)
  const walk = (node: AnyNode, labelDepth: number): void => {
    const tag = jsxCallTag(node, jsxNames)
    if (tag === null) {
      for (const child of childNodes(node)) walk(child, labelDepth)
      return
    }
    facts.tags.add(tag)
    const args = Array.isArray(node.arguments) ? node.arguments.filter(isNode) : []
    const props = readProps(args[1])
    if (
      props.presence('className').kind !== 'absent' ||
      props.presence('style').kind !== 'absent'
    ) {
      facts.presentationAttribute = true
    }
    if (tag === 'label') {
      const htmlFor = props.presence('htmlFor')
      if (htmlFor.kind === 'literal') facts.labelForLiterals.add(htmlFor.value)
      if (htmlFor.kind === 'dynamic') facts.labelForDynamic = true
    }
    if (CONTROL_TAGS.has(tag)) {
      facts.controls.push({ tag, props, insideLabel: labelDepth > 0 })
    }
    const nextDepth = labelDepth + (tag === 'label' ? 1 : 0)
    for (const argument of args) walk(argument, nextDepth)
  }
  walk(program, 0)
}

const namePresence = (props: JsxProps, attributes: readonly string[]): PropPresence => {
  for (const attribute of attributes) {
    const presence = props.presence(attribute)
    if (presence.kind !== 'absent') return presence
  }
  return { kind: 'absent' }
}

const isNamedControl = (control: ControlFact, facts: SourceFacts, jsxNames: ReadonlySet<string>): boolean => {
  const { tag, props } = control
  const direct = namePresence(props, ['aria-label', 'aria-labelledby', 'title'])
  if (direct.kind === 'literal' || direct.kind === 'dynamic') return true
  if (direct.kind === 'empty') return false
  // Spread props can carry a name we cannot see statically; give the benefit
  // of the doubt instead of failing correct code.
  if (props.hasSpread) return true
  if (tag === 'a' || tag === 'button') {
    const evidence = childNameEvidence(props.childrenNode, jsxNames)
    return evidence.textLike || evidence.namedDescendant
  }
  const type = props.presence('type')
  if (tag === 'input' && type.kind === 'literal' && type.value === 'hidden') return true
  if (control.insideLabel) return true
  const id = props.presence('id')
  if (id.kind === 'literal') {
    return facts.labelForLiterals.has(id.value) || facts.labelForDynamic
  }
  if (id.kind === 'dynamic') {
    return facts.labelForLiterals.size > 0 || facts.labelForDynamic
  }
  return false
}

const analyzeSource = async (definition: ReactAppDefinition): Promise<SourceFacts> => {
  const facts: SourceFacts = {
    tags: new Set(),
    controls: [],
    labelForLiterals: new Set(),
    labelForDynamic: false,
    presentationAttribute: false,
  }
  const scripts = definition.files.filter(({ path }) => !path.endsWith('.css'))
  const programs = await Promise.all(
    scripts.map(async ({ path, content }) => {
      try {
        const lowered = await transform(content, {
          format: 'esm',
          jsx: 'automatic',
          jsxImportSource: 'react',
          loader: path.endsWith('.tsx') ? 'tsx' : 'ts',
          target: 'es2022',
        })
        return parse(lowered.code, { ecmaVersion: 'latest', sourceType: 'module' }) as unknown as AnyNode
      } catch {
        // A file that does not lower also fails compilation; the required
        // compile checks close the gate, so analysis just skips it.
        return null
      }
    }),
  )
  for (const program of programs) {
    if (program) collectFacts(program, facts)
  }
  return facts
}

const namedControlVerdict = (facts: SourceFacts): { controls: number; unnamed: number } => {
  // Re-derive per-file jsx names is unnecessary here: controls were collected
  // with their props already resolved, and child evidence only needs the jsx
  // calls nested inside those props, which acorn preserved. A conservative
  // superset of runtime names keeps the evidence walk working after esbuild's
  // import renaming.
  const jsxNames = new Set(['jsx', 'jsxs', 'jsxDEV', 'jsx2', 'jsxs2'])
  const unnamed = facts.controls.filter((control) => !isNamedControl(control, facts, jsxNames))
  return { controls: facts.controls.length, unnamed: unnamed.length }
}

const check = (
  id: string,
  label: string,
  verdict: QualityCheck['verdict'],
  criticality: QualityCheck['criticality'],
  detail: string,
): QualityCheck => ({ id, label, verdict, criticality, detail })

const sourceText = (definition: ReactAppDefinition): string =>
  definition.files.map(({ content }) => content).join('\n')

const hasUnsafeCapability = (source: string): boolean =>
  /https?:\/\//i.test(source) ||
  /["'`]\/\/[a-z0-9]/i.test(source) ||
  /\b(?:fetch|XMLHttpRequest|WebSocket|EventSource|sendBeacon)\s*\(/.test(source) ||
  /\b(?:window\.open|location\.(?:assign|replace))\s*\(/.test(source) ||
  /\b(?:(?:window|self)\.)?location(?:\.href)?\s*=/.test(source)

const boundedDetail = (diagnostics: readonly string[]): string => {
  const message = diagnostics.join(' ').replaceAll(/\s+/g, ' ').trim()
  return message.length > 460 ? `${message.slice(0, 457)}...` : message
}

export const evaluateReactApp = async (
  definition: ReactAppDefinition,
  compilation: ReactCompilation,
  evaluatedAt = new Date(),
): Promise<QualityReport> => {
  const source = sourceText(definition)
  const artifact = compilation.artifact
  const compiled = artifact !== null
  const unsafeCapability = hasUnsafeCapability(source)
  const facts = await analyzeSource(definition)
  const hasLandmarks = facts.tags.has('main') && facts.tags.has('h1')
  const { controls, unnamed } = namedControlVerdict(facts)
  const usesRuntime = /\b(?:inputs|store|files)\b/.test(source)
  const hasPresentation =
    definition.files.some(({ path, content }) => path.endsWith('.css') && content.trim()) ||
    facts.presentationAttribute
  const checks: QualityCheck[] = [
    check(
      'react-compilation',
      'React compilation',
      compiled ? 'pass' : 'fail',
      'required',
      artifact
        ? `The source compiled with React ${artifact.react} into one stored artifact.`
        : boundedDetail(compilation.diagnostics) || 'The React source did not compile.',
    ),
    check(
      'bounded-artifact',
      'Bounded artifact',
      compiled ? 'pass' : 'fail',
      'required',
      artifact
        ? `The JavaScript and CSS total ${artifact.javascriptBytes + artifact.stylesheetBytes} bytes.`
        : 'No executable artifact was produced.',
    ),
    check(
      'self-contained',
      'Self-contained and offline',
      unsafeCapability ? 'fail' : 'pass',
      'required',
      unsafeCapability
        ? 'External URLs, network APIs, and navigation APIs are not allowed.'
        : 'The source declares no external URLs, network APIs, or navigation APIs.',
    ),
    check(
      'document-landmarks',
      'Readable app landmarks',
      hasLandmarks ? 'pass' : 'fail',
      'required',
      hasLandmarks
        ? 'The React tree declares a main landmark and primary heading.'
        : 'Add one main landmark and one primary heading to the React tree.',
    ),
    check(
      'accessible-controls',
      'Named native controls',
      unnamed === 0 ? 'pass' : 'fail',
      'required',
      unnamed === 0
        ? `${controls} native control${controls === 1 ? '' : 's'} pass the source-level name check.`
        : `${unnamed} native control${unnamed === 1 ? '' : 's'} need visible text or an accessible name.`,
    ),
    check(
      'responsive-shell',
      'Responsive preview shell',
      compiled ? 'pass' : 'fail',
      'informational',
      compiled
        ? 'The harness supplies the responsive viewport and isolated preview shell.'
        : 'Responsive preview behavior can be checked after compilation succeeds.',
    ),
    check(
      'eevee-runtime',
      'EEVEE inputs or storage',
      usesRuntime ? 'pass' : 'fail',
      'informational',
      usesRuntime
        ? 'The source reads generated inputs or durable applet storage.'
        : 'The app is independent of its generated inputs and durable store.',
    ),
    check(
      'presentation-layer',
      'Intentional presentation layer',
      hasPresentation ? 'pass' : 'fail',
      'informational',
      hasPresentation
        ? 'The source includes a stylesheet, class names, or inline presentation rules.'
        : 'The source has no explicit presentation layer yet.',
    ),
  ]
  const requiredFailures = checks.filter(
    ({ criticality, verdict }) => criticality === 'required' && verdict === 'fail',
  ).length
  const informationalFailures = checks.filter(
    ({ criticality, verdict }) => criticality === 'informational' && verdict === 'fail',
  ).length
  return {
    evaluator: 'eevee.react-static@2',
    verdict: aggregateEvaluationVerdict(checks),
    score: Math.max(0, 100 - requiredFailures * 20 - informationalFailures * 5),
    checks,
    evaluatedAt: evaluatedAt.toISOString(),
  }
}
