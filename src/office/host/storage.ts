'use client'

import { api } from '@/client/api'
import type { WorkbookSaveRequest } from '@/office/sheets/shared/desktop-api'

export interface DriveFileHandle {
  readonly id: string
  readonly name: string
}

export interface StoredDriveFile {
  readonly handle: DriveFileHandle
  readonly size: number
  readonly modified: string
  readonly provenance: { readonly summary: string }
}

export interface HostStorage {
  open(handle: DriveFileHandle): Promise<Uint8Array>
  save(handle: DriveFileHandle, bytes: Uint8Array): Promise<void>
  saveAs(name: string, bytes: Uint8Array): Promise<DriveFileHandle>
  create(name: string, bytes: Uint8Array): Promise<DriveFileHandle>
  list(): Promise<readonly StoredDriveFile[]>
  recent(limit?: number): Promise<readonly StoredDriveFile[]>
}

const versions = new Map<string, string>()

const changed = (fileId: string, select = false): void => {
  window.dispatchEvent(new CustomEvent('eevee:files-changed', { detail: { fileId, select } }))
}

const stored = (file: Awaited<ReturnType<typeof api.listFiles>>['files'][number]): StoredDriveFile => {
  versions.set(file.id, file.versionId)
  return {
    handle: { id: file.id, name: file.name },
    size: file.size,
    modified: file.updatedAt,
    provenance: { summary: `Version ${file.version} · Saved in EEVEE` },
  }
}

const baseVersion = async (fileId: string): Promise<string> => {
  const known = versions.get(fileId)
  if (known) return known
  const response = await api.inspectFile(fileId)
  versions.set(fileId, response.detail.file.versionId)
  return response.detail.file.versionId
}

const create = async (name: string, bytes: Uint8Array): Promise<DriveFileHandle> => {
  const response = await api.uploadFile(name, bytes)
  versions.set(response.file.id, response.file.versionId)
  changed(response.file.id, true)
  return { id: response.file.id, name: response.file.name }
}

export const hostStorage: HostStorage = {
  async open(handle) {
    const response = await api.inspectFile(handle.id)
    versions.set(handle.id, response.detail.file.versionId)
    return api.readFile(handle.id, response.detail.file.versionId)
  },
  async save(handle, bytes) {
    const response = await api.saveFile(handle.id, await baseVersion(handle.id), bytes)
    versions.set(handle.id, response.file.versionId)
    changed(handle.id)
  },
  saveAs: create,
  create,
  async list() {
    return (await api.listFiles()).files.map(stored)
  },
  async recent(limit = 10) {
    if (!Number.isInteger(limit) || limit < 0) throw new Error('Recent file limit must be non-negative')
    return (await api.listFiles()).files.slice(0, limit).map(stored)
  },
}

export const saveSpreadsheetEdits = async (
  handle: DriveFileHandle,
  request: WorkbookSaveRequest,
): Promise<{ bytes: Uint8Array; touchedEntries: readonly string[] }> => {
  const response = await api.editSpreadsheet(handle.id, await baseVersion(handle.id), request)
  versions.set(handle.id, response.file.versionId)
  changed(handle.id)
  return {
    bytes: await api.readFile(handle.id, response.file.versionId),
    touchedEntries: response.touchedEntries,
  }
}
