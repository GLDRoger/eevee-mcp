import { drizzle } from 'drizzle-orm/postgres-js'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import postgres from 'postgres'

const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) throw new Error('DATABASE_URL is required to run migrations')
// The container runs this before `next start`; a production deploy without a
// usable session secret stops here with one clear line instead of serving a
// page whose every API call fails.
if (process.env.NODE_ENV === 'production') {
  const secret = process.env.EEVEE_SESSION_SECRET
  if (!secret || secret.length < 32) {
    throw new Error('EEVEE_SESSION_SECRET must contain at least 32 characters before EEVEE can start')
  }
}

// The migrator's CREATE SCHEMA IF NOT EXISTS raises a NOTICE on every run;
// only the final status line is worth printing.
const client = postgres(databaseUrl, { max: 1, onnotice: () => {} })

try {
  await migrate(drizzle(client), { migrationsFolder: 'drizzle' })
  console.log('Database migrations are current')
} finally {
  await client.end()
}
