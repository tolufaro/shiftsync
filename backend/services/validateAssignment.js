const { getPool } = require('../db')
const { validateAssignmentCore } = require('../domain/validateAssignment')

function normalizeTimeStr(value) {
  if (!value) return null
  const s = String(value)
  return s.length >= 5 ? s.slice(0, 5) : s
}

async function validateAssignment(staffId, shiftId, options = {}) {
  const pool = options.pool || getPool()
  const excludeShiftIds = Array.isArray(options.excludeShiftIds) ? options.excludeShiftIds : []
  const excluded = Array.from(new Set([shiftId, ...excludeShiftIds]))

  const shiftResult = await pool.query(
    `
      select
        s.id,
        s.location_id,
        l.timezone as location_timezone,
        s.required_skill_id,
        s.start_at,
        s.end_at
      from shifts s
      join locations l on l.id = s.location_id
      where s.id = $1
      limit 1
    `,
    [shiftId],
  )

  const shift = shiftResult.rows[0]
  if (!shift) {
    return { valid: false, violations: [{ code: 'shift_not_found', shiftId }], suggestions: [] }
  }

  const staffTzResult = await pool.query('select home_timezone from users where id = $1 limit 1', [staffId])
  const staffTimeZone = staffTzResult.rows[0]?.home_timezone || 'UTC'

  const querySkills = () => pool.query('select skill_id from staff_skills where staff_id = $1', [staffId])
  const queryLocations = () => pool.query('select location_id from staff_locations where staff_id = $1', [staffId])
  const queryAssigned = () =>
    pool.query(
      `
        select s2.id as shift_id, s2.start_at, s2.end_at
        from shift_assignments sa
        join shifts s2 on s2.id = sa.shift_id
        where sa.staff_id = $1
          and not (sa.shift_id = any($2::uuid[]))
          and sa.status <> 'dropped'::shift_assignment_status
      `,
      [staffId, excluded],
    )
  const queryWindows = () =>
    pool.query(
      `
        select day_of_week, to_char(start_time, 'HH24:MI') as start_time, to_char(end_time, 'HH24:MI') as end_time, is_recurring
        from availability_windows
        where staff_id = $1
        order by day_of_week asc, start_time asc
      `,
      [staffId],
    )
  const queryExceptions = () =>
    pool.query(
      `
        select date::text as date, type, to_char(start_time, 'HH24:MI') as start_time, to_char(end_time, 'HH24:MI') as end_time
        from availability_exceptions
        where staff_id = $1
        order by date asc
      `,
      [staffId],
    )

  const isClient = typeof pool.release === 'function'
  const [skills, locations, assignedShifts, windows, exceptions] = isClient
    ? [await querySkills(), await queryLocations(), await queryAssigned(), await queryWindows(), await queryExceptions()]
    : await Promise.all([querySkills(), queryLocations(), queryAssigned(), queryWindows(), queryExceptions()])

  return validateAssignmentCore({
    staffId,
    staffTimeZone,
    shift: {
      id: shift.id,
      locationId: shift.location_id,
      locationTimeZone: shift.location_timezone,
      requiredSkillId: shift.required_skill_id,
      startAt: new Date(shift.start_at).toISOString(),
      endAt: new Date(shift.end_at).toISOString(),
    },
    staffSkills: skills.rows.map((r) => r.skill_id),
    staffLocationIds: locations.rows.map((r) => r.location_id),
    assignedShifts: assignedShifts.rows.map((r) => ({
      shiftId: r.shift_id,
      startAt: new Date(r.start_at).toISOString(),
      endAt: new Date(r.end_at).toISOString(),
    })),
    availability: {
      windows: windows.rows.map((w) => ({
        dayOfWeek: Number(w.day_of_week),
        startTime: normalizeTimeStr(w.start_time),
        endTime: normalizeTimeStr(w.end_time),
        isRecurring: Boolean(w.is_recurring),
      })),
      exceptions: exceptions.rows.map((e) => ({
        date: e.date,
        type: e.type,
        startTime: normalizeTimeStr(e.start_time),
        endTime: normalizeTimeStr(e.end_time),
      })),
    },
  })
}

module.exports = { validateAssignment }
