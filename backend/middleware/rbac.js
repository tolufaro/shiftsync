const { getPool } = require('../db')
const { requireAuth } = require('./auth')

async function attachUser(req, res, next) {
  try {
    const userId = req.auth?.sub
    if (!userId) {
      res.status(401).json({ error: 'unauthorized' })
      return
    }

    const pool = getPool()
    const result = await pool.query('select id, email, name, role from users where id = $1 limit 1', [userId])
    const user = result.rows[0]

    if (!user) {
      res.status(401).json({ error: 'unauthorized' })
      return
    }

    req.user = user
    next()
  } catch (_e) {
    res.status(500).json({ error: 'server_error' })
  }
}

function requireUser() {
  return [requireAuth, attachUser]
}

function requireRole(allowedRoles) {
  const roles = Array.isArray(allowedRoles) ? allowedRoles : [allowedRoles]
  return [
    ...requireUser(),
    (req, res, next) => {
      const role = req.user?.role
      if (!role || !roles.includes(role)) {
        res.status(403).json({ error: 'forbidden' })
        return
      }
      next()
    },
  ]
}

function requireLocationAccess(options = {}) {
  const getLocationId =
    options.getLocationId ||
    ((req) => {
      return req.params.locationId || req.params.location_id || req.body?.location_id || req.query?.location_id
    })

  return async (req, res, next) => {
    try {
      if (!req.auth) {
        res.status(401).json({ error: 'unauthorized' })
        return
      }

      if (!req.user) {
        await new Promise((resolve) => attachUser(req, res, resolve))
        if (!req.user) return
      }

      const userRole = req.user.role
      if (userRole === 'admin') {
        next()
        return
      }

      const locationId = getLocationId(req)
      if (!locationId) {
        res.status(400).json({ error: 'location_id_required' })
        return
      }

      if (userRole !== 'manager' && userRole !== 'staff') {
        res.status(403).json({ error: 'forbidden' })
        return
      }

      const pool = getPool()
      const exists = await pool.query(
        'select 1 from staff_locations where staff_id = $1 and location_id = $2 limit 1',
        [req.user.id, locationId],
      )

      if (exists.rows.length === 0) {
        res.status(403).json({ error: 'forbidden' })
        return
      }

      next()
    } catch (_e) {
      res.status(500).json({ error: 'server_error' })
    }
  }
}

module.exports = { requireUser, requireRole, requireLocationAccess }

