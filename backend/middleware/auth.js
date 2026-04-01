const jwt = require('jsonwebtoken')

const TOKEN_COOKIE_NAME = 'ss_token'

function getJwtSecret() {
  const secret = process.env.JWT_SECRET
  if (!secret) {
    throw new Error('JWT_SECRET is required')
  }
  return secret
}

function getTokenFromRequest(req) {
  const authHeader = req.headers.authorization
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.slice('Bearer '.length).trim()
  }
  if (req.cookies && req.cookies[TOKEN_COOKIE_NAME]) {
    return req.cookies[TOKEN_COOKIE_NAME]
  }
  return null
}

function requireAuth(req, res, next) {
  try {
    const token = getTokenFromRequest(req)
    if (!token) {
      res.status(401).json({ error: 'unauthorized' })
      return
    }

    const secret = getJwtSecret()
    const payload = jwt.verify(token, secret)
    req.auth = payload
    next()
  } catch (_e) {
    res.status(401).json({ error: 'unauthorized' })
  }
}

module.exports = { TOKEN_COOKIE_NAME, getJwtSecret, getTokenFromRequest, requireAuth }

