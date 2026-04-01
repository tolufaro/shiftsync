const { getPool } = require('../db')
const { validateAssignment } = require('./validateAssignment')

async function findValidAlternatives(shiftId, options = {}) {
  const pool = options.pool || getPool()
  const limit = Number.isFinite(options.limit) ? Number(options.limit) : 10
  const candidateLimit = Number.isFinite(options.candidateLimit) ? Number(options.candidateLimit) : 80

  const shiftResult = await pool.query(
    `
      select id, location_id, required_skill_id
      from shifts
      where id = $1
      limit 1
    `,
    [shiftId],
  )
  const shift = shiftResult.rows[0]
  if (!shift) return []

  const sql = shift.required_skill_id
    ? `
        select u.id, u.email, u.name
        from users u
        join staff_locations sl on sl.staff_id = u.id
        join staff_skills ss on ss.staff_id = u.id and ss.skill_id = $2
        where u.role = 'staff'::user_role
          and sl.location_id = $1
          and not exists (
            select 1
            from shift_assignments sa
            where sa.shift_id = $3
              and sa.staff_id = u.id
              and sa.status <> 'dropped'::shift_assignment_status
          )
        order by u.created_at desc
        limit $4
      `
    : `
        select u.id, u.email, u.name
        from users u
        join staff_locations sl on sl.staff_id = u.id
        where u.role = 'staff'::user_role
          and sl.location_id = $1
          and not exists (
            select 1
            from shift_assignments sa
            where sa.shift_id = $2
              and sa.staff_id = u.id
              and sa.status <> 'dropped'::shift_assignment_status
          )
        order by u.created_at desc
        limit $3
      `

  const params = shift.required_skill_id
    ? [shift.location_id, shift.required_skill_id, shiftId, candidateLimit]
    : [shift.location_id, shiftId, candidateLimit]

  const candidates = await pool.query(sql, params)

  const alternatives = []
  for (const c of candidates.rows) {
    const result = await validateAssignment(c.id, shiftId, { pool })
    if (result.valid) {
      alternatives.push({ id: c.id, email: c.email, name: c.name })
      if (alternatives.length >= limit) break
    }
  }

  return alternatives
}

module.exports = { findValidAlternatives }
