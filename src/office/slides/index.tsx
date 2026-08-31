import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { OfficeEditorProps } from '../registry'
import { SaveAsPrompt } from '../host/pickers'
import { hostStorage } from '../host/storage'
import { App } from './App'
import { heuristicFontMetrics, loadOfficeFontMetrics } from './fonts'
import { LocaleProvider, setModuleLang } from './i18n/locale'
import { setFontMetrics } from './session'
import { createSlidesApi, type PickedBytes } from './slides-api'
import './styles.css'

interface NamePrompt {
  initialName: string
  resolve: (name: string | null) => void
}

function pickViaInput(
  input: HTMLInputElement | null,
  accept: string,
  resolve: (files: File[] | null) => void,
): void {
  if (!input) {
    resolve(null)
    return
  }
  input.accept = accept
  input.onchange = () => {
    const files = input.files ? [...input.files] : []
    input.value = ''
    resolve(files.length ? files : null)
  }
  input.click()
}

async function fileToPicked(file: File | undefined): Promise<PickedBytes | null> {
  if (!file) return null
  return { name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) }
}

export default function OfficeSlidesEditor({ fileId, onClose }: OfficeEditorProps) {
  const [namePrompt, setNamePrompt] = useState<NamePrompt | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const pickRef = useRef<((files: File[] | null) => void) | null>(null)

  useEffect(() => {
    setModuleLang('en')
    setFontMetrics(heuristicFontMetrics())
    void loadOfficeFontMetrics().then((metrics) => setFontMetrics(metrics))
  }, [])

  const requestName = useCallback(
    (initialName: string): Promise<string | null> =>
      new Promise((resolve) => setNamePrompt({ initialName, resolve })),
    [],
  )

  const pickFiles = useCallback(
    (accept: string): Promise<File[] | null> =>
      new Promise((resolve) => {
        pickRef.current = resolve
        pickViaInput(fileInput.current, accept, resolve)
      }),
    [],
  )

  const api = useMemo(() => {
    return createSlidesApi({
      storage: hostStorage,
      pendingFileId: fileId,
      pickImage: async () => fileToPicked((await pickFiles('image/*'))?.[0]),
      pickMedia: async (kind) =>
        fileToPicked((await pickFiles(kind === 'video' ? 'video/*' : 'audio/*'))?.[0]),
      pickModel: async () => fileToPicked((await pickFiles('.glb,.gltf,model/gltf-binary'))?.[0]),
      requestName,
    })
  }, [fileId, pickFiles, requestName])

  window.slidesApi = api

  return (
    <section className="office-slides" aria-label="Slides editor">
      <input
        ref={fileInput}
        type="file"
        hidden
        multiple
        onChange={(event) => {
          const files = event.currentTarget.files ? [...event.currentTarget.files] : []
          event.currentTarget.value = ''
          pickRef.current?.(files.length ? files : null)
          pickRef.current = null
        }}
      />
      <LocaleProvider initial="en">
        <App onClose={onClose} />
      </LocaleProvider>
      {namePrompt ? (
        <SaveAsPrompt
          initialName={namePrompt.initialName}
          onClose={() => {
            namePrompt.resolve(null)
            setNamePrompt(null)
          }}
          onSave={(name) => {
            namePrompt.resolve(name)
            setNamePrompt(null)
          }}
        />
      ) : null}
    </section>
  )
}
