function parseYmd(ymd) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd)
  if (!m) return null
  return { y: Number(m[1]), mo: Number(m[2]), d: Number(m[3]) }
}

function addDaysYmd(ymd, days) {
  const p = parseYmd(ymd)
  if (!p) return null
  const dt = new Date(Date.UTC(p.y, p.mo - 1, p.d + days))
  return dt.toISOString().slice(0, 10)
}

function ymdFromParts(parts) {
  const y = parts.year
  const m = parts.month
  const d = parts.day
  if (!y || !m || !d) return null
  return `${y}-${m}-${d}`
}

function localYmd(date, timeZone) {
  const fmt = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' })
  const parts = fmt.formatToParts(date)
  const map = {}
  for (const p of parts) map[p.type] = p.value
  return ymdFromParts(map)
}

function localDayOfWeek(date, timeZone) {
  const fmt = new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short' })
  const w = fmt.format(date)
  const weekdayMap = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }
  return weekdayMap[w]
}

function localMinutes(date, timeZone) {
  const fmt = new Intl.DateTimeFormat('en-US', { timeZone, hour12: false, hour: '2-digit', minute: '2-digit' })
  const parts = fmt.formatToParts(date)
  const map = {}
  for (const p of parts) map[p.type] = p.value
  const hour = Number(map.hour)
  const minute = Number(map.minute)
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null
  return hour * 60 + minute
}

function segmentsForInterval(startAt, endAt, timeZone) {
  const start = startAt instanceof Date ? startAt : new Date(startAt)
  const end = endAt instanceof Date ? endAt : new Date(endAt)
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null
  if (!(end > start)) return null

  const startYmd = localYmd(start, timeZone)
  const endYmd = localYmd(new Date(end.getTime() - 1), timeZone)
  if (!startYmd || !endYmd) return null

  const segments = []
  let cursorYmd = startYmd
  for (let guard = 0; guard < 14; guard++) {
    const dayStartMin = cursorYmd === startYmd ? localMinutes(start, timeZone) : 0
    const dayEndMin = cursorYmd === endYmd ? (localMinutes(new Date(end.getTime() - 1), timeZone) ?? 0) + 1 : 1440
    const dow = cursorYmd === startYmd ? localDayOfWeek(start, timeZone) : localDayOfWeek(new Date(start.getTime() + guard * 86400000), timeZone)
    segments.push({ ymd: cursorYmd, dayOfWeek: dow, startMin: dayStartMin ?? 0, endMin: dayEndMin })
    if (cursorYmd === endYmd) break
    const next = addDaysYmd(cursorYmd, 1)
    if (!next) return null
    cursorYmd = next
  }

  return segments
}

function minutesForYmd(shifts, timeZone, ymd) {
  let minutes = 0
  for (const s of shifts) {
    const segments = segmentsForInterval(s.startAt, s.endAt, timeZone)
    if (!segments) continue
    for (const seg of segments) {
      if (seg.ymd !== ymd) continue
      minutes += Math.max(0, seg.endMin - seg.startMin)
    }
  }
  return minutes
}

function getDailyHours(shifts, dateYmd, timeZone) {
  const minutes = minutesForYmd(shifts, timeZone, dateYmd)
  return minutes / 60
}

function getWeeklyHours(shifts, weekStartYmd, timeZone) {
  let minutes = 0
  for (let i = 0; i < 7; i++) {
    const ymd = addDaysYmd(weekStartYmd, i)
    if (!ymd) continue
    minutes += minutesForYmd(shifts, timeZone, ymd)
  }
  return minutes / 60
}

function workedDatesSet(shifts, timeZone) {
  const set = new Set()
  for (const s of shifts) {
    const segments = segmentsForInterval(s.startAt, s.endAt, timeZone)
    if (!segments) continue
    for (const seg of segments) {
      if (seg.endMin > seg.startMin) set.add(seg.ymd)
    }
  }
  return set
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

function getConsecutiveDays(shifts, weekStartYmd, timeZone) {
  const dates = workedDatesSet(shifts, timeZone)
  let max = 0
  for (let i = 0; i < 7; i++) {
    const ymd = addDaysYmd(weekStartYmd, i)
    if (!ymd) continue
    const streak = consecutiveDaysEndingOn(dates, ymd)
    if (streak > max) max = streak
  }
  return max
}

module.exports = { getWeeklyHours, getDailyHours, getConsecutiveDays, addDaysYmd, localYmd, segmentsForInterval, consecutiveDaysEndingOn }

