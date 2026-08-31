import { downloadFile } from '../host/download'
import { hostStorage, type DriveFileHandle, type StoredDriveFile } from '../host/storage'
import type { OpenFileResult, PickImageResult } from './ipc'

const IMAGE_MIME = {
  gif: 'image/gif',
  jpeg: 'image/jpeg',
  jpg: 'image/jpeg',
  png: 'image/png',
} as const

const extensionOf = (name: string): string => name.split('.').at(-1)?.toLowerCase() ?? ''

const imageMime = (extension: string): PickImageResult['mime'] | null => {
  if (extension === 'png') return IMAGE_MIME.png
  if (extension === 'jpg') return IMAGE_MIME.jpg
  if (extension === 'jpeg') return IMAGE_MIME.jpeg
  if (extension === 'gif') return IMAGE_MIME.gif
  return null
}

const chooseImage = (): Promise<File | null> =>
  new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'image/png,image/jpeg,image/gif'
    const finish = () => resolve(input.files?.[0] ?? null)
    input.addEventListener('change', finish, { once: true })
    input.addEventListener('cancel', finish, { once: true })
    input.click()
  })

const pickImage = async (): Promise<PickImageResult | null> => {
  const file = await chooseImage()
  if (!file) return null
  if (file.size > 5 * 1024 * 1024) throw new Error('Images must be 5 MB or smaller')
  const mime = imageMime(extensionOf(file.name))
  if (!mime) return null
  const bytes = new Uint8Array(await file.arrayBuffer())
  const binary = Array.from(bytes, (byte) => String.fromCharCode(byte)).join('')
  return { base64: window.btoa(binary), mime, name: file.name }
}

export const downloadDocx = (name: string, bytes: Uint8Array): void => {
  const target = name.toLocaleLowerCase('en-US').endsWith('.docx') ? name : `${name}.docx`
  downloadFile(
    target,
    bytes,
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  )
}

export interface DocumentsBrowserApi {
  open(handle: DriveFileHandle): Promise<OpenFileResult>
  findDocument(fileId: string): Promise<DriveFileHandle>
  listDocuments(): Promise<readonly StoredDriveFile[]>
  recent(limit?: number): Promise<readonly StoredDriveFile[]>
  save(handle: DriveFileHandle, bytes: Uint8Array): Promise<void>
  saveAs(name: string, bytes: Uint8Array): Promise<DriveFileHandle>
  saveNew(name: string, bytes: Uint8Array): Promise<DriveFileHandle>
  pickImage(): Promise<PickImageResult | null>
}

const listDocuments = async (): Promise<readonly StoredDriveFile[]> =>
  (await hostStorage.list()).filter((file) => extensionOf(file.handle.name) === 'docx')

export const desktopApi: DocumentsBrowserApi = {
  async open(handle) {
    return { handle, data: await hostStorage.open(handle) }
  },
  async findDocument(fileId) {
    const file = (await listDocuments()).find((candidate) => candidate.handle.id === fileId)
    if (!file) throw new Error('This document is no longer available')
    return file.handle
  },
  listDocuments,
  recent: (limit) => hostStorage.recent(limit),
  save: (handle, bytes) => hostStorage.save(handle, bytes),
  saveAs: (name, bytes) => hostStorage.saveAs(name, bytes),
  saveNew: (name, bytes) => hostStorage.create(name, bytes),
  pickImage,
}
