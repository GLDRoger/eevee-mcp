const EXTERNAL_PROTOCOLS = new Set(['http:', 'https:', 'mailto:', 'tel:'])

export function safeExternalUrl(value: string | null | undefined): string | null {
  const candidate = value?.trim()
  if (!candidate) return null
  try {
    const url = new URL(candidate)
    return EXTERNAL_PROTOCOLS.has(url.protocol) ? url.href : null
  } catch {
    return null
  }
}

export function safeOfficeHref(value: string | null | undefined): string | null {
  const candidate = value?.trim()
  if (!candidate) return null
  return candidate.startsWith('#') ? candidate : safeExternalUrl(candidate)
}

export function openExternalUrl(value: string | null | undefined): boolean {
  const url = safeExternalUrl(value)
  if (!url) return false
  window.open(url, '_blank', 'noopener,noreferrer')
  return true
}
