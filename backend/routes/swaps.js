const express = require('express')

const { getPool } = require('../db')
const { requireRole, requireUser } = require('../middleware/rbac')
const { validateAssignment } = require('../services/validateAssignment')
const { findValidAlternatives } = require('../services/findValidAlternatives')

const router = express.Router()

function cleanString(v) {
  const s = String(v || '').trim()
  return s.length ? s : null
}

function isIsoDate(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
}

function isShiftEditable(shiftStartAt) {
  const start = shiftStartAt instanceof Date ? shiftStartAt : new Date(shiftStartAt)
  if (Number.isNaN(start.getTime())) return false
  const cutoff = Date.now() + 48 * 60 * 60 * 1000
  return start.getTime() > cutoff
}

async function ensureManagerLocationAccess(pool, userId, locationId) {
  const exists = await pool.query(
    'select 1 from staff_locations where staff_id = $1 and location_id = $2 limit 1',
    [userId, locationId],
  )
  return exists.rows.length > 0
}

async function countPendingRequests(pool, staffId) {
  const r = await pool.query(
    `
      select count(*)::int as c
      from swap_requests
      where requested_by = $1
        and status in ('pending'::swap_request_status, 'pending_manager_approval'::swap_request_status)
    `,
    [staffId],
  )
  return r.rows[0].c
}

async function getExpiresAt(pool, shiftId) {
  const r = await pool.query('select start_at from shifts where id = $1 limit 1', [shiftId])
  const shift = r.rows[0]
  if (!shift) return null
  const start = new Date(shift.start_at)
  const expires = new Date(start.getTime() - 24 * 60 * 60 * 1000)
  return expires.toISOString()
}

router.post('/drop', ...requireRole(['staff']), async (req, res) => {
  const assignmentId = cleanString(req.body?.assignmentId)
  if (!assignmentId) {
    res.status(400).json({ error: 'assignmentId_required' })
    return
  }

  const pool = getPool()
  const staffId = req.user.id

  const pendingCount = await countPendingRequests(pool, staffId)
  if (pendingCount >= 3) {
    res.status(409).json({ error: 'too_many_pending_requests' })
    return
  }

  const assignmentResult = await pool.query(
    `
      select sa.id, sa.shift_id, sa.staff_id, sa.status, s.start_at, s.location_id
      from shift_assignments sa
      join shifts s on s.id = sa.shift_id
      where sa.id = $1
      limit 1
    `,
    [assignmentId],
  )
  const assignment = assignmentResult.rows[0]
  if (!assignment) {
    res.status(404).json({ error: 'assignment_not_found' })
    return
  }

  if (assignment.staff_id !== staffId) {
    res.status(403).json({ error: 'forbidden' })
    return
  }

  if (assignment.status !== 'active') {
    res.status(409).json({ error: 'assignment_not_active' })
    return
  }

  if (!isShiftEditable(assignment.start_at)) {
    res.status(409).json({ error: 'cutoff_reached' })
    return
  }

  const expiresAt = new Date(new Date(assignment.start_at).getTime() - 24 * 60 * 60 * 1000).toISOString()
  if (new Date(expiresAt).getTime() <= Date.now()) {
    res.status(409).json({ error: 'expired' })
    return
  }

  await pool.query('begin')
  try {
    const created = await pool.query(
      `
        insert into swap_requests (assignment_id, requested_by, type, status, expires_at)
        values ($1, $2, $3::swap_request_type, $4::swap_request_status, $5::timestamptz)
        returning id, assignment_id, requested_by, target_staff_id, type, status, expires_at, created_at
      `,
      [assignmentId, staffId, 'drop', 'pending_manager_approval', expiresAt],
    )

    await pool.query(
      'insert into audit_logs (user_id, action, entity_type, entity_id, before, after) values ($1,$2,$3,$4,$5,$6)',
      [staffId, 'swap.drop.request', 'swap_request', created.rows[0].id, JSON.stringify({}), JSON.stringify({ assignmentId })],
    )

    await pool.query('commit')
    const swap = created.rows[0]
    req.app.locals.realtime?.emitToLocation(assignment.location_id, 'swap:new', { swapId: swap.id, type: swap.type, shiftId: assignment.shift_id })
    req.app.locals.realtime?.emitToUser(staffId, 'swap:submitted', { swapId: swap.id, type: swap.type })
    res.status(201).json({ swap })
  } catch (e) {
    await pool.query('rollback')
    throw e
  }
})

router.post('/request', ...requireRole(['staff']), async (req, res) => {
  const assignmentId = cleanString(req.body?.assignmentId)
  const targetStaffId = cleanString(req.body?.targetStaffId)
  const targetAssignmentId = cleanString(req.body?.targetAssignmentId)

  if (!assignmentId || !targetStaffId) {
    res.status(400).json({ error: 'assignmentId_and_targetStaffId_required' })
    return
  }

  const pool = getPool()
  const staffA = req.user.id

  const pendingCount = await countPendingRequests(pool, staffA)
  if (pendingCount >= 3) {
    res.status(409).json({ error: 'too_many_pending_requests' })
    return
  }

  const assignmentAResult = await pool.query(
    `
      select sa.id, sa.shift_id, sa.staff_id, sa.status, s.location_id, s.start_at
      from shift_assignments sa
      join shifts s on s.id = sa.shift_id
      where sa.id = $1
      limit 1
    `,
    [assignmentId],
  )
  const assignmentA = assignmentAResult.rows[0]
  if (!assignmentA) {
    res.status(404).json({ error: 'assignment_not_found' })
    return
  }

  if (assignmentA.staff_id !== staffA) {
    res.status(403).json({ error: 'forbidden' })
    return
  }

  if (assignmentA.status !== 'active') {
    res.status(409).json({ error: 'assignment_not_active' })
    return
  }

  if (!isShiftEditable(assignmentA.start_at)) {
    res.status(409).json({ error: 'cutoff_reached' })
    return
  }

  const targetUser = await pool.query('select id, role from users where id = $1 limit 1', [targetStaffId])
  if (!targetUser.rows[0] || targetUser.rows[0].role !== 'staff') {
    res.status(400).json({ error: 'invalid_target_staff' })
    return
  }

  let assignmentB = null
  let swapExpiresAt = new Date(new Date(assignmentA.start_at).getTime() - 24 * 60 * 60 * 1000).toISOString()

  if (targetAssignmentId) {
    const assignmentBResult = await pool.query(
      `
        select sa.id, sa.shift_id, sa.staff_id, sa.status, s.start_at
        from shift_assignments sa
        join shifts s on s.id = sa.shift_id
        where sa.id = $1
        limit 1
      `,
      [targetAssignmentId],
    )
    assignmentB = assignmentBResult.rows[0]
    if (!assignmentB || assignmentB.staff_id !== targetStaffId || assignmentB.status !== 'active') {
      res.status(400).json({ error: 'invalid_target_assignment' })
      return
    }
    const expB = new Date(new Date(assignmentB.start_at).getTime() - 24 * 60 * 60 * 1000).toISOString()
    swapExpiresAt = new Date(Math.min(new Date(swapExpiresAt).getTime(), new Date(expB).getTime())).toISOString()
  }

  if (new Date(swapExpiresAt).getTime() <= Date.now()) {
    res.status(409).json({ error: 'expired' })
    return
  }

  const validationB = await validateAssignment(targetStaffId, assignmentA.shift_id, { pool, excludeShiftIds: assignmentB ? [assignmentB.shift_id] : [] })
  if (!validationB.valid) {
    const alternatives = await findValidAlternatives(assignmentA.shift_id, { pool, limit: 8 })
    res.status(400).json({ error: 'constraint_violation_target', validation: validationB, alternatives })
    return
  }

  if (assignmentB) {
    const validationA = await validateAssignment(staffA, assignmentB.shift_id, { pool, excludeShiftIds: [assignmentA.shift_id] })
    if (!validationA.valid) {
      res.status(400).json({ error: 'constraint_violation_requestor', validation: validationA })
      return
    }
  }

  await pool.query('begin')
  try {
    const created = await pool.query(
      `
        insert into swap_requests (assignment_id, requested_by, target_staff_id, type, status, expires_at, target_assignment_id)
        values ($1, $2, $3, $4::swap_request_type, $5::swap_request_status, $6::timestamptz, $7::uuid)
        returning id, assignment_id, requested_by, target_staff_id, type, status, expires_at, target_assignment_id, created_at
      `,
      [assignmentId, staffA, targetStaffId, 'swap', 'pending', swapExpiresAt, targetAssignmentId],
    )

    await pool.query(
      'insert into notifications (user_id, type, message, metadata) values ($1,$2,$3,$4)',
      [targetStaffId, 'swap', 'New swap request', JSON.stringify({ swapRequestId: created.rows[0].id })],
    )

    await pool.query(
      'insert into audit_logs (user_id, action, entity_type, entity_id, before, after) values ($1,$2,$3,$4,$5,$6)',
      [
        staffA,
        'swap.request',
        'swap_request',
        created.rows[0].id,
        JSON.stringify({}),
        JSON.stringify({ assignmentId, targetStaffId, targetAssignmentId }),
      ],
    )

    await pool.query('commit')
    const swap = created.rows[0]
    req.app.locals.realtime?.emitToUser(targetStaffId, 'swap:new', { swapId: swap.id, type: swap.type, fromStaffId: staffA })
    req.app.locals.realtime?.emitToUser(staffA, 'swap:submitted', { swapId: swap.id, type: swap.type })
    req.app.locals.realtime?.emitToLocation(assignmentA.location_id, 'swap:new', { swapId: swap.id, type: swap.type, shiftId: assignmentA.shift_id })
    res.status(201).json({ swap })
  } catch (e) {
    await pool.query('rollback')
    throw e
  }
})

router.patch('/:swapId/respond', ...requireRole(['staff']), async (req, res) => {
  const swapId = req.params.swapId
  const response = cleanString(req.body?.response)
  if (!response || !['accept', 'decline'].includes(response)) {
    res.status(400).json({ error: 'invalid_response' })
    return
  }

  const pool = getPool()
  const staffId = req.user.id

  const swapResult = await pool.query(
    `
      select sr.id, sr.type, sr.status, sr.requested_by, sr.target_staff_id, sr.expires_at, sr.assignment_id, sr.target_assignment_id,
             sa.shift_id, s.location_id
      from swap_requests sr
      join shift_assignments sa on sa.id = sr.assignment_id
      join shifts s on s.id = sa.shift_id
      where sr.id = $1
      limit 1
    `,
    [swapId],
  )
  const swap = swapResult.rows[0]
  if (!swap) {
    res.status(404).json({ error: 'not_found' })
    return
  }

  if (swap.type !== 'swap') {
    res.status(400).json({ error: 'not_a_swap_request' })
    return
  }

  if (swap.target_staff_id !== staffId) {
    res.status(403).json({ error: 'forbidden' })
    return
  }

  if (swap.status !== 'pending') {
    res.status(409).json({ error: 'not_pending' })
    return
  }

  if (swap.expires_at && new Date(swap.expires_at).getTime() <= Date.now()) {
    await pool.query('update swap_requests set status = $1::swap_request_status where id = $2', ['expired', swapId])
    res.status(409).json({ error: 'expired' })
    return
  }

  const nextStatus = response === 'accept' ? 'pending_manager_approval' : 'rejected'

  await pool.query('begin')
  try {
    await pool.query('update swap_requests set status = $1::swap_request_status where id = $2', [nextStatus, swapId])
    await pool.query(
      'insert into notifications (user_id, type, message, metadata) values ($1,$2,$3,$4)',
      [
        swap.requested_by,
        'swap',
        response === 'accept' ? 'Swap accepted (awaiting manager approval)' : 'Swap declined',
        JSON.stringify({ swapRequestId: swapId }),
      ],
    )
    await pool.query(
      'insert into audit_logs (user_id, action, entity_type, entity_id, before, after) values ($1,$2,$3,$4,$5,$6)',
      [
        staffId,
        'swap.respond',
        'swap_request',
        swapId,
        JSON.stringify({ status: swap.status }),
        JSON.stringify({ status: nextStatus, response }),
      ],
    )
    await pool.query('commit')
  } catch (e) {
    await pool.query('rollback')
    throw e
  }

  req.app.locals.realtime?.emitToUser(swap.requested_by, response === 'accept' ? 'swap:accepted' : 'swap:declined', {
    swapId,
    status: nextStatus,
  })
  req.app.locals.realtime?.emitToLocation(swap.location_id, 'swap:updated', { swapId, status: nextStatus, shiftId: swap.shift_id })

  res.json({ ok: true, status: nextStatus })
})

router.get('/pending', ...requireRole(['admin', 'manager']), async (req, res) => {
  const pool = getPool()
  const locationId = cleanString(req.query?.locationId)

  const params = []
  const where = ["sr.status in ('pending_manager_approval'::swap_request_status, 'pending'::swap_request_status)"]

  if (locationId) {
    params.push(locationId)
    where.push(`s.location_id = $${params.length}`)
  }

  if (req.user.role === 'manager') {
    params.push(req.user.id)
    where.push(`exists (select 1 from staff_locations sl where sl.staff_id = $${params.length} and sl.location_id = s.location_id)`)
  }

  const whereSql = where.length ? `where ${where.join(' and ')}` : ''

  const result = await pool.query(
    `
      select
        sr.id,
        sr.type,
        sr.status,
        sr.expires_at,
        sr.created_at,
        sr.assignment_id,
        sr.target_assignment_id,
        sr.requested_by,
        u1.email as requested_by_email,
        u1.name as requested_by_name,
        sr.target_staff_id,
        u2.email as target_staff_email,
        u2.name as target_staff_name,
        s.id as shift_id,
        s.start_at,
        s.end_at,
        s.location_id,
        l.name as location_name,
        l.timezone as location_timezone
      from swap_requests sr
      join shift_assignments sa on sa.id = sr.assignment_id
      join shifts s on s.id = sa.shift_id
      join locations l on l.id = s.location_id
      left join users u1 on u1.id = sr.requested_by
      left join users u2 on u2.id = sr.target_staff_id
      ${whereSql}
      order by sr.created_at asc
      limit 200
    `,
    params,
  )

  res.json({
    swaps: result.rows.map((r) => ({
      id: r.id,
      type: r.type,
      status: r.status,
      expiresAt: r.expires_at ? new Date(r.expires_at).toISOString() : null,
      createdAt: r.created_at,
      assignmentId: r.assignment_id,
      targetAssignmentId: r.target_assignment_id,
      requestedBy: { id: r.requested_by, email: r.requested_by_email, name: r.requested_by_name },
      targetStaff: r.target_staff_id ? { id: r.target_staff_id, email: r.target_staff_email, name: r.target_staff_name } : null,
      shift: {
        id: r.shift_id,
        startAt: new Date(r.start_at).toISOString(),
        endAt: new Date(r.end_at).toISOString(),
        location: { id: r.location_id, name: r.location_name, timezone: r.location_timezone },
      },
    })),
  })
})

router.patch('/:swapId/approve', ...requireRole(['admin', 'manager']), async (req, res) => {
  const pool = getPool()
  const swapId = req.params.swapId
  const decision = cleanString(req.body?.decision)

  if (!decision || !['approve', 'deny'].includes(decision)) {
    res.status(400).json({ error: 'invalid_decision' })
    return
  }

  const swapResult = await pool.query(
    `
      select sr.id, sr.type, sr.status, sr.assignment_id, sr.target_assignment_id, sr.requested_by, sr.target_staff_id, sr.expires_at,
             sa.shift_id as shift_a_id,
             s.location_id as location_id,
             s.start_at as shift_a_start_at
      from swap_requests sr
      join shift_assignments sa on sa.id = sr.assignment_id
      join shifts s on s.id = sa.shift_id
      where sr.id = $1
      limit 1
    `,
    [swapId],
  )
  const swap = swapResult.rows[0]
  if (!swap) {
    res.status(404).json({ error: 'not_found' })
    return
  }

  if (req.user.role === 'manager') {
    const ok = await ensureManagerLocationAccess(pool, req.user.id, swap.location_id)
    if (!ok) {
      res.status(403).json({ error: 'forbidden' })
      return
    }
  }

  if (swap.expires_at && new Date(swap.expires_at).getTime() <= Date.now()) {
    await pool.query('update swap_requests set status = $1::swap_request_status where id = $2', ['expired', swapId])
    res.status(409).json({ error: 'expired' })
    return
  }

  if (!isShiftEditable(swap.shift_a_start_at)) {
    res.status(409).json({ error: 'cutoff_reached' })
    return
  }

  if (decision === 'deny') {
    await pool.query('begin')
    try {
      await pool.query('update swap_requests set status = $1::swap_request_status where id = $2', ['rejected', swapId])
      await pool.query(
        'insert into audit_logs (user_id, action, entity_type, entity_id, before, after) values ($1,$2,$3,$4,$5,$6)',
        [req.user.id, 'swap.manager.deny', 'swap_request', swapId, JSON.stringify({ status: swap.status }), JSON.stringify({ status: 'rejected' })],
      )

      await pool.query(
        'insert into notifications (user_id, type, message, metadata) values ($1,$2,$3,$4)',
        [swap.requested_by, 'swap', 'Swap/drop denied by manager', JSON.stringify({ swapRequestId: swapId })],
      )
      if (swap.target_staff_id) {
        await pool.query(
          'insert into notifications (user_id, type, message, metadata) values ($1,$2,$3,$4)',
          [swap.target_staff_id, 'swap', 'Swap denied by manager', JSON.stringify({ swapRequestId: swapId })],
        )
      }
      await pool.query('commit')
    } catch (e) {
      await pool.query('rollback')
      throw e
    }

    req.app.locals.realtime?.emitToUser(swap.requested_by, 'swap:denied', { swapId, status: 'rejected' })
    if (swap.target_staff_id) {
      req.app.locals.realtime?.emitToUser(swap.target_staff_id, 'swap:denied', { swapId, status: 'rejected' })
    }
    req.app.locals.realtime?.emitToLocation(swap.location_id, 'swap:updated', { swapId, status: 'rejected', shiftId: swap.shift_a_id })

    res.json({ ok: true, status: 'rejected' })
    return
  }

  if (swap.type === 'swap' && swap.status !== 'pending_manager_approval') {
    res.status(409).json({ error: 'not_ready_for_approval' })
    return
  }

  if (swap.type === 'drop' && swap.status !== 'pending_manager_approval') {
    res.status(409).json({ error: 'not_ready_for_approval' })
    return
  }

  await pool.query('begin')
  try {
    if (swap.type === 'drop') {
      await pool.query(
        'update shift_assignments set status = $1::shift_assignment_status, assigned_by = $2 where id = $3',
        ['dropped', req.user.id, swap.assignment_id],
      )
    } else {
      const assignmentA = await pool.query(
        'select id, staff_id, shift_id from shift_assignments where id = $1 limit 1 for update',
        [swap.assignment_id],
      )
      const a = assignmentA.rows[0]
      if (!a) throw new Error('assignment_not_found')

      if (!swap.target_staff_id) throw new Error('target_staff_required')

      if (swap.target_assignment_id) {
        const assignmentB = await pool.query(
          'select id, staff_id, shift_id from shift_assignments where id = $1 limit 1 for update',
          [swap.target_assignment_id],
        )
        const b = assignmentB.rows[0]
        if (!b) throw new Error('target_assignment_not_found')

        const validationB = await validateAssignment(swap.target_staff_id, a.shift_id, { pool, excludeShiftIds: [b.shift_id] })
        if (!validationB.valid) {
          const alternatives = await findValidAlternatives(a.shift_id, { pool, limit: 8 })
          await pool.query('rollback')
          res.status(400).json({ error: 'constraint_violation_target', validation: validationB, alternatives })
          return
        }

        const validationA = await validateAssignment(a.staff_id, b.shift_id, { pool, excludeShiftIds: [a.shift_id] })
        if (!validationA.valid) {
          await pool.query('rollback')
          res.status(400).json({ error: 'constraint_violation_requestor', validation: validationA })
          return
        }

        await pool.query('update shift_assignments set staff_id = $1, assigned_by = $2 where id = $3', [
          swap.target_staff_id,
          req.user.id,
          a.id,
        ])
        await pool.query('update shift_assignments set staff_id = $1, assigned_by = $2 where id = $3', [
          a.staff_id,
          req.user.id,
          b.id,
        ])
      } else {
        const validationB = await validateAssignment(swap.target_staff_id, a.shift_id, { pool })
        if (!validationB.valid) {
          const alternatives = await findValidAlternatives(a.shift_id, { pool, limit: 8 })
          await pool.query('rollback')
          res.status(400).json({ error: 'constraint_violation_target', validation: validationB, alternatives })
          return
        }

        await pool.query('update shift_assignments set staff_id = $1, assigned_by = $2 where id = $3', [
          swap.target_staff_id,
          req.user.id,
          a.id,
        ])
      }
    }

    await pool.query('update swap_requests set status = $1::swap_request_status where id = $2', ['approved', swapId])

    await pool.query(
      'insert into audit_logs (user_id, action, entity_type, entity_id, before, after) values ($1,$2,$3,$4,$5,$6)',
      [req.user.id, 'swap.manager.approve', 'swap_request', swapId, JSON.stringify({ status: swap.status }), JSON.stringify({ status: 'approved' })],
    )

    await pool.query(
      'insert into notifications (user_id, type, message, metadata) values ($1,$2,$3,$4)',
      [swap.requested_by, 'swap', 'Swap/drop approved', JSON.stringify({ swapRequestId: swapId })],
    )
    if (swap.target_staff_id) {
      await pool.query(
        'insert into notifications (user_id, type, message, metadata) values ($1,$2,$3,$4)',
        [swap.target_staff_id, 'swap', 'Swap approved', JSON.stringify({ swapRequestId: swapId })],
      )
    }

    await pool.query('commit')
  } catch (e) {
    await pool.query('rollback')
    throw e
  }

  req.app.locals.realtime?.emitToUser(swap.requested_by, 'swap:approved', { swapId, status: 'approved' })
  if (swap.target_staff_id) {
    req.app.locals.realtime?.emitToUser(swap.target_staff_id, 'swap:approved', { swapId, status: 'approved' })
  }
  req.app.locals.realtime?.emitToLocation(swap.location_id, 'swap:updated', { swapId, status: 'approved', shiftId: swap.shift_a_id })
  req.app.locals.realtime?.emitToLocation(swap.location_id, 'schedule:updated', { locationId: swap.location_id, shiftId: swap.shift_a_id, reason: 'swap.approved' })

  res.json({ ok: true, status: 'approved' })
})

router.get('/me', ...requireUser(), async (req, res) => {
  const pool = getPool()
  const userId = req.user.id

  const result = await pool.query(
    `
      select sr.id, sr.type, sr.status, sr.expires_at, sr.created_at, sr.assignment_id, sr.target_assignment_id,
             sr.target_staff_id, u2.email as target_staff_email, u2.name as target_staff_name,
             s.id as shift_id, s.start_at, s.end_at, l.name as location_name, l.timezone as location_timezone
      from swap_requests sr
      join shift_assignments sa on sa.id = sr.assignment_id
      join shifts s on s.id = sa.shift_id
      join locations l on l.id = s.location_id
      left join users u2 on u2.id = sr.target_staff_id
      where sr.requested_by = $1
      order by sr.created_at desc
      limit 100
    `,
    [userId],
  )

  res.json({
    swaps: result.rows.map((r) => ({
      id: r.id,
      type: r.type,
      status: r.status,
      expiresAt: r.expires_at ? new Date(r.expires_at).toISOString() : null,
      createdAt: r.created_at,
      assignmentId: r.assignment_id,
      targetAssignmentId: r.target_assignment_id,
      targetStaff: r.target_staff_id ? { id: r.target_staff_id, email: r.target_staff_email, name: r.target_staff_name } : null,
      shift: {
        id: r.shift_id,
        startAt: new Date(r.start_at).toISOString(),
        endAt: new Date(r.end_at).toISOString(),
        location: { name: r.location_name, timezone: r.location_timezone },
      },
    })),
  })
})

module.exports = { swapsRouter: router }
