'use client'

import { useRef, useState } from 'react'
import type { OfficeFileSummary } from '@/domain/office-file'

const mediumLabel: Record<OfficeFileSummary['medium'], string> = {
  document: 'Document',
  spreadsheet: 'Spreadsheet',
  presentation: 'Presentation',
  pdf: 'PDF',
}

export function LibraryLedger({
  files,
  selectedId,
  onSelect,
  onUpload,
}: {
  files: readonly OfficeFileSummary[]
  selectedId: string | null
  onSelect: (fileId: string) => void
  onUpload: (file: File) => Promise<void>
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)

  return (
    <aside className="ledger" aria-label="File library">
      <div className="ledger-heading">
        <h1>Library</h1>
        <span>{files.length}</span>
      </div>
      <input
        ref={inputRef}
        type="file"
        accept=".docx,.xlsx,.pptx,.pdf"
        hidden
        onChange={(event) => {
          const file = event.currentTarget.files?.[0]
          event.currentTarget.value = ''
          if (!file) return
          setUploading(true)
          void onUpload(file).catch(() => undefined).finally(() => setUploading(false))
        }}
      />
      <button
        className="library-upload"
        type="button"
        disabled={uploading}
        onClick={() => inputRef.current?.click()}
      >
        {uploading ? 'Importing file' : 'Import Office file'}
      </button>
      {files.length === 0 ? (
        <div className="ledger-empty">
          <p>Your working files will live here.</p>
          <span>Import a DOCX, XLSX, PPTX, or PDF to keep it versioned in EEVEE.</span>
        </div>
      ) : (
        <ol className="ledger-list">
          {files.map((file, index) => (
            <li key={file.id}>
              <button
                className={selectedId === file.id ? 'ledger-entry is-selected' : 'ledger-entry'}
                type="button"
                onClick={() => onSelect(file.id)}
              >
                <span className="ledger-index">{String(index + 1).padStart(2, '0')}</span>
                <span className="ledger-entry-main">
                  <strong>{file.name}</strong>
                  <span>{mediumLabel[file.medium]}</span>
                </span>
                <span className="ledger-state">v{file.version}</span>
              </button>
            </li>
          ))}
        </ol>
      )}
    </aside>
  )
}
