const fs = require('fs')
const path = require('path')

const dotenv = require('dotenv')
dotenv.config()

const { createPool } = require('../db')

const pool = createPool()

if (!pool) {
  throw new Error('DATABASE_URL is required')
}

async function ensureMigrationsTable() {
  await pool.query(`
    create table if not exists schema_migrations (
      id text primary key,
      applied_at timestamptz not null default now()
    )
  `)
}

async function getAppliedMigrationIds() {
  const { rows } = await pool.query('select id from schema_migrations')
  return new Set(rows.map((r) => r.id))
}

function listMigrationFiles() {
  const migrationsDir = path.join(__dirname, '..', 'migrations')
  if (!fs.existsSync(migrationsDir)) return []

  return fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((f) => ({ id: f, fullPath: path.join(migrationsDir, f) }))
}

async function applyMigration(migration) {
  const sql = fs.readFileSync(migration.fullPath, 'utf8')
  await pool.query('begin')
  try {
    await pool.query(sql)
    await pool.query('insert into schema_migrations (id) values ($1)', [migration.id])
    await pool.query('commit')
  } catch (e) {
    await pool.query('rollback')
    throw e
  }
}

async function main() {
  await ensureMigrationsTable()
  const applied = await getAppliedMigrationIds()
  const migrations = listMigrationFiles()

  for (const migration of migrations) {
    if (applied.has(migration.id)) continue
    process.stdout.write(`Applying ${migration.id}... `)
    await applyMigration(migration)
    process.stdout.write('done\n')
  }

  await pool.end()
}

main().catch(async (e) => {
  try {
    await pool.end()
  } catch (_e) {}
  console.error(e)
  process.exit(1)
})

