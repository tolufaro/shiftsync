'use client'

import { differenceInCalendarDays } from 'date-fns'
import { formatInTimeZone, toZonedTime } from 'date-fns-tz'

export function localYmd(value: Date | string, timeZone: string) {
  const d = value instanceof Date ? value : new Date(value)
  return formatInTimeZone(d, timeZone, 'yyyy-MM-dd')
}

export function formatDayLabel(value: Date | string, timeZone: string) {
  const d = value instanceof Date ? value : new Date(value)
  return formatInTimeZone(d, timeZone, 'EEE MMM d')
}

export function formatTimeRange(startIso: string, endIso: string, timeZone: string) {
  const start = new Date(startIso)
  const end = new Date(endIso)

  const startText = formatInTimeZone(start, timeZone, 'h:mm a')
  const endText = formatInTimeZone(end, timeZone, 'h:mm a')

  const startZ = toZonedTime(start, timeZone)
  const endZ = toZonedTime(end, timeZone)
  const dayDiff = differenceInCalendarDays(endZ, startZ)

  const suffix = dayDiff > 0 ? ` (+${dayDiff})` : ''
  return `${startText}–${endText}${suffix}`
}

