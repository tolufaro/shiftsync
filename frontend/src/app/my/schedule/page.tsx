'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState } from 'react'

import { getSocket } from '../../../lib/socket'
import { formatDayLabel, formatTimeRange } from '../../../lib/time'

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
    <div className="container" style={{ maxWidth: 960 }}>
      <div className="rowBetween">
        <h1 className="pageTitle" style={{ margin: 0 }}>
          My Schedule
        </h1>
        <Link href="/" className="btn">
          Home
        </Link>
      </div>

      <div className="card" style={{ marginTop: 12 }}>
        <div className="cardBody rowBetween" style={{ alignItems: 'center' }}>
          <div className="muted">Shift times are displayed in each location’s timezone.</div>
          <span className="badge">Timezone-aware</span>
        </div>
      </div>

      {error ? (
        <div className="card" style={{ marginTop: 12, borderColor: 'color-mix(in srgb, var(--danger) 35%, var(--border))' }}>
          <div className="cardBody" style={{ color: 'var(--danger)' }}>
            {error}
          </div>
        </div>
      ) : null}

      <div style={{ marginTop: 16 }} className="row">
        <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <span>Week start</span>
          <input
            type="date"
            value={weekStart}
            onChange={(e) => setWeekStart(e.target.value)}
            className="input"
            style={{ width: 200 }}
          />
        </label>
        <button onClick={load} className="btn">
          Refresh
        </button>
      </div>

      {loading ? (
        <div style={{ marginTop: 12 }} className="muted">
          Loading...
        </div>
      ) : null}

      {!loading ? (
        <div style={{ marginTop: 16 }} className="stack">
          {shifts.map((s) => (
            <div key={s.assignmentId} className="card">
              <div className="cardBody">
                <div className="rowBetween">
                  <div style={{ fontWeight: 800 }}>{formatDayLabel(s.startAt, s.location.timezone)}</div>
                  <span className={`badge ${s.status === 'published' ? 'badgeSuccess' : ''}`}>{s.status}</span>
                </div>
                <div style={{ marginTop: 6 }}>
                  <div style={{ fontSize: 18, fontWeight: 800 }}>{formatTimeRange(s.startAt, s.endAt, s.location.timezone)}</div>
                  <div style={{ marginTop: 4 }}>
                    Location: <strong>{s.location.name}</strong> <span className="muted">({s.location.timezone})</span>
                  </div>
                  {s.requiredSkillName ? <div>Role: {s.requiredSkillName}</div> : null}
                  <div className="muted">Assignment: {s.assignmentStatus}</div>
                </div>
              </div>
            </div>
          ))}
          {shifts.length === 0 ? <div className="muted">No shifts this week.</div> : null}
        </div>
      ) : null}
    </div>
  )
}
