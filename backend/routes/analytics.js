const express = require('express')

const { getPool } = require('../db')
const { requireRole } = require('../middleware/rbac')
const { getFairnessScore } = require('../services/fairness')

const router = express.Router()

router.use(...requireRole(['admin', 'manager']))

function cleanString(v) {
  const s = String(v || '').trim()
  return s.length ? s : null
}

function isIsoDate(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
}

function parseRange(from, to) {
  if (!isIsoDate(from) || !isIsoDate(to)) return null
  const start = new Date(`${from}T00:00:00.000Z`)
  const end = new Date(`${to}T00:00:00.000Z`)
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null
  if (!(end > start)) return null
  return { startIso: start.toISOString(), endIso: end.toISOString() }
}

async function ensureManagerLocationAccess(pool, userId, locationId) {
  const exists = await pool.query(
    'select 1 from staff_locations where staff_id = $1 and location_id = $2 limit 1',
    [userId, locationId],
  )
  return exists.rows.length > 0
}

router.get('/hours', async (req, res) => {
  const pool = getPool()
  const from = cleanString(req.query?.from)
  const to = cleanString(req.query?.to)
  const locationId = cleanString(req.query?.locationId)

  const range = parseRange(from, to)
  if (!range) {
    res.status(400).json({ error: 'invalid_range' })
    return
  }

  if (locationId && req.user.role === 'manager') {
    const ok = await ensureManagerLocationAccess(pool, req.user.id, locationId)
    if (!ok) {
      res.status(403).json({ error: 'forbidden' })
      return
    }
  }

  const params = [range.startIso, range.endIso]
  const where = ["sa.status <> 'dropped'::shift_assignment_status"]
  if (locationId) {
    params.push(locationId)
    where.push(`s.location_id = $${params.length}`)
  }
  if (req.user.role === 'manager') {
    params.push(req.user.id)
    where.push(`exists (select 1 from staff_locations sl where sl.staff_id = $${params.length} and sl.location_id = s.location_id)`)
  }

  const result = await pool.query(
    `
      select
        u.id,
        u.email,
        u.name,
        u.desired_weekly_hours,
        sum(extract(epoch from (least(s.end_at, $2::timestamptz) - greatest(s.start_at, $1::timestamptz)))) / 3600.0 as hours
      from shift_assignments sa
      join shifts s on s.id = sa.shift_id
      join users u on u.id = sa.staff_id
      where ${where.join(' and ')}
        and s.start_at < $2::timestamptz
        and s.end_at > $1::timestamptz
        and u.role = 'staff'::user_role
      group by u.id, u.email, u.name, u.desired_weekly_hours
      order by hours desc nulls last
      limit 500
    `,
    params,
  )

  const days = (new Date(range.endIso).getTime() - new Date(range.startIso).getTime()) / 86400000
  const weeks = days / 7

  res.json({
    from,
    to,
    locationId: locationId || null,
    staff: result.rows.map((r) => {
      const hours = Number(r.hours || 0)
      const desiredWeekly = r.desired_weekly_hours === null || r.desired_weekly_hours === undefined ? null : Number(r.desired_weekly_hours)
      const desiredForRange = desiredWeekly === null ? null : desiredWeekly * weeks
      const delta = desiredForRange === null ? null : hours - desiredForRange
      return {
        id: r.id,
        email: r.email,
        name: r.name,
        hours,
        desiredWeeklyHours: desiredWeekly,
        desiredHoursForRange: desiredForRange,
        deltaHours: delta,
      }
    }),
  })
})

router.get('/fairness', async (req, res) => {
  const pool = getPool()
  const from = cleanString(req.query?.from)
  const to = cleanString(req.query?.to)
  const locationId = cleanString(req.query?.locationId)

  const range = parseRange(from, to)
  if (!range) {
    res.status(400).json({ error: 'invalid_range' })
    return
  }
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

  const fairness = await getFairnessScore(locationId, { from: range.startIso, to: range.endIso }, { pool })

  const hours = await pool.query(
    `
      select
        u.id,
        sum(extract(epoch from (least(s.end_at, $3::timestamptz) - greatest(s.start_at, $2::timestamptz)))) / 3600.0 as hours
      from users u
      join staff_locations sl on sl.staff_id = u.id
      left join shift_assignments sa on sa.staff_id = u.id and sa.status <> 'dropped'::shift_assignment_status
      left join shifts s on s.id = sa.shift_id and s.location_id = $1 and s.start_at < $3::timestamptz and s.end_at > $2::timestamptz
      where sl.location_id = $1
        and u.role = 'staff'::user_role
      group by u.id
    `,
    [locationId, range.startIso, range.endIso],
  )
  const hoursMap = new Map()
  for (const r of hours.rows) hoursMap.set(r.id, Number(r.hours || 0))

  const premiumCounts = await pool.query(
    `
      select sa.staff_id, count(*)::int as premium_count
      from shift_assignments sa
      join shifts s on s.id = sa.shift_id
      where s.location_id = $1
        and s.is_premium = true
        and sa.status <> 'dropped'::shift_assignment_status
        and s.start_at >= $2::timestamptz
        and s.start_at < $3::timestamptz
      group by sa.staff_id
    `,
    [locationId, range.startIso, range.endIso],
  )
  const premiumMap = new Map()
  for (const r of premiumCounts.rows) premiumMap.set(r.staff_id, r.premium_count)

  const desired = await pool.query(
    `
      select u.id, u.desired_weekly_hours
      from users u
      join staff_locations sl on sl.staff_id = u.id
      where sl.location_id = $1
        and u.role = 'staff'::user_role
    `,
    [locationId],
  )
  const desiredMap = new Map()
  for (const r of desired.rows) desiredMap.set(r.id, r.desired_weekly_hours === null ? null : Number(r.desired_weekly_hours))

  const days = (new Date(range.endIso).getTime() - new Date(range.startIso).getTime()) / 86400000
  const weeks = days / 7

  res.json({
    locationId,
    from,
    to,
    avgPremiumPerStaff: fairness.avgPremiumPerStaff,
    staff: fairness.staff.map((s) => {
      const hoursVal = hoursMap.get(s.id) || 0
      const desiredWeekly = desiredMap.get(s.id) ?? null
      const desiredForRange = desiredWeekly === null ? null : desiredWeekly * weeks
      return {
        id: s.id,
        email: s.email,
        name: s.name,
        hours: hoursVal,
        desiredWeeklyHours: desiredWeekly,
        desiredHoursForRange: desiredForRange,
        premiumShifts: premiumMap.get(s.id) || 0,
        fairnessScore: s.fairnessScore,
      }
    }),
  })
})

module.exports = { analyticsRouter: router }

