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

module.exports = { locationsRouter: router }

