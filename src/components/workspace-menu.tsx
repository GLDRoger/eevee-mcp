'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { api } from '@/client/api'

/**
 * The one place the workbench says where it sits and how to leave it. There
 * is no account: a workspace is this browser's cookie, so leaving is one way
 * and the menu says so before it lets you.
 */
export function WorkspaceMenu() {
  const router = useRouter()
  const [workspaceId, setWorkspaceId] = useState<string | null>(null)
  const [open, setOpen] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [leaving, setLeaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    const controller = new AbortController()
    api.session(controller.signal).then(
      (session) => setWorkspaceId(session.workspaceId),
      () => undefined,
    )
    return () => controller.abort()
  }, [])

  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    const onPointer = (event: PointerEvent) => {
      if (event.target instanceof Element && event.target.closest('.workspace-menu')) return
      setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('pointerdown', onPointer)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('pointerdown', onPointer)
    }
  }, [open])

  const leave = async () => {
    setLeaving(true)
    setError('')
    try {
      await api.leaveWorkspace()
      router.push('/')
      router.refresh()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not leave the workspace')
      setLeaving(false)
    }
  }

  return (
    <div className="workspace-menu">
      <button
        type="button"
        className="workspace-menu-toggle"
        aria-expanded={open}
        aria-haspopup="menu"
        title="This browser's workspace: go to the site, or leave and start empty"
        onClick={() => {
          setOpen((current) => !current)
          setConfirming(false)
        }}
      >
        Workspace
      </button>
      {open ? (
        <div className="workspace-menu-panel" role="menu">
          <p className="workspace-menu-id">
            Workspace {workspaceId ? workspaceId.slice(0, 8) : '…'} · lives in this browser
          </p>
          <Link href="/" role="menuitem" className="workspace-menu-item">
            About EEVEE
            <small>the landing page</small>
          </Link>
          {confirming ? (
            <div className="workspace-menu-confirm" role="alertdialog" aria-label="Leave this workspace?">
              <p>
                Leaving forgets this browser&rsquo;s workspace: its passkey, applets, files, and
                records. There is no account to sign back into.
              </p>
              <div>
                <button type="button" className="workspace-menu-leave" disabled={leaving} onClick={() => void leave()}>
                  {leaving ? 'Leaving…' : 'Leave and start empty'}
                </button>
                <button type="button" className="text-action" onClick={() => setConfirming(false)}>
                  Keep it
                </button>
              </div>
              {error ? <p className="form-error" role="alert">{error}</p> : null}
            </div>
          ) : (
            <button type="button" role="menuitem" className="workspace-menu-item" onClick={() => setConfirming(true)}>
              Leave workspace
              <small>sign out; starts a new empty one</small>
            </button>
          )}
        </div>
      ) : null}
    </div>
  )
}
