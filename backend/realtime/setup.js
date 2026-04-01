const { getPool } = require('../db')
const { authenticateSocket } = require('./auth')
const { locationRoom, userRoom } = require('./rooms')

function setupRealtime(io, options = {}) {
  const pool = options.pool || getPool()

  io.use(authenticateSocket)

  io.on('connection', async (socket) => {
    const userId = socket.user?.id
    if (!userId) {
      socket.disconnect(true)
      return
    }

    socket.join(userRoom(userId))

    try {
      const locations = await pool.query('select location_id from staff_locations where staff_id = $1', [userId])
      for (const r of locations.rows) {
        socket.join(locationRoom(r.location_id))
      }
    } catch (_e) {}
  })
}

module.exports = { setupRealtime }

