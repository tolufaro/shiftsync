'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState } from 'react'

import { formatDayLabel, formatTimeRange } from '../../lib/time'

type ShiftRow = {
  id: string
  location: { id: string; name: string; timezone: string }
  requiredSkill: { id: string; name: string } | null
  startAt: string
  endAt: string
  headcountNeeded: number
  filled: number
}

export default function AvailableShiftsPage() {
  const apiUrl = useMemo(() => process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001', [])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [shifts, setShifts] = useState<ShiftRow[]>([])
  const [claiming, setClaiming] = useState<Record<string, boolean>>({})

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
      const data = await fetchJson<{ shifts: ShiftRow[] }>('/me/shifts/available')
      setShifts(data.shifts)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load')
    } finally {
      setLoading(false)
    }
  }, [fetchJson])

  useEffect(() => {
    load()
  }, [load])

  async function claim(shiftId: string) {
    setClaiming((p) => ({ ...p, [shiftId]: true }))
    setError(null)
    try {
      await fetchJson(`/me/shifts/${shiftId}/claim`, { method: 'POST' })
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Claim failed')
    } finally {
      setClaiming((p) => ({ ...p, [shiftId]: false }))
    }
  }

  return (
    <div className="container" style={{ maxWidth: 960 }}>
      <div className="rowBetween">
        <h1 className="pageTitle" style={{ margin: 0 }}>
          Available Shifts
        </h1>
        <Link href="/" className="btn">
          Home
        </Link>
      </div>

      <div className="card" style={{ marginTop: 12 }}>
        <div className="cardBody rowBetween" style={{ alignItems: 'center' }}>
          <div className="muted">Times are displayed in each shift’s location timezone.</div>
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
      {loading ? (
        <div style={{ marginTop: 12 }} className="muted">
          Loading...
        </div>
      ) : null}

      {!loading ? (
        <div style={{ marginTop: 16 }} className="stack">
          {shifts.map((s) => (
            <div key={s.id} className="card">
              <div className="cardBody">
                <div className="rowBetween">
                  <div style={{ fontWeight: 800 }}>{formatDayLabel(s.startAt, s.location.timezone)}</div>
                  <span className="badge">
                    {s.filled}/{s.headcountNeeded} filled
                  </span>
                </div>
                <div style={{ marginTop: 6 }}>
                  <div style={{ fontSize: 18, fontWeight: 800 }}>{formatTimeRange(s.startAt, s.endAt, s.location.timezone)}</div>
                  <div style={{ marginTop: 4 }}>
                    Location: <strong>{s.location.name}</strong> <span className="muted">({s.location.timezone})</span>
                  </div>
                  {s.requiredSkill ? <div>Role: {s.requiredSkill.name}</div> : null}
                </div>
                <div style={{ marginTop: 12 }}>
                  <button onClick={() => claim(s.id)} disabled={Boolean(claiming[s.id])} className="btn btnPrimary" style={{ width: 160 }}>
                    {claiming[s.id] ? 'Claiming...' : 'Claim'}
                  </button>
                </div>
              </div>
            </div>
          ))}
          {shifts.length === 0 ? <div className="muted">No available shifts you qualify for.</div> : null}
        </div>
      ) : null}
    </div>
  )
}
