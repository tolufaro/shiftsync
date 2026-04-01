const { getPool } = require('../db')

async function getPreference(pool, userId, type) {
  const r = await pool.query(
    `
      select email_enabled
      from notification_preferences
      where user_id = $1 and type = $2
      limit 1
    `,
    [userId, type],
  )
  if (!r.rows.length) return { emailEnabled: false }
  return { emailEnabled: Boolean(r.rows[0].email_enabled) }
}

async function simulateEmail(pool, userId, type, message, metadata) {
  const u = await pool.query('select email from users where id = $1 limit 1', [userId])
  const email = u.rows[0]?.email || userId
  console.log(`[email:sim] to=${email} type=${type} message=${message} metadata=${JSON.stringify(metadata || {})}`)
}

async function createNotification(userId, type, message, metadata, options = {}) {
  const pool = options.pool || getPool()
  const realtime = options.realtime || null
  const emailSimulation = options.emailSimulation === undefined ? true : Boolean(options.emailSimulation)

  const inserted = await pool.query(
    `
      insert into notifications (user_id, type, message, metadata)
      values ($1, $2, $3, $4::jsonb)
      returning id, user_id, type, message, read, metadata, created_at
    `,
    [userId, type, message, JSON.stringify(metadata || {})],
  )
  const n = inserted.rows[0]

  if (realtime) {
    realtime.emitToUser(userId, 'notification:new', {
      id: n.id,
      type: n.type,
      message: n.message,
      read: n.read,
      metadata: n.metadata,
      createdAt: n.created_at,
    })
  }

  const pref = await getPreference(pool, userId, type)
  if (emailSimulation && pref.emailEnabled) {
    await simulateEmail(pool, userId, type, message, metadata)
  }

  return {
    id: n.id,
    userId: n.user_id,
    type: n.type,
    message: n.message,
    read: n.read,
    metadata: n.metadata,
    createdAt: n.created_at,
  }
}

async function upsertNotificationPreferences(userId, preferences, options = {}) {
  const pool = options.pool || getPool()
  if (!Array.isArray(preferences)) return []

  await pool.query('begin')
  try {
    for (const p of preferences) {
      const type = String(p?.type || '').trim()
      if (!type) continue
      const emailEnabled = Boolean(p?.emailEnabled)
      await pool.query(
        `
          insert into notification_preferences (user_id, type, email_enabled, updated_at)
          values ($1, $2, $3, now())
          on conflict (user_id, type)
          do update set email_enabled = excluded.email_enabled, updated_at = now()
        `,
        [userId, type, emailEnabled],
      )
    }
    await pool.query('commit')
  } catch (e) {
    await pool.query('rollback')
    throw e
  }

  const result = await pool.query(
    `
      select type, email_enabled
      from notification_preferences
      where user_id = $1
      order by type asc
    `,
    [userId],
  )
  return result.rows.map((r) => ({ type: r.type, emailEnabled: Boolean(r.email_enabled) }))
}

async function listNotificationPreferences(userId, options = {}) {
  const pool = options.pool || getPool()
  const result = await pool.query(
    `
      select type, email_enabled
      from notification_preferences
      where user_id = $1
      order by type asc
    `,
    [userId],
  )
  return result.rows.map((r) => ({ type: r.type, emailEnabled: Boolean(r.email_enabled) }))
}

module.exports = { createNotification, upsertNotificationPreferences, listNotificationPreferences }
