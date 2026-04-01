const { DateTime, Interval } = require('luxon')

const TEN_HOURS_MS = 10 * 60 * 60 * 1000
const WEEKLY_HOURS_WARNING = 38
const WEEKLY_HOURS_OVERTIME = 40
const WEEKLY_HOURS_HARD_MAX = 60
const DAILY_HOURS_WARNING = 8
const DAILY_HOURS_HARD_MAX = 12
const CONSECUTIVE_DAYS_WARNING = 6
const CONSECUTIVE_DAYS_HARD_MAX = 7

function overlaps(aStart, aEnd, bStart, bEnd) {
  return aStart < bEnd && bStart < aEnd
}

function parseYmd(ymd) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd)
  if (!m) return null
  const y = Number(m[1])
  const mo = Number(m[2])
  const d = Number(m[3])
  return { y, mo, d }
}

function addDaysYmd(ymd, days) {
  const p = parseYmd(ymd)
  if (!p) return null
  const dt = new Date(Date.UTC(p.y, p.mo - 1, p.d + days))
  return dt.toISOString().slice(0, 10)
}

function dayIndexUtcFromYmd(ymd) {
  const p = parseYmd(ymd)
  if (!p) return null
  return Math.floor(Date.UTC(p.y, p.mo - 1, p.d) / 86400000)
}

function toMinutes(time) {
  if (!time || typeof time !== 'string') return null
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(time)
  if (!m) return null
  return Number(m[1]) * 60 + Number(m[2])
}

function parseTimeParts(time) {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(String(time || ''))
  if (!m) return null
  return { hour: Number(m[1]), minute: Number(m[2]) }
}

function dateTimeAtLocalMinute(ymd, minutes, timeZone) {
  const p = parseYmd(ymd)
  if (!p) return null
  const base = DateTime.fromObject({ year: p.y, month: p.mo, day: p.d, hour: 0, minute: 0, second: 0 }, { zone: timeZone })
  if (!base.isValid) return null
  return base.plus({ minutes })
}

function intervalForWindow(ymd, startTime, endTime, timeZone) {
  const sMin = toMinutes(startTime)
  const eMin = toMinutes(endTime)
  if (sMin === null || eMin === null) return null
  const start = dateTimeAtLocalMinute(ymd, sMin, timeZone)
  const endBase = dateTimeAtLocalMinute(ymd, eMin, timeZone)
  if (!start || !endBase || !start.isValid || !endBase.isValid) return null
  const end = endBase <= start ? endBase.plus({ days: 1 }) : endBase
  return Interval.fromDateTimes(start, end)
}

function mergeIntervals(intervals) {
  const sorted = intervals
    .filter((i) => i && i.isValid)
    .sort((a, b) => a.start.toMillis() - b.start.toMillis())
  const out = []
  for (const i of sorted) {
    const last = out[out.length - 1]
    if (!last) {
      out.push(i)
      continue
    }
    if (last.end.toMillis() >= i.start.toMillis()) {
      out[out.length - 1] = Interval.fromDateTimes(last.start, last.end.toMillis() >= i.end.toMillis() ? last.end : i.end)
    } else {
      out.push(i)
    }
  }
  return out
}

function windowsForDateIntervals(ymd, dayOfWeek, recurringWindows, exceptions, timeZone) {
  const dateExceptions = exceptions.filter((e) => e.date === ymd)
  const unavail = dateExceptions.some((e) => e.type === 'unavailable')
  if (unavail) return []

  const custom = dateExceptions.filter((e) => e.type === 'custom')
  const baseWindows = custom.length ? custom : recurringWindows.filter((w) => w.dayOfWeek === dayOfWeek)

  const intervals = []
  for (const w of baseWindows) {
    const it = intervalForWindow(ymd, w.startTime, w.endTime, timeZone)
    if (it) intervals.push(it)
  }

  const prevYmd = addDaysYmd(ymd, -1)
  if (prevYmd) {
    const prevExceptions = exceptions.filter((e) => e.date === prevYmd)
    const prevUnavail = prevExceptions.some((e) => e.type === 'unavailable')
    const prevCustom = prevExceptions.filter((e) => e.type === 'custom')
    const prevWindows = prevCustom.length ? prevCustom : recurringWindows.filter((w) => w.dayOfWeek === ((dayOfWeek + 6) % 7))
    if (!prevUnavail) {
      for (const w of prevWindows) {
        const sMin = toMinutes(w.startTime)
        const eMin = toMinutes(w.endTime)
        if (sMin === null || eMin === null) continue
        if (eMin > sMin) continue
        const it = intervalForWindow(prevYmd, w.startTime, w.endTime, timeZone)
        if (it) intervals.push(it)
      }
    }
  }

  return mergeIntervals(intervals)
}

function splitIntervalByLocalDay(startIso, endIso, timeZone) {
  const start = DateTime.fromISO(startIso, { zone: timeZone })
  const end = DateTime.fromISO(endIso, { zone: timeZone })
  if (!start.isValid || !end.isValid) return null
  if (!(end.toMillis() > start.toMillis())) return null

  const segments = []
  let cursor = start.startOf('day')
  for (let guard = 0; guard < 16 && cursor.toMillis() < end.toMillis(); guard++) {
    const next = cursor.plus({ days: 1 })
    const segStart = start.toMillis() > cursor.toMillis() ? start : cursor
    const segEnd = end.toMillis() < next.toMillis() ? end : next
    const ms = Math.max(0, segEnd.toMillis() - segStart.toMillis())
    if (ms > 0) {
      segments.push({
        ymd: cursor.toISODate(),
        dayOfWeek: cursor.weekday % 7,
        start: segStart,
        end: segEnd,
        ms,
      })
    }
    cursor = next
  }
  return segments
}

function consecutiveDaysEndingOn(workedDates, endYmd) {
  let streak = 0
  let cursor = endYmd
  for (let i = 0; i < 32; i++) {
    if (!workedDates.has(cursor)) break
    streak += 1
    const prev = addDaysYmd(cursor, -1)
    if (!prev) break
    cursor = prev
  }
  return streak
}

function validateAssignmentCore(input) {
  const violations = []
  const suggestions = []

  const shiftStart = new Date(input.shift.startAt)
  const shiftEnd = new Date(input.shift.endAt)
  if (Number.isNaN(shiftStart.getTime()) || Number.isNaN(shiftEnd.getTime())) {
    return { valid: false, violations: [{ code: 'invalid_shift_time', severity: 'block' }], suggestions: [] }
  }

  const assigned = input.assignedShifts || []
  const conflicts = []
  for (const s of assigned) {
    const aStart = new Date(s.startAt)
    const aEnd = new Date(s.endAt)
    if (Number.isNaN(aStart.getTime()) || Number.isNaN(aEnd.getTime())) continue
    if (overlaps(shiftStart, shiftEnd, aStart, aEnd)) {
      conflicts.push({ shiftId: s.shiftId, startAt: s.startAt, endAt: s.endAt })
    }
  }
  if (conflicts.length) {
    violations.push({ code: 'double_book', severity: 'block', conflicts })
    suggestions.push({ code: 'choose_different_staff_or_time' })
  }

  const gaps = []
  for (const s of assigned) {
    const aStart = new Date(s.startAt)
    const aEnd = new Date(s.endAt)
    if (Number.isNaN(aStart.getTime()) || Number.isNaN(aEnd.getTime())) continue
    if (aEnd <= shiftStart) {
      const gap = shiftStart.getTime() - aEnd.getTime()
      if (gap < TEN_HOURS_MS) gaps.push({ code: 'gap_before', otherShiftId: s.shiftId, gapHours: gap / 3600000 })
    } else if (aStart >= shiftEnd) {
      const gap = aStart.getTime() - shiftEnd.getTime()
      if (gap < TEN_HOURS_MS) gaps.push({ code: 'gap_after', otherShiftId: s.shiftId, gapHours: gap / 3600000 })
    }
  }
  if (gaps.length) {
    violations.push({ code: 'min_rest_10h', severity: 'block', gaps })
    suggestions.push({ code: 'pick_shift_with_more_rest' })
  }

  const requiredSkillId = input.shift.requiredSkillId
  if (requiredSkillId) {
    const hasSkill = (input.staffSkills || []).includes(requiredSkillId)
    if (!hasSkill) {
      violations.push({ code: 'skill_mismatch', severity: 'block', requiredSkillId })
      suggestions.push({ code: 'assign_skill_to_staff', requiredSkillId })
    }
  }

  const locationId = input.shift.locationId
  if (locationId) {
    const hasLocation = (input.staffLocationIds || []).includes(locationId)
    if (!hasLocation) {
      violations.push({ code: 'location_not_certified', severity: 'block', locationId })
      suggestions.push({ code: 'assign_staff_to_location', locationId })
    }
  }

  const locationTimeZone = input.shift.locationTimeZone
  const staffTimeZone = input.staffTimeZone || locationTimeZone || 'UTC'

  let shiftSegments = null
  let overtime = null

  if (!locationTimeZone) {
    violations.push({ code: 'missing_location_timezone', severity: 'block' })
  }

  shiftSegments = splitIntervalByLocalDay(input.shift.startAt, input.shift.endAt, staffTimeZone)
  if (!shiftSegments) {
    violations.push({ code: 'availability_check_failed', severity: 'block' })
  } else {
    const recurring = input.availability?.windows || []
    const exceptions = input.availability?.exceptions || []

    const uncovered = []
    for (const seg of shiftSegments) {
      const wins = windowsForDateIntervals(seg.ymd, seg.dayOfWeek, recurring, exceptions, staffTimeZone)
      const segInterval = Interval.fromDateTimes(seg.start, seg.end)
      const ok = wins.some((w) => w.start.toMillis() <= segInterval.start.toMillis() && w.end.toMillis() >= segInterval.end.toMillis())
      if (!ok) {
        uncovered.push({
          date: seg.ymd,
          dayOfWeek: seg.dayOfWeek,
          startTime: seg.start.toFormat('HH:mm'),
          endTime: seg.end.toFormat('HH:mm'),
          timeZone: staffTimeZone,
        })
      }
    }

    if (uncovered.length) {
      violations.push({ code: 'outside_availability', severity: 'block', uncovered })
      suggestions.push({ code: 'update_availability' })
    }

    const shiftStartLocal = DateTime.fromISO(input.shift.startAt, { zone: staffTimeZone })
    if (shiftStartLocal.isValid) {
      const weekStart = shiftStartLocal.startOf('day').minus({ days: shiftStartLocal.weekday - 1 })
      const weekStartYmd = weekStart.toISODate()
      const weekYmds = []
      for (let i = 0; i < 7; i++) {
        const ymd = addDaysYmd(weekStartYmd, i)
        if (ymd) weekYmds.push(ymd)
      }

      const dailyMsBefore = new Map()
      for (const s of assigned) {
        const parts = splitIntervalByLocalDay(s.startAt, s.endAt, staffTimeZone)
        if (!parts) continue
        for (const p of parts) {
          dailyMsBefore.set(p.ymd, (dailyMsBefore.get(p.ymd) || 0) + p.ms)
        }
      }

      const dailyMsAdded = new Map()
      for (const p of shiftSegments) {
        dailyMsAdded.set(p.ymd, (dailyMsAdded.get(p.ymd) || 0) + p.ms)
      }

      let weeklyMsBefore = 0
      let weeklyMsAfter = 0
      for (const ymd of weekYmds) {
        weeklyMsBefore += dailyMsBefore.get(ymd) || 0
        weeklyMsAfter += (dailyMsBefore.get(ymd) || 0) + (dailyMsAdded.get(ymd) || 0)
      }

      const weeklyHoursBefore = weeklyMsBefore / 3600000
      const weeklyHoursAfter = weeklyMsAfter / 3600000

      if (weeklyHoursAfter >= WEEKLY_HOURS_HARD_MAX) {
        violations.push({
          code: 'overtime_weekly_hard',
          severity: 'block',
          message: `Weekly hours would be ${weeklyHoursAfter.toFixed(1)}h (limit ${WEEKLY_HOURS_HARD_MAX}h)`,
          hoursBefore: weeklyHoursBefore,
          hoursAfter: weeklyHoursAfter,
          weekStart: weekStartYmd,
        })
      } else if (weeklyHoursAfter >= WEEKLY_HOURS_OVERTIME) {
        violations.push({
          code: 'overtime_weekly_overtime',
          severity: 'warning',
          message: `Weekly hours would be ${weeklyHoursAfter.toFixed(1)}h (overtime starts at ${WEEKLY_HOURS_OVERTIME}h)`,
          hoursBefore: weeklyHoursBefore,
          hoursAfter: weeklyHoursAfter,
          weekStart: weekStartYmd,
        })
      } else if (weeklyHoursAfter >= WEEKLY_HOURS_WARNING) {
        violations.push({
          code: 'overtime_weekly_warning',
          severity: 'warning',
          message: `Weekly hours would be ${weeklyHoursAfter.toFixed(1)}h (near overtime)`,
          hoursBefore: weeklyHoursBefore,
          hoursAfter: weeklyHoursAfter,
          weekStart: weekStartYmd,
        })
      }

      const shiftDays = Array.from(new Set(shiftSegments.map((s) => s.ymd)))
      const daily = []

      for (const ymd of shiftDays) {
        const beforeMs = dailyMsBefore.get(ymd) || 0
        const afterMs = beforeMs + (dailyMsAdded.get(ymd) || 0)
        const hoursBefore = beforeMs / 3600000
        const hoursAfter = afterMs / 3600000
        daily.push({ date: ymd, hoursBefore, hoursAfter })

        if (hoursAfter >= DAILY_HOURS_HARD_MAX) {
          violations.push({
            code: 'overtime_daily_hard',
            severity: 'block',
            message: `Daily hours on ${ymd} would be ${hoursAfter.toFixed(1)}h (limit ${DAILY_HOURS_HARD_MAX}h)`,
            date: ymd,
            hoursBefore,
            hoursAfter,
          })
        } else if (hoursAfter >= DAILY_HOURS_WARNING) {
          violations.push({
            code: 'overtime_daily_warning',
            severity: 'warning',
            message: `Daily hours on ${ymd} would be ${hoursAfter.toFixed(1)}h (near overtime)`,
            date: ymd,
            hoursBefore,
            hoursAfter,
          })
        }
      }

      const workedBefore = new Set()
      for (const [ymd, ms] of dailyMsBefore.entries()) {
        if (ms > 0) workedBefore.add(ymd)
      }
      const workedAfter = new Set(workedBefore)
      for (const [ymd, ms] of dailyMsAdded.entries()) {
        if (ms > 0) workedAfter.add(ymd)
      }

      let maxBefore = 0
      let maxAfter = 0
      let streakEnd = null
      for (const ymd of weekYmds) {
        const b = consecutiveDaysEndingOn(workedBefore, ymd)
        const a = consecutiveDaysEndingOn(workedAfter, ymd)
        if (b > maxBefore) maxBefore = b
        if (a > maxAfter) {
          maxAfter = a
          streakEnd = ymd
        }
      }

      if (maxAfter > CONSECUTIVE_DAYS_HARD_MAX) {
        violations.push({
          code: 'overtime_consecutive_hard',
          severity: 'block',
          overrideable: false,
          message: `This would schedule ${maxAfter} consecutive days (max ${CONSECUTIVE_DAYS_HARD_MAX})`,
          consecutiveDaysBefore: maxBefore,
          consecutiveDaysAfter: maxAfter,
          endDate: streakEnd,
        })
      } else if (maxAfter === CONSECUTIVE_DAYS_HARD_MAX) {
        violations.push({
          code: 'overtime_consecutive_hard',
          severity: 'block',
          overrideable: true,
          message: `This would schedule ${maxAfter} consecutive days (override required)`,
          consecutiveDaysBefore: maxBefore,
          consecutiveDaysAfter: maxAfter,
          endDate: streakEnd,
        })
        suggestions.push({ code: 'manager_override_required' })
      } else if (maxAfter >= CONSECUTIVE_DAYS_WARNING) {
        violations.push({
          code: 'overtime_consecutive_warning',
          severity: 'warning',
          message: `This would schedule ${maxAfter} consecutive days`,
          consecutiveDaysBefore: maxBefore,
          consecutiveDaysAfter: maxAfter,
          endDate: streakEnd,
        })
      }

      overtime = {
        timeZone: staffTimeZone,
        weekStart: weekStartYmd,
        weeklyHoursBefore,
        weeklyHoursAfter,
        daily,
        consecutiveDaysBefore: maxBefore,
        consecutiveDaysAfter: maxAfter,
      }
    }
  }

  const valid = violations.every((v) => v.severity !== 'block')
  return { valid, violations, suggestions, overtime }
}

module.exports = { validateAssignmentCore }
