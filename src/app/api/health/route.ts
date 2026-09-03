import { sql } from 'drizzle-orm'
import { NextResponse } from 'next/server'
import { getDatabase } from '@/server/db/client'
import { assertSessionSecret } from '@/server/session'

// Liveness probe for the container healthcheck: no session cookie, no
// workspace row, a round trip to Postgres, and the session secret every
// other route depends on.
export async function GET(): Promise<NextResponse> {
  try {
    assertSessionSecret()
    await getDatabase().execute(sql`select 1`)
    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('EEVEE health check failed', error)
    return NextResponse.json({ ok: false }, { status: 503 })
  }
}
