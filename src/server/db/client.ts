import 'server-only'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from './schema'

let database: ReturnType<typeof createDatabase> | undefined

const createDatabase = () => {
  const databaseUrl = process.env.DATABASE_URL
  if (!databaseUrl) throw new Error('DATABASE_URL is required')
  const client = postgres(databaseUrl, {
    max: process.env.NODE_ENV === 'production' ? 10 : 2,
    prepare: false,
  })
  return drizzle(client, { schema })
}

export const getDatabase = (): ReturnType<typeof createDatabase> => {
  database ??= createDatabase()
  return database
}
