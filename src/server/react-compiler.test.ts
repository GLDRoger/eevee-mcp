import { describe, expect, it } from 'vitest'
import { reactAppDefinitionSchema, type ReactAppDefinition } from '@/domain/react-app'
import { compileReactApp } from './react-compiler'

const definition = (app: string, extraFiles: ReactAppDefinition['files'] = []): ReactAppDefinition =>
  reactAppDefinitionSchema.parse({
    kind: 'react-app',
    entry: 'src/App.tsx',
    files: [{ path: 'src/App.tsx', content: app }, ...extraFiles],
  })

describe('compileReactApp', () => {
  it('enforces source limits in encoded bytes', () => {
    expect(() =>
      definition(`export default () => <main><h1>${'🦊'.repeat(60_000)}</h1></main>`),
    ).toThrow('cannot exceed 200000 bytes')
  })

  it('bundles interactive React and CSS into one self-contained artifact', async () => {
    const compiled = await compileReactApp(
      definition(
        `
          import { useState } from 'react'
          import './app.css'
          export default function App({ inputs, store }) {
            const [count, setCount] = useState(0)
            return <main><h1>{String(inputs.title)}</h1><button onClick={() => {
              const next = count + 1
              setCount(next)
              void store.set('count', next)
            }}>Count {count}</button></main>
          }
        `,
        [{ path: 'src/app.css', content: 'button { color: rebeccapurple; }' }],
      ),
      new Date('2026-08-26T12:00:00.000Z'),
    )

    expect(compiled.diagnostics).toEqual([])
    expect(compiled.artifact).toMatchObject({
      kind: 'compiled-react-app',
      compiler: 'esbuild@0.28.2',
      react: '19.2.8',
      compiledAt: '2026-08-26T12:00:00.000Z',
    })
    expect(compiled.artifact?.html).toContain('<div id="root"></div>')
    expect(compiled.artifact?.html).toContain('button{color:#639}')
    expect(compiled.artifact?.javascriptBytes).toBeGreaterThan(0)
  })

  it.each([
    ['third-party package', "import map from 'lodash'; export default () => <main>{String(map)}</main>"],
    ['dynamic import', "void import('./feature'); export default () => <main />"],
    ['path traversal', "import thing from '../outside'; export default () => <main>{thing}</main>"],
    ['user react-dom', "import { createRoot } from 'react-dom/client'; export default () => <main>{String(createRoot)}</main>"],
    ['import meta', "export default () => <main>{String(import/**/.meta.url)}</main>"],
  ])('rejects %s', async (_name, source) => {
    const compiled = await compileReactApp(definition(source))
    expect(compiled.artifact).toBeNull()
    expect(compiled.diagnostics.join('\n')).not.toBe('')
  })

  it('returns diagnostics for invalid JSX instead of executing it', async () => {
    const compiled = await compileReactApp(definition('export default () => <main>'))
    expect(compiled.artifact).toBeNull()
    expect(compiled.diagnostics.join('\n')).toContain('Unexpected end of file')
  })
})
