const test = require('node:test')
const assert = require('node:assert/strict')

require('dotenv').config()

const bcrypt = require('bcryptjs')

const { getPool } = require('../db')
const { assignStaffToShift } = require('./assignShift')

test('concurrent assignment locks enforce headcount and return one winner', { skip: !process.env.DATABASE_URL }, async () => {
  const pool = getPool()

  const locationResult = await pool.query(
    `
      select sl.location_id
      from staff_locations sl
      join users u on u.id = sl.staff_id
      where u.role = 'staff'::user_role
      group by sl.location_id
      having count(*) >= 2
      limit 1
    `,
  )
  assert.ok(locationResult.rows.length > 0, 'needs at least one location with 2+ staff')
  const locationId = locationResult.rows[0].location_id

  const actorResult = await pool.query("select id from users where email = 'admin@shiftsync.com' limit 1")
  assert.ok(actorResult.rows.length > 0)
  const actorUserId = actorResult.rows[0].id

  const locationTzResult = await pool.query('select timezone from locations where id = $1 limit 1', [locationId])
  const tz = locationTzResult.rows[0].timezone
  assert.ok(tz)

  const start = new Date(Date.now() + 5 * 86400000)
  const dateYmd = start.toISOString().slice(0, 10)

  const passwordHash = await bcrypt.hash('test-password', 10)
  const staffInsert = await pool.query(
    `
      insert into users (email, password_hash, role, name, home_timezone)
      values
        ($1, $2, 'staff'::user_role, 'Test Staff A', $4),
        ($3, $2, 'staff'::user_role, 'Test Staff B', $4)
      returning id, email
    `,
    [`test.staff.a.${Date.now()}@example.com`, passwordHash, `test.staff.b.${Date.now()}@example.com`, tz],
  )
  assert.equal(staffInsert.rows.length, 2)
  const staffA = staffInsert.rows[0].id
  const staffB = staffInsert.rows[1].id

  await pool.query('insert into staff_locations (staff_id, location_id) values ($1, $2), ($3, $2)', [staffA, locationId, staffB])

  for (const staffId of [staffA, staffB]) {
    for (let dow = 0; dow <= 6; dow++) {
      await pool.query(
        `
          insert into availability_windows (staff_id, day_of_week, start_time, end_time, is_recurring)
          values ($1, $2, $3::time, $4::time, true)
        `,
        [staffId, dow, '00:00', '23:59'],
      )
    }
  }

  const shiftInsert = await pool.query(
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
      values (
        $1,
        null,
        (($2::date + $3::time) at time zone $5),
        (($2::date + $4::time) at time zone $5),
        $2::date,
        $3::time,
        $4::time,
        false,
        1,
        'published'::shift_status
      )
      returning id
    `,
    [locationId, dateYmd, '10:00', '14:00', tz],
  )
  const shiftId = shiftInsert.rows[0].id

  try {
    const [r1, r2] = await Promise.all([
      assignStaffToShift({ shiftId, staffId: staffA, actorUserId }, { pool }),
      assignStaffToShift({ shiftId, staffId: staffB, actorUserId }, { pool }),
    ])

    const oks = [r1, r2].filter((r) => r.ok)
    const fails = [r1, r2].filter((r) => !r.ok)
    assert.equal(oks.length, 1)
    assert.equal(fails.length, 1)
    assert.equal(fails[0].error, 'headcount_full')

    const count = await pool.query(
      `
        select count(*)::int as c
        from shift_assignments
        where shift_id = $1 and status <> 'dropped'::shift_assignment_status
      `,
      [shiftId],
    )
    assert.equal(count.rows[0].c, 1)
  } finally {
    await pool.query('delete from shift_assignments where shift_id = $1', [shiftId])
    await pool.query('delete from shifts where id = $1', [shiftId])
    await pool.query('delete from availability_windows where staff_id = any($1::uuid[])', [[staffA, staffB]])
    await pool.query('delete from staff_locations where staff_id = any($1::uuid[])', [[staffA, staffB]])
    await pool.query('delete from users where id = any($1::uuid[])', [[staffA, staffB]])
  }
})
