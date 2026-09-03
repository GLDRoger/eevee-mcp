'use client'

import { useEffect, useState } from 'react'
import {
  TOOL_ACTIVITY_EVENT,
  toolActivitySchema,
  type ToolActivity,
} from '@/client/tool-activity'
import type { ToolRegistration } from '@/client/webmcp'
import { MissionPlanStrip } from './mission-plan'

const MAX_ENTRIES = 40

const time = new Intl.DateTimeFormat('en', {
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
})

const duration = (activity: ToolActivity): string => {
  if (activity.durationMs === null) return ''
  if (activity.durationMs < 1000) return ` · ${activity.durationMs}ms`
  return ` · ${(activity.durationMs / 1000).toFixed(1)}s`
}

export function AgentActivity({ toolsLive }: { toolsLive: ToolRegistration | null }) {
  const [entries, setEntries] = useState<ToolActivity[]>([])

  useEffect(() => {
    const listen = (event: Event) => {
      if (!(event instanceof CustomEvent)) return
      const parsed = toolActivitySchema.safeParse(event.detail)
      if (!parsed.success) return
      const activity = parsed.data
      setEntries((current) => {
        const index = current.findIndex(({ id }) => id === activity.id)
        if (index === -1) return [activity, ...current].slice(0, MAX_ENTRIES)
        return current.map((entry, position) => (position === index ? activity : entry))
      })
    }
    window.addEventListener(TOOL_ACTIVITY_EVENT, listen)
    return () => window.removeEventListener(TOOL_ACTIVITY_EVENT, listen)
  }, [])

  const working = entries.some(({ phase }) => phase === 'started')

  return (
    <aside className="agent-rail" aria-label="Agent activity">
      <header className="agent-rail-heading">
        <span className={working ? 'activity-label is-working' : 'activity-label'}>
          <span className="activity-pulse" aria-hidden="true" />
          {working ? 'Agent working' : 'Agent'}
        </span>
        {toolsLive === null ? null : toolsLive.live === 0 ? (
          <span
            className="webmcp-chip is-off"
            title="This browser did not expose document.modelContext. In Chrome 149+, enable chrome://flags/#enable-webmcp-testing and relaunch, or open this page in ChatGPT's browser."
          >
            No agent
          </span>
        ) : (
          <span
            className={toolsLive.failures.length > 0 ? 'webmcp-chip is-partial' : 'webmcp-chip is-live'}
            title={
              toolsLive.failures.length > 0
                ? `Some tools did not register:\n${toolsLive.failures.join('\n')}`
                : 'A WebMCP-capable browser agent can use every EEVEE tool on this page.'
            }
          >
            {toolsLive.live} of {toolsLive.total} tools live
          </span>
        )}
      </header>
      <MissionPlanStrip />
      {entries.length === 0 ? (
        <p className="activity-empty">
          Every tool call the agent makes on this page shows up here as it happens, with its
          outcome and timing.
        </p>
      ) : (
        <ol className="activity-list" aria-live="polite">
          {entries.map((entry) => (
            <li key={entry.id} className={`is-${entry.phase}`}>
              <span className="activity-mark" aria-hidden="true" />
              <div>
                <code>{entry.tool}</code>
                <span className="activity-meta">
                  {entry.phase === 'started'
                    ? 'running'
                    : `${time.format(new Date(entry.at))}${duration(entry)}`}
                  {entry.error ? ` · ${entry.error}` : ''}
                </span>
              </div>
            </li>
          ))}
        </ol>
      )}
    </aside>
  )
}
