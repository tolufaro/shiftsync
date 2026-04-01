const test = require('node:test')
const assert = require('node:assert/strict')

const { validateAssignmentCore } = require('./validateAssignment')

test('valid assignment when no conflicts, skill/location match, and within availability', () => {
  const result = validateAssignmentCore({
    staffId: 'staff-1',
    shift: {
      id: 'shift-1',
      locationId: 'loc-1',
      locationTimeZone: 'UTC',
      requiredSkillId: 'skill-1',
      startAt: '2026-04-06T10:00:00.000Z',
      endAt: '2026-04-06T12:00:00.000Z',
    },
    staffSkills: ['skill-1'],
    staffLocationIds: ['loc-1'],
    assignedShifts: [],
    availability: {
      windows: [{ dayOfWeek: 1, startTime: '09:00', endTime: '17:00', isRecurring: true }],
      exceptions: [],
    },
  })

  assert.equal(result.valid, true)
  assert.equal(result.violations.length, 0)
})

test('double-book violation when overlapping existing assignment', () => {
  const result = validateAssignmentCore({
    staffId: 'staff-1',
    shift: {
      id: 'shift-1',
      locationId: 'loc-1',
      locationTimeZone: 'UTC',
      requiredSkillId: null,
      startAt: '2026-04-06T10:00:00.000Z',
      endAt: '2026-04-06T12:00:00.000Z',
    },
    staffSkills: [],
    staffLocationIds: ['loc-1'],
    assignedShifts: [{ shiftId: 'shift-2', startAt: '2026-04-06T11:00:00.000Z', endAt: '2026-04-06T13:00:00.000Z' }],
    availability: { windows: [{ dayOfWeek: 1, startTime: '00:00', endTime: '23:59', isRecurring: true }], exceptions: [] },
  })

  assert.equal(result.valid, false)
  assert.ok(result.violations.some((v) => v.code === 'double_book'))
})

test('10hr gap violation when rest is less than 10 hours', () => {
  const result = validateAssignmentCore({
    staffId: 'staff-1',
    shift: {
      id: 'shift-1',
      locationId: 'loc-1',
      locationTimeZone: 'UTC',
      requiredSkillId: null,
      startAt: '2026-04-06T12:00:00.000Z',
      endAt: '2026-04-06T16:00:00.000Z',
    },
    staffSkills: [],
    staffLocationIds: ['loc-1'],
    assignedShifts: [{ shiftId: 'shift-2', startAt: '2026-04-06T04:00:00.000Z', endAt: '2026-04-06T06:30:00.000Z' }],
    availability: { windows: [{ dayOfWeek: 1, startTime: '00:00', endTime: '23:59', isRecurring: true }], exceptions: [] },
  })

  assert.equal(result.valid, false)
  assert.ok(result.violations.some((v) => v.code === 'min_rest_10h'))
})

test('skill mismatch violation when required skill missing', () => {
  const result = validateAssignmentCore({
    staffId: 'staff-1',
    shift: {
      id: 'shift-1',
      locationId: 'loc-1',
      locationTimeZone: 'UTC',
      requiredSkillId: 'skill-req',
      startAt: '2026-04-06T10:00:00.000Z',
      endAt: '2026-04-06T12:00:00.000Z',
    },
    staffSkills: ['skill-other'],
    staffLocationIds: ['loc-1'],
    assignedShifts: [],
    availability: { windows: [{ dayOfWeek: 1, startTime: '00:00', endTime: '23:59', isRecurring: true }], exceptions: [] },
  })

  assert.equal(result.valid, false)
  assert.ok(result.violations.some((v) => v.code === 'skill_mismatch'))
})

test('location certification violation when staff not assigned to location', () => {
  const result = validateAssignmentCore({
    staffId: 'staff-1',
    shift: {
      id: 'shift-1',
      locationId: 'loc-2',
      locationTimeZone: 'UTC',
      requiredSkillId: null,
      startAt: '2026-04-06T10:00:00.000Z',
      endAt: '2026-04-06T12:00:00.000Z',
    },
    staffSkills: [],
    staffLocationIds: ['loc-1'],
    assignedShifts: [],
    availability: { windows: [{ dayOfWeek: 1, startTime: '00:00', endTime: '23:59', isRecurring: true }], exceptions: [] },
  })

  assert.equal(result.valid, false)
  assert.ok(result.violations.some((v) => v.code === 'location_not_certified'))
})

test('availability violation when outside recurring window or unavailable exception', () => {
  const outside = validateAssignmentCore({
    staffId: 'staff-1',
    shift: {
      id: 'shift-1',
      locationId: 'loc-1',
      locationTimeZone: 'UTC',
      requiredSkillId: null,
      startAt: '2026-04-06T18:00:00.000Z',
      endAt: '2026-04-06T19:00:00.000Z',
    },
    staffSkills: [],
    staffLocationIds: ['loc-1'],
    assignedShifts: [],
    availability: { windows: [{ dayOfWeek: 1, startTime: '09:00', endTime: '17:00', isRecurring: true }], exceptions: [] },
  })
  assert.equal(outside.valid, false)
  assert.ok(outside.violations.some((v) => v.code === 'outside_availability'))

  const blocked = validateAssignmentCore({
    staffId: 'staff-1',
    shift: {
      id: 'shift-1',
      locationId: 'loc-1',
      locationTimeZone: 'UTC',
      requiredSkillId: null,
      startAt: '2026-04-06T10:00:00.000Z',
      endAt: '2026-04-06T12:00:00.000Z',
    },
    staffSkills: [],
    staffLocationIds: ['loc-1'],
    assignedShifts: [],
    availability: {
      windows: [{ dayOfWeek: 1, startTime: '00:00', endTime: '23:59', isRecurring: true }],
      exceptions: [{ date: '2026-04-06', type: 'unavailable', startTime: null, endTime: null }],
    },
  })
  assert.equal(blocked.valid, false)
  assert.ok(blocked.violations.some((v) => v.code === 'outside_availability'))
})

