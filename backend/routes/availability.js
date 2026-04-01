const express = require('express')

const { getPool } = require('../db')
const { requireUser } = require('../middleware/rbac')

const router = express.Router()

router.use(...requireUser())

function normalizeTime(value) {
  if (!value) return null
  const s = String(value)
  return s.length >= 5 ? s.slice(0, 5) : s
}

function isIsoDate(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
}

function isTime(value) {
  return typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d(\.\d{1,6})?)?$/.test(value)
}

function isDayOfWeek(value) {
  return Number.isInteger(value) && value >= 0 && value <= 6
}

router.get('/', async (req, res) => {
  const pool = getPool()
  const staffId = req.user.id

  const [windows, exceptions] = await Promise.all([
    pool.query(
      `
        select id, day_of_week, start_time, end_time, is_recurring, created_at
        from availability_windows
        where staff_id = $1
        order by day_of_week asc, start_time asc
      `,
      [staffId],
    ),
    pool.query(
      `
        select id, date::text as date, type, start_time, end_time, created_at
        from availability_exceptions
        where staff_id = $1
        order by date asc
      `,
      [staffId],
    ),
  ])

  res.json({
    windows: windows.rows.map((w) => ({
      id: w.id,
      dayOfWeek: Number(w.day_of_week),
      startTime: normalizeTime(w.start_time),
      endTime: normalizeTime(w.end_time),
      isRecurring: Boolean(w.is_recurring),
      createdAt: w.created_at,
    })),
    exceptions: exceptions.rows.map((e) => ({
      id: e.id,
      date: e.date,
      type: e.type,
      startTime: normalizeTime(e.start_time),
      endTime: normalizeTime(e.end_time),
      createdAt: e.created_at,
    })),
  })
})

router.put('/windows', async (req, res) => {
  const windows = Array.isArray(req.body?.windows) ? req.body.windows : null
  if (!windows) {
    res.status(400).json({ error: 'windows_required' })
    return
  }

  const normalized = []

  for (const w of windows) {
    const dayOfWeek = Number(w?.dayOfWeek)
    const startTime = w?.startTime
    const endTime = w?.endTime
    const isRecurring = w?.isRecurring === undefined ? true : Boolean(w.isRecurring)

    if (!isDayOfWeek(dayOfWeek)) {
      res.status(400).json({ error: 'invalid_day_of_week' })
      return
    }
    if (!isTime(startTime) || !isTime(endTime)) {
      res.status(400).json({ error: 'invalid_time' })
      return
    }

    normalized.push({ dayOfWeek, startTime, endTime, isRecurring })
  }

  const pool = getPool()
  const staffId = req.user.id

  await pool.query('begin')
  try {
    await pool.query('delete from availability_windows where staff_id = $1', [staffId])
    for (const w of normalized) {
      await pool.query(
        `
          insert into availability_windows (staff_id, day_of_week, start_time, end_time, is_recurring)
          values ($1, $2, $3, $4, $5)
        `,
        [staffId, w.dayOfWeek, w.startTime, w.endTime, w.isRecurring],
      )
    }
    await pool.query('commit')
  } catch (e) {
    await pool.query('rollback')
    throw e
  }

  res.json({ ok: true })
})

router.post('/exceptions', async (req, res) => {
  const date = req.body?.date
  const type = req.body?.type
  const startTime = req.body?.startTime
  const endTime = req.body?.endTime

  if (!isIsoDate(date)) {
    res.status(400).json({ error: 'invalid_date' })
    return
  }

  if (type !== 'unavailable' && type !== 'custom') {
    res.status(400).json({ error: 'invalid_type' })
    return
  }

  let st = null
  let et = null
  if (type === 'custom') {
    if (!isTime(startTime) || !isTime(endTime)) {
      res.status(400).json({ error: 'invalid_time' })
      return
    }
    st = startTime
    et = endTime
  }

  const pool = getPool()
  const staffId = req.user.id

  const inserted = await pool.query(
    `
      insert into availability_exceptions (staff_id, date, type, start_time, end_time)
      values ($1, $2, $3, $4, $5)
      returning id, date::text as date, type, start_time, end_time, created_at
    `,
    [staffId, date, type, st, et],
  )

  const e = inserted.rows[0]
  res.status(201).json({
    exception: {
      id: e.id,
      date: e.date,
      type: e.type,
      startTime: normalizeTime(e.start_time),
      endTime: normalizeTime(e.end_time),
      createdAt: e.created_at,
    },
  })
})

router.delete('/exceptions/:exceptionId', async (req, res) => {
  const pool = getPool()
  const staffId = req.user.id
  const exceptionId = req.params.exceptionId

  const deleted = await pool.query(
    'delete from availability_exceptions where id = $1 and staff_id = $2 returning id',
    [exceptionId, staffId],
  )

  if (deleted.rows.length === 0) {
    res.status(404).json({ error: 'not_found' })
    return
  }

  res.json({ ok: true })
})

module.exports = { availabilityRouter: router }
