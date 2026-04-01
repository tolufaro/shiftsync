const pg = require('pg')

const { Pool } = pg

function createPool() {
  const databaseUrl = process.env.DATABASE_URL
  if (!databaseUrl) return null

  return new Pool({
    connectionString: databaseUrl,
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
