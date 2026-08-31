import { useEffect, useRef } from 'react'

/** Same cadence as the Docs autosave (30s tick + save on window blur) */
export const AUTOSAVE_INTERVAL_MS = 30_000

/**
 * Autosave scheduling calls `save` every `intervalMs` and when the page is hidden,
 * but only while `shouldSave()` reports pending changes.
 */
export function startAutosave(
  shouldSave: () => boolean,
  save: () => void,
  intervalMs: number = AUTOSAVE_INTERVAL_MS,
): () => void {
  const tick = () => {
    if (shouldSave()) save()
  }
  const id = window.setInterval(tick, intervalMs)
  const onVisibilityChange = () => {
    if (document.visibilityState === 'hidden') tick()
  }
  document.addEventListener('visibilitychange', onVisibilityChange)
  return () => {
    window.clearInterval(id)
    document.removeEventListener('visibilitychange', onVisibilityChange)
  }
}

/** React binding: installs the scheduler once and reads the latest callbacks through a ref */
export function useAutosave(shouldSave: () => boolean, save: () => void): void {
  const latest = useRef({ shouldSave, save })
  useEffect(() => {
    latest.current = { shouldSave, save }
  }, [shouldSave, save])
  useEffect(
    () =>
      startAutosave(
        () => latest.current.shouldSave(),
        () => latest.current.save(),
      ),
    [],
  )
}
