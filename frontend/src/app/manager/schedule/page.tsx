'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState } from 'react'

import { getSocket } from '../../../lib/socket'
import { formatDayLabel, formatTimeRange, localYmd } from '../../../lib/time'

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

type ValidationViolation = { code: string; severity?: 'warning' | 'block'; message?: string; overrideable?: boolean }
type AssignmentValidation = { valid: boolean; violations: ValidationViolation[]; suggestions?: unknown[]; overtime?: unknown }
type AlternativeStaff = { id: string; email: string; name: string | null }
type AssignFeedback =
  | { ok: true }
  | { ok: false; message: string; validation?: AssignmentValidation; alternatives?: AlternativeStaff[] }

type OvertimePreview = { weeklyHoursBefore: number; weeklyHoursAfter: number; [key: string]: unknown }
type PreviewResponse = { valid: boolean; violations: ValidationViolation[]; suggestions: unknown[]; overtime: OvertimePreview | null }

type OnDutyRow = { staffId: string; email: string; name: string | null; shiftId: string; startAt: string; endAt: string }
type ScheduleUpdatedPayload = { locationId?: string; shiftId?: string; reason?: string }
type SwapUpdatedPayload = { locationId?: string; shiftId?: string; status?: string }

type ShiftHistoryEntry = {
  id: string
  createdAt: string
  action: string
  actor: { id: string; email: string; name: string | null } | null
  before: unknown
  after: unknown
}

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
  const [previewByShiftId, setPreviewByShiftId] = useState<Record<string, { staffId: string; data: PreviewResponse }>>({})
  const [overrideOpen, setOverrideOpen] = useState<{ shiftId: string; staffId: string } | null>(null)
  const [overrideReason, setOverrideReason] = useState('')
  const [overrideSubmitting, setOverrideSubmitting] = useState(false)

  const [onDuty, setOnDuty] = useState<OnDutyRow[]>([])

  const [historyShiftId, setHistoryShiftId] = useState<string | null>(null)
  const [historyLoading, setHistoryLoading] = useState(false)
  const [historyError, setHistoryError] = useState<string | null>(null)
  const [historyEntries, setHistoryEntries] = useState<ShiftHistoryEntry[]>([])

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

  const loadOnDuty = useCallback(async () => {
    if (!locationId) return
    try {
      const data = await fetchJson<{ staff: OnDutyRow[] }>(`/schedule/on-duty?locationId=${encodeURIComponent(locationId)}`)
      setOnDuty(data.staff)
    } catch {}
  }, [fetchJson, locationId])

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

  useEffect(() => {
    loadOnDuty()
    const t = setInterval(() => {
      loadOnDuty()
    }, 60000)
    return () => clearInterval(t)
  }, [loadOnDuty])

  useEffect(() => {
    const socket = getSocket(apiUrl)
    function onScheduleUpdated(payload: ScheduleUpdatedPayload) {
      const loc = payload?.locationId
      if (!loc || loc !== locationId) return
      loadSchedule()
      loadOnDuty()
    }
    function onSwapUpdated(payload: SwapUpdatedPayload) {
      const loc = payload?.locationId
      if (loc && loc === locationId) {
        loadOnDuty()
      }
    }
    function onAssignmentConflict() {
      setError('Assignment conflict detected. Refreshing schedule.')
      loadSchedule()
    }
    socket.on('schedule:updated', onScheduleUpdated)
    socket.on('swap:updated', onSwapUpdated)
    socket.on('assignment:conflict', onAssignmentConflict)
    return () => {
      socket.off('schedule:updated', onScheduleUpdated)
      socket.off('swap:updated', onSwapUpdated)
      socket.off('assignment:conflict', onAssignmentConflict)
    }
  }, [apiUrl, locationId, loadSchedule, loadOnDuty])

  const days = useMemo(() => {
    return Array.from({ length: 7 }, (_, i) => addDaysYmd(weekStart, i))
  }, [weekStart])

  const shiftsByDay = useMemo(() => {
    const map: Record<string, Shift[]> = {}
    const tz = location?.timezone || 'UTC'
    for (const s of shifts) {
      const k = localYmd(s.startAt, tz)
      map[k] = map[k] || []
      map[k].push(s)
    }
    return map
  }, [shifts, location?.timezone])

  const hoursByStaff = useMemo(() => {
    const map = new Map<string, number>()
    for (const st of staff) map.set(st.id, 0)
    for (const s of shifts) {
      const hours = (new Date(s.endAt).getTime() - new Date(s.startAt).getTime()) / 3600000
      for (const a of s.assignments) {
        if (a.status !== 'active') continue
        map.set(a.staffId, (map.get(a.staffId) || 0) + hours)
      }
    }
    return map
  }, [shifts, staff])

  const maxHours = useMemo(() => {
    let max = 0
    for (const v of hoursByStaff.values()) if (v > max) max = v
    return Math.max(40, max)
  }, [hoursByStaff])

  const loadPreview = useCallback(
    async (shiftId: string, staffId: string) => {
      if (!staffId) return
      try {
        const data = await fetchJson<PreviewResponse>(`/shifts/${shiftId}/preview?staffId=${encodeURIComponent(staffId)}`)
        setPreviewByShiftId((prev) => ({ ...prev, [shiftId]: { staffId, data } }))
      } catch {}
    },
    [fetchJson],
  )

  const loadHistory = useCallback(
    async (shiftId: string) => {
      setHistoryShiftId(shiftId)
      setHistoryLoading(true)
      setHistoryError(null)
      try {
        const data = await fetchJson<{ entries: ShiftHistoryEntry[] }>(`/shifts/${shiftId}/history`)
        setHistoryEntries(data.entries)
      } catch (e) {
        setHistoryEntries([])
        setHistoryError(e instanceof Error ? e.message : 'Failed to load history')
      } finally {
        setHistoryLoading(false)
      }
    },
    [fetchJson],
  )

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
    const validation = data?.validation as AssignmentValidation | undefined
    const alternatives = data?.alternatives as AlternativeStaff[] | undefined

    if (data?.error === 'constraint_violation' && validation?.violations?.length) {
      const blocks = validation.violations.filter((v) => v.severity === 'block')
      const canOverride = blocks.length > 0 && blocks.every((v) => v.overrideable)
      if (canOverride) {
        setOverrideOpen({ shiftId, staffId })
        setOverrideReason('')
        setAssignFeedback((prev) => ({ ...prev, [shiftId]: { ok: false, message, validation, alternatives } }))
        return
      }
    }

    setAssignFeedback((prev) => ({ ...prev, [shiftId]: { ok: false, message, validation, alternatives } }))
  }

  async function submitOverride() {
    if (!overrideOpen) return
    if (!overrideReason.trim()) return
    const { shiftId, staffId } = overrideOpen
    setOverrideSubmitting(true)
    setError(null)
    try {
      const res = await fetch(`${apiUrl}/shifts/${shiftId}/assign`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ staffId, overrideReason: overrideReason.trim() }),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok) {
        const message = data?.error ? String(data.error) : `Assign failed (${res.status})`
        setAssignFeedback((prev) => ({ ...prev, [shiftId]: { ok: false, message, validation: data?.validation, alternatives: data?.alternatives } }))
        return
      }
      setOverrideOpen(null)
      setAssignFeedback((prev) => ({ ...prev, [shiftId]: { ok: true } }))
      await loadSchedule()
    } finally {
      setOverrideSubmitting(false)
    }
  }

  return (
    <div className="container" style={{ maxWidth: 1200 }}>
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
        <div style={{ marginTop: 16, display: 'grid', gap: 16 }}>
          <div style={{ padding: 12, border: '1px solid #e5e5e5', borderRadius: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'baseline' }}>
              <h2 style={{ margin: 0 }}>On Duty Now</h2>
              <button
                onClick={loadOnDuty}
                style={{ padding: '8px 10px', borderRadius: 8, border: '1px solid #111', background: '#fff', cursor: 'pointer' }}
              >
                Refresh
              </button>
            </div>
            <div style={{ marginTop: 10, display: 'grid', gap: 6 }}>
              {onDuty.map((r) => (
                <div key={r.staffId} style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                  <div style={{ color: '#222' }}>{r.name || r.email}</div>
                  <div style={{ color: '#555' }}>{formatTimeRange(r.startAt, r.endAt, location.timezone)}</div>
                </div>
              ))}
              {onDuty.length === 0 ? <div style={{ color: '#777' }}>No one currently on duty.</div> : null}
            </div>
          </div>

          <div style={{ padding: 12, border: '1px solid #e5e5e5', borderRadius: 12 }}>
            <h2 style={{ margin: '0 0 10px 0' }}>Projected Weekly Hours</h2>
            <div style={{ display: 'grid', gap: 8 }}>
              {staff.map((st) => {
                const hours = hoursByStaff.get(st.id) || 0
                const pct = Math.min(100, (hours / maxHours) * 100)
                const color = hours >= 60 ? '#b00020' : hours >= 40 ? '#d07a00' : hours >= 38 ? '#b38900' : '#0b6b2b'
                return (
                  <div key={st.id} style={{ display: 'grid', gridTemplateColumns: '260px 1fr 60px', gap: 10, alignItems: 'center' }}>
                    <div style={{ color: '#222' }}>{st.name ? `${st.name} (${st.email})` : st.email}</div>
                    <div style={{ height: 10, background: '#eee', borderRadius: 999, overflow: 'hidden' }}>
                      <div style={{ width: `${pct}%`, height: '100%', background: color }} />
                    </div>
                    <div style={{ textAlign: 'right', color: '#333' }}>{hours.toFixed(1)}h</div>
                  </div>
                )
              })}
            </div>
          </div>

          <div style={{ border: '1px solid #e5e5e5', borderRadius: 12, overflow: 'hidden' }}>
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
                    const preview = previewByShiftId[s.id]
                    const previewMatches = preview && preview.staffId === (assignSelection[s.id] || '')
                    const overtime = previewMatches ? preview.data.overtime : null
                    const violations = previewMatches ? preview.data.violations : []
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
                          <div style={{ display: 'flex', gap: 8 }}>
                            <button
                              onClick={() => loadHistory(s.id)}
                              className="btn btnSmall"
                            >
                              History
                            </button>
                            <button
                              onClick={() => toggleStatus(s)}
                              className="btn btnSmall"
                            >
                              {s.status === 'draft' ? 'Publish' : 'Unpublish'}
                            </button>
                          </div>
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
                            onChange={(e) => {
                              const nextStaffId = e.target.value
                              setAssignSelection((prev) => ({ ...prev, [s.id]: nextStaffId }))
                              setAssignFeedback((prev) => ({ ...prev, [s.id]: prev[s.id] }))
                              if (nextStaffId) loadPreview(s.id, nextStaffId)
                            }}
                            className="select"
                            style={{ padding: 8 }}
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
                            className="btn btnPrimary"
                          >
                            Assign
                          </button>
                        </div>

                        {previewMatches ? (
                          <div style={{ marginTop: 10, padding: 10, borderRadius: 10, border: '1px solid #eee', background: '#fafafa' }}>
                            {overtime ? (
                              <div style={{ color: '#333' }}>
                                Weekly: {Number(overtime.weeklyHoursBefore).toFixed(1)}h → {Number(overtime.weeklyHoursAfter).toFixed(1)}h
                              </div>
                            ) : (
                              <div style={{ color: '#555' }}>Preview unavailable</div>
                            )}
                            {violations?.some((v) => v.severity === 'warning') ? (
                              <div style={{ marginTop: 4, color: '#b38900' }}>
                                {violations
                                  .filter((v) => v.severity === 'warning' && v.message)
                                  .map((v) => v.message)
                                  .join(' · ') || 'Near overtime'}
                              </div>
                            ) : null}
                            {violations?.some((v) => v.severity === 'block') ? (
                              <div style={{ marginTop: 4, color: '#b00020' }}>
                                {violations
                                  .filter((v) => v.severity === 'block' && v.message)
                                  .map((v) => v.message)
                                  .join(' · ') || 'Blocked'}
                              </div>
                            ) : null}
                          </div>
                        ) : null}

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
        </div>
      ) : null}

      {overrideOpen ? (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.4)',
            display: 'grid',
            placeItems: 'center',
            padding: 16,
            zIndex: 50,
          }}
        >
          <div style={{ width: '100%', maxWidth: 560, background: '#fff', borderRadius: 12, padding: 16 }}>
            <div style={{ fontSize: 18, fontWeight: 700 }}>Override Required (7th day)</div>
            <div style={{ marginTop: 6, color: '#555' }}>Provide a reason to approve this assignment.</div>
            <textarea
              value={overrideReason}
              onChange={(e) => setOverrideReason(e.target.value)}
              rows={4}
              style={{ marginTop: 12, width: '100%', padding: 10, borderRadius: 8, border: '1px solid #ccc' }}
            />
            <div style={{ marginTop: 12, display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button
                onClick={() => setOverrideOpen(null)}
                disabled={overrideSubmitting}
                style={{ padding: '10px 12px', borderRadius: 8, border: '1px solid #111', background: '#fff', cursor: 'pointer' }}
              >
                Cancel
              </button>
              <button
                onClick={submitOverride}
                disabled={overrideSubmitting || !overrideReason.trim()}
                style={{
                  padding: '10px 12px',
                  borderRadius: 8,
                  border: '1px solid #111',
                  background: '#111',
                  color: '#fff',
                  cursor: 'pointer',
                }}
              >
                {overrideSubmitting ? 'Submitting...' : 'Confirm Override'}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {historyShiftId ? (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.35)',
            display: 'grid',
            justifyItems: 'end',
            alignItems: 'stretch',
            padding: 0,
            zIndex: 40,
          }}
          onClick={() => setHistoryShiftId(null)}
        >
          <div
            style={{ width: '100%', maxWidth: 520, background: '#fff', padding: 16, overflowY: 'auto' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'baseline' }}>
              <div>
                <div style={{ fontSize: 18, fontWeight: 700 }}>Shift History</div>
                <div style={{ color: '#666' }}>{historyShiftId}</div>
              </div>
              <button
                onClick={() => setHistoryShiftId(null)}
                style={{ padding: '8px 10px', borderRadius: 8, border: '1px solid #111', background: '#fff', cursor: 'pointer' }}
              >
                Close
              </button>
            </div>

            {historyError ? <div style={{ marginTop: 10, color: '#b00020' }}>{historyError}</div> : null}
            {historyLoading ? <div style={{ marginTop: 10 }}>Loading...</div> : null}

            {!historyLoading ? (
              <div style={{ marginTop: 12, display: 'grid', gap: 10 }}>
                {historyEntries.map((e) => (
                  <div key={e.id} style={{ border: '1px solid #e5e5e5', borderRadius: 12, padding: 12 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'baseline' }}>
                      <div style={{ fontWeight: 700 }}>{e.action}</div>
                      <div style={{ color: '#666' }}>{new Date(e.createdAt).toLocaleString()}</div>
                    </div>
                    <div style={{ marginTop: 6, color: '#333' }}>
                      {e.actor ? (e.actor.name ? `${e.actor.name} (${e.actor.email})` : e.actor.email) : 'System'}
                    </div>
                    <div style={{ marginTop: 10, display: 'grid', gap: 10 }}>
                      <div>
                        <div style={{ fontWeight: 700, color: '#555' }}>Before</div>
                        <pre style={{ margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word', color: '#222' }}>
                          {e.before ? JSON.stringify(e.before, null, 2) : ''}
                        </pre>
                      </div>
                      <div>
                        <div style={{ fontWeight: 700, color: '#555' }}>After</div>
                        <pre style={{ margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word', color: '#222' }}>
                          {e.after ? JSON.stringify(e.after, null, 2) : ''}
                        </pre>
                      </div>
                    </div>
                  </div>
                ))}
                {historyEntries.length === 0 ? <div style={{ color: '#666' }}>No audit entries.</div> : null}
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  )
}
