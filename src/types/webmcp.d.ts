interface WebMcpToolAnnotations {
  readOnlyHint?: boolean
  untrustedContentHint?: boolean
}

interface WebMcpExecuteOptions {
  signal: AbortSignal
}

interface WebMcpTool {
  name: string
  title?: string
  description: string
  inputSchema?: object
  annotations?: WebMcpToolAnnotations
  execute(input: Record<string, unknown>, options: WebMcpExecuteOptions): Promise<unknown>
}

interface WebMcpRegisterOptions {
  exposedTo?: string[]
  signal?: AbortSignal
}

interface WebMcpModelContext {
  registerTool(tool: WebMcpTool, options?: WebMcpRegisterOptions): Promise<void>
}

interface Document {
  modelContext?: WebMcpModelContext
}

interface Window {
  eevee?: Readonly<{
    inputs: Readonly<Record<string, unknown>>
    media: Readonly<Record<string, unknown>> | null
    store: Readonly<{
      get(key: string): Promise<unknown>
      set(key: string, value: unknown): Promise<unknown>
      all(): Promise<Record<string, unknown>>
    }>
    files: Readonly<{
      list(): Promise<
        Array<{ id: string; name: string; medium: string; version: number; size: number }>
      >
      read(fileId: string): Promise<{
        id: string
        name: string
        medium: string
        version: number
        contentBase64: string
      }>
      table(
        fileId: string,
      ): Promise<Array<{ name: string; rows: Array<Array<string | number | boolean | null>> }>>
      text(fileId: string): Promise<string>
    }>
    actions: Readonly<{
      register(handlers: Readonly<Record<string, (input: Readonly<Record<string, unknown>>) => unknown>>): void
    }>
  }>
  __eeveeReady?: () => void
}
