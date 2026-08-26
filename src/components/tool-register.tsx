'use client'

export function ToolRegister({
  supported,
  workspaceId,
}: {
  supported: boolean
  workspaceId: string | null
}) {
  return (
    <aside className="tool-register" aria-label="Agent connection">
      <span className={supported ? 'connection-mark is-connected' : 'connection-mark'} />
      <div>
        <strong>{supported ? 'Seven WebMCP tools registered' : 'WebMCP is not active here'}</strong>
        <p>
          {supported
            ? 'The browser agent can inspect and act. Publishing still requires you.'
            : 'Open this page in ChatGPT’s browser or enable WebMCP in Chrome.'}
        </p>
      </div>
      <span className="workspace-ref">
        {workspaceId ? `Workspace ${workspaceId.slice(0, 8)}` : 'Opening workspace'}
      </span>
    </aside>
  )
}
