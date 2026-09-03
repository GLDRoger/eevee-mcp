'use client'

import { useCallback, useEffect, useState } from 'react'
import '@univerjs/preset-sheets-core/lib/index.css'
import type { OfficeEditorProps } from '../registry'
import { hostStorage, type DriveFileHandle, type StoredDriveFile } from '../host/storage'
import { OpenFromDrivePicker } from '../host/pickers'
import { createWebDesktopApi, type WebDesktopApi } from './host-api'
import { App } from './renderer/App'
import { LocaleProvider, setModuleLang } from './renderer/i18n/locale'
import type { WorkbookFile } from './shared/desktop-api'
import './renderer/styles.css'

export default function OfficeSheetsEditor({ fileId, onClose }: OfficeEditorProps) {
  const [openRequest, setOpenRequest] = useState<((handle: DriveFileHandle | null) => void) | null>(
    null,
  )
  const [files, setFiles] = useState<readonly StoredDriveFile[]>([])
  const [api, setApi] = useState<WebDesktopApi | null>(null)
  const [file, setFile] = useState<WorkbookFile | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)

  const requestOpen = useCallback(async (): Promise<DriveFileHandle | null> => {
    setFiles(
      (await hostStorage.list()).filter((item) => item.handle.name.toLowerCase().endsWith('.xlsx')),
    )
    return new Promise((resolve) => setOpenRequest(() => resolve))
  }, [])

  useEffect(() => {
    const next = createWebDesktopApi({ requestOpen })
    Object.defineProperty(window, 'desktopApi', { configurable: true, value: next })
    let active = true
    queueMicrotask(() => {
      if (active) setApi(next)
    })
    return () => {
      active = false
      next.dispose()
    }
  }, [requestOpen])

  useEffect(() => {
    if (!api) return
    let active = true
    let opened: WorkbookFile | null = null
    setModuleLang('en')
    setLoadError(null)
    void (async () => {
      const handle = fileId ? await handleFor(fileId) : null
      opened = handle ? await api.openHandle(handle) : await api.openBlank()
      if (active) setFile(opened)
      else await api.closeWorkbook(opened.sessionId)
    })().catch((reason: unknown) => {
      if (active)
        setLoadError(reason instanceof Error ? reason.message : 'The workbook could not be opened.')
    })
    return () => {
      active = false
      if (opened) void api.closeWorkbook(opened.sessionId)
    }
  }, [api, fileId])

  return (
    <section className="office-sheets" lang="en" aria-label="Sheets editor">
      <LocaleProvider initial="en">
        {file ? (
          <App key={file.sessionId} initialFile={file} onClose={onClose} />
        ) : loadError ? (
          <section className="file-preview" role="alert">
            This spreadsheet could not be opened: {loadError}
          </section>
        ) : null}
      </LocaleProvider>
      {openRequest ? (
        <OpenFromDrivePicker
          files={files}
          onClose={() => {
            openRequest(null)
            setOpenRequest(null)
          }}
          onOpen={(handle) => {
            openRequest(handle)
            setOpenRequest(null)
          }}
        />
      ) : null}
    </section>
  )
}

const handleFor = async (fileId: string): Promise<DriveFileHandle | null> =>
  (await hostStorage.list()).find((file) => file.handle.id === fileId)?.handle ?? null
