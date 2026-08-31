import { describe, expect, it } from 'vitest'
import { evaluateReactApp } from './react-app-quality'
import { reactAppDefinitionSchema, type ReactCompilation } from '@/domain/react-app'

const source = (content: string) =>
  reactAppDefinitionSchema.parse({
    kind: 'react-app',
    entry: 'src/App.tsx',
    files: [{ path: 'src/App.tsx', content }],
  })

const multiFile = (files: Array<{ path: string; content: string }>) =>
  reactAppDefinitionSchema.parse({ kind: 'react-app', entry: 'src/App.tsx', files })

const successfulCompilation: ReactCompilation = {
  artifact: {
    kind: 'compiled-react-app',
    html: '<!doctype html><html><head></head><body></body></html>',
    javascriptBytes: 180_000,
    stylesheetBytes: 1_000,
    compiler: 'esbuild@0.28.2',
    react: '19.2.8',
    compiledAt: '2026-08-26T12:00:00.000Z',
  },
  diagnostics: [],
}

const checkOf = (report: Awaited<ReturnType<typeof evaluateReactApp>>, id: string) =>
  report.checks.find((item) => item.id === id)

describe('evaluateReactApp', () => {
  it('passes a compiled, offline, accessible React app', async () => {
    const report = await evaluateReactApp(
      source(`
        export default function App({ inputs, store }) {
          return <main className="app"><h1>{String(inputs.title)}</h1>
            <button onClick={() => void store.set('saved', true)}>Save</button>
          </main>
        }
      `),
      successfulCompilation,
      new Date('2026-08-26T12:00:00.000Z'),
    )
    expect(report).toMatchObject({ verdict: 'pass', score: 100 })
    expect(report.checks.every(({ verdict }) => verdict === 'pass')).toBe(true)
  })

  it('fails required checks without using the diagnostic score as the gate', async () => {
    const report = await evaluateReactApp(
      source('export default () => <div><button /></div>'),
      successfulCompilation,
    )
    expect(report.verdict).toBe('fail')
    expect(report.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'document-landmarks', verdict: 'fail' }),
        expect.objectContaining({ id: 'accessible-controls', verdict: 'fail' }),
      ]),
    )
  })

  it('distinguishes icon-only controls from explicitly named and hidden controls', async () => {
    const unnamed = await evaluateReactApp(
      source('export default () => <main><h1>Tasks</h1><button><svg><path /></svg></button></main>'),
      successfulCompilation,
    )
    expect(checkOf(unnamed, 'accessible-controls')?.verdict).toBe('fail')

    const named = await evaluateReactApp(
      source(
        'export default () => <main><h1>Tasks</h1><button aria-label="Add" /><button>Save</button><input type="hidden" name="nonce" /></main>',
      ),
      successfulCompilation,
    )
    expect(checkOf(named, 'accessible-controls')?.verdict).toBe('pass')
  })

  it('blocks networked source and reports compiler diagnostics', async () => {
    const report = await evaluateReactApp(
      source(`export default () => <main><h1>Remote</h1>{fetch('/api')}</main>`),
      { artifact: null, diagnostics: ['Could not resolve source'] },
    )
    expect(report.verdict).toBe('fail')
    expect(checkOf(report, 'react-compilation')?.detail).toBe('Could not resolve source')
    expect(checkOf(report, 'self-contained')?.verdict).toBe('fail')
  })

  it('is not sensitive to JSX attribute order around arrow-function props', async () => {
    // Regression: the regex evaluator treated `=>` inside an earlier prop as
    // the tag close, so a control whose aria-label came after an arrow prop
    // failed the required accessibility check while the reordered twin passed.
    const labelAfterArrow = await evaluateReactApp(
      source(`
        export default function App() {
          return <main><h1>Split</h1>
            <input value="x" onChange={(e) => void e} aria-label="Amount" />
            <button type="button" onClick={() => void 0}>Add</button>
          </main>
        }
      `),
      successfulCompilation,
    )
    expect(checkOf(labelAfterArrow, 'accessible-controls')?.verdict).toBe('pass')
    expect(labelAfterArrow.verdict).toBe('pass')
  })

  it('accepts label-wrapped fields and htmlFor associations', async () => {
    const report = await evaluateReactApp(
      source(`
        export default function App() {
          return <main><h1>Form</h1>
            <label>Name<input name="name" /></label>
            <label htmlFor="age">Age</label>
            <input id="age" type="number" />
          </main>
        }
      `),
      successfulCompilation,
    )
    expect(checkOf(report, 'accessible-controls')?.verdict).toBe('pass')
  })

  it('finds landmarks contributed by a separate component file', async () => {
    // Regression: landmark detection required the literal tags inside one
    // file; an app composing through a Layout component false-failed.
    const report = await evaluateReactApp(
      multiFile([
        {
          path: 'src/App.tsx',
          content: `
            import { Layout } from './Layout'
            export default function App() {
              return <Layout title="Report"><p>Body</p></Layout>
            }
          `,
        },
        {
          path: 'src/Layout.tsx',
          content: `
            export function Layout({ title, children }: { title: string; children?: unknown }) {
              return <main><h1>{title}</h1>{children}</main>
            }
          `,
        },
      ]),
      successfulCompilation,
    )
    expect(checkOf(report, 'document-landmarks')?.verdict).toBe('pass')
  })

  it('treats dynamic button content as readable text', async () => {
    const report = await evaluateReactApp(
      source(`
        export default function App({ inputs }) {
          return <main><h1>Counts</h1><button type="button">{String(inputs.label)}</button></main>
        }
      `),
      successfulCompilation,
    )
    expect(checkOf(report, 'accessible-controls')?.verdict).toBe('pass')
  })

  it('still fails an aria-label that is an empty string', async () => {
    const report = await evaluateReactApp(
      source('export default () => <main><h1>Bad</h1><button aria-label="" /></main>'),
      successfulCompilation,
    )
    expect(checkOf(report, 'accessible-controls')?.verdict).toBe('fail')
  })
})
