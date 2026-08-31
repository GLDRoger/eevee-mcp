import { ownedArrayBuffer } from '@/domain/bytes'

export const downloadFile = (name: string, bytes: Uint8Array, type: string): void => {
  const url = URL.createObjectURL(new Blob([ownedArrayBuffer(bytes)], { type }))
  const link = document.createElement('a')
  link.href = url
  link.download = name
  link.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 0)
}
