'use client'

import { useCallback, useMemo, useState } from 'react'
import type { OfficeFileSummary } from '@/domain/office-file'
import { hostStorage } from '../host/storage'
import App from './App'
import { createPdfBrowserApi, type PdfBrowserApi } from './browser-api'
import './styles.css'

interface NamePrompt {
  initialName: string
  resolve: (name: string | null) => void
}

export default function FullPdfEditor({
  file,
}: {
  file: OfficeFileSummary
}) {
  const [namePrompt, setNamePrompt] = useState<NamePrompt | null>(null)

  const choosePdf = useCallback(
    (): Promise<Uint8Array | null> =>
      new Promise((resolve) => {
        const input = document.createElement('input')
        input.type = 'file'
        input.accept = 'application/pdf,.pdf'
        input.addEventListener('change', () => {
          const selected = input.files?.[0]
          if (!selected) return resolve(null)
          void selected.arrayBuffer().then(
            (buffer) => resolve(new Uint8Array(buffer)),
            () => resolve(null),
          )
        }, { once: true })
        input.click()
      }),
    [],
  )

  const requestName = useCallback(
    (initialName: string): Promise<string | null> =>
      new Promise((resolve) => setNamePrompt({ initialName, resolve })),
    [],
  )

  const api = useMemo<PdfBrowserApi>(
    () => createPdfBrowserApi({ storage: hostStorage, choosePdf, requestName }),
    [choosePdf, requestName],
  )

  return (
    <section className="office-pdf" aria-label={`${file.name} PDF editor`}>
      <App api={api} initialHandle={{ id: file.id, name: file.name }} onClose={() => undefined} />
      {namePrompt ? (
        <form
          className="office-name-prompt"
          onSubmit={(event) => {
            event.preventDefault()
            const data = new FormData(event.currentTarget)
            const name = data.get('name')
            namePrompt.resolve(typeof name === 'string' && name.trim() ? name.trim() : null)
            setNamePrompt(null)
          }}
        >
          <label>File name<input name="name" defaultValue={namePrompt.initialName} autoFocus /></label>
          <button type="button" onClick={() => {
            namePrompt.resolve(null)
            setNamePrompt(null)
          }}>Cancel</button>
          <button type="submit">Save</button>
        </form>
      ) : null}
    </section>
  )
}
