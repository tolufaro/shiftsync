const express = require('express')

const { getPool } = require('../db')
const { requireUser } = require('../middleware/rbac')
const { listNotificationPreferences, upsertNotificationPreferences } = require('../services/notifications')
const { logAudit } = require('../services/audit')

const router = express.Router()

router.use(...requireUser())

router.get('/', async (req, res) => {
  const pool = getPool()
  const preferences = await listNotificationPreferences(req.user.id, { pool })
  res.json({ preferences })
})

router.put('/', async (req, res) => {
  const prefs = Array.isArray(req.body?.preferences) ? req.body.preferences : null
  if (!prefs) {
    res.status(400).json({ error: 'preferences_required' })
    return
  }
  const pool = getPool()
  const before = await listNotificationPreferences(req.user.id, { pool })
  const preferences = await upsertNotificationPreferences(req.user.id, prefs, { pool })
  await logAudit(req.user.id, 'notification_prefs.update', 'user', req.user.id, { preferences: before }, { preferences }, { pool })
  res.json({ preferences })
})

module.exports = { notificationPreferencesRouter: router }
