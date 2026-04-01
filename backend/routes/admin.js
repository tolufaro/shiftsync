const bcrypt = require('bcryptjs')
const express = require('express')

const { getPool } = require('../db')
const { requireRole } = require('../middleware/rbac')
const { logAudit } = require('../services/audit')

const router = express.Router()

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase()
}

function cleanString(v) {
  const s = String(v || '').trim()
  return s.length ? s : null
}

function isIsoDate(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
}

function csvEscape(value) {
  if (value === null || value === undefined) return '""'
  const s = String(value)
  return `"${s.replace(/"/g, '""')}"`
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

  await logAudit(req.user.id, 'admin.user.create', 'user', created.rows[0].id, null, { email, name, role }, { pool })
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

  const existing = await pool.query('select id, email, name, role from users where id = $1 limit 1', [userId])
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

  await logAudit(
    req.user.id,
    'admin.user.update',
    'user',
    userId,
    { email: current.email, name: current.name, role: current.role },
    { email: updated.rows[0].email, name: updated.rows[0].name, role: updated.rows[0].role },
    { pool },
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

  const before = await pool.query('select location_id from staff_locations where staff_id = $1 order by location_id', [userId])

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

  await logAudit(
    req.user.id,
    'admin.user.locations.update',
    'user',
    userId,
    { locationIds: before.rows.map((r) => r.location_id) },
    { locationIds },
    { pool },
  )
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

  const before = await pool.query('select skill_id from staff_skills where staff_id = $1 order by skill_id', [userId])

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

  await logAudit(
    req.user.id,
    'admin.user.skills.update',
    'user',
    userId,
    { skillIds: before.rows.map((r) => r.skill_id) },
    { skillIds },
    { pool },
  )
  res.json({ ok: true })
})

router.get('/audit/export', async (req, res) => {
  const from = cleanString(req.query?.from)
  const to = cleanString(req.query?.to)
  const locationId = cleanString(req.query?.locationId)

  if (!from || !to || !isIsoDate(from) || !isIsoDate(to)) {
    res.status(400).json({ error: 'from_and_to_required' })
    return
  }

  const fromTs = `${from}T00:00:00.000Z`
  const toTs = `${to}T23:59:59.999Z`

  const pool = getPool()

  const params = [fromTs, toTs]
  let locationClause = ''
  if (locationId) {
    params.push(locationId)
    const locParam = `$${params.length}::uuid`
    locationClause = `
      and (
        (a.entity_type = 'shift' and s.location_id = ${locParam})
        or (a.entity_type = 'shift_assignment' and s2.location_id = ${locParam})
        or (a.entity_type = 'swap_request' and s3.location_id = ${locParam})
      )
    `
  }

  const result = await pool.query(
    `
      select
        a.id,
        a.created_at,
        a.action,
        a.entity_type,
        a.entity_id,
        a.before,
        a.after,
        u.email as actor_email,
        s.location_id as shift_location_id,
        s2.location_id as assignment_location_id,
        s3.location_id as swap_location_id
      from audit_logs a
      left join users u on u.id = a.user_id
      left join shifts s on (a.entity_type = 'shift' and a.entity_id = s.id)
      left join shift_assignments sa on (a.entity_type = 'shift_assignment' and a.entity_id = sa.id)
      left join shifts s2 on (a.entity_type = 'shift_assignment' and sa.shift_id = s2.id)
      left join swap_requests sr on (a.entity_type = 'swap_request' and a.entity_id = sr.id)
      left join shift_assignments sa2 on (a.entity_type = 'swap_request' and sr.assignment_id = sa2.id)
      left join shifts s3 on (a.entity_type = 'swap_request' and sa2.shift_id = s3.id)
      where a.created_at >= $1::timestamptz
        and a.created_at <= $2::timestamptz
        ${locationClause}
      order by a.created_at asc
      limit 20000
    `,
    params,
  )

  const lines = []
  lines.push(['created_at', 'actor_email', 'action', 'entity_type', 'entity_id', 'location_id', 'before', 'after'].map(csvEscape).join(','))
  for (const r of result.rows) {
    const location = r.shift_location_id || r.assignment_location_id || r.swap_location_id || ''
    lines.push(
      [
        r.created_at,
        r.actor_email || '',
        r.action,
        r.entity_type,
        r.entity_id || '',
        location,
        r.before ? JSON.stringify(r.before) : '',
        r.after ? JSON.stringify(r.after) : '',
      ]
        .map(csvEscape)
        .join(','),
    )
  }

  res.setHeader('Content-Type', 'text/csv; charset=utf-8')
  res.setHeader('Content-Disposition', `attachment; filename="audit_${from}_to_${to}.csv"`)
  res.send(lines.join('\n'))
})

module.exports = { adminRouter: router }
