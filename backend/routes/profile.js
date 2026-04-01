const express = require('express')

const { getPool } = require('../db')
const { requireUser } = require('../middleware/rbac')

const router = express.Router()

router.use(...requireUser())

function cleanString(v) {
  const s = String(v || '').trim()
  return s.length ? s : null
}

router.get('/', async (req, res) => {
  const pool = getPool()
  const userId = req.user.id
  const r = await pool.query('select id, email, name, role, home_timezone from users where id = $1 limit 1', [userId])
  if (!r.rows.length) {
    res.status(404).json({ error: 'not_found' })
    return
  }
  const u = r.rows[0]
  res.json({ user: { id: u.id, email: u.email, name: u.name, role: u.role, homeTimeZone: u.home_timezone } })
})

router.put('/timezone', async (req, res) => {
  const tz = cleanString(req.body?.timeZone)
  if (!tz) {
    res.status(400).json({ error: 'timeZone_required' })
    return
  }

  const pool = getPool()
  const userId = req.user.id
  const updated = await pool.query('update users set home_timezone = $1 where id = $2 returning id, home_timezone', [tz, userId])
  if (!updated.rows.length) {
    res.status(404).json({ error: 'not_found' })
    return
  }
  res.json({ ok: true, homeTimeZone: updated.rows[0].home_timezone })
})

module.exports = { profileRouter: router }

