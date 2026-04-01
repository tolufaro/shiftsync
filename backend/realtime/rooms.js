function userRoom(userId) {
  return `user:${userId}`
}

function locationRoom(locationId) {
  return `location:${locationId}`
}

module.exports = { userRoom, locationRoom }

