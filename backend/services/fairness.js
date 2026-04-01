const { getPool } = require('../db')

function clamp01(x) {
  if (x < 0) return 0
  if (x > 1) return 1
  return x
}

async function getFairnessScore(locationId, period, options = {}) {
  const pool = options.pool || getPool()
  const from = period?.from
  const to = period?.to
  if (!from || !to) throw new Error('from_and_to_required')

  const staff = await pool.query(
    `
      select u.id, u.email, u.name
      from users u
      join staff_locations sl on sl.staff_id = u.id
      where sl.location_id = $1
        and u.role = 'staff'::user_role
      order by u.name nulls last, u.email
    `,
    [locationId],
  )

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
    [locationId, from, to],
  )

  const map = new Map()
  for (const r of premiumCounts.rows) map.set(r.staff_id, r.premium_count)

  const staffCount = staff.rows.length
  const totalPremium = premiumCounts.rows.reduce((sum, r) => sum + r.premium_count, 0)
  const avg = staffCount > 0 ? totalPremium / staffCount : 0

  return {
    locationId,
    from,
    to,
    avgPremiumPerStaff: avg,
    staff: staff.rows.map((u) => {
      const received = map.get(u.id) || 0
      const ratio = avg > 0 ? received / avg : 1
      const score = Math.round(clamp01(ratio) * 100)
      return { id: u.id, email: u.email, name: u.name, premiumShifts: received, fairnessScore: score }
    }),
  }
}

module.exports = { getFairnessScore }

