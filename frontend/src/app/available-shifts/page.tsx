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
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12 }}>
        <h1 style={{ margin: 0 }}>Available Shifts</h1>
        <Link href="/">Home</Link>
      </div>

      {error ? <div style={{ marginTop: 12, color: '#b00020' }}>{error}</div> : null}
      {loading ? <div style={{ marginTop: 12 }}>Loading...</div> : null}

      {!loading ? (
        <div style={{ marginTop: 16, display: 'grid', gap: 10 }}>
          {shifts.map((s) => (
            <div key={s.id} style={{ padding: 12, border: '1px solid #e5e5e5', borderRadius: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                <div style={{ fontWeight: 700 }}>{formatDayLabel(s.startAt, s.location.timezone)}</div>
                <div style={{ color: '#555' }}>
                  {s.filled}/{s.headcountNeeded} filled
                </div>
              </div>
              <div style={{ marginTop: 6 }}>
                <div style={{ fontSize: 18, fontWeight: 700 }}>{formatTimeRange(s.startAt, s.endAt, s.location.timezone)}</div>
                <div style={{ marginTop: 4, color: '#333' }}>
                  Location: <strong>{s.location.name}</strong> <span style={{ color: '#666' }}>({s.location.timezone})</span>
                </div>
                {s.requiredSkill ? <div style={{ color: '#333' }}>Role: {s.requiredSkill.name}</div> : null}
              </div>
              <div style={{ marginTop: 10 }}>
                <button
                  onClick={() => claim(s.id)}
                  disabled={Boolean(claiming[s.id])}
                  style={{
                    width: 140,
                    padding: 10,
                    borderRadius: 8,
                    border: '1px solid #111',
                    background: '#111',
                    color: '#fff',
                    cursor: 'pointer',
                  }}
                >
                  {claiming[s.id] ? 'Claiming...' : 'Claim'}
                </button>
              </div>
            </div>
          ))}
          {shifts.length === 0 ? <div style={{ color: '#555' }}>No available shifts you qualify for.</div> : null}
        </div>
      ) : null}
    </div>
  )
}
