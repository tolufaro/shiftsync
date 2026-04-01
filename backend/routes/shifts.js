const express = require('express')

const { getPool } = require('../db')
const { requireRole } = require('../middleware/rbac')
const { findValidAlternatives } = require('../services/findValidAlternatives')
const { validateAssignment } = require('../services/validateAssignment')
const { assignStaffToShift } = require('../services/assignShift')
const { createNotification } = require('../services/notifications')
const { logAudit } = require('../services/audit')

const router = express.Router()

router.use(...requireRole(['admin', 'manager']))

function withinCutoff(startAtIso) {
  const start = startAtIso instanceof Date ? startAtIso : new Date(startAtIso)
  if (Number.isNaN(start.getTime())) return false
  const cutoff = Date.now() + 48 * 60 * 60 * 1000
  return start.getTime() <= cutoff
}

function cleanString(v) {
  const s = String(v || '').trim()
  return s.length ? s : null
}

function asInt(v, fallback) {
  const n = Number(v)
  return Number.isFinite(n) ? n : fallback
}

function parseIsoDateTime(value) {
  if (!value) return null
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null
    return value
  }
  if (typeof value !== 'string') return null
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return null
  return d
}

async function ensureManagerLocationAccess(pool, userId, locationId) {
  const exists = await pool.query(
    'select 1 from staff_locations where staff_id = $1 and location_id = $2 limit 1',
    [userId, locationId],
  )
  return exists.rows.length > 0
}

async function notifyAssignedStaff(pool, shiftId, type, message, metadata, realtime) {
  const assigned = await pool.query(
    `
      select staff_id
      from shift_assignments
      where shift_id = $1 and status <> 'dropped'::shift_assignment_status
    `,
    [shiftId],
  )

  for (const r of assigned.rows) {
    await createNotification(r.staff_id, type, message, metadata, { pool, realtime })
  }
}

async function cancelPendingSwapsForShift(pool, shiftId, actorUserId, locationId, realtime) {
  const pending = await pool.query(
    `
      select sr.id, sr.requested_by, sr.target_staff_id
      from swap_requests sr
      join shift_assignments sa on sa.id = sr.assignment_id
      where sa.shift_id = $1
        and sr.status in ('pending'::swap_request_status, 'pending_manager_approval'::swap_request_status)
    `,
    [shiftId],
  )

  if (!pending.rows.length) return 0

  const client = typeof pool.connect === 'function' ? await pool.connect() : null
  const db = client || pool

  try {
    if (client) await client.query('begin')

    const ids = pending.rows.map((r) => r.id)
    await db.query('update swap_requests set status = $1::swap_request_status where id = any($2::uuid[])', ['cancelled', ids])

    for (const r of pending.rows) {
      await logAudit(actorUserId, 'swap.cancel.shift_edit', 'swap_request', r.id, {}, { status: 'cancelled' }, { pool: db })

      await createNotification(
        r.requested_by,
        'swap.cancelled',
        'Swap/drop request cancelled due to shift update',
        { shiftId, swapRequestId: r.id },
        { pool: db, realtime },
      )

      if (r.target_staff_id) {
        await createNotification(
          r.target_staff_id,
          'swap.cancelled',
          'Swap request cancelled due to shift update',
          { shiftId, swapRequestId: r.id },
          { pool: db, realtime },
        )
      }
    }

    if (client) await client.query('commit')
  } catch (e) {
    if (client) {
      try {
        await client.query('rollback')
      } catch {}
    }
    throw e
  } finally {
    if (client) client.release()
  }

  if (realtime && locationId) {
    for (const r of pending.rows) {
      realtime.emitToUser(r.requested_by, 'swap:cancelled', { swapId: r.id, shiftId })
      if (r.target_staff_id) realtime.emitToUser(r.target_staff_id, 'swap:cancelled', { swapId: r.id, shiftId })
    }
    realtime.emitToLocation(locationId, 'swap:updated', { shiftId, status: 'cancelled' })
  }

  return pending.rows.length
}

router.get('/', async (req, res) => {
  const pool = getPool()

  const locationId = cleanString(req.query?.locationId)
  const status = cleanString(req.query?.status)
  const from = parseIsoDateTime(req.query?.from)
  const to = parseIsoDateTime(req.query?.to)

  if (status && !['draft', 'published'].includes(status)) {
    res.status(400).json({ error: 'invalid_status' })
    return
  }

  const params = []
  const where = []

  if (locationId) {
    params.push(locationId)
    where.push(`s.location_id = $${params.length}`)
  }

  if (status) {
    params.push(status)
    where.push(`s.status = $${params.length}::shift_status`)
  }

  if (from) {
    params.push(from.toISOString())
    where.push(`s.start_at >= $${params.length}::timestamptz`)
  }

  if (to) {
    params.push(to.toISOString())
    where.push(`s.start_at < $${params.length}::timestamptz`)
  }

  if (req.user.role === 'manager') {
    params.push(req.user.id)
    where.push(`exists (select 1 from staff_locations sl where sl.staff_id = $${params.length} and sl.location_id = s.location_id)`)
  }

  const whereSql = where.length ? `where ${where.join(' and ')}` : ''

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
        s.is_premium,
        s.headcount_needed,
        s.status,
        s.created_at,
        s.updated_at
      from shifts s
      join locations l on l.id = s.location_id
      left join skills sk on sk.id = s.required_skill_id
      ${whereSql}
      order by s.start_at asc
      limit 500
    `,
    params,
  )

  res.json({
    shifts: result.rows.map((r) => ({
      id: r.id,
      locationId: r.location_id,
      location: { id: r.location_id, name: r.location_name, timezone: r.location_timezone },
      requiredSkillId: r.required_skill_id,
      requiredSkill: r.required_skill_id ? { id: r.required_skill_id, name: r.required_skill_name } : null,
      startAt: new Date(r.start_at).toISOString(),
      endAt: new Date(r.end_at).toISOString(),
      isPremium: Boolean(r.is_premium),
      headcountNeeded: r.headcount_needed,
      status: r.status,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    })),
  })
})

router.get('/:shiftId', async (req, res) => {
  const pool = getPool()
  const shiftId = req.params.shiftId

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
        s.is_premium,
        s.headcount_needed,
        s.status,
        s.created_at,
        s.updated_at
      from shifts s
      join locations l on l.id = s.location_id
      left join skills sk on sk.id = s.required_skill_id
      where s.id = $1
      limit 1
    `,
    [shiftId],
  )

  const r = result.rows[0]
  if (!r) {
    res.status(404).json({ error: 'not_found' })
    return
  }

  if (req.user.role === 'manager') {
    const ok = await ensureManagerLocationAccess(pool, req.user.id, r.location_id)
    if (!ok) {
      res.status(403).json({ error: 'forbidden' })
      return
    }
  }

  res.json({
    shift: {
      id: r.id,
      locationId: r.location_id,
      location: { id: r.location_id, name: r.location_name, timezone: r.location_timezone },
      requiredSkillId: r.required_skill_id,
      requiredSkill: r.required_skill_id ? { id: r.required_skill_id, name: r.required_skill_name } : null,
      startAt: new Date(r.start_at).toISOString(),
      endAt: new Date(r.end_at).toISOString(),
      isPremium: Boolean(r.is_premium),
      headcountNeeded: r.headcount_needed,
      status: r.status,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    },
  })
})

router.post('/', async (req, res) => {
  const locationId = cleanString(req.body?.locationId)
  const requiredSkillId = cleanString(req.body?.requiredSkillId)
  const status = cleanString(req.body?.status) || 'draft'

  const startAt = parseIsoDateTime(req.body?.startAt)
  const endAt = parseIsoDateTime(req.body?.endAt)
  const headcountNeeded = asInt(req.body?.headcountNeeded, 1)

  if (!locationId || !startAt || !endAt) {
    res.status(400).json({ error: 'location_and_times_required' })
    return
  }

  if (!(endAt > startAt)) {
    res.status(400).json({ error: 'end_must_be_after_start' })
    return
  }

  if (!Number.isInteger(headcountNeeded) || headcountNeeded < 1 || headcountNeeded > 500) {
    res.status(400).json({ error: 'invalid_headcount' })
    return
  }

  if (!['draft', 'published'].includes(status)) {
    res.status(400).json({ error: 'invalid_status' })
    return
  }

  const pool = getPool()

  if (req.user.role === 'manager') {
    const ok = await ensureManagerLocationAccess(pool, req.user.id, locationId)
    if (!ok) {
      res.status(403).json({ error: 'forbidden' })
      return
    }
  }

  const inserted = await pool.query(
    `
      insert into shifts (
        location_id,
        required_skill_id,
        start_at,
        end_at,
        date,
        start_time,
        end_time,
        is_premium,
        headcount_needed,
        status
      )
      select
        $1::uuid,
        $2::uuid,
        $3::timestamptz,
        $4::timestamptz,
        (($3::timestamptz at time zone l.timezone)::date),
        (($3::timestamptz at time zone l.timezone)::time),
        (($4::timestamptz at time zone l.timezone)::time),
        (
          extract(dow from ($3::timestamptz at time zone l.timezone)) in (5, 6)
          and ($3::timestamptz at time zone l.timezone)::time >= time '17:00'
        ),
        $5::int,
        $6::shift_status
      from locations l
      where l.id = $1::uuid
      returning id
    `,
    [locationId, requiredSkillId, startAt.toISOString(), endAt.toISOString(), headcountNeeded, status],
  )

  if (inserted.rows.length === 0) {
    res.status(404).json({ error: 'location_not_found' })
    return
  }

  const createdId = inserted.rows[0].id
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
        s.is_premium,
        s.headcount_needed,
        s.status,
        s.created_at,
        s.updated_at
      from shifts s
      join locations l on l.id = s.location_id
      left join skills sk on sk.id = s.required_skill_id
      where s.id = $1
      limit 1
    `,
    [createdId],
  )
  const r = result.rows[0]

  await logAudit(req.user.id, 'shift.create', 'shift', r.id, null, {
    locationId: r.location_id,
    requiredSkillId: r.required_skill_id,
    startAt: new Date(r.start_at).toISOString(),
    endAt: new Date(r.end_at).toISOString(),
    isPremium: Boolean(r.is_premium),
    headcountNeeded: r.headcount_needed,
    status: r.status,
  })

  req.app.locals.realtime?.emitToLocation(r.location_id, 'schedule:updated', { locationId: r.location_id, shiftId: r.id, reason: 'shift.created' })

  res.status(201).json({
    shift: {
      id: r.id,
      locationId: r.location_id,
      location: { id: r.location_id, name: r.location_name, timezone: r.location_timezone },
      requiredSkillId: r.required_skill_id,
      requiredSkill: r.required_skill_id ? { id: r.required_skill_id, name: r.required_skill_name } : null,
      startAt: new Date(r.start_at).toISOString(),
      endAt: new Date(r.end_at).toISOString(),
      isPremium: Boolean(r.is_premium),
      headcountNeeded: r.headcount_needed,
      status: r.status,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    },
  })
})

router.patch('/:shiftId', async (req, res) => {
  const pool = getPool()
  const shiftId = req.params.shiftId

  const existing = await pool.query(
    'select id, location_id, required_skill_id, start_at, end_at, headcount_needed, status, is_premium from shifts where id = $1 limit 1',
    [shiftId],
  )
  const current = existing.rows[0]
  if (!current) {
    res.status(404).json({ error: 'not_found' })
    return
  }

  if (req.user.role === 'manager') {
    const ok = await ensureManagerLocationAccess(pool, req.user.id, current.location_id)
    if (!ok) {
      res.status(403).json({ error: 'forbidden' })
      return
    }
  }

  const nextLocationId = req.body?.locationId !== undefined ? cleanString(req.body.locationId) : undefined
  const requiredSkillId = req.body?.requiredSkillId !== undefined ? cleanString(req.body.requiredSkillId) : undefined
  const status = req.body?.status !== undefined ? cleanString(req.body.status) : undefined

  const startAt = req.body?.startAt !== undefined ? parseIsoDateTime(req.body.startAt) : undefined
  const endAt = req.body?.endAt !== undefined ? parseIsoDateTime(req.body.endAt) : undefined
  const headcountNeeded = req.body?.headcountNeeded !== undefined ? asInt(req.body.headcountNeeded, NaN) : undefined

  if (status !== undefined && !['draft', 'published'].includes(status || '')) {
    res.status(400).json({ error: 'invalid_status' })
    return
  }

  if (headcountNeeded !== undefined && (!Number.isInteger(headcountNeeded) || headcountNeeded < 1 || headcountNeeded > 500)) {
    res.status(400).json({ error: 'invalid_headcount' })
    return
  }

  if (startAt !== undefined && !startAt) {
    res.status(400).json({ error: 'invalid_startAt' })
    return
  }

  if (endAt !== undefined && !endAt) {
    res.status(400).json({ error: 'invalid_endAt' })
    return
  }

  const effectiveStart = startAt !== undefined ? startAt : parseIsoDateTime(current.start_at)
  const effectiveEnd = endAt !== undefined ? endAt : parseIsoDateTime(current.end_at)

  if (!effectiveStart || !effectiveEnd) {
    res.status(500).json({ error: 'server_error' })
    return
  }

  if (!(effectiveEnd > effectiveStart)) {
    res.status(400).json({ error: 'end_must_be_after_start' })
    return
  }

  const willUpdateTime = startAt !== undefined || endAt !== undefined || nextLocationId !== undefined

  if (nextLocationId && req.user.role === 'manager') {
    const ok = await ensureManagerLocationAccess(pool, req.user.id, nextLocationId)
    if (!ok) {
      res.status(403).json({ error: 'forbidden' })
      return
    }
  }

  const updates = []
  const params = []

  function set(field, value, cast) {
    params.push(value)
    updates.push(`${field} = $${params.length}${cast || ''}`)
  }

  if (nextLocationId !== undefined) set('location_id', nextLocationId, '::uuid')
  if (requiredSkillId !== undefined) set('required_skill_id', requiredSkillId, '::uuid')
  if (status !== undefined) set('status', status, '::shift_status')
  if (headcountNeeded !== undefined) set('headcount_needed', headcountNeeded, '::int')
  if (startAt !== undefined) set('start_at', startAt.toISOString(), '::timestamptz')
  if (endAt !== undefined) set('end_at', endAt.toISOString(), '::timestamptz')

  if (!updates.length) {
    const r = await pool.query(
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
          s.is_premium,
          s.headcount_needed,
          s.status,
          s.created_at,
          s.updated_at
        from shifts s
        join locations l on l.id = s.location_id
        left join skills sk on sk.id = s.required_skill_id
        where s.id = $1
        limit 1
      `,
      [shiftId],
    )
    const row = r.rows[0]
    res.json({
      shift: {
        id: row.id,
        locationId: row.location_id,
        location: { id: row.location_id, name: row.location_name, timezone: row.location_timezone },
        requiredSkillId: row.required_skill_id,
        requiredSkill: row.required_skill_id ? { id: row.required_skill_id, name: row.required_skill_name } : null,
        startAt: new Date(row.start_at).toISOString(),
        endAt: new Date(row.end_at).toISOString(),
        isPremium: Boolean(row.is_premium),
        headcountNeeded: row.headcount_needed,
        status: row.status,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      },
    })
    return
  }

  params.push(shiftId)
  const updated = await pool.query(
    `
      update shifts s
      set ${updates.join(', ')}, updated_at = now()
      where s.id = $${params.length}
      returning s.id
    `,
    params,
  )

  if (updated.rows.length === 0) {
    res.status(404).json({ error: 'not_found' })
    return
  }

  if (willUpdateTime) {
    await pool.query(
      `
        update shifts s
        set
          date = ((s.start_at at time zone l.timezone)::date),
          start_time = ((s.start_at at time zone l.timezone)::time),
          end_time = ((s.end_at at time zone l.timezone)::time),
          is_premium = (
            extract(dow from (s.start_at at time zone l.timezone)) in (5, 6)
            and (s.start_at at time zone l.timezone)::time >= time '17:00'
          ),
          updated_at = now()
        from locations l
        where s.id = $1 and l.id = s.location_id
      `,
      [shiftId],
    )
  }

  await cancelPendingSwapsForShift(pool, shiftId, req.user.id, nextLocationId || current.location_id, req.app.locals.realtime)

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
        s.is_premium,
        s.headcount_needed,
        s.status,
        s.created_at,
        s.updated_at
      from shifts s
      join locations l on l.id = s.location_id
      left join skills sk on sk.id = s.required_skill_id
      where s.id = $1
      limit 1
    `,
    [shiftId],
  )
  const r = result.rows[0]

  await logAudit(
    req.user.id,
    'shift.update',
    'shift',
    shiftId,
    {
      locationId: current.location_id,
      requiredSkillId: current.required_skill_id,
      startAt: new Date(current.start_at).toISOString(),
      endAt: new Date(current.end_at).toISOString(),
      isPremium: Boolean(current.is_premium),
      headcountNeeded: current.headcount_needed,
      status: current.status,
    },
    {
      locationId: r.location_id,
      requiredSkillId: r.required_skill_id,
      startAt: new Date(r.start_at).toISOString(),
      endAt: new Date(r.end_at).toISOString(),
      isPremium: Boolean(r.is_premium),
      headcountNeeded: r.headcount_needed,
      status: r.status,
    },
    { pool },
  )

  req.app.locals.realtime?.emitToLocation(r.location_id, 'schedule:updated', { locationId: r.location_id, shiftId: r.id, reason: 'shift.updated' })
  await notifyAssignedStaff(pool, shiftId, 'shift.updated', 'A shift you are assigned to was updated', { shiftId }, req.app.locals.realtime)

  res.json({
    shift: {
      id: r.id,
      locationId: r.location_id,
      location: { id: r.location_id, name: r.location_name, timezone: r.location_timezone },
      requiredSkillId: r.required_skill_id,
      requiredSkill: r.required_skill_id ? { id: r.required_skill_id, name: r.required_skill_name } : null,
      startAt: new Date(r.start_at).toISOString(),
      endAt: new Date(r.end_at).toISOString(),
      isPremium: Boolean(r.is_premium),
      headcountNeeded: r.headcount_needed,
      status: r.status,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    },
  })
})

router.delete('/:shiftId', async (req, res) => {
  const pool = getPool()
  const shiftId = req.params.shiftId

  const existing = await pool.query(
    'select id, location_id, required_skill_id, start_at, end_at, headcount_needed, status, is_premium from shifts where id = $1 limit 1',
    [shiftId],
  )
  const current = existing.rows[0]
  if (!current) {
    res.status(404).json({ error: 'not_found' })
    return
  }

  if (req.user.role === 'manager') {
    const ok = await ensureManagerLocationAccess(pool, req.user.id, current.location_id)
    if (!ok) {
      res.status(403).json({ error: 'forbidden' })
      return
    }
  }

  await notifyAssignedStaff(
    pool,
    shiftId,
    'shift.deleted',
    'A shift you were assigned to was deleted',
    { shiftId },
    req.app.locals.realtime,
  )
  await cancelPendingSwapsForShift(pool, shiftId, req.user.id, current.location_id, req.app.locals.realtime)
  await logAudit(
    req.user.id,
    'shift.delete',
    'shift',
    shiftId,
    {
      locationId: current.location_id,
      requiredSkillId: current.required_skill_id,
      startAt: new Date(current.start_at).toISOString(),
      endAt: new Date(current.end_at).toISOString(),
      isPremium: Boolean(current.is_premium),
      headcountNeeded: current.headcount_needed,
      status: current.status,
    },
    null,
    { pool },
  )
  await pool.query('delete from shifts where id = $1', [shiftId])
  req.app.locals.realtime?.emitToLocation(current.location_id, 'schedule:updated', { locationId: current.location_id, shiftId, reason: 'shift.deleted' })
  res.json({ ok: true })
})

router.patch('/:shiftId/status', async (req, res) => {
  const pool = getPool()
  const shiftId = req.params.shiftId
  const status = cleanString(req.body?.status)

  if (!status || !['draft', 'published'].includes(status)) {
    res.status(400).json({ error: 'invalid_status' })
    return
  }

  const existing = await pool.query('select id, location_id, status, start_at from shifts where id = $1 limit 1', [shiftId])
  const current = existing.rows[0]
  if (!current) {
    res.status(404).json({ error: 'not_found' })
    return
  }

  if (req.user.role === 'manager') {
    const ok = await ensureManagerLocationAccess(pool, req.user.id, current.location_id)
    if (!ok) {
      res.status(403).json({ error: 'forbidden' })
      return
    }
  }

  if (withinCutoff(current.start_at)) {
    res.status(409).json({ error: 'cutoff_reached' })
    return
  }

  if (current.status === status) {
    res.json({ ok: true })
    return
  }

  await pool.query('begin')
  try {
    await pool.query('update shifts set status = $1::shift_status, updated_at = now() where id = $2', [status, shiftId])
    await logAudit(req.user.id, 'shift.status', 'shift', shiftId, { status: current.status }, { status }, { pool })
    await pool.query('commit')
  } catch (e) {
    await pool.query('rollback')
    throw e
  }

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
        s.is_premium,
        s.headcount_needed,
        s.status,
        s.created_at,
        s.updated_at
      from shifts s
      join locations l on l.id = s.location_id
      left join skills sk on sk.id = s.required_skill_id
      where s.id = $1
      limit 1
    `,
    [shiftId],
  )
  const r = result.rows[0]

  req.app.locals.realtime?.emitToLocation(r.location_id, 'schedule:updated', { locationId: r.location_id, shiftId: r.id, reason: 'shift.status' })
  await notifyAssignedStaff(
    pool,
    shiftId,
    r.status === 'published' ? 'shift.published' : 'shift.unpublished',
    r.status === 'published' ? 'A shift you are assigned to was published' : 'A shift you are assigned to was unpublished',
    { shiftId, status: r.status },
    req.app.locals.realtime,
  )

  res.json({
    shift: {
      id: r.id,
      locationId: r.location_id,
      location: { id: r.location_id, name: r.location_name, timezone: r.location_timezone },
      requiredSkillId: r.required_skill_id,
      requiredSkill: r.required_skill_id ? { id: r.required_skill_id, name: r.required_skill_name } : null,
      startAt: new Date(r.start_at).toISOString(),
      endAt: new Date(r.end_at).toISOString(),
      isPremium: Boolean(r.is_premium),
      headcountNeeded: r.headcount_needed,
      status: r.status,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    },
  })
})

router.get('/:shiftId/history', async (req, res) => {
  const pool = getPool()
  const shiftId = req.params.shiftId

  const shiftResult = await pool.query('select id, location_id from shifts where id = $1 limit 1', [shiftId])
  const shift = shiftResult.rows[0]
  if (!shift) {
    res.status(404).json({ error: 'not_found' })
    return
  }

  if (req.user.role === 'manager') {
    const ok = await ensureManagerLocationAccess(pool, req.user.id, shift.location_id)
    if (!ok) {
      res.status(403).json({ error: 'forbidden' })
      return
    }
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
        u.id as actor_id,
        u.email as actor_email,
        u.name as actor_name
      from audit_logs a
      left join users u on u.id = a.user_id
      where a.entity_type = 'shift' and a.entity_id = $1::uuid
      order by a.created_at asc
      limit 500
    `,
    [shiftId],
  )

  res.json({
    shiftId,
    entries: result.rows.map((r) => ({
      id: r.id,
      createdAt: r.created_at,
      action: r.action,
      actor: r.actor_id ? { id: r.actor_id, email: r.actor_email, name: r.actor_name } : null,
      before: r.before,
      after: r.after,
    })),
  })
})

router.get('/:shiftId/alternatives', async (req, res) => {
  const pool = getPool()
  const shiftId = req.params.shiftId
  const limit = asInt(req.query?.limit, 10)

  const shiftResult = await pool.query('select id, location_id from shifts where id = $1 limit 1', [shiftId])
  const shift = shiftResult.rows[0]
  if (!shift) {
    res.status(404).json({ error: 'not_found' })
    return
  }

  if (req.user.role === 'manager') {
    const ok = await ensureManagerLocationAccess(pool, req.user.id, shift.location_id)
    if (!ok) {
      res.status(403).json({ error: 'forbidden' })
      return
    }
  }

  const alternatives = await findValidAlternatives(shiftId, { pool, limit: Math.max(1, Math.min(limit, 50)) })
  res.json({ alternatives })
})

router.get('/:shiftId/preview', async (req, res) => {
  const pool = getPool()
  const shiftId = req.params.shiftId
  const staffId = cleanString(req.query?.staffId)

  if (!staffId) {
    res.status(400).json({ error: 'staffId_required' })
    return
  }

  const shiftResult = await pool.query('select id, location_id from shifts where id = $1 limit 1', [shiftId])
  const shift = shiftResult.rows[0]
  if (!shift) {
    res.status(404).json({ error: 'not_found' })
    return
  }

  if (req.user.role === 'manager') {
    const ok = await ensureManagerLocationAccess(pool, req.user.id, shift.location_id)
    if (!ok) {
      res.status(403).json({ error: 'forbidden' })
      return
    }
  }

  const validation = await validateAssignment(staffId, shiftId, { pool })
  res.json({
    valid: validation.valid,
    violations: validation.violations,
    suggestions: validation.suggestions,
    overtime: validation.overtime || null,
  })
})

router.post('/:shiftId/assign', async (req, res) => {
  const pool = getPool()
  const shiftId = req.params.shiftId
  const staffId = cleanString(req.body?.staffId)
  const overrideReason = cleanString(req.body?.overrideReason)

  if (!staffId) {
    res.status(400).json({ error: 'staffId_required' })
    return
  }

  const shiftResult = await pool.query(
    'select id, location_id, start_at, headcount_needed, status from shifts where id = $1 limit 1',
    [shiftId],
  )
  const shift = shiftResult.rows[0]
  if (!shift) {
    res.status(404).json({ error: 'not_found' })
    return
  }

  if (req.user.role === 'manager') {
    const ok = await ensureManagerLocationAccess(pool, req.user.id, shift.location_id)
    if (!ok) {
      res.status(403).json({ error: 'forbidden' })
      return
    }
  }

  if (withinCutoff(shift.start_at)) {
    res.status(409).json({ error: 'cutoff_reached' })
    return
  }

  const result = await assignStaffToShift(
    { shiftId, staffId, actorUserId: req.user.id, overrideReason },
    { pool },
  )

  if (!result.ok) {
    if (result.error === 'headcount_full') {
      req.app.locals.realtime?.emitToUser(req.user.id, 'assignment:conflict', { shiftId, reason: 'headcount_full' })
      res.status(409).json({ error: 'headcount_full' })
      return
    }
    if (result.error === 'already_assigned') {
      res.status(409).json({ error: 'already_assigned' })
      return
    }
    if (result.error === 'constraint_violation') {
      const alternatives = await findValidAlternatives(shiftId, { pool, limit: 8 })
      res.status(400).json({ error: 'constraint_violation', validation: result.validation, alternatives })
      return
    }
    if (result.error === 'not_found') {
      res.status(404).json({ error: 'not_found' })
      return
    }
    res.status(400).json({ error: result.error })
    return
  }

  req.app.locals.realtime?.emitToLocation(result.locationId, 'schedule:updated', { locationId: result.locationId, shiftId })
  req.app.locals.realtime?.emitToUser(staffId, 'assignment:new', { shiftId, assignmentId: result.assignmentId })

  await createNotification(
    staffId,
    'assignment.new',
    'You were assigned to a shift',
    { shiftId, assignmentId: result.assignmentId },
    { pool, realtime: req.app.locals.realtime },
  )

  if (result.warnings && result.warnings.length) {
    const msgs = result.warnings.map((w) => w.message || w.code)
    await createNotification(
      staffId,
      'overtime.warning',
      `Overtime warning: ${msgs.join(' · ')}`,
      { shiftId, staffId, assignmentId: result.assignmentId, warnings: result.warnings, overtime: result.overtime || null },
      { pool, realtime: req.app.locals.realtime },
    )
    await createNotification(
      req.user.id,
      'overtime.warning',
      `Overtime warning: ${msgs.join(' · ')}`,
      { shiftId, staffId, assignmentId: result.assignmentId, warnings: result.warnings, overtime: result.overtime || null },
      { pool, realtime: req.app.locals.realtime },
    )
  }

  res.status(201).json({ ok: true, assignmentId: result.assignmentId, warnings: result.warnings, overtime: result.overtime })
})

module.exports = { shiftsRouter: router }
