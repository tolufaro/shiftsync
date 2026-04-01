const express = require('express')

const { getPool } = require('../db')
const { requireRole, requireUser } = require('../middleware/rbac')

const router = express.Router()

function isIsoDate(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
}

async function ensureManagerLocationAccess(pool, userId, locationId) {
  const exists = await pool.query(
    'select 1 from staff_locations where staff_id = $1 and location_id = $2 limit 1',
    [userId, locationId],
  )
  return exists.rows.length > 0
}

router.get('/manager', ...requireRole(['admin', 'manager']), async (req, res) => {
  const pool = getPool()
  const locationId = String(req.query?.locationId || '').trim()
  const weekStart = String(req.query?.weekStart || '').trim()

  if (!locationId) {
    res.status(400).json({ error: 'locationId_required' })
    return
  }
  if (!isIsoDate(weekStart)) {
    res.status(400).json({ error: 'weekStart_required' })
    return
  }

  if (req.user.role === 'manager') {
    const ok = await ensureManagerLocationAccess(pool, req.user.id, locationId)
    if (!ok) {
      res.status(403).json({ error: 'forbidden' })
      return
    }
  }

  const locationResult = await pool.query('select id, name, address, timezone from locations where id = $1 limit 1', [
    locationId,
  ])
  const location = locationResult.rows[0]
  if (!location) {
    res.status(404).json({ error: 'location_not_found' })
    return
  }

  const result = await pool.query(
    `
      with range as (
        select
          ($2::date at time zone l.timezone) as start_at,
          (($2::date + 7) at time zone l.timezone) as end_at
        from locations l
        where l.id = $1
      )
      select
        s.id,
        s.location_id,
        s.required_skill_id,
        sk.name as required_skill_name,
        s.start_at,
        s.end_at,
        s.headcount_needed,
        s.status,
        coalesce(
          json_agg(
            json_build_object(
              'assignmentId', sa.id,
              'staffId', u.id,
              'email', u.email,
              'name', u.name,
              'status', sa.status
            )
          ) filter (where sa.id is not null),
          '[]'::json
        ) as assignments
      from shifts s
      join range r on true
      left join skills sk on sk.id = s.required_skill_id
      left join shift_assignments sa on sa.shift_id = s.id and sa.status <> 'dropped'::shift_assignment_status
      left join users u on u.id = sa.staff_id
      where s.location_id = $1
        and s.start_at >= r.start_at
        and s.start_at < r.end_at
      group by s.id, sk.name
      order by s.start_at asc
    `,
    [locationId, weekStart],
  )

  res.json({
    location,
    weekStart,
    shifts: result.rows.map((r) => ({
      id: r.id,
      locationId: r.location_id,
      requiredSkillId: r.required_skill_id,
      requiredSkillName: r.required_skill_name,
      startAt: new Date(r.start_at).toISOString(),
      endAt: new Date(r.end_at).toISOString(),
      headcountNeeded: r.headcount_needed,
      status: r.status,
      assignments: r.assignments,
    })),
  })
})

router.get('/me', ...requireUser(), async (req, res) => {
  const pool = getPool()
  const weekStart = String(req.query?.weekStart || '').trim()
  if (!isIsoDate(weekStart)) {
    res.status(400).json({ error: 'weekStart_required' })
    return
  }

  const startAt = new Date(`${weekStart}T00:00:00.000Z`)
  const endAt = new Date(startAt.getTime() + 7 * 86400000)

  const result = await pool.query(
    `
      select
        s.id,
        s.location_id,
        l.name as location_name,
        l.timezone as location_timezone,
        s.required_skill_id,
        sk.name as required_skill_name,
        s.start_at,
        s.end_at,
        s.headcount_needed,
        s.status,
        sa.id as assignment_id,
        sa.status as assignment_status
      from shift_assignments sa
      join shifts s on s.id = sa.shift_id
      join locations l on l.id = s.location_id
      left join skills sk on sk.id = s.required_skill_id
      where sa.staff_id = $1
        and sa.status <> 'dropped'::shift_assignment_status
        and s.start_at >= $2::timestamptz
        and s.start_at < $3::timestamptz
      order by s.start_at asc
    `,
    [req.user.id, startAt.toISOString(), endAt.toISOString()],
  )

  res.json({
    weekStart,
    shifts: result.rows.map((r) => ({
      id: r.id,
      assignmentId: r.assignment_id,
      assignmentStatus: r.assignment_status,
      location: { id: r.location_id, name: r.location_name, timezone: r.location_timezone },
      requiredSkillId: r.required_skill_id,
      requiredSkillName: r.required_skill_name,
      startAt: new Date(r.start_at).toISOString(),
      endAt: new Date(r.end_at).toISOString(),
      status: r.status,
    })),
  })
})

router.get('/on-duty', ...requireRole(['admin', 'manager']), async (req, res) => {
  const pool = getPool()
  const locationId = String(req.query?.locationId || '').trim()
  if (!locationId) {
    res.status(400).json({ error: 'locationId_required' })
    return
  }

  if (req.user.role === 'manager') {
    const ok = await ensureManagerLocationAccess(pool, req.user.id, locationId)
    if (!ok) {
      res.status(403).json({ error: 'forbidden' })
      return
    }
  }

  const result = await pool.query(
    `
      select
        u.id as staff_id,
        u.email,
        u.name,
        s.id as shift_id,
        s.start_at,
        s.end_at
      from shift_assignments sa
      join shifts s on s.id = sa.shift_id
      join users u on u.id = sa.staff_id
      where s.location_id = $1
        and s.status = 'published'::shift_status
        and sa.status <> 'dropped'::shift_assignment_status
        and now() >= s.start_at
        and now() < s.end_at
      order by s.start_at asc
    `,
    [locationId],
  )

  res.json({
    locationId,
    now: new Date().toISOString(),
    staff: result.rows.map((r) => ({
      staffId: r.staff_id,
      email: r.email,
      name: r.name,
      shiftId: r.shift_id,
      startAt: new Date(r.start_at).toISOString(),
      endAt: new Date(r.end_at).toISOString(),
    })),
  })
})

module.exports = { scheduleRouter: router }
