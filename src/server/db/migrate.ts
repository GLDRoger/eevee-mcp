import { drizzle } from 'drizzle-orm/postgres-js'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import postgres from 'postgres'

const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) throw new Error('DATABASE_URL is required to run migrations')

const client = postgres(databaseUrl, { max: 1 })

try {
  await migrate(drizzle(client), { migrationsFolder: 'drizzle' })
  console.log('Database migrations are current')
} finally {
  await client.end()
}
