import bcrypt from 'bcryptjs'
import dotenv from 'dotenv'
import pg from 'pg'

dotenv.config()

const { Pool } = pg

type LocationSeed = { name: string; address: string; timezone: string }
type SkillSeed = { name: string }

function requireEnv(name: string) {
  const v = process.env[name]
  if (!v) throw new Error(`${name} is required`)
  return v
}

function randomItem<T>(items: T[]) {
  return items[Math.floor(Math.random() * items.length)]
}

function addDays(date: Date, days: number) {
  const d = new Date(date)
  d.setUTCDate(d.getUTCDate() + days)
  return d
}

function toDateOnly(date: Date) {
  return date.toISOString().slice(0, 10)
}

async function main() {
  const pool = new Pool({ connectionString: requireEnv('DATABASE_URL') })

  const locations: LocationSeed[] = [
    { name: 'LA Downtown', address: '101 Main St, Los Angeles, CA', timezone: 'America/Los_Angeles' },
    { name: 'Seattle Center', address: '500 Center Ave, Seattle, WA', timezone: 'America/Los_Angeles' },
    { name: 'NYC Midtown', address: '200 5th Ave, New York, NY', timezone: 'America/New_York' },
    { name: 'Boston Harbor', address: '1 Harbor Way, Boston, MA', timezone: 'America/New_York' },
  ]

  const skills: SkillSeed[] = [{ name: 'bartender' }, { name: 'line cook' }, { name: 'server' }, { name: 'host' }]

  const adminEmail = 'admin@shiftsync.com'
  const adminPassword = 'password123'

  await pool.query('begin')
  try {
    await pool.query(`
      truncate table
        swap_requests,
        shift_assignments,
        shifts,
        availability_exceptions,
        availability_windows,
        staff_skills,
        skills,
        staff_locations,
        locations,
        notifications,
        audit_logs,
        users
      cascade
    `)

    const insertedLocations = []
    for (const loc of locations) {
      const r = await pool.query(
        'insert into locations (name, address, timezone) values ($1, $2, $3) returning id',
        [loc.name, loc.address, loc.timezone],
      )
      insertedLocations.push({ id: r.rows[0].id as string, ...loc })
    }

    const insertedSkills = []
    for (const s of skills) {
      const r = await pool.query('insert into skills (name) values ($1) returning id', [s.name])
      insertedSkills.push({ id: r.rows[0].id as string, ...s })
    }

    const passwordHash = await bcrypt.hash(adminPassword, 12)
    const admin = await pool.query(
      'insert into users (name, email, password_hash, role) values ($1, $2, $3, $4) returning id, email',
      ['Admin', adminEmail, passwordHash, 'admin'],
    )
    const adminId = admin.rows[0].id as string

    const managers = []
    for (let i = 1; i <= 4; i++) {
      const email = `manager${i}@shiftsync.com`
      const ph = await bcrypt.hash('password123', 12)
      const r = await pool.query(
        'insert into users (name, email, password_hash, role) values ($1, $2, $3, $4) returning id, email',
        [`Manager ${i}`, email, ph, 'manager'],
      )
      managers.push({ id: r.rows[0].id as string, email })
    }

    const staff = []
    for (let i = 1; i <= 12; i++) {
      const email = `staff${i}@shiftsync.com`
      const ph = await bcrypt.hash('password123', 12)
      const r = await pool.query(
        'insert into users (name, email, password_hash, role) values ($1, $2, $3, $4) returning id, email',
        [`Staff ${i}`, email, ph, 'staff'],
      )
      staff.push({ id: r.rows[0].id as string, email })
    }

    for (const s of staff) {
      const assigned = new Set<string>()
      const primary = randomItem(insertedLocations).id
      assigned.add(primary)
      if (Math.random() < 0.35) assigned.add(randomItem(insertedLocations).id)

      for (const locId of assigned) {
        await pool.query('insert into staff_locations (staff_id, location_id) values ($1, $2)', [s.id, locId])
      }

      const skillCount = 1 + Math.floor(Math.random() * 3)
      const chosen = new Set<string>()
      while (chosen.size < skillCount) chosen.add(randomItem(insertedSkills).id)
      for (const skillId of chosen) {
        await pool.query('insert into staff_skills (staff_id, skill_id) values ($1, $2)', [s.id, skillId])
      }
    }

    for (const s of staff) {
      const dayTemplate = [
        { dow: 1, start: '08:00', end: '16:00' },
        { dow: 2, start: '08:00', end: '16:00' },
        { dow: 3, start: '12:00', end: '20:00' },
        { dow: 4, start: '12:00', end: '20:00' },
        { dow: 5, start: '08:00', end: '16:00' },
      ]

      for (const w of dayTemplate) {
        if (Math.random() < 0.2) continue
        await pool.query(
          'insert into availability_windows (staff_id, day_of_week, start_time, end_time, is_recurring) values ($1, $2, $3, $4, $5)',
          [s.id, w.dow, w.start, w.end, true],
        )
      }

      const exceptionDate = toDateOnly(addDays(new Date(), 6 + Math.floor(Math.random() * 6)))
      await pool.query('insert into availability_exceptions (staff_id, date, type) values ($1, $2, $3)', [
        s.id,
        exceptionDate,
        'unavailable',
      ])

      const customDate = toDateOnly(addDays(new Date(), 2 + Math.floor(Math.random() * 5)))
      await pool.query(
        'insert into availability_exceptions (staff_id, date, type, start_time, end_time) values ($1, $2, $3, $4, $5)',
        [s.id, customDate, 'custom', '10:00', '14:00'],
      )
    }

    const shiftIds: string[] = []
    const today = new Date()
    for (let d = 0; d < 14; d++) {
      const date = toDateOnly(addDays(today, d))
      for (const loc of insertedLocations) {
        const reqSkill = randomItem(insertedSkills).id
        const headcount = 1 + Math.floor(Math.random() * 3)
        const morning = await pool.query(
          'insert into shifts (location_id, required_skill_id, date, start_time, end_time, headcount_needed, status) values ($1,$2,$3,$4,$5,$6,$7) returning id',
          [loc.id, reqSkill, date, '08:00', '16:00', headcount, 'published'],
        )
        shiftIds.push(morning.rows[0].id as string)

        const evening = await pool.query(
          'insert into shifts (location_id, required_skill_id, date, start_time, end_time, headcount_needed, status) values ($1,$2,$3,$4,$5,$6,$7) returning id',
          [loc.id, reqSkill, date, '16:00', '23:00', 1, 'published'],
        )
        shiftIds.push(evening.rows[0].id as string)
      }
    }

    const assignmentIds: string[] = []
    for (let i = 0; i < Math.min(40, shiftIds.length); i++) {
      const shiftId = shiftIds[i]
      const staffMember = randomItem(staff)
      const created = await pool.query(
        'insert into shift_assignments (shift_id, staff_id, assigned_by, status) values ($1, $2, $3, $4) returning id',
        [shiftId, staffMember.id, adminId, 'active'],
      )
      assignmentIds.push(created.rows[0].id as string)
    }

    if (assignmentIds.length > 0) {
      const pendingAssignmentId = assignmentIds[0]
      await pool.query('update shift_assignments set status = $1 where id = $2', ['pending_swap', pendingAssignmentId])
      await pool.query(
        'insert into swap_requests (assignment_id, requested_by, target_staff_id, type, status, expires_at) values ($1,$2,$3,$4,$5, now() + interval \'2 days\')',
        [pendingAssignmentId, staff[0].id, staff[1].id, 'swap', 'pending'],
      )
      await pool.query(
        'insert into swap_requests (assignment_id, requested_by, type, status, expires_at) values ($1,$2,$3,$4, now() + interval \'1 day\')',
        [pendingAssignmentId, staff[0].id, 'drop', 'pending'],
      )
    }

    await pool.query(
      'insert into notifications (user_id, type, message, metadata) values ($1, $2, $3, $4), ($5, $6, $7, $8)',
      [
        adminId,
        'system',
        'Seed data created',
        JSON.stringify({ source: 'seed.ts' }),
        staff[0].id,
        'schedule',
        'You have a new assignment',
        JSON.stringify({}),
      ],
    )

    await pool.query(
      'insert into audit_logs (user_id, action, entity_type, entity_id, before, after) values ($1,$2,$3,$4,$5,$6)',
      [adminId, 'seed', 'system', null, null, JSON.stringify({ ok: true })],
    )

    await pool.query('commit')
  } catch (e) {
    await pool.query('rollback')
    throw e
  } finally {
    await pool.end()
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})

