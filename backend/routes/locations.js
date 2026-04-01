const express = require('express')

const { getPool } = require('../db')
const { requireRole, requireLocationAccess } = require('../middleware/rbac')

const router = express.Router()

router.get('/', requireRole(['admin', 'manager']), async (req, res) => {
  const pool = getPool()
  if (req.user.role === 'admin') {
    const result = await pool.query('select id, name, address, timezone from locations order by name')
    res.json({ locations: result.rows })
    return
  }

  const result = await pool.query(
    `
      select l.id, l.name, l.address, l.timezone
      from locations l
      join staff_locations sl on sl.location_id = l.id
      where sl.staff_id = $1
      order by l.name
    `,
    [req.user.id],
  )
  res.json({ locations: result.rows })
})

router.get('/:locationId', requireRole(['admin', 'manager']), requireLocationAccess(), async (req, res) => {
  const pool = getPool()
  const result = await pool.query('select id, name, address, timezone from locations where id = $1 limit 1', [
    req.params.locationId,
  ])
  const location = result.rows[0]
  if (!location) {
    res.status(404).json({ error: 'not_found' })
    return
  }
  res.json({ location })
})

router.get('/:locationId/staff', requireRole(['admin', 'manager']), requireLocationAccess(), async (req, res) => {
  const pool = getPool()
  const locationId = req.params.locationId

  const result = await pool.query(
    `
      select u.id, u.email, u.name, u.role
      from users u
      join staff_locations sl on sl.staff_id = u.id
      where sl.location_id = $1
        and u.role = 'staff'::user_role
      order by u.name nulls last, u.email
    `,
    [locationId],
  )

  res.json({ staff: result.rows })
})

module.exports = { locationsRouter: router }
