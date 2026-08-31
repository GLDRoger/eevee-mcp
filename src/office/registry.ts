import type { MutableRefObject } from 'react'

export interface OfficeEditorSession {
  name: string
  bytes: Uint8Array
  revision: number
  onDirty: (dirty: boolean) => void
  exportRef: MutableRefObject<(() => Promise<Uint8Array>) | null>
}

export interface OfficeEditorProps {
  fileId: string | null
  onClose: () => void
  session?: OfficeEditorSession
}
