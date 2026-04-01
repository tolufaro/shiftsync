const bcrypt = require('bcryptjs')
const express = require('express')

const { getPool } = require('../db')
const { requireRole } = require('../middleware/rbac')

const router = express.Router()

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase()
}

function cleanString(v) {
  const s = String(v || '').trim()
  return s.length ? s : null
}

router.use(...requireRole('admin'))

router.get('/users', async (req, res) => {
  const role = cleanString(req.query?.role)
  const q = cleanString(req.query?.q)

  const pool = getPool()

  const params = []
  const where = []

  if (role) {
    params.push(role)
    where.push(`role = $${params.length}`)
  }

  if (q) {
    params.push(`%${q}%`)
    where.push(`(email ilike $${params.length} or name ilike $${params.length})`)
  }

  const whereSql = where.length ? `where ${where.join(' and ')}` : ''
  const result = await pool.query(
    `
      select id, email, name, role, created_at
      from users
      ${whereSql}
      order by created_at desc
      limit 200
    `,
    params,
  )
  res.json({ users: result.rows })
})

router.get('/users/:userId', async (req, res) => {
  const pool = getPool()
  const userId = req.params.userId

  const userResult = await pool.query('select id, email, name, role, created_at from users where id = $1 limit 1', [
    userId,
  ])
  const user = userResult.rows[0]
  if (!user) {
    res.status(404).json({ error: 'not_found' })
    return
  }

  const locations = await pool.query(
    `
      select l.id, l.name, l.address, l.timezone
      from locations l
      join staff_locations sl on sl.location_id = l.id
      where sl.staff_id = $1
      order by l.name
    `,
    [userId],
  )

  const skills = await pool.query(
    `
      select s.id, s.name
      from skills s
      join staff_skills ss on ss.skill_id = s.id
      where ss.staff_id = $1
      order by s.name
    `,
    [userId],
  )

  res.json({ user, locations: locations.rows, skills: skills.rows })
})

router.post('/users', async (req, res) => {
  const email = normalizeEmail(req.body?.email)
  const password = String(req.body?.password || '')
  const role = cleanString(req.body?.role) || 'staff'
  const name = cleanString(req.body?.name)

  if (!email || !password) {
    res.status(400).json({ error: 'email_and_password_required' })
    return
  }

  if (password.length < 8) {
    res.status(400).json({ error: 'password_too_short' })
    return
  }

  if (!['admin', 'manager', 'staff'].includes(role)) {
    res.status(400).json({ error: 'invalid_role' })
    return
  }

  const pool = getPool()

  const existing = await pool.query('select id from users where email = $1 limit 1', [email])
  if (existing.rows.length > 0) {
    res.status(409).json({ error: 'email_already_in_use' })
    return
  }

  const passwordHash = await bcrypt.hash(password, 12)
  const created = await pool.query(
    'insert into users (email, password_hash, role, name) values ($1, $2, $3, $4) returning id, email, name, role, created_at',
    [email, passwordHash, role, name],
  )

  res.status(201).json({ user: created.rows[0] })
})

router.patch('/users/:userId', async (req, res) => {
  const userId = req.params.userId
  const email = req.body?.email !== undefined ? normalizeEmail(req.body.email) : undefined
  const name = req.body?.name !== undefined ? cleanString(req.body.name) : undefined
  const role = req.body?.role !== undefined ? cleanString(req.body.role) : undefined
  const password = req.body?.password !== undefined ? String(req.body.password || '') : undefined

  if (role !== undefined && !['admin', 'manager', 'staff'].includes(role || '')) {
    res.status(400).json({ error: 'invalid_role' })
    return
  }

  if (password !== undefined && password.length > 0 && password.length < 8) {
    res.status(400).json({ error: 'password_too_short' })
    return
  }

  const pool = getPool()

  const existing = await pool.query('select id, email from users where id = $1 limit 1', [userId])
  const current = existing.rows[0]
  if (!current) {
    res.status(404).json({ error: 'not_found' })
    return
  }

  if (email && email !== current.email) {
    const emailTaken = await pool.query('select id from users where email = $1 and id <> $2 limit 1', [email, userId])
    if (emailTaken.rows.length > 0) {
      res.status(409).json({ error: 'email_already_in_use' })
      return
    }
  }

  const updates = []
  const params = []

  function set(field, value) {
    params.push(value)
    updates.push(`${field} = $${params.length}`)
  }

  if (email !== undefined) set('email', email)
  if (name !== undefined) set('name', name)
  if (role !== undefined) set('role', role)
  if (password !== undefined && password.length > 0) {
    const passwordHash = await bcrypt.hash(password, 12)
    set('password_hash', passwordHash)
  }

  if (!updates.length) {
    const u = await pool.query('select id, email, name, role, created_at from users where id = $1 limit 1', [userId])
    res.json({ user: u.rows[0] })
    return
  }

  params.push(userId)
  const updated = await pool.query(
    `
      update users
      set ${updates.join(', ')}, updated_at = now()
      where id = $${params.length}
      returning id, email, name, role, created_at
    `,
    params,
  )

  res.json({ user: updated.rows[0] })
})

router.get('/locations', async (_req, res) => {
  const pool = getPool()
  const result = await pool.query('select id, name, address, timezone from locations order by name')
  res.json({ locations: result.rows })
})

router.get('/skills', async (_req, res) => {
  const pool = getPool()
  const result = await pool.query('select id, name from skills order by name')
  res.json({ skills: result.rows })
})

router.put('/users/:userId/locations', async (req, res) => {
  const userId = req.params.userId
  const locationIds = Array.isArray(req.body?.locationIds) ? req.body.locationIds : []

  const pool = getPool()

  const existing = await pool.query('select id from users where id = $1 limit 1', [userId])
  if (existing.rows.length === 0) {
    res.status(404).json({ error: 'not_found' })
    return
  }

  await pool.query('begin')
  try {
    await pool.query('delete from staff_locations where staff_id = $1', [userId])
    for (const locId of locationIds) {
      await pool.query('insert into staff_locations (staff_id, location_id) values ($1, $2)', [userId, locId])
    }
    await pool.query('commit')
  } catch (e) {
    await pool.query('rollback')
    throw e
  }

  res.json({ ok: true })
})

router.put('/users/:userId/skills', async (req, res) => {
  const userId = req.params.userId
  const skillIds = Array.isArray(req.body?.skillIds) ? req.body.skillIds : []

  const pool = getPool()

  const existing = await pool.query('select id from users where id = $1 limit 1', [userId])
  if (existing.rows.length === 0) {
    res.status(404).json({ error: 'not_found' })
    return
  }

  await pool.query('begin')
  try {
    await pool.query('delete from staff_skills where staff_id = $1', [userId])
    for (const skillId of skillIds) {
      await pool.query('insert into staff_skills (staff_id, skill_id) values ($1, $2)', [userId, skillId])
    }
    await pool.query('commit')
  } catch (e) {
    await pool.query('rollback')
    throw e
  }

  res.json({ ok: true })
})

module.exports = { adminRouter: router }

