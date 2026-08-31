import { z } from 'zod'

export const REACT_APP_ENTRY = 'src/App.tsx'
export const MAX_REACT_APP_FILES = 16
export const MAX_REACT_APP_FILE_BYTES = 200_000
export const MAX_REACT_APP_SOURCE_BYTES = 1_000_000
export const MAX_REACT_APP_BUNDLE_BYTES = 2_000_000

const sourcePath = /^src\/(?:[a-zA-Z0-9_-]+\/)*[a-zA-Z0-9_-]+\.(?:css|ts|tsx)$/

export const reactAppFileSchema = z.strictObject({
  path: z
    .string()
    .min(1)
    .max(240)
    .regex(sourcePath, 'Use a relative src/ path ending in .ts, .tsx, or .css'),
  content: z.string().max(MAX_REACT_APP_SOURCE_BYTES),
})

export const reactAppDefinitionSchema = z
  .strictObject({
    kind: z.literal('react-app'),
    entry: z.literal(REACT_APP_ENTRY),
    files: z.array(reactAppFileSchema).min(1).max(MAX_REACT_APP_FILES),
  })
  .superRefine(({ files }, context) => {
    const paths = new Set<string>()
    let sourceBytes = 0
    for (const [index, file] of files.entries()) {
      if (paths.has(file.path)) {
        context.addIssue({
          code: 'custom',
          message: `Duplicate source path: ${file.path}`,
          path: ['files'],
        })
      }
      paths.add(file.path)
      const fileBytes = new TextEncoder().encode(file.content).byteLength
      if (fileBytes > MAX_REACT_APP_FILE_BYTES) {
        context.addIssue({
          code: 'custom',
          message: `One React source file cannot exceed ${MAX_REACT_APP_FILE_BYTES} bytes`,
          path: ['files', index, 'content'],
        })
      }
      sourceBytes += fileBytes
    }
    if (!paths.has(REACT_APP_ENTRY)) {
      context.addIssue({
        code: 'custom',
        message: `${REACT_APP_ENTRY} is required`,
        path: ['files'],
      })
    }
    if (sourceBytes > MAX_REACT_APP_SOURCE_BYTES) {
      context.addIssue({
        code: 'custom',
        message: `React source cannot exceed ${MAX_REACT_APP_SOURCE_BYTES} bytes`,
        path: ['files'],
      })
    }
  })

export const webAppArtifactSchema = z.strictObject({
  kind: z.literal('compiled-react-app'),
  html: z.string().min(1),
  javascriptBytes: z.number().int().nonnegative(),
  stylesheetBytes: z.number().int().nonnegative(),
  compiler: z.literal('esbuild@0.28.2'),
  react: z.literal('19.2.8'),
  compiledAt: z.iso.datetime({ offset: true }),
})

export type ReactAppDefinition = z.infer<typeof reactAppDefinitionSchema>
export type ReactAppFile = z.infer<typeof reactAppFileSchema>
export type WebAppArtifact = z.infer<typeof webAppArtifactSchema>
export type ReactCompilation = {
  artifact: WebAppArtifact | null
  diagnostics: string[]
}
