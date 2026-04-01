const express = require('express')

const { getPool } = require('../db')
const { requireUser } = require('../middleware/rbac')

const router = express.Router()

router.use(...requireUser())

function asInt(v, fallback) {
  const n = Number(v)
  if (!Number.isFinite(n)) return fallback
  return Math.floor(n)
}

router.get('/', async (req, res) => {
  const pool = getPool()
  const userId = req.user.id
  const limit = Math.max(1, Math.min(asInt(req.query?.limit, 50), 200))
  const offset = Math.max(0, asInt(req.query?.offset, 0))
  const unreadOnly = String(req.query?.unreadOnly || '').trim() === 'true'

  const params = [userId, limit, offset]
  const where = ['user_id = $1']
  if (unreadOnly) where.push('read = false')

  const result = await pool.query(
    `
      select id, type, message, read, metadata, created_at
      from notifications
      where ${where.join(' and ')}
      order by created_at desc
      limit $2 offset $3
    `,
    params,
  )

  res.json({
    notifications: result.rows.map((n) => ({
      id: n.id,
      type: n.type,
      message: n.message,
      read: Boolean(n.read),
      metadata: n.metadata,
      createdAt: n.created_at,
    })),
  })
})

router.get('/unread-count', async (req, res) => {
  const pool = getPool()
  const userId = req.user.id
  const r = await pool.query('select count(*)::int as c from notifications where user_id = $1 and read = false', [userId])
  res.json({ count: r.rows[0].c })
})

router.patch('/:notificationId/read', async (req, res) => {
  const pool = getPool()
  const userId = req.user.id
  const id = req.params.notificationId

  const updated = await pool.query('update notifications set read = true where id = $1 and user_id = $2 returning id', [id, userId])
  if (!updated.rows.length) {
    res.status(404).json({ error: 'not_found' })
    return
  }
  res.json({ ok: true })
})

router.post('/read-all', async (req, res) => {
  const pool = getPool()
  const userId = req.user.id
  await pool.query('update notifications set read = true where user_id = $1 and read = false', [userId])
  res.json({ ok: true })
})

module.exports = { notificationsRouter: router }

