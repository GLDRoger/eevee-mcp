import 'server-only'
import { join, posix } from 'node:path'
import { build, formatMessages, type BuildFailure, type Loader, type Plugin } from 'esbuild'
import {
  MAX_REACT_APP_BUNDLE_BYTES,
  REACT_APP_ENTRY,
  type ReactCompilation,
  type ReactAppDefinition,
} from '@/domain/react-app'

const VIRTUAL_NAMESPACE = 'eevee-source'
const HARNESS_ENTRY = 'eevee-entry.tsx'
const reactPackagePaths = new Map([
  ['react', join(process.cwd(), 'node_modules', 'react', 'index.js')],
  ['react/jsx-runtime', join(process.cwd(), 'node_modules', 'react', 'jsx-runtime.js')],
])
const reactDomClientPath = join(process.cwd(), 'node_modules', 'react-dom', 'client.js')
const sourceExtensions = ['', '.tsx', '.ts', '.css', '/index.tsx', '/index.ts', '/index.css']

const isBuildFailure = (error: unknown): error is BuildFailure =>
  error instanceof Error &&
  'errors' in error &&
  Array.isArray(error.errors) &&
  error.errors.every(
    (message) =>
      typeof message === 'object' &&
      message !== null &&
      'text' in message &&
      typeof message.text === 'string',
  )

const harnessSource = `
import React, { StrictMode, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import App, * as AppletModule from './${REACT_APP_ENTRY}';

function EeveeHarness() {
  useEffect(() => {
    window.eevee.actions.register(AppletModule.actions ?? {});
    window.__eeveeReady();
  }, []);
  return <App inputs={window.eevee.inputs} store={window.eevee.store} />;
}

const root = document.getElementById('root');
if (!root) throw new Error('EEVEE could not find the applet root');
createRoot(root).render(
  <StrictMode>
    <EeveeHarness />
  </StrictMode>,
);
`

const loaderFor = (sourcePath: string): Loader => {
  if (sourcePath.endsWith('.tsx')) return 'tsx'
  if (sourcePath.endsWith('.ts')) return 'ts'
  return 'css'
}

const relativeSource = (
  files: ReadonlyMap<string, string>,
  importer: string,
  specifier: string,
): string | null => {
  const base = posix.normalize(posix.join(posix.dirname(importer), specifier))
  if (!base.startsWith('src/')) return null
  return sourceExtensions.map((extension) => `${base}${extension}`).find((path) => files.has(path)) ?? null
}

const compilerPlugin = (files: ReadonlyMap<string, string>): Plugin => ({
  name: 'eevee-react-source',
  setup: (compiler) => {
    compiler.onResolve({ filter: /^eevee-entry\.tsx$/ }, () => ({
      path: HARNESS_ENTRY,
      namespace: VIRTUAL_NAMESPACE,
    }))
    compiler.onResolve({ filter: /.*/, namespace: VIRTUAL_NAMESPACE }, (args) => {
      if (args.kind === 'dynamic-import') {
        return { errors: [{ text: 'Dynamic imports are not allowed in EEVEE applets' }] }
      }
      if (
        args.kind === 'url-token' &&
        (args.path.startsWith('data:') || args.path.startsWith('#'))
      ) {
        return { path: args.path, external: true }
      }
      if (args.path === 'react-dom/client' && args.importer === HARNESS_ENTRY) {
        return { path: reactDomClientPath }
      }
      const reactPackagePath = reactPackagePaths.get(args.path)
      if (reactPackagePath) return { path: reactPackagePath }
      if (!args.path.startsWith('.')) {
        return { errors: [{ text: `Package or URL imports are not allowed: ${args.path}` }] }
      }
      const resolved = relativeSource(files, args.importer, args.path)
      return resolved
        ? { path: resolved, namespace: VIRTUAL_NAMESPACE }
        : { errors: [{ text: `Source import does not exist or leaves src/: ${args.path}` }] }
    })
    compiler.onLoad({ filter: /.*/, namespace: VIRTUAL_NAMESPACE }, (args) => {
      if (args.path === HARNESS_ENTRY) return { contents: harnessSource, loader: 'tsx' }
      const contents = files.get(args.path)
      return contents === undefined
        ? { errors: [{ text: `Source file does not exist: ${args.path}` }] }
        : { contents, loader: loaderFor(args.path) }
    })
  },
})

const escapeRawTextEndTag = (value: string, tag: 'script' | 'style'): string =>
  value.replaceAll(new RegExp(`</${tag}`, 'gi'), `<\\/${tag}`)

const artifactHtml = (javascript: string, stylesheet: string): string => `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>EEVEE applet</title>
    ${stylesheet ? `<style>${escapeRawTextEndTag(stylesheet, 'style')}</style>` : ''}
  </head>
  <body>
    <div id="root"></div>
    <script>${escapeRawTextEndTag(javascript, 'script')}</script>
  </body>
</html>`

export const compileReactApp = async (
  definition: ReactAppDefinition,
  compiledAt = new Date(),
): Promise<ReactCompilation> => {
  const files = new Map(definition.files.map(({ path, content }) => [path, content]))
  try {
    const result = await build({
      absWorkingDir: '/',
      bundle: true,
      define: { 'process.env.NODE_ENV': '"production"' },
      entryPoints: [{ in: HARNESS_ENTRY, out: 'applet' }],
      format: 'iife',
      jsx: 'automatic',
      jsxImportSource: 'react',
      legalComments: 'none',
      logLevel: 'silent',
      logOverride: { 'empty-import-meta': 'error' },
      minify: true,
      outdir: 'out',
      platform: 'browser',
      plugins: [compilerPlugin(files)],
      sourcemap: false,
      target: 'es2022',
      treeShaking: true,
      write: false,
    })
    const javascript = result.outputFiles.find(({ path }) => path.endsWith('.js'))?.text
    const stylesheet = result.outputFiles.find(({ path }) => path.endsWith('.css'))?.text ?? ''
    if (!javascript) throw new Error('The React compiler did not produce JavaScript')
    const totalBytes = new TextEncoder().encode(javascript + stylesheet).byteLength
    if (totalBytes > MAX_REACT_APP_BUNDLE_BYTES) {
      return {
        artifact: null,
        diagnostics: [`Compiled applets cannot exceed ${MAX_REACT_APP_BUNDLE_BYTES} bytes`],
      }
    }
    return {
      artifact: {
        kind: 'compiled-react-app',
        html: artifactHtml(javascript, stylesheet),
        javascriptBytes: new TextEncoder().encode(javascript).byteLength,
        stylesheetBytes: new TextEncoder().encode(stylesheet).byteLength,
        compiler: 'esbuild@0.28.2',
        react: '19.2.8',
        compiledAt: compiledAt.toISOString(),
      },
      diagnostics: [],
    }
  } catch (error) {
    if (!isBuildFailure(error)) throw error
    return {
      artifact: null,
      diagnostics: await formatMessages(error.errors, { color: false, kind: 'error' }),
    }
  }
}
