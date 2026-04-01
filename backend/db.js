const pg = require('pg')

const { Pool } = pg

function createPool() {
  const databaseUrl = process.env.DATABASE_URL
  if (!databaseUrl) return null

  return new Pool({
    connectionString: databaseUrl,
  })
}

module.exports = { createPool }
