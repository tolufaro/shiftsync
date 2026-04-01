'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState } from 'react'

type UserRole = 'admin' | 'manager' | 'staff'
type Me = { id: string; email: string; role: UserRole }

type Location = { id: string; name: string; timezone: string; address?: string | null }

type Assignment = { assignmentId: string; staffId: string; email: string; name: string | null; status: string }

type Shift = {
  id: string
  startAt: string
  endAt: string
  status: 'draft' | 'published'
  headcountNeeded: number
  requiredSkillName: string | null
  assignments: Assignment[]
}

type StaffRow = { id: string; email: string; name: string | null; role: string }

type AssignmentValidation = { valid: boolean; violations: { code: string }[]; suggestions?: unknown[] }
type AlternativeStaff = { id: string; email: string; name: string | null }
type AssignFeedback =
  | { ok: true }
  | { ok: false; message: string; validation?: AssignmentValidation; alternatives?: AlternativeStaff[] }

function toYmd(date: Date) {
  return date.toISOString().slice(0, 10)
}

function addDaysYmd(ymd: string, days: number) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd)
  if (!m) return ymd
  const y = Number(m[1])
  const mo = Number(m[2])
  const d = Number(m[3])
  const dt = new Date(Date.UTC(y, mo - 1, d + days))
  return dt.toISOString().slice(0, 10)
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

function formatDayLabel(date: Date, timeZone: string) {
  const fmt = new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short', month: 'short', day: 'numeric' })
  return fmt.format(date)
}

export default function ManagerSchedulePage() {
  const apiUrl = useMemo(() => process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001', [])
  const [me, setMe] = useState<Me | null>(null)

  const [locations, setLocations] = useState<Location[]>([])
  const [locationId, setLocationId] = useState<string>('')
  const [weekStart, setWeekStart] = useState<string>(() => toYmd(startOfWeekMonday(new Date())))

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [location, setLocation] = useState<Location | null>(null)
  const [shifts, setShifts] = useState<Shift[]>([])

  const [staff, setStaff] = useState<StaffRow[]>([])
  const [staffLoading, setStaffLoading] = useState(false)

  const [assignSelection, setAssignSelection] = useState<Record<string, string>>({})
  const [assignFeedback, setAssignFeedback] = useState<Record<string, AssignFeedback>>({})

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

  const loadBase = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const meData = await fetchJson<{ user: Me }>('/auth/me')
      setMe(meData.user)
      if (meData.user.role !== 'admin' && meData.user.role !== 'manager') {
        setError('Manager access required')
        setLocations([])
        return
      }

      const locData = await fetchJson<{ locations: Location[] }>('/locations')
      setLocations(locData.locations)
      if (!locationId && locData.locations.length) setLocationId(locData.locations[0].id)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load')
    } finally {
      setLoading(false)
    }
  }, [fetchJson, locationId])

  const loadSchedule = useCallback(async () => {
    if (!locationId || !weekStart) return
    setLoading(true)
    setError(null)
    try {
      const data = await fetchJson<{ location: Location; shifts: Shift[] }>(
        `/schedule/manager?locationId=${encodeURIComponent(locationId)}&weekStart=${encodeURIComponent(weekStart)}`,
      )
      setLocation(data.location)
      setShifts(data.shifts)
      setAssignFeedback({})
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load schedule')
    } finally {
      setLoading(false)
    }
  }, [fetchJson, locationId, weekStart])

  const loadStaff = useCallback(async () => {
    if (!locationId) return
    setStaffLoading(true)
    setError(null)
    try {
      const data = await fetchJson<{ staff: StaffRow[] }>(`/locations/${locationId}/staff`)
      setStaff(data.staff)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load staff')
    } finally {
      setStaffLoading(false)
    }
  }, [fetchJson, locationId])

  useEffect(() => {
    loadBase()
  }, [loadBase])

  useEffect(() => {
    loadSchedule()
  }, [loadSchedule])

  useEffect(() => {
    loadStaff()
  }, [loadStaff])

  const days = useMemo(() => {
    return Array.from({ length: 7 }, (_, i) => addDaysYmd(weekStart, i))
  }, [weekStart])

  const shiftsByDay = useMemo(() => {
    const map: Record<string, Shift[]> = {}
    const tz = location?.timezone || 'UTC'
    const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' })
    for (const s of shifts) {
      const k = fmt.format(new Date(s.startAt))
      map[k] = map[k] || []
      map[k].push(s)
    }
    return map
  }, [shifts, location?.timezone])

  async function toggleStatus(shift: Shift) {
    setError(null)
    try {
      const next = shift.status === 'draft' ? 'published' : 'draft'
      await fetchJson(`/shifts/${shift.id}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: next }),
      })
      await loadSchedule()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Status update failed')
    }
  }

  async function assign(shiftId: string) {
    const staffId = assignSelection[shiftId]
    if (!staffId) return
    setError(null)
    const res = await fetch(`${apiUrl}/shifts/${shiftId}/assign`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ staffId }),
    })
    const data = await res.json().catch(() => null)
    if (res.ok) {
      setAssignFeedback((prev) => ({ ...prev, [shiftId]: { ok: true } }))
      await loadSchedule()
      return
    }

    const message = data?.error ? String(data.error) : `Assign failed (${res.status})`
    setAssignFeedback((prev) => ({
      ...prev,
      [shiftId]: { ok: false, message, validation: data?.validation, alternatives: data?.alternatives },
    }))
  }

  return (
    <div style={{ maxWidth: 1200, margin: '40px auto', padding: 16 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12 }}>
        <h1 style={{ margin: 0 }}>Manager Schedule</h1>
        <Link href="/">Home</Link>
      </div>

      {me ? <div style={{ marginTop: 8, color: '#555' }}>Signed in as {me.email}</div> : null}
      {error ? <div style={{ marginTop: 12, color: '#b00020' }}>{error}</div> : null}

      <div style={{ marginTop: 16, display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
        <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <span>Location</span>
          <select
            value={locationId}
            onChange={(e) => setLocationId(e.target.value)}
            style={{ padding: 10, borderRadius: 8, border: '1px solid #ccc' }}
          >
            {locations.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        </label>

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
          onClick={loadSchedule}
          style={{ padding: '10px 12px', borderRadius: 8, border: '1px solid #111', background: '#fff', cursor: 'pointer' }}
        >
          Refresh
        </button>

        <div style={{ color: '#555' }}>
          {location ? (
            <span>
              Timezone: <strong>{location.timezone}</strong>
            </span>
          ) : null}
        </div>
        <div style={{ color: '#555' }}>{staffLoading ? 'Loading staff...' : null}</div>
      </div>

      {loading ? <div style={{ marginTop: 12 }}>Loading...</div> : null}

      {!loading && location ? (
        <div style={{ marginTop: 16, border: '1px solid #e5e5e5', borderRadius: 12, overflow: 'hidden' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', borderBottom: '1px solid #eee' }}>
            {days.map((ymd) => (
              <div key={ymd} style={{ padding: 10, fontWeight: 600, background: '#fafafa' }}>
                {formatDayLabel(new Date(`${ymd}T12:00:00.000Z`), location.timezone)}
              </div>
            ))}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)' }}>
            {days.map((dayKey) => {
              const dayShifts = shiftsByDay[dayKey] || []
              return (
                <div key={dayKey} style={{ minHeight: 180, padding: 10, borderRight: '1px solid #eee' }}>
                  {dayShifts.map((s) => {
                    const bg = s.status === 'published' ? '#e6f7ee' : '#f3f3f3'
                    const border = s.status === 'published' ? '#3aa76d' : '#bbb'
                    const fb = assignFeedback[s.id]
                    return (
                      <div
                        key={s.id}
                        style={{
                          padding: 10,
                          borderRadius: 10,
                          border: `1px solid ${border}`,
                          background: bg,
                          marginBottom: 10,
                        }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
                          <div style={{ fontWeight: 700 }}>{formatTimeRange(s.startAt, s.endAt, location.timezone)}</div>
                          <button
                            onClick={() => toggleStatus(s)}
                            style={{
                              padding: '6px 8px',
                              borderRadius: 8,
                              border: '1px solid #111',
                              background: '#fff',
                              cursor: 'pointer',
                              height: 32,
                            }}
                          >
                            {s.status === 'draft' ? 'Publish' : 'Unpublish'}
                          </button>
                        </div>

                        <div style={{ marginTop: 6, color: '#333' }}>
                          {s.requiredSkillName ? <div>Skill: {s.requiredSkillName}</div> : null}
                          <div>
                            Headcount: {s.assignments.length}/{s.headcountNeeded}
                          </div>
                        </div>

                        <div style={{ marginTop: 8 }}>
                          <div style={{ fontWeight: 600, marginBottom: 4 }}>Assigned</div>
                          {s.assignments.length ? (
                            <div style={{ display: 'grid', gap: 4 }}>
                              {s.assignments.map((a) => (
                                <div key={a.assignmentId} style={{ color: '#222' }}>
                                  {(a.name || a.email) + (a.status !== 'active' ? ` (${a.status})` : '')}
                                </div>
                              ))}
                            </div>
                          ) : (
                            <div style={{ color: '#555' }}>None</div>
                          )}
                        </div>

                        <div style={{ marginTop: 10, display: 'grid', gap: 8 }}>
                          <select
                            value={assignSelection[s.id] || ''}
                            onChange={(e) => setAssignSelection((prev) => ({ ...prev, [s.id]: e.target.value }))}
                            style={{ padding: 8, borderRadius: 8, border: '1px solid #ccc' }}
                          >
                            <option value="">Assign staff...</option>
                            {staff.map((st) => (
                              <option key={st.id} value={st.id}>
                                {st.name ? `${st.name} (${st.email})` : st.email}
                              </option>
                            ))}
                          </select>
                          <button
                            onClick={() => assign(s.id)}
                            style={{
                              padding: '8px 10px',
                              borderRadius: 8,
                              border: '1px solid #111',
                              background: '#111',
                              color: '#fff',
                              cursor: 'pointer',
                            }}
                          >
                            Assign
                          </button>
                        </div>

                        {fb ? (
                          <div style={{ marginTop: 10 }}>
                            {fb.ok ? <div style={{ color: '#0b6b2b' }}>Assigned</div> : null}
                            {!fb.ok ? <div style={{ color: '#b00020' }}>{fb.message}</div> : null}
                            {!fb.ok && fb.validation?.violations?.length ? (
                              <div style={{ marginTop: 6, color: '#555' }}>
                                Violations: {fb.validation.violations.map((v) => v.code).join(', ')}
                              </div>
                            ) : null}
                            {!fb.ok && fb.alternatives?.length ? (
                              <div style={{ marginTop: 6, color: '#555' }}>
                                Alternatives: {fb.alternatives.map((a) => a.name || a.email).join(', ')}
                              </div>
                            ) : null}
                          </div>
                        ) : null}
                      </div>
                    )
                  })}
                  {dayShifts.length === 0 ? <div style={{ color: '#777' }}>No shifts</div> : null}
                </div>
              )
            })}
          </div>
        </div>
      ) : null}
    </div>
  )
}
