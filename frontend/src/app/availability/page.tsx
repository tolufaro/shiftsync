'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState } from 'react'

type AvailabilityWindow = {
  id: string
  dayOfWeek: number
  startTime: string
  endTime: string
  isRecurring: boolean
}

type AvailabilityException = {
  id: string
  date: string
  type: 'unavailable' | 'custom'
  startTime: string | null
  endTime: string | null
}

type Me = { id: string; email: string; role?: string }
type ProfileUser = { homeTimeZone: string }

const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

export default function AvailabilityPage() {
  const apiUrl = useMemo(() => process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001', [])

  const [me, setMe] = useState<Me | null>(null)
  const [homeTimeZone, setHomeTimeZone] = useState<string>('UTC')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [weekly, setWeekly] = useState<{ enabled: boolean; startTime: string; endTime: string }[]>(
    Array.from({ length: 7 }, () => ({ enabled: false, startTime: '09:00', endTime: '17:00' })),
  )
  const [exceptions, setExceptions] = useState<AvailabilityException[]>([])

  const [exDate, setExDate] = useState('')
  const [exType, setExType] = useState<'unavailable' | 'custom'>('unavailable')
  const [exStart, setExStart] = useState('10:00')
  const [exEnd, setExEnd] = useState('14:00')

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
      const [meData, profileData, data] = await Promise.all([
        fetchJson<{ user: Me }>('/auth/me'),
        fetchJson<{ user: ProfileUser }>('/me/profile'),
        fetchJson<{ windows: AvailabilityWindow[]; exceptions: AvailabilityException[] }>('/me/availability'),
      ])
      setMe(meData.user)
      setHomeTimeZone(profileData.user.homeTimeZone || 'UTC')

      const nextWeekly = Array.from({ length: 7 }, () => ({ enabled: false, startTime: '09:00', endTime: '17:00' }))
      for (const w of data.windows) {
        const d = Number(w.dayOfWeek)
        if (d < 0 || d > 6) continue
        nextWeekly[d] = { enabled: true, startTime: w.startTime, endTime: w.endTime }
      }
      setWeekly(nextWeekly)
      setExceptions(data.exceptions)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load')
    } finally {
      setLoading(false)
    }
  }, [fetchJson])

  useEffect(() => {
    load()
  }, [load])

  async function saveWeekly() {
    setError(null)
    try {
      const windows = weekly
        .map((w, dayOfWeek) => ({ ...w, dayOfWeek }))
        .filter((w) => w.enabled)
        .map((w) => ({ dayOfWeek: w.dayOfWeek, startTime: w.startTime, endTime: w.endTime, isRecurring: true }))

      await fetchJson('/me/availability/windows', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ windows }),
      })
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed')
    }
  }

  async function addException(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    try {
      const payload: Record<string, unknown> = { date: exDate, type: exType }
      if (exType === 'custom') {
        payload.startTime = exStart
        payload.endTime = exEnd
      }
      await fetchJson('/me/availability/exceptions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      setExDate('')
      setExType('unavailable')
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed')
    }
  }

  async function removeException(id: string) {
    setError(null)
    try {
      await fetchJson(`/me/availability/exceptions/${id}`, { method: 'DELETE' })
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Delete failed')
    }
  }

  return (
    <div className="container" style={{ maxWidth: 1000 }}>
      <div className="rowBetween">
        <h1 className="pageTitle" style={{ margin: 0 }}>
          Availability
        </h1>
        <Link href="/" className="btn">
          Home
        </Link>
      </div>

      {me ? (
        <div style={{ marginTop: 10 }} className="row">
          <span className="badge">Staff</span>
          <span className="muted">Signed in as {me.email}</span>
        </div>
      ) : null}

      <div className="card" style={{ marginTop: 14 }}>
        <div className="cardBody rowBetween" style={{ alignItems: 'center' }}>
          <div className="muted">
            Availability times are interpreted in your home timezone: <strong>{homeTimeZone}</strong>.
          </div>
          <Link href="/settings/timezone" className="btn btnSmall">
            Change timezone
          </Link>
        </div>
      </div>

      {error ? (
        <div className="card" style={{ marginTop: 12, borderColor: 'color-mix(in srgb, var(--danger) 35%, var(--border))' }}>
          <div className="cardBody" style={{ color: 'var(--danger)' }}>
            {error}
          </div>
        </div>
      ) : null}
      {loading ? (
        <div className="muted" style={{ marginTop: 12 }}>
          Loading...
        </div>
      ) : null}

      {!loading ? (
        <div className="stack" style={{ marginTop: 16 }}>
          <div className="card">
            <div className="cardBody">
              <div className="rowBetween">
                <h2 style={{ margin: 0 }}>Weekly Recurring Availability</h2>
                <button onClick={saveWeekly} className="btn btnPrimary">
                  Save Weekly
                </button>
              </div>

              <div className="muted" style={{ marginTop: 8 }}>
                Overnight windows are allowed (e.g. 22:00–06:00).
              </div>

              <div style={{ marginTop: 12, display: 'grid', gap: 10 }}>
                {weekly.map((w, i) => (
                  <div key={i} style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
                    <label style={{ display: 'flex', gap: 10, alignItems: 'center', minWidth: 90 }}>
                      <input
                        type="checkbox"
                        checked={w.enabled}
                        onChange={(e) =>
                          setWeekly((prev) => {
                            const next = prev.slice()
                            next[i] = { ...next[i], enabled: e.target.checked }
                            return next
                          })
                        }
                      />
                      <span style={{ fontWeight: 800 }}>{dayNames[i]}</span>
                    </label>
                    <input
                      type="time"
                      value={w.startTime}
                      disabled={!w.enabled}
                      onChange={(e) =>
                        setWeekly((prev) => {
                          const next = prev.slice()
                          next[i] = { ...next[i], startTime: e.target.value }
                          return next
                        })
                      }
                      className="input"
                      style={{ width: 160, opacity: w.enabled ? 1 : 0.6 }}
                    />
                    <input
                      type="time"
                      value={w.endTime}
                      disabled={!w.enabled}
                      onChange={(e) =>
                        setWeekly((prev) => {
                          const next = prev.slice()
                          next[i] = { ...next[i], endTime: e.target.value }
                          return next
                        })
                      }
                      className="input"
                      style={{ width: 160, opacity: w.enabled ? 1 : 0.6 }}
                    />
                  </div>
                ))}
                {weekly.every((w) => !w.enabled) ? <div className="muted">No weekly availability set.</div> : null}
              </div>
            </div>
          </div>

          <div className="card">
            <div className="cardBody">
              <div className="rowBetween">
                <h2 style={{ margin: 0 }}>One-off Exceptions</h2>
                <span className="badge">Timezone: {homeTimeZone}</span>
              </div>

              <form onSubmit={addException} style={{ marginTop: 12 }} className="stack">
                <div className="row" style={{ flexWrap: 'wrap' }}>
                  <input type="date" value={exDate} onChange={(e) => setExDate(e.target.value)} required className="input" style={{ width: 220 }} />
                  <select value={exType} onChange={(e) => setExType(e.target.value as 'unavailable' | 'custom')} className="select" style={{ width: 220 }}>
                    <option value="unavailable">unavailable</option>
                    <option value="custom">custom hours</option>
                  </select>
                  <button type="submit" className="btn">
                    Add Exception
                  </button>
                </div>

                {exType === 'custom' ? (
                  <div className="row" style={{ flexWrap: 'wrap' }}>
                    <input type="time" value={exStart} onChange={(e) => setExStart(e.target.value)} required className="input" style={{ width: 180 }} />
                    <input type="time" value={exEnd} onChange={(e) => setExEnd(e.target.value)} required className="input" style={{ width: 180 }} />
                  </div>
                ) : null}
              </form>

              <div style={{ marginTop: 14 }} className="stack">
                {exceptions.map((ex) => (
                  <div key={ex.id} className="card" style={{ boxShadow: 'none' }}>
                    <div className="cardBody rowBetween" style={{ alignItems: 'center' }}>
                      <div>
                        <div style={{ fontWeight: 800 }}>{ex.date}</div>
                        <div className="muted">
                          {ex.type === 'unavailable' ? 'Unavailable' : `Custom: ${ex.startTime}–${ex.endTime}`}
                        </div>
                      </div>
                      <button onClick={() => removeException(ex.id)} className="btn btnSmall" style={{ borderColor: 'color-mix(in srgb, var(--danger) 35%, var(--border))', color: 'var(--danger)' }}>
                        Remove
                      </button>
                    </div>
                  </div>
                ))}
                {exceptions.length === 0 ? <div className="muted">No exceptions yet.</div> : null}
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
