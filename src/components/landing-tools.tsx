'use client'

import { useEffect } from 'react'
import { modelContextOf } from '@/client/webmcp'

/**
 * The landing page carries one WebMCP tool so an agent that arrives here can
 * get itself to the workbench, where the real tool set registers.
 */
export function LandingTools() {
  useEffect(() => {
    const context = modelContextOf()
    if (!context) return
    const controller = new AbortController()
    void context
      .registerTool(
        {
          name: 'open_workbench',
          title: 'Open the EEVEE workbench',
          description:
            'Navigate this tab from the EEVEE landing page to the workbench at /workbench, where 28 EEVEE tools register: applets, evaluations, reviews, runs, Office files, and decisions. Call this first; the landing page has no other tools.',
          inputSchema: { type: 'object', properties: {}, additionalProperties: false },
          annotations: { readOnlyHint: false },
          execute: async () => {
            const url = new URL('/workbench', window.location.href).toString()
            window.setTimeout(() => window.location.assign(url), 50)
            return { ok: true, url, next: 'Wait for the page to load, then list the tools again.' }
          },
        },
        { signal: controller.signal },
      )
      .catch(() => undefined)
    return () => controller.abort()
  }, [])
  return null
}
