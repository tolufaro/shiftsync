const { getPool } = require('../db')

async function logAudit(userId, action, entityType, entityId, before, after, options = {}) {
  const pool = options.pool || getPool()
  const actorUserId = userId || null
  const beforeJson = before === undefined ? null : JSON.stringify(before)
  const afterJson = after === undefined ? null : JSON.stringify(after)

  await pool.query(
    `
      insert into audit_logs (user_id, action, entity_type, entity_id, before, after)
      values ($1, $2, $3, $4::uuid, $5::jsonb, $6::jsonb)
    `,
    [actorUserId, action, entityType, entityId || null, beforeJson, afterJson],
  )
}

module.exports = { logAudit }

