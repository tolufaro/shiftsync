const express = require('express')

const { getPool } = require('../db')
const { requireRole } = require('../middleware/rbac')
const { validateAssignment } = require('../services/validateAssignment')

const router = express.Router()

router.use(...requireRole(['staff']))

function withinCutoff(startAt) {
  const start = startAt instanceof Date ? startAt : new Date(startAt)
  if (Number.isNaN(start.getTime())) return false
  const cutoff = Date.now() + 48 * 60 * 60 * 1000
  return start.getTime() <= cutoff
}

router.get('/available', async (req, res) => {
  const pool = getPool()
  const staffId = req.user.id

  const candidateRows = await pool.query(
    `
      with staff_locs as (
        select location_id
        from staff_locations
        where staff_id = $1
      ),
      active_counts as (
        select shift_id, count(*)::int as active_count
        from shift_assignments
        where status <> 'dropped'::shift_assignment_status
        group by shift_id
      )
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
        coalesce(ac.active_count, 0) as active_count
      from shifts s
      join staff_locs sl on sl.location_id = s.location_id
      join locations l on l.id = s.location_id
      left join skills sk on sk.id = s.required_skill_id
      left join active_counts ac on ac.shift_id = s.id
      where s.status = 'published'::shift_status
        and s.start_at > now()
        and coalesce(ac.active_count, 0) < s.headcount_needed
        and not exists (
          select 1
          from shift_assignments sa2
          where sa2.shift_id = s.id
            and sa2.staff_id = $1
            and sa2.status <> 'dropped'::shift_assignment_status
        )
        and (
          s.required_skill_id is null
          or exists (
            select 1 from staff_skills ss
            where ss.staff_id = $1 and ss.skill_id = s.required_skill_id
          )
        )
      order by s.start_at asc
      limit 200
    `,
    [staffId],
  )

  const valid = []
  for (const r of candidateRows.rows) {
    const validation = await validateAssignment(staffId, r.id, { pool })
    if (!validation.valid) continue
    valid.push({
      id: r.id,
      location: { id: r.location_id, name: r.location_name, timezone: r.location_timezone },
      requiredSkill: r.required_skill_id ? { id: r.required_skill_id, name: r.required_skill_name } : null,
      startAt: new Date(r.start_at).toISOString(),
      endAt: new Date(r.end_at).toISOString(),
      headcountNeeded: r.headcount_needed,
      filled: r.active_count,
      status: r.status,
    })
    if (valid.length >= 60) break
  }

  res.json({ shifts: valid })
})

router.post('/:shiftId/claim', async (req, res) => {
  const pool = getPool()
  const staffId = req.user.id
  const shiftId = req.params.shiftId

  const shiftResult = await pool.query('select id, location_id, start_at, headcount_needed, status from shifts where id = $1 limit 1', [shiftId])
  const shift = shiftResult.rows[0]
  if (!shift) {
    res.status(404).json({ error: 'not_found' })
    return
  }

  if (shift.status !== 'published') {
    res.status(409).json({ error: 'shift_not_published' })
    return
  }

  if (withinCutoff(shift.start_at)) {
    res.status(409).json({ error: 'cutoff_reached' })
    return
  }

  const count = await pool.query(
    `
      select count(*)::int as c
      from shift_assignments
      where shift_id = $1 and status <> 'dropped'::shift_assignment_status
    `,
    [shiftId],
  )
  if (count.rows[0].c >= shift.headcount_needed) {
    res.status(409).json({ error: 'headcount_full' })
    return
  }

  const already = await pool.query(
    `
      select id
      from shift_assignments
      where shift_id = $1 and staff_id = $2 and status <> 'dropped'::shift_assignment_status
      limit 1
    `,
    [shiftId, staffId],
  )
  if (already.rows.length) {
    res.status(409).json({ error: 'already_assigned' })
    return
  }

  const validation = await validateAssignment(staffId, shiftId, { pool })
  if (!validation.valid) {
    res.status(400).json({ error: 'constraint_violation', validation })
    return
  }

  await pool.query('begin')
  let assignmentId = null
  try {
    const created = await pool.query(
      `
        insert into shift_assignments (shift_id, staff_id, assigned_by, status)
        values ($1, $2, $3, $4::shift_assignment_status)
        returning id
      `,
      [shiftId, staffId, staffId, 'active'],
    )
    assignmentId = created.rows[0].id

    await pool.query(
      'insert into audit_logs (user_id, action, entity_type, entity_id, before, after) values ($1,$2,$3,$4,$5,$6)',
      [staffId, 'shift.claim', 'shift', shiftId, JSON.stringify({}), JSON.stringify({ assignmentId: created.rows[0].id })],
    )

    await pool.query('commit')
  } catch (e) {
    await pool.query('rollback')
    throw e
  }

  req.app.locals.realtime?.emitToLocation(shift.location_id, 'schedule:updated', { locationId: shift.location_id, shiftId, reason: 'shift.claim' })
  req.app.locals.realtime?.emitToUser(staffId, 'assignment:new', { shiftId, assignmentId })

  res.status(201).json({ ok: true, assignmentId })
})

module.exports = { myShiftsRouter: router }
