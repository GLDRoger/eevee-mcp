import type { NextRequest } from 'next/server'

/**
 * The origin a browser sees for this deployment. Under `next start` without
 * `-H`, `request.nextUrl.origin` is the constant `http://localhost:3000`
 * whatever the real host, which made every same-origin check fail and every
 * passkey bind to rp "localhost" on a deployed hostname.
 *
 * Resolution order: EEVEE_PUBLIC_ORIGIN when set (recommended in production;
 * one value, no header trust), then the proxy's X-Forwarded-Proto and
 * X-Forwarded-Host, then Host, then nextUrl as a last resort. A forged Host
 * on a direct request only changes the origin that request is checked
 * against; a browser's Origin header and the WebAuthn credential binding are
 * not attacker-controlled, so nothing crosses a workspace this way.
 */
export const publicOrigin = (request: NextRequest): URL => {
  const configured = process.env.EEVEE_PUBLIC_ORIGIN?.trim()
  if (configured) return new URL(new URL(configured).origin)
  const first = (name: string): string | null =>
    request.headers.get(name)?.split(',')[0]?.trim() || null
  const host = first('x-forwarded-host') ?? first('host')
  if (host) {
    const protocol = first('x-forwarded-proto') ?? request.nextUrl.protocol.replace(':', '')
    try {
      return new URL(`${protocol}://${host}`)
    } catch {
      // Fall through to nextUrl for a malformed header.
    }
  }
  return new URL(request.nextUrl.origin)
}
