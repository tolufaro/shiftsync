const test = require('node:test')
const assert = require('node:assert/strict')

const { validateAssignmentCore } = require('./validateAssignment')

test('availability uses staff home timezone, not location timezone', () => {
  const result = validateAssignmentCore({
    staffId: 'staff-1',
    staffTimeZone: 'America/Los_Angeles',
    shift: {
      id: 'shift-1',
      locationId: 'loc-1',
      locationTimeZone: 'America/New_York',
      requiredSkillId: null,
      startAt: '2025-04-07T16:00:00.000Z',
      endAt: '2025-04-08T00:00:00.000Z',
    },
    staffSkills: [],
    staffLocationIds: ['loc-1'],
    assignedShifts: [],
    availability: {
      windows: [{ dayOfWeek: 1, startTime: '09:00', endTime: '17:00', isRecurring: true }],
      exceptions: [],
    },
  })

  assert.equal(result.valid, true)
  assert.ok(result.violations.every((v) => v.severity !== 'block'))
  assert.ok(!result.violations.some((v) => v.code === 'outside_availability'))
})

test('DST spring-forward day does not break availability checks', () => {
  const ok = validateAssignmentCore({
    staffId: 'staff-1',
    staffTimeZone: 'America/New_York',
    shift: {
      id: 'shift-1',
      locationId: 'loc-1',
      locationTimeZone: 'America/New_York',
      requiredSkillId: null,
      startAt: '2025-03-09T06:30:00.000Z',
      endAt: '2025-03-09T07:30:00.000Z',
    },
    staffSkills: [],
    staffLocationIds: ['loc-1'],
    assignedShifts: [],
    availability: {
      windows: [{ dayOfWeek: 0, startTime: '01:00', endTime: '04:00', isRecurring: true }],
      exceptions: [],
    },
  })
  assert.equal(ok.valid, true)

  const bad = validateAssignmentCore({
    staffId: 'staff-1',
    staffTimeZone: 'America/New_York',
    shift: {
      id: 'shift-1',
      locationId: 'loc-1',
      locationTimeZone: 'America/New_York',
      requiredSkillId: null,
      startAt: '2025-03-09T06:30:00.000Z',
      endAt: '2025-03-09T07:30:00.000Z',
    },
    staffSkills: [],
    staffLocationIds: ['loc-1'],
    assignedShifts: [],
    availability: {
      windows: [{ dayOfWeek: 0, startTime: '01:00', endTime: '02:00', isRecurring: true }],
      exceptions: [],
    },
  })
  assert.equal(bad.valid, false)
  assert.ok(bad.violations.some((v) => v.code === 'outside_availability'))
})

test('overnight availability window can cover overnight shift via carryover', () => {
  const result = validateAssignmentCore({
    staffId: 'staff-1',
    staffTimeZone: 'UTC',
    shift: {
      id: 'shift-1',
      locationId: 'loc-1',
      locationTimeZone: 'UTC',
      requiredSkillId: null,
      startAt: '2025-04-07T23:00:00.000Z',
      endAt: '2025-04-08T05:00:00.000Z',
    },
    staffSkills: [],
    staffLocationIds: ['loc-1'],
    assignedShifts: [],
    availability: {
      windows: [{ dayOfWeek: 1, startTime: '22:00', endTime: '06:00', isRecurring: true }],
      exceptions: [],
    },
  })
  assert.equal(result.valid, true)
})
