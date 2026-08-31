'use client'

import { lazy, Suspense } from 'react'
import type { OfficeFileDetail } from '@/domain/office-file'

const PdfEditor = lazy(() => import('@/office/pdf/full-pdf-editor'))
const DocumentEditor = lazy(() => import('@/office/docs'))
const SheetsEditor = lazy(() => import('@/office/sheets'))
const SlidesEditor = lazy(() => import('@/office/slides'))

export function FileInspector({
  detail,
}: {
  detail: OfficeFileDetail
}) {
  const { file } = detail
  return (
    <div className="file-inspector">
      <div className="office-editor-shell">
        {file.medium === 'document' ? (
          <Suspense fallback={<section className="file-preview">Opening Documents editor…</section>}>
            <DocumentEditor key={file.versionId} fileId={file.id} onClose={() => undefined} />
          </Suspense>
        ) : file.medium === 'pdf' ? (
          <Suspense fallback={<section className="file-preview">Opening PDF editor…</section>}>
            <PdfEditor key={file.versionId} file={file} />
          </Suspense>
        ) : file.medium === 'spreadsheet' ? (
          <Suspense fallback={<section className="file-preview">Opening Sheets editor…</section>}>
            <SheetsEditor key={file.versionId} fileId={file.id} onClose={() => undefined} />
          </Suspense>
        ) : file.medium === 'presentation' ? (
          <Suspense fallback={<section className="file-preview">Opening Slides editor…</section>}>
            <SlidesEditor key={file.versionId} fileId={file.id} onClose={() => undefined} />
          </Suspense>
        ) : null}
      </div>
    </div>
  )
}
