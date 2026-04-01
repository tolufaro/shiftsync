'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState } from 'react'

import { getSocket } from '../../../lib/socket'

type ShiftRow = {
  id: string
  assignmentId: string
  assignmentStatus: string
  location: { id: string; name: string; timezone: string }
  requiredSkillName: string | null
  startAt: string
  endAt: string
  status: 'draft' | 'published'
}

function toYmd(date: Date) {
  return date.toISOString().slice(0, 10)
}

function startOfWeekMonday(date: Date) {
  const d = new Date(date)
  const day = d.getUTCDay()
  const diff = (day + 6) % 7
  d.setUTCDate(d.getUTCDate() - diff)
  d.setUTCHours(0, 0, 0, 0)
  return d
}

function formatTimeRange(startAt: string, endAt: string, timeZone: string) {
  const fmt = new Intl.DateTimeFormat('en-US', { timeZone, hour: 'numeric', minute: '2-digit' })
  return `${fmt.format(new Date(startAt))}–${fmt.format(new Date(endAt))}`
}

function formatDate(startAt: string, timeZone: string) {
  const fmt = new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short', month: 'short', day: 'numeric' })
  return fmt.format(new Date(startAt))
}

export default function MySchedulePage() {
  const apiUrl = useMemo(() => process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001', [])
  const [weekStart, setWeekStart] = useState(() => toYmd(startOfWeekMonday(new Date())))
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [shifts, setShifts] = useState<ShiftRow[]>([])

  const fetchJson = useCallback(
    async <T,>(path: string, init?: RequestInit) => {
      const res = await fetch(`${apiUrl}${path}`, { ...init, credentials: 'include' })
      const data = await res.json().catch(() => null)
      if (!res.ok) {
        const message = data?.error ? String(data.error) : `Request failed (${res.status})`
        throw new Error(message)
      }
      return data as T
    },
    [apiUrl],
  )

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await fetchJson<{ shifts: ShiftRow[] }>(`/schedule/me?weekStart=${encodeURIComponent(weekStart)}`)
      setShifts(data.shifts)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load')
    } finally {
      setLoading(false)
    }
  }, [fetchJson, weekStart])

  useEffect(() => {
    load()
  }, [load])

  useEffect(() => {
    const socket = getSocket(apiUrl)
    function onScheduleUpdated() {
      load()
    }
    socket.on('schedule:updated', onScheduleUpdated)
    socket.on('assignment:new', onScheduleUpdated)
    return () => {
      socket.off('schedule:updated', onScheduleUpdated)
      socket.off('assignment:new', onScheduleUpdated)
    }
  }, [apiUrl, load])

  return (
    <div style={{ maxWidth: 900, margin: '40px auto', padding: 16 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12 }}>
        <h1 style={{ margin: 0 }}>My Schedule</h1>
        <Link href="/">Home</Link>
      </div>

      {error ? <div style={{ marginTop: 12, color: '#b00020' }}>{error}</div> : null}

      <div style={{ marginTop: 16, display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
        <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <span>Week start</span>
          <input
            type="date"
            value={weekStart}
            onChange={(e) => setWeekStart(e.target.value)}
            style={{ padding: 10, borderRadius: 8, border: '1px solid #ccc' }}
          />
        </label>
        <button
          onClick={load}
          style={{ padding: '10px 12px', borderRadius: 8, border: '1px solid #111', background: '#fff', cursor: 'pointer' }}
        >
          Refresh
        </button>
      </div>

      {loading ? <div style={{ marginTop: 12 }}>Loading...</div> : null}

      {!loading ? (
        <div style={{ marginTop: 16, display: 'grid', gap: 10 }}>
          {shifts.map((s) => (
            <div key={s.assignmentId} style={{ padding: 12, border: '1px solid #e5e5e5', borderRadius: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                <div style={{ fontWeight: 700 }}>{formatDate(s.startAt, s.location.timezone)}</div>
                <div style={{ color: s.status === 'published' ? '#0b6b2b' : '#555' }}>{s.status}</div>
              </div>
              <div style={{ marginTop: 6 }}>
                <div style={{ fontSize: 18, fontWeight: 700 }}>{formatTimeRange(s.startAt, s.endAt, s.location.timezone)}</div>
                <div style={{ marginTop: 4, color: '#333' }}>
                  Location: <strong>{s.location.name}</strong> <span style={{ color: '#666' }}>({s.location.timezone})</span>
                </div>
                {s.requiredSkillName ? <div style={{ color: '#333' }}>Role: {s.requiredSkillName}</div> : null}
                <div style={{ color: '#555' }}>Assignment: {s.assignmentStatus}</div>
              </div>
            </div>
          ))}
          {shifts.length === 0 ? <div style={{ color: '#555' }}>No shifts this week.</div> : null}
        </div>
      ) : null}
    </div>
  )
}
