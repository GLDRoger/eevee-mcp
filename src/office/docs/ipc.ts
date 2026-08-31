import type { DriveFileHandle } from '../host/storage'

export interface OpenFileResult {
  handle: DriveFileHandle
  data: Uint8Array
}

export interface PickImageResult {
  base64: string
  mime: 'image/png' | 'image/jpeg' | 'image/gif'
  name: string
}
