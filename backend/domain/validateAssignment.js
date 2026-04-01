const TEN_HOURS_MS = 10 * 60 * 60 * 1000

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

function dayIndexUtcFromYmd(ymd) {
  const p = parseYmd(ymd)
  if (!p) return null
  return Math.floor(Date.UTC(p.y, p.mo - 1, p.d) / 86400000)
}

function ymdFromParts(parts) {
  const y = parts.year
  const m = parts.month
  const d = parts.day
  if (!y || !m || !d) return null
  return `${y}-${m}-${d}`
}

function localInfo(date, timeZone) {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    hour12: false,
    weekday: 'short',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })

  const parts = fmt.formatToParts(date)
  const map = {}
  for (const p of parts) {
    map[p.type] = p.value
  }

  const ymd = ymdFromParts(map)
  if (!ymd) return null

  const weekdayShort = map.weekday
  const hour = Number(map.hour)
  const minute = Number(map.minute)
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null

  const weekdayMap = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }
  const dayOfWeek = weekdayMap[weekdayShort]
  if (dayOfWeek === undefined) return null

  return { ymd, dayOfWeek, minutes: hour * 60 + minute }
}

function toMinutes(time) {
  if (!time || typeof time !== 'string') return null
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(time)
  if (!m) return null
  return Number(m[1]) * 60 + Number(m[2])
}

function getSegmentsForShift(shiftStartAt, shiftEndAt, timeZone) {
  const startInfo = localInfo(shiftStartAt, timeZone)
  const endInfo = localInfo(new Date(shiftEndAt.getTime() - 1), timeZone)
  if (!startInfo || !endInfo) return null

  const startDayIndex = dayIndexUtcFromYmd(startInfo.ymd)
  const endDayIndex = dayIndexUtcFromYmd(endInfo.ymd)
  if (startDayIndex === null || endDayIndex === null) return null

  const segments = []
  for (let di = startDayIndex; di <= endDayIndex; di++) {
    const p = parseYmd(di === startDayIndex ? startInfo.ymd : endInfo.ymd)
    if (!p) return null
  }

  if (endDayIndex - startDayIndex > 7) return null

  function addDaysYmd(ymd, days) {
    const p = parseYmd(ymd)
    if (!p) return null
    const dt = new Date(Date.UTC(p.y, p.mo - 1, p.d + days))
    return dt.toISOString().slice(0, 10)
  }

  const dayCount = endDayIndex - startDayIndex
  for (let offset = 0; offset <= dayCount; offset++) {
    const ymd = addDaysYmd(startInfo.ymd, offset)
    if (!ymd) return null
    const dayStart = offset === 0 ? startInfo.minutes : 0
    const dayEnd = offset === dayCount ? endInfo.minutes + 1 : 1440
    const info = localInfo(new Date(shiftStartAt.getTime() + offset * 86400000), timeZone)
    const dayOfWeek = info ? info.dayOfWeek : null
    segments.push({ ymd, dayOfWeek, startMin: dayStart, endMin: dayEnd })
  }

  return segments
}

function windowsForDate(ymd, dayOfWeek, recurringWindows, exceptions) {
  const dateExceptions = exceptions.filter((e) => e.date === ymd)
  const unavail = dateExceptions.some((e) => e.type === 'unavailable')
  if (unavail) return []

  const custom = dateExceptions.filter((e) => e.type === 'custom')
  if (custom.length) {
    return custom
      .map((e) => {
        const s = toMinutes(e.startTime)
        const en = toMinutes(e.endTime)
        if (s === null || en === null) return null
        return { startMin: s, endMin: en }
      })
      .filter(Boolean)
  }

  return recurringWindows
    .filter((w) => w.dayOfWeek === dayOfWeek)
    .map((w) => {
      const s = toMinutes(w.startTime)
      const en = toMinutes(w.endTime)
      if (s === null || en === null) return null
      return { startMin: s, endMin: en }
    })
    .filter(Boolean)
}

function isSegmentCovered(segment, windows) {
  for (const w of windows) {
    if (segment.startMin >= w.startMin && segment.endMin <= w.endMin) return true
  }
  return false
}

function validateAssignmentCore(input) {
  const violations = []
  const suggestions = []

  const shiftStart = new Date(input.shift.startAt)
  const shiftEnd = new Date(input.shift.endAt)
  if (Number.isNaN(shiftStart.getTime()) || Number.isNaN(shiftEnd.getTime())) {
    return { valid: false, violations: [{ code: 'invalid_shift_time' }], suggestions: [] }
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
    violations.push({ code: 'double_book', conflicts })
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
    violations.push({ code: 'min_rest_10h', gaps })
    suggestions.push({ code: 'pick_shift_with_more_rest' })
  }

  const requiredSkillId = input.shift.requiredSkillId
  if (requiredSkillId) {
    const hasSkill = (input.staffSkills || []).includes(requiredSkillId)
    if (!hasSkill) {
      violations.push({ code: 'skill_mismatch', requiredSkillId })
      suggestions.push({ code: 'assign_skill_to_staff', requiredSkillId })
    }
  }

  const locationId = input.shift.locationId
  if (locationId) {
    const hasLocation = (input.staffLocationIds || []).includes(locationId)
    if (!hasLocation) {
      violations.push({ code: 'location_not_certified', locationId })
      suggestions.push({ code: 'assign_staff_to_location', locationId })
    }
  }

  const timeZone = input.shift.locationTimeZone
  if (!timeZone) {
    violations.push({ code: 'missing_location_timezone' })
  } else {
    const segments = getSegmentsForShift(shiftStart, shiftEnd, timeZone)
    if (!segments) {
      violations.push({ code: 'availability_check_failed' })
    } else {
      const recurring = input.availability?.windows || []
      const exceptions = input.availability?.exceptions || []

      const uncovered = []
      for (const seg of segments) {
        if (seg.dayOfWeek === null || seg.dayOfWeek === undefined) {
          uncovered.push({ date: seg.ymd })
          continue
        }
        const wins = windowsForDate(seg.ymd, seg.dayOfWeek, recurring, exceptions)
        if (!isSegmentCovered(seg, wins)) {
          uncovered.push({ date: seg.ymd, dayOfWeek: seg.dayOfWeek, startTime: seg.startMin, endTime: seg.endMin })
        }
      }

      if (uncovered.length) {
        violations.push({ code: 'outside_availability', uncovered })
        suggestions.push({ code: 'update_availability' })
      }
    }
  }

  return { valid: violations.length === 0, violations, suggestions }
}

module.exports = { validateAssignmentCore }

