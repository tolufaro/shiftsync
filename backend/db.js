const pg = require('pg')

const { Pool } = pg

function createPool() {
  const databaseUrl = process.env.DATABASE_URL
  if (!databaseUrl) return null

  const sslEnabled = process.env.DATABASE_SSL === 'true' || process.env.PGSSLMODE === 'require'

  return new Pool({
    connectionString: databaseUrl,
    ssl: sslEnabled ? { rejectUnauthorized: false } : undefined,
  })
}

function getPool() {
  const pool = createPool()
  if (!pool) {
    throw new Error('DATABASE_URL is required')
  }
  return pool
}

module.exports = { createPool, getPool }
