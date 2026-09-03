'use client'

import { useState } from 'react'
import type { AppletSummary } from '@/domain/api'
import type { ReferenceAppletSlug } from '@/domain/reference-applet'

const mediumLabel: Record<AppletSummary['medium'], string> = {
  'web-app': 'Web app',
  document: 'Document',
  spreadsheet: 'Spreadsheet',
  presentation: 'Presentation',
  pdf: 'PDF',
  workflow: 'Workflow',
  image: 'Image',
  video: 'Video',
}

export function AppletLedger({
  applets,
  selectedId,
  onSelect,
  onInstallReference,
}: {
  applets: readonly AppletSummary[]
  selectedId: string | null
  onSelect: (appletId: string) => void
  onInstallReference: (slug: ReferenceAppletSlug) => Promise<void>
}) {
  const [installing, setInstalling] = useState<ReferenceAppletSlug | null>(null)
  const [error, setError] = useState('')

  const install = async (slug: ReferenceAppletSlug) => {
    setInstalling(slug)
    setError('')
    try {
      await onInstallReference(slug)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'The reference applet could not be installed')
    } finally {
      setInstalling(null)
    }
  }

  return (
    <aside className="ledger" aria-label="Applet ledger">
      <div className="ledger-heading">
        <h1>Applet ledger</h1>
        <span>{applets.length}</span>
      </div>
      {applets.length === 0 ? (
        <div className="ledger-empty">
          <p>No applets yet.</p>
          <span>
            Install the reference applet below (no agent needed), or ask your browser agent to
            create one.
          </span>
        </div>
      ) : (
        <ol className="ledger-list">
          {applets.map((applet, index) => {
            const live = Boolean(applet.activeVersionId)
            return (
              <li key={applet.id}>
                <button
                  className={selectedId === applet.id ? 'ledger-entry is-selected' : 'ledger-entry'}
                  type="button"
                  onClick={() => onSelect(applet.id)}
                >
                  <span className="ledger-index">{String(index + 1).padStart(2, '0')}</span>
                  <span className="ledger-entry-main">
                    <strong>{applet.name}</strong>
                    <span>{mediumLabel[applet.medium]}</span>
                  </span>
                  <span className={live ? 'ledger-state is-live' : 'ledger-state'}>
                    {live ? 'Live' : 'Draft'}
                  </span>
                </button>
              </li>
            )
          })}
        </ol>
      )}
      <section className="ledger-references" aria-labelledby="reference-applets-title">
        <p id="reference-applets-title">Reference applets</p>
        {([
          ['meridian', 'Meridian Ops', 'A seven-module ERP: inventory, orders, credit, invoicing, reports.'],
        ] as const).map(([slug, name, description]) => {
          const installed = applets.find((applet) => applet.name === name)
          return (
            <div className="ledger-reference" key={slug}>
              <strong>{name}</strong>
              <span>{description}</span>
              {installed ? (
                <button type="button" onClick={() => onSelect(installed.id)}>
                  Open the installed copy
                </button>
              ) : (
                <button
                  type="button"
                  disabled={installing !== null}
                  onClick={() => void install(slug)}
                >
                  {installing === slug ? 'Installing…' : 'Install as draft'}
                </button>
              )}
            </div>
          )
        })}
        {error ? <small role="alert">{error}</small> : null}
      </section>
    </aside>
  )
}
