'use client'

import { useState } from 'react'
import type { OfficeFileSummary } from '@/domain/office-file'
import { blankFile, type BlankFileKind } from '@/client/blank-files'

const mediumLabel: Record<OfficeFileSummary['medium'], string> = {
  document: 'Document',
  spreadsheet: 'Spreadsheet',
  presentation: 'Presentation',
  pdf: 'PDF',
}

const NEW_FILE_ACTIONS: ReadonlyArray<{ kind: BlankFileKind; label: string }> = [
  { kind: 'document', label: 'New document' },
  { kind: 'spreadsheet', label: 'New spreadsheet' },
  { kind: 'presentation', label: 'New presentation' },
]

export function StudioLedger({
  files,
  selectedId,
  onSelect,
  onCreate,
}: {
  files: readonly OfficeFileSummary[]
  selectedId: string | null
  onSelect: (fileId: string) => void
  onCreate: (name: string, bytes: Uint8Array) => Promise<void>
}) {
  const [creating, setCreating] = useState<BlankFileKind | null>(null)
  const [error, setError] = useState('')

  const create = async (kind: BlankFileKind) => {
    setCreating(kind)
    setError('')
    try {
      const created = await blankFile(kind)
      await onCreate(created.name, created.bytes)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'The file was not created')
    } finally {
      setCreating(null)
    }
  }

  return (
    <aside className="ledger" aria-label="Studio">
      <div className="ledger-heading">
        <h1>Studio</h1>
        <span>{files.length}</span>
      </div>
      <div className="studio-create">
        {NEW_FILE_ACTIONS.map(({ kind, label }) => (
          <button
            key={kind}
            className="library-upload"
            type="button"
            disabled={creating !== null}
            onClick={() => void create(kind)}
          >
            {creating === kind ? 'Creating' : label}
          </button>
        ))}
      </div>
      {error ? <p className="form-error" role="alert">{error}</p> : null}
      {files.length === 0 ? (
        <div className="ledger-empty">
          <p>Start from a blank file.</p>
          <span>Or import one in the Library; everything opens here with its full editor.</span>
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
