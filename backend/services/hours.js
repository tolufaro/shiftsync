const { getPool } = require('../db')
const { getWeeklyHours: getWeeklyHoursPure, getDailyHours: getDailyHoursPure, getConsecutiveDays: getConsecutiveDaysPure } = require('../domain/hours')

async function loadAssignedShifts(pool, staffId, startAtIso, endAtIso) {
  const result = await pool.query(
    `
      select
        s.start_at,
        s.end_at,
        l.timezone as location_timezone
      from shift_assignments sa
      join shifts s on s.id = sa.shift_id
      join locations l on l.id = s.location_id
      where sa.staff_id = $1
        and sa.status <> 'dropped'::shift_assignment_status
        and s.start_at < $3::timestamptz
        and s.end_at > $2::timestamptz
    `,
    [staffId, startAtIso, endAtIso],
  )
  return result.rows.map((r) => ({
    startAt: new Date(r.start_at).toISOString(),
    endAt: new Date(r.end_at).toISOString(),
    timeZone: r.location_timezone,
  }))
}

async function getWeeklyHours(staffId, weekStartYmd, options = {}) {
  const pool = options.pool || getPool()
  const startAt = new Date(`${weekStartYmd}T00:00:00.000Z`)
  const endAt = new Date(startAt.getTime() + 7 * 86400000)
  const shifts = await loadAssignedShifts(pool, staffId, startAt.toISOString(), endAt.toISOString())
  const grouped = new Map()
  for (const s of shifts) {
    const tz = s.timeZone || 'UTC'
    grouped.set(tz, grouped.get(tz) || [])
    grouped.get(tz).push({ startAt: s.startAt, endAt: s.endAt })
  }
  let hours = 0
  for (const [tz, arr] of grouped.entries()) {
    hours += getWeeklyHoursPure(arr, weekStartYmd, tz)
  }
  return hours
}

async function getDailyHours(staffId, dateYmd, options = {}) {
  const pool = options.pool || getPool()
  const startAt = new Date(`${dateYmd}T00:00:00.000Z`)
  const endAt = new Date(startAt.getTime() + 86400000)
  const shifts = await loadAssignedShifts(pool, staffId, startAt.toISOString(), endAt.toISOString())
  const grouped = new Map()
  for (const s of shifts) {
    const tz = s.timeZone || 'UTC'
    grouped.set(tz, grouped.get(tz) || [])
    grouped.get(tz).push({ startAt: s.startAt, endAt: s.endAt })
  }
  let hours = 0
  for (const [tz, arr] of grouped.entries()) {
    hours += getDailyHoursPure(arr, dateYmd, tz)
  }
  return hours
}

async function getConsecutiveDays(staffId, weekStartYmd, options = {}) {
  const pool = options.pool || getPool()
  const startAt = new Date(`${weekStartYmd}T00:00:00.000Z`)
  const endAt = new Date(startAt.getTime() + 7 * 86400000)
  const shifts = await loadAssignedShifts(pool, staffId, startAt.toISOString(), endAt.toISOString())
  const grouped = new Map()
  for (const s of shifts) {
    const tz = s.timeZone || 'UTC'
    grouped.set(tz, grouped.get(tz) || [])
    grouped.get(tz).push({ startAt: s.startAt, endAt: s.endAt })
  }
  let max = 0
  for (const [tz, arr] of grouped.entries()) {
    const v = getConsecutiveDaysPure(arr, weekStartYmd, tz)
    if (v > max) max = v
  }
  return max
}

module.exports = { getWeeklyHours, getDailyHours, getConsecutiveDays }

