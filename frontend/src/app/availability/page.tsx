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

const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

export default function AvailabilityPage() {
  const apiUrl = useMemo(() => process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001', [])

  const [me, setMe] = useState<Me | null>(null)
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
      const meData = await fetchJson<{ user: Me }>('/auth/me')
      setMe(meData.user)

      const data = await fetchJson<{ windows: AvailabilityWindow[]; exceptions: AvailabilityException[] }>('/me/availability')

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
    <div style={{ maxWidth: 900, margin: '40px auto', padding: 16 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12 }}>
        <h1 style={{ margin: 0 }}>Availability</h1>
        <div style={{ display: 'flex', gap: 12 }}>
          <Link href="/">Home</Link>
        </div>
      </div>

      {me ? <div style={{ marginTop: 8, color: '#555' }}>Signed in as {me.email}</div> : null}

      {error ? <div style={{ marginTop: 12, color: '#b00020' }}>{error}</div> : null}
      {loading ? <div style={{ marginTop: 12 }}>Loading...</div> : null}

      {!loading ? (
        <div style={{ display: 'grid', gap: 16, marginTop: 16 }}>
          <div style={{ padding: 12, border: '1px solid #e5e5e5', borderRadius: 12 }}>
            <h2 style={{ margin: '0 0 10px 0' }}>Weekly Recurring Availability</h2>
            <div style={{ display: 'grid', gap: 10 }}>
              {weekly.map((w, i) => (
                <div key={i} style={{ display: 'grid', gridTemplateColumns: '90px 1fr 1fr', gap: 10, alignItems: 'center' }}>
                  <label style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
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
                    <span>{dayNames[i]}</span>
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
                    style={{ padding: 10, borderRadius: 8, border: '1px solid #ccc' }}
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
                    style={{ padding: 10, borderRadius: 8, border: '1px solid #ccc' }}
                  />
                </div>
              ))}
            </div>

            <div style={{ marginTop: 12 }}>
              <button
                onClick={saveWeekly}
                style={{
                  width: 160,
                  padding: 10,
                  borderRadius: 8,
                  border: '1px solid #111',
                  background: '#111',
                  color: '#fff',
                  cursor: 'pointer',
                }}
              >
                Save Weekly
              </button>
            </div>
          </div>

          <div style={{ padding: 12, border: '1px solid #e5e5e5', borderRadius: 12 }}>
            <h2 style={{ margin: '0 0 10px 0' }}>One-off Exceptions</h2>
            <form onSubmit={addException} style={{ display: 'grid', gap: 10, marginBottom: 12 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 180px', gap: 10 }}>
                <input
                  type="date"
                  value={exDate}
                  onChange={(e) => setExDate(e.target.value)}
                  required
                  style={{ padding: 10, borderRadius: 8, border: '1px solid #ccc' }}
                />
                <select
                  value={exType}
                  onChange={(e) => setExType(e.target.value as 'unavailable' | 'custom')}
                  style={{ padding: 10, borderRadius: 8, border: '1px solid #ccc' }}
                >
                  <option value="unavailable">unavailable</option>
                  <option value="custom">custom hours</option>
                </select>
              </div>

              {exType === 'custom' ? (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                  <input
                    type="time"
                    value={exStart}
                    onChange={(e) => setExStart(e.target.value)}
                    required
                    style={{ padding: 10, borderRadius: 8, border: '1px solid #ccc' }}
                  />
                  <input
                    type="time"
                    value={exEnd}
                    onChange={(e) => setExEnd(e.target.value)}
                    required
                    style={{ padding: 10, borderRadius: 8, border: '1px solid #ccc' }}
                  />
                </div>
              ) : null}

              <button
                type="submit"
                style={{
                  width: 180,
                  padding: 10,
                  borderRadius: 8,
                  border: '1px solid #111',
                  background: '#fff',
                  cursor: 'pointer',
                }}
              >
                Add Exception
              </button>
            </form>

            <div style={{ display: 'grid', gap: 8 }}>
              {exceptions.map((ex) => (
                <div
                  key={ex.id}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    gap: 12,
                    padding: 10,
                    border: '1px solid #eee',
                    borderRadius: 10,
                  }}
                >
                  <div>
                    <div style={{ fontWeight: 600 }}>{ex.date}</div>
                    <div style={{ color: '#555' }}>
                      {ex.type === 'unavailable' ? 'Unavailable' : `Custom: ${ex.startTime}–${ex.endTime}`}
                    </div>
                  </div>
                  <button
                    onClick={() => removeException(ex.id)}
                    style={{
                      padding: '8px 10px',
                      borderRadius: 8,
                      border: '1px solid #b00020',
                      background: '#fff',
                      color: '#b00020',
                      cursor: 'pointer',
                      height: 36,
                      alignSelf: 'center',
                    }}
                  >
                    Remove
                  </button>
                </div>
              ))}
              {exceptions.length === 0 ? <div style={{ color: '#555' }}>No exceptions yet.</div> : null}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}

