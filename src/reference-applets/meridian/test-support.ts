/**
 * Test support for the Meridian reference applet: bundle any subset of its
 * template-string sources with esbuild and evaluate the result in node:vm so
 * unit tests can call the applet's pure logic directly.
 */
import { createRequire } from 'node:module'
import { posix } from 'node:path'
import { runInThisContext } from 'node:vm'
import { build, type Plugin } from 'esbuild'
import { meridianVersion } from './index'

const NAMESPACE = 'meridian'
const ENTRY = 'src/test-entry.tsx'
const extensions = ['', '.tsx', '.ts', '.css']

export const meridianFiles = new Map(
  meridianVersion.definition.files.map(({ path, content }) => [path, content]),
)

const virtualPlugin: Plugin = {
  name: 'meridian-virtual-source',
  setup: (compiler) => {
    compiler.onResolve({ filter: /^\.\.?\// }, (args) => {
      const importer = args.namespace === NAMESPACE ? args.importer : ENTRY
      const base = posix.normalize(posix.join(posix.dirname(importer), args.path))
      const resolved = extensions.map((extension) => `${base}${extension}`).find((path) => meridianFiles.has(path))
      if (!resolved) return { errors: [{ text: `Meridian source does not exist: ${args.path}` }] }
      return { path: resolved, namespace: NAMESPACE }
    })
    compiler.onLoad({ filter: /.*/, namespace: NAMESPACE }, (args) => {
      const contents = meridianFiles.get(args.path) ?? ''
      if (args.path.endsWith('.css')) return { contents: '', loader: 'js' }
      return { contents, loader: args.path.endsWith('.tsx') ? 'tsx' : 'ts' }
    })
  },
}

/** Bundle an entry that imports Meridian sources and return its CommonJS exports. */
export const bundleMeridian = async (entrySource: string): Promise<Record<string, unknown>> => {
  const result = await build({
    stdin: { contents: entrySource, resolveDir: '/src', loader: 'tsx', sourcefile: ENTRY },
    bundle: true,
    format: 'cjs',
    platform: 'node',
    write: false,
    jsx: 'automatic',
    jsxImportSource: 'react',
    target: 'es2022',
    logLevel: 'silent',
    external: ['react', 'react/jsx-runtime'],
    plugins: [virtualPlugin],
  })
  const code = result.outputFiles[0]?.text ?? ''
  const bundle = { exports: {} as Record<string, unknown> }
  const factory = runInThisContext(`(function (module, exports, require) {${code}\n})`) as (
    bundle: { exports: Record<string, unknown> },
    exports: Record<string, unknown>,
    require: NodeJS.Require,
  ) => void
  factory(bundle, bundle.exports, createRequire(import.meta.url))
  return bundle.exports
}

export type MeridianState = {
  products: Array<{ id: string; sku: string; category: string; stock: number; cost: number; tracked: boolean; archived: boolean }>
  customers: Array<{ id: string; name: string; hold: boolean; creditLimit: number; terms: string }>
  orders: Array<{ id: string; number: string; state: string; customerId: string; lines: Array<{ productId: string; qty: number; price: number }> }>
  invoices: Array<{ id: string; number: string; orderId: string; state: string; total: number; dueAt: string; payments: Array<{ amount: number }> }>
  audit: Array<{ at: string; entry: string }>
  seq: Record<string, number>
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type MeridianLib = Record<string, (...args: any[]) => any>

export const loadMeridianLib = async (): Promise<MeridianLib> =>
  (await bundleMeridian(
    "export * from './lib/model'; export * from './lib/logic'; export * from './lib/reports'; export * from './lib/format'",
  )) as MeridianLib
