const { locationRoom, userRoom } = require('./rooms')

function createEmitter(io) {
  function emitToUser(userId, event, payload) {
    if (!io) return
    io.to(userRoom(userId)).emit(event, payload)
  }

  function emitToLocation(locationId, event, payload) {
    if (!io) return
    io.to(locationRoom(locationId)).emit(event, payload)
  }

  return { emitToUser, emitToLocation }
}

module.exports = { createEmitter }

