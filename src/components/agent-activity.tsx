'use client'

import { useEffect, useState } from 'react'
import {
  TOOL_ACTIVITY_EVENT,
  toolActivitySchema,
  type ToolActivity,
} from '@/client/tool-activity'

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

export function AgentActivity() {
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
    <footer className="activity-strip" aria-label="Agent activity">
      <span className={working ? 'activity-label is-working' : 'activity-label'}>
        <span className="activity-pulse" aria-hidden="true" />
        {working ? 'Agent working' : 'Agent activity'}
      </span>
      {entries.length === 0 ? (
        <p className="activity-empty">
          Tool calls from a connected browser agent appear here as they happen.
        </p>
      ) : (
        <ol className="activity-list" aria-live="polite">
          {entries.map((entry) => (
            <li key={entry.id} className={`is-${entry.phase}`}>
              <span className="activity-mark" aria-hidden="true" />
              <code>{entry.tool}</code>
              <span className="activity-meta">
                {entry.phase === 'started'
                  ? 'running'
                  : `${time.format(new Date(entry.at))}${duration(entry)}`}
                {entry.error ? ` · ${entry.error}` : ''}
              </span>
            </li>
          ))}
        </ol>
      )}
    </footer>
  )
}
