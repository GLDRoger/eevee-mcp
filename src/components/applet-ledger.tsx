import type { AppletSummary } from '@/domain/api'

const mediumLabel: Record<AppletSummary['medium'], string> = {
  'web-app': 'Web app',
  document: 'Document',
  spreadsheet: 'Sheet',
  presentation: 'Slides',
  pdf: 'PDF',
  workflow: 'Workflow',
  image: 'Image',
  video: 'Video',
}

export function AppletLedger({
  applets,
  selectedId,
  onSelect,
}: {
  applets: readonly AppletSummary[]
  selectedId: string | null
  onSelect: (appletId: string) => void
}) {
  return (
    <aside className="ledger" aria-label="Applet ledger">
      <div className="ledger-heading">
        <h1>Applet ledger</h1>
        <span>{applets.length}</span>
      </div>
      {applets.length === 0 ? (
        <div className="ledger-empty">
          <p>No applets have been registered.</p>
          <span>Ask your browser agent to create one through EEVEE.</span>
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
    </aside>
  )
}
