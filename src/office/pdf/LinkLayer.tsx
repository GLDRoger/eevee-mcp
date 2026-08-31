import { useEffect, useState } from 'react'
import type { ReactElement } from 'react'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import { pdfRectToCss } from './annotations'
import type { PageGeom } from './annotations'
import { safeExternalUrl } from '../host/external-url'

interface LinkItem {
  rect: [number, number, number, number]
  url?: string
  dest?: unknown
}

interface RawLinkAnnotation {
  subtype?: string
  rect?: number[]
  url?: string
  dest?: unknown
  action?: string
}

/** Link annot hit areas: external links open a new window (main process routes to shell.openExternal); internal dests jump pages */
export function LinkLayer({
  doc,
  pageNo,
  geom,
  scale,
  onGoToDest,
}: {
  doc: PDFDocumentProxy
  pageNo: number
  geom: PageGeom
  scale: number
  onGoToDest: (dest: unknown) => void
}): ReactElement | null {
  const [links, setLinks] = useState<LinkItem[] | null>(null)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const page = await doc.getPage(pageNo)
      const annots = (await page.getAnnotations()) as RawLinkAnnotation[]
      if (cancelled) return
      const out: LinkItem[] = []
      for (const a of annots) {
        if (a.subtype !== 'Link' || !a.rect || (!a.url && !a.dest)) continue
        const url = safeExternalUrl(a.url) ?? undefined
        if (!url && a.dest == null) continue
        out.push({
          rect: a.rect as LinkItem['rect'],
          url,
          dest: a.dest,
        })
      }
      setLinks(out)
    })()
    return () => {
      cancelled = true
    }
  }, [doc, pageNo])

  if (!links || links.length === 0) return null

  return (
    <div className="pdf-link-layer">
      {links.map((l, i) => (
        <a
          key={i}
          className="pdf-link"
          style={pdfRectToCss(geom, l.rect, scale)}
          href={l.url ?? '#'}
          title={l.url}
          target={l.url ? '_blank' : undefined}
          rel="noopener noreferrer"
          onClick={(e) => {
            if (!l.url) {
              e.preventDefault()
              onGoToDest(l.dest)
            }
          }}
        />
      ))}
    </div>
  )
}
