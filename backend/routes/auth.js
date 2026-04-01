const bcrypt = require('bcryptjs')
const express = require('express')
const jwt = require('jsonwebtoken')

const { getPool } = require('../db')
const { TOKEN_COOKIE_NAME, getJwtSecret, requireAuth } = require('../middleware/auth')

const router = express.Router()

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase()
}

function getCookieOptions() {
  const isProd = process.env.NODE_ENV === 'production'
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: isProd,
    path: '/',
  }
}

router.post('/register', async (req, res) => {
  const email = normalizeEmail(req.body?.email)
  const password = String(req.body?.password || '')

  if (!email || !password) {
    res.status(400).json({ error: 'email_and_password_required' })
    return
  }

  if (password.length < 8) {
    res.status(400).json({ error: 'password_too_short' })
    return
  }

  const pool = getPool()

  const existing = await pool.query('select id from users where email = $1 limit 1', [email])
  if (existing.rows.length > 0) {
    res.status(409).json({ error: 'email_already_in_use' })
    return
  }

  const passwordHash = await bcrypt.hash(password, 12)

  const created = await pool.query(
    'insert into users (email, password_hash) values ($1, $2) returning id, email, role, created_at',
    [email, passwordHash],
  )

  res.status(201).json({ user: created.rows[0] })
})

router.post('/login', async (req, res) => {
  const email = normalizeEmail(req.body?.email)
  const password = String(req.body?.password || '')

  if (!email || !password) {
    res.status(400).json({ error: 'email_and_password_required' })
    return
  }

  const pool = getPool()
  const result = await pool.query('select id, email, role, password_hash from users where email = $1 limit 1', [email])
  const user = result.rows[0]

  if (!user) {
    res.status(401).json({ error: 'invalid_credentials' })
    return
  }

  const ok = await bcrypt.compare(password, user.password_hash)
  if (!ok) {
    res.status(401).json({ error: 'invalid_credentials' })
    return
  }

  const secret = getJwtSecret()
  const token = jwt.sign({ sub: user.id, email: user.email }, secret, { expiresIn: '7d' })

  res.cookie(TOKEN_COOKIE_NAME, token, getCookieOptions())
  res.json({ user: { id: user.id, email: user.email, role: user.role } })
})

router.post('/logout', (req, res) => {
  res.clearCookie(TOKEN_COOKIE_NAME, { path: '/' })
  res.json({ ok: true })
})

router.get('/me', requireAuth, async (req, res) => {
  const userId = req.auth?.sub
  if (!userId) {
    res.status(401).json({ error: 'unauthorized' })
    return
  }

  const pool = getPool()
  const result = await pool.query('select id, email, name, role, created_at from users where id = $1 limit 1', [userId])
  const user = result.rows[0]
  if (!user) {
    res.status(401).json({ error: 'unauthorized' })
    return
  }

  res.json({ user })
})

module.exports = { authRouter: router }
