const dotenv = require('dotenv')

dotenv.config()

const http = require('http')
const cors = require('cors')
const express = require('express')
const { Server } = require('socket.io')
const { createPool } = require('./db')

const app = express()

app.use(cors({ origin: process.env.CORS_ORIGIN || true }))
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

const server = http.createServer(app)

const io = new Server(server, {
  cors: {
    origin: process.env.CORS_ORIGIN || true,
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
