const jwt = require('jsonwebtoken')

const { TOKEN_COOKIE_NAME, getJwtSecret } = require('../middleware/auth')

function parseCookies(headerValue) {
  const out = {}
  if (!headerValue) return out
  const parts = String(headerValue).split(';')
  for (const p of parts) {
    const idx = p.indexOf('=')
    if (idx === -1) continue
    const k = p.slice(0, idx).trim()
    const v = p.slice(idx + 1).trim()
    if (!k) continue
    out[k] = decodeURIComponent(v)
  }
  return out
}

function authenticateSocket(socket, next) {
  try {
    const cookieHeader = socket.handshake.headers?.cookie
    const cookies = parseCookies(cookieHeader)
    const token = cookies[TOKEN_COOKIE_NAME]
    if (!token) {
      next(new Error('unauthorized'))
      return
    }
    const payload = jwt.verify(token, getJwtSecret())
    socket.user = { id: payload.sub, email: payload.email }
    next()
  } catch (_e) {
    next(new Error('unauthorized'))
  }
}

module.exports = { authenticateSocket }

