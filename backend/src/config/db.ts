import { Pool } from 'pg'
import 'dotenv/config'

// Parse DATABASE_URL manually so passwords with special chars ([ ] @ : etc.)
// don't break Node's URL parser when passed as a connection string.
function parseDbUrl(url: string) {
  const withoutProto = url.replace(/^[^:]+:\/\//, '')
  const atIdx        = withoutProto.lastIndexOf('@')
  const userInfo     = withoutProto.slice(0, atIdx)
  const hostInfo     = withoutProto.slice(atIdx + 1)

  const colonInUser  = userInfo.indexOf(':')
  const user         = userInfo.slice(0, colonInUser)
  const password     = userInfo.slice(colonInUser + 1)

  const slashIdx     = hostInfo.indexOf('/')
  const hostPort     = hostInfo.slice(0, slashIdx)
  const database     = hostInfo.slice(slashIdx + 1)

  const colonInHost  = hostPort.lastIndexOf(':')
  const host         = hostPort.slice(0, colonInHost)
  const port         = parseInt(hostPort.slice(colonInHost + 1)) || 5432

  return { user, password, host, port, database }
}

export const pool = new Pool({
  ...parseDbUrl(process.env.DATABASE_URL!),
  ssl:                  { rejectUnauthorized: false },
  max:                  5,
  min:                  2,
  idleTimeoutMillis:    60_000,
  connectionTimeoutMillis: 30_000,
  keepAlive:            true,
  keepAliveInitialDelayMillis: 10_000,
  // Required for Supabase transaction pooler (port 6543)
  statement_timeout:    30_000,
})

pool.on('error', (err) => {
  console.error('[DB] Unexpected error on idle client:', err)
})

export async function query<T = any>(sql: string, params?: any[]): Promise<T[]> {
  const client = await pool.connect()
  try {
    const result = await client.query(sql, params)
    return result.rows as T[]
  } finally {
    client.release()
  }
}
