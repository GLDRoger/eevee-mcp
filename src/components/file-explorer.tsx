'use client'

import { useState } from 'react'
import type { OfficeFileDetail } from '@/domain/office-file'
import { api } from '@/client/api'
import { DocumentReview } from './document-review'

const mediumLabel = {
  document: 'Document',
  spreadsheet: 'Spreadsheet',
  presentation: 'Presentation',
  pdf: 'PDF',
} as const

const date = new Intl.DateTimeFormat('en', {
  day: '2-digit',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
})

const size = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function FileExplorer({
  detail,
  onOpenInStudio,
  onChanged,
  reviewFindingIds,
}: {
  detail: OfficeFileDetail
  onOpenInStudio: () => void
  onChanged: () => void
  reviewFindingIds?: readonly string[]
}) {
  const { file, versions } = detail
  const [restoringId, setRestoringId] = useState<string | null>(null)
  const [error, setError] = useState('')

  const contentUrl = (versionId?: string) =>
    `/api/files/${encodeURIComponent(file.id)}/content${
      versionId ? `?versionId=${encodeURIComponent(versionId)}` : ''
    }`

  const restore = async (versionId: string) => {
    setRestoringId(versionId)
    setError('')
    try {
      // Restoring never rewrites history: the old bytes become a NEW
      // immutable version on top of the register.
      const bytes = await api.readFile(file.id, versionId)
      await api.saveFile(file.id, file.versionId, bytes)
      onChanged()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'This version was not restored')
    } finally {
      setRestoringId(null)
    }
  }

  return (
    <article className="file-explorer">
      <header className="inspector-heading is-file">
        <div>
          <span>{mediumLabel[file.medium]}</span>
          <h2>{file.name}</h2>
          <p>
            {size(file.size)} · updated {date.format(new Date(file.updatedAt))} · checksum{' '}
            {file.sha256.slice(0, 12)}…
          </p>
        </div>
        <div className="file-explorer-actions">
          <button className="primary-action" type="button" onClick={onOpenInStudio}>
            Open in Studio
          </button>
          <a className="text-action" href={contentUrl()} download={file.name}>
            Download current
          </a>
        </div>
      </header>
      {file.medium === 'document' ? (
        <DocumentReview
          file={file}
          requestedFindingIds={reviewFindingIds}
          onChanged={onChanged}
        />
      ) : null}
      <section className="version-register" aria-labelledby="file-versions-title">
        <header>
          <h3 id="file-versions-title">Version register</h3>
          <span>{versions.length} immutable</span>
        </header>
        <ol>
          {versions.map((version) => {
            const current = version.id === file.versionId
            return (
              <li key={version.id}>
                <div className="version-number">v{version.version}</div>
                <div className="version-copy">
                  <strong>{version.note || 'Saved version'}</strong>
                  <span>
                    {date.format(new Date(version.createdAt))} · {size(version.size)}
                  </span>
                </div>
                <span className="file-version-actions">
                  <a
                    className="text-action"
                    href={contentUrl(version.id)}
                    download={file.name.replace(/(\.[a-z]+)$/i, `-v${version.version}$1`)}
                  >
                    Download
                  </a>
                  {current ? (
                    <span className="version-state">Current</span>
                  ) : (
                    <button
                      type="button"
                      disabled={restoringId !== null}
                      onClick={() => void restore(version.id)}
                    >
                      {restoringId === version.id ? 'Restoring' : 'Restore'}
                    </button>
                  )}
                </span>
              </li>
            )
          })}
        </ol>
      </section>
      {error ? <p className="form-error" role="alert">{error}</p> : null}
    </article>
  )
}
