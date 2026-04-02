const dotenv = require('dotenv')

dotenv.config()

const http = require('http')
const cookieParser = require('cookie-parser')
const cors = require('cors')
const express = require('express')
const { Server } = require('socket.io')
const { createPool } = require('./db')
const { authRouter } = require('./routes/auth')
const { adminRouter } = require('./routes/admin')
const { locationsRouter } = require('./routes/locations')
const { availabilityRouter } = require('./routes/availability')
const { shiftsRouter } = require('./routes/shifts')
const { scheduleRouter } = require('./routes/schedule')
const { swapsRouter } = require('./routes/swaps')
const { myShiftsRouter } = require('./routes/myShifts')
const { analyticsRouter } = require('./routes/analytics')
const { notificationsRouter } = require('./routes/notifications')
const { notificationPreferencesRouter } = require('./routes/notificationPreferences')
const { profileRouter } = require('./routes/profile')
const { setupRealtime } = require('./realtime/setup')
const { createEmitter } = require('./realtime/emit')

const app = express()

app.use(cors({ origin: process.env.CORS_ORIGIN || true, credentials: true }))
app.use(cookieParser())
app.use(express.json())

const pool = createPool()

app.get('/health', async (_req, res) => {
  try {
    if (!pool) {
      res.status(503).json({ ok: false, db: { ok: false, reason: 'DATABASE_URL is not set' } })
      return
    }

    await pool.query('select 1')
    res.json({ ok: true, db: { ok: true } })
  } catch (e) {
    res.status(503).json({ ok: false, db: { ok: false, reason: e instanceof Error ? e.message : 'db_error' } })
  }
})

app.use('/auth', authRouter)
app.use('/admin', adminRouter)
app.use('/locations', locationsRouter)
app.use('/me/availability', availabilityRouter)
app.use('/shifts', shiftsRouter)
app.use('/schedule', scheduleRouter)
app.use('/swaps', swapsRouter)
app.use('/me/shifts', myShiftsRouter)
app.use('/analytics', analyticsRouter)
app.use('/me/notifications', notificationsRouter)
app.use('/me/notification-preferences', notificationPreferencesRouter)
app.use('/me/profile', profileRouter)

const server = http.createServer(app)

const io = new Server(server, {
  cors: {
    origin: process.env.CORS_ORIGIN || true,
    credentials: true,
  },
})

io.on('connection', (socket) => {
  socket.on('ping', () => {
    socket.emit('pong')
  })
})

setupRealtime(io, { pool })
app.locals.io = io
app.locals.realtime = createEmitter(io)

const port = process.env.PORT ? Number(process.env.PORT) : 3001

server.listen(port, () => {
  console.log(`ShiftSync backend listening on http://localhost:${port}`)
})
