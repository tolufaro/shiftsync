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
  } catch (_e) {
    res.status(503).json({ ok: false, db: { ok: false } })
  }
})

app.use('/auth', authRouter)
app.use('/admin', adminRouter)
app.use('/locations', locationsRouter)
app.use('/me/availability', availabilityRouter)
app.use('/shifts', shiftsRouter)
app.use('/schedule', scheduleRouter)

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

const port = process.env.PORT ? Number(process.env.PORT) : 3001

server.listen(port, () => {
  console.log(`ShiftSync backend listening on http://localhost:${port}`)
})
