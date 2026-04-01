const test = require('node:test')
const assert = require('node:assert/strict')

const { getWeeklyHours, getDailyHours, getConsecutiveDays } = require('./hours')

test('getDailyHours sums time within the day (UTC)', () => {
  const shifts = [{ startAt: '2026-04-06T10:00:00.000Z', endAt: '2026-04-06T12:30:00.000Z' }]
  const hours = getDailyHours(shifts, '2026-04-06', 'UTC')
  assert.equal(hours, 2.5)
})

test('getWeeklyHours sums across 7 days (UTC)', () => {
  const shifts = [
    { startAt: '2026-04-06T10:00:00.000Z', endAt: '2026-04-06T12:00:00.000Z' },
    { startAt: '2026-04-07T10:00:00.000Z', endAt: '2026-04-07T14:00:00.000Z' },
  ]
  const hours = getWeeklyHours(shifts, '2026-04-06', 'UTC')
  assert.equal(hours, 6)
})

test('getConsecutiveDays returns max streak within week (UTC)', () => {
  const shifts = [
    { startAt: '2026-04-06T10:00:00.000Z', endAt: '2026-04-06T12:00:00.000Z' },
    { startAt: '2026-04-07T10:00:00.000Z', endAt: '2026-04-07T12:00:00.000Z' },
    { startAt: '2026-04-08T10:00:00.000Z', endAt: '2026-04-08T12:00:00.000Z' },
    { startAt: '2026-04-10T10:00:00.000Z', endAt: '2026-04-10T12:00:00.000Z' },
  ]
  const max = getConsecutiveDays(shifts, '2026-04-06', 'UTC')
  assert.equal(max, 3)
})

