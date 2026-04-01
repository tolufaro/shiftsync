const { getPool } = require('../db')
const { validateAssignment } = require('./validateAssignment')

async function assignStaffToShift(params, options = {}) {
  const pool = options.pool || getPool()
  const shiftId = params.shiftId
  const staffId = params.staffId
  const actorUserId = params.actorUserId
  const overrideReason = params.overrideReason || null

  const client = await pool.connect()
  try {
    await client.query('begin')

    const shiftResult = await client.query(
      `
        select id, location_id, start_at, headcount_needed, status
        from shifts
        where id = $1
        for update
      `,
      [shiftId],
    )
    const shift = shiftResult.rows[0]
    if (!shift) {
      await client.query('rollback')
      return { ok: false, error: 'not_found' }
    }

    const existingAssignment = await client.query(
      `
        select id
        from shift_assignments
        where shift_id = $1 and staff_id = $2 and status <> 'dropped'::shift_assignment_status
        limit 1
      `,
      [shiftId, staffId],
    )
    if (existingAssignment.rows.length) {
      await client.query('rollback')
      return { ok: false, error: 'already_assigned', locationId: shift.location_id }
    }

    const count = await client.query(
      `
        select count(*)::int as c
        from shift_assignments
        where shift_id = $1 and status <> 'dropped'::shift_assignment_status
      `,
      [shiftId],
    )
    if (count.rows[0].c >= shift.headcount_needed) {
      await client.query('rollback')
      return { ok: false, error: 'headcount_full', locationId: shift.location_id }
    }

    const validation = await validateAssignment(staffId, shiftId, { pool: client })
    if (!validation.valid) {
      const blocks = (validation.violations || []).filter((v) => v.severity === 'block')
      const nonOverrideBlocks = blocks.filter((v) => !v.overrideable)
      const canOverride = overrideReason && blocks.length > 0 && nonOverrideBlocks.length === 0

      if (!canOverride) {
        await client.query('rollback')
        return { ok: false, error: 'constraint_violation', validation, locationId: shift.location_id }
      }
    }

    const warnings = (validation.violations || []).filter((v) => v.severity === 'warning')

    const created = await client.query(
      `
        insert into shift_assignments (shift_id, staff_id, assigned_by, status)
        values ($1, $2, $3, $4::shift_assignment_status)
        returning id
      `,
      [shiftId, staffId, actorUserId, 'active'],
    )
    const assignmentId = created.rows[0].id

    await client.query(
      'insert into audit_logs (user_id, action, entity_type, entity_id, before, after) values ($1,$2,$3,$4,$5,$6)',
      [
        actorUserId,
        overrideReason ? 'shift.assign.override' : 'shift.assign',
        'shift',
        shiftId,
        JSON.stringify({}),
        JSON.stringify({ assignmentId, staffId, overrideReason }),
      ],
    )

    await client.query('commit')
    return { ok: true, assignmentId, warnings, overtime: validation.overtime || null, locationId: shift.location_id }
  } catch (e) {
    try {
      await client.query('rollback')
    } catch {}
    throw e
  } finally {
    client.release()
  }
}

module.exports = { assignStaffToShift }

