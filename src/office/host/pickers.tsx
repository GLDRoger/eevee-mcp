import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import type { DriveFileHandle, StoredDriveFile } from './storage'
import './pickers.css'

function DeskOverlay({
  label,
  onClose,
  children,
}: {
  label: string
  onClose: () => void
  children: ReactNode
}) {
  useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', escape)
    return () => window.removeEventListener('keydown', escape)
  }, [onClose])

  return (
    <div className="oh-overlay" role="dialog" aria-modal="true" aria-label={label}>
      <button className="oh-backdrop" type="button" aria-label="Close" onClick={onClose} />
      <div className="oh-dialog">{children}</div>
    </div>
  )
}

interface OpenFromDrivePickerProps {
  files: readonly StoredDriveFile[]
  onClose: () => void
  onOpen: (handle: DriveFileHandle) => void
}

interface SaveAsPromptProps {
  initialName: string
  onClose: () => void
  onSave: (name: string) => void
}

const sizeFormat = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 1 })
const dateFormat = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short' })

const formatSize = (bytes: number): string => {
  const unit = bytes >= 1_048_576 ? 1_048_576 : 1_024
  return `${sizeFormat.format(bytes / unit)} ${unit === 1_048_576 ? 'MB' : 'KB'}`
}

const fileKind = (name: string): string => name.split('.').at(-1)?.toUpperCase() ?? 'FILE'

export function OpenFromDrivePicker({ files, onClose, onOpen }: OpenFromDrivePickerProps) {
  return (
    <DeskOverlay label="Open from drive" onClose={onClose}>
      <section className="oh-picker">
        <header className="oh-head">
          <h2>Open from drive</h2>
          <button type="button" onClick={onClose}>
            Cancel
          </button>
        </header>
        <p className="oh-intro">Choose a file stored in EEVEE.</p>
        <div className="oh-files fd-collection fd-collection--list">
          {files.length === 0 ? <p className="oh-empty">No files are available.</p> : null}
          {files.map((file) => (
            <button
              className="fd-file oh-file"
              type="button"
              key={file.handle.id}
              data-overlay-autofocus={file === files[0] ? '' : undefined}
              onClick={() => onOpen(file.handle)}
            >
              <span className="oh-kind">{fileKind(file.handle.name)}</span>
              <strong>{file.handle.name}</strong>
              <span className="fd-provenance">{file.provenance.summary}</span>
              <span className="fd-meta ee-data">{formatSize(file.size)}</span>
              <time className="fd-date" dateTime={file.modified}>
                {dateFormat.format(new Date(file.modified))}
              </time>
            </button>
          ))}
        </div>
      </section>
    </DeskOverlay>
  )
}

export function SaveAsPrompt({ initialName, onClose, onSave }: SaveAsPromptProps) {
  const [name, setName] = useState(initialName)
  const [error, setError] = useState('')
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => input.current?.select(), [])

  const submit = (event: FormEvent) => {
    event.preventDefault()
    const value = name.trim()
    if (value.length === 0 || /[\\/\0]/.test(value)) {
      setError('Enter a file name without a path.')
      return
    }
    onSave(value)
  }

  return (
    <DeskOverlay label="Save as" onClose={onClose}>
      <form className="oh-save" onSubmit={submit}>
        <h2>Save a copy</h2>
        <p>Choose the name this copy will keep on your drive.</p>
        <label>
          File name
          <input
            ref={input}
            data-overlay-autofocus
            value={name}
            maxLength={255}
            aria-invalid={Boolean(error)}
            aria-describedby={error ? 'oh-save-error' : undefined}
            onChange={(event) => {
              setName(event.target.value)
              setError('')
            }}
          />
        </label>
        {error ? (
          <p className="oh-error" id="oh-save-error" role="alert">
            {error}
          </p>
        ) : null}
        <footer className="oh-actions">
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button className="ee-act" type="submit">
            Save copy
          </button>
        </footer>
      </form>
    </DeskOverlay>
  )
}
