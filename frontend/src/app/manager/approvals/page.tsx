'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState } from 'react'

type Location = { id: string; name: string; timezone: string }

type SwapRow = {
  id: string
  type: 'swap' | 'drop'
  status: string
  expiresAt: string | null
  createdAt: string
  requestedBy: { id: string; email: string; name: string | null }
  targetStaff: { id: string; email: string; name: string | null } | null
  shift: { id: string; startAt: string; endAt: string; location: { id: string; name: string; timezone: string } }
}

function formatTimeRange(startAt: string, endAt: string, timeZone: string) {
  const fmt = new Intl.DateTimeFormat('en-US', { timeZone, hour: 'numeric', minute: '2-digit' })
  return `${fmt.format(new Date(startAt))}–${fmt.format(new Date(endAt))}`
}

function formatDate(startAt: string, timeZone: string) {
  const fmt = new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short', month: 'short', day: 'numeric' })
  return fmt.format(new Date(startAt))
}

export default function ManagerApprovalsPage() {
  const apiUrl = useMemo(() => process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001', [])
  const [locations, setLocations] = useState<Location[]>([])
  const [locationId, setLocationId] = useState<string>('')
  const [swaps, setSwaps] = useState<SwapRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [actioning, setActioning] = useState<Record<string, boolean>>({})

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
      const locData = await fetchJson<{ locations: Location[] }>('/locations')
      setLocations(locData.locations)
      const chosen = locationId || locData.locations[0]?.id || ''
      if (!locationId && chosen) setLocationId(chosen)

      const qs = chosen ? `?locationId=${encodeURIComponent(chosen)}` : ''
      const data = await fetchJson<{ swaps: SwapRow[] }>(`/swaps/pending${qs}`)
      setSwaps(data.swaps)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load')
    } finally {
      setLoading(false)
    }
  }, [fetchJson, locationId])

  useEffect(() => {
    load()
  }, [load])

  async function decide(swapId: string, decision: 'approve' | 'deny') {
    setActioning((p) => ({ ...p, [swapId]: true }))
    setError(null)
    try {
      await fetchJson(`/swaps/${swapId}/approve`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision }),
      })
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Action failed')
    } finally {
      setActioning((p) => ({ ...p, [swapId]: false }))
    }
  }

  return (
    <div style={{ maxWidth: 1000, margin: '40px auto', padding: 16 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12 }}>
        <h1 style={{ margin: 0 }}>Manager Approvals</h1>
        <Link href="/">Home</Link>
      </div>

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
          {swaps.map((s) => (
            <div key={s.id} style={{ padding: 12, border: '1px solid #e5e5e5', borderRadius: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'baseline' }}>
                <div style={{ fontWeight: 700 }}>
                  {s.type.toUpperCase()} — {s.shift.location.name}
                </div>
                <div style={{ color: '#555' }}>{s.status}</div>
              </div>

              <div style={{ marginTop: 6, color: '#333' }}>
                <div>
                  {formatDate(s.shift.startAt, s.shift.location.timezone)} —{' '}
                  {formatTimeRange(s.shift.startAt, s.shift.endAt, s.shift.location.timezone)}{' '}
                  <span style={{ color: '#666' }}>({s.shift.location.timezone})</span>
                </div>
                <div style={{ marginTop: 4 }}>
                  Requested by: <strong>{s.requestedBy.name || s.requestedBy.email}</strong>
                </div>
                {s.targetStaff ? (
                  <div>
                    Target: <strong>{s.targetStaff.name || s.targetStaff.email}</strong>
                  </div>
                ) : null}
                {s.expiresAt ? <div style={{ color: '#666' }}>Expires: {new Date(s.expiresAt).toLocaleString()}</div> : null}
              </div>

              <div style={{ marginTop: 10, display: 'flex', gap: 10 }}>
                <button
                  onClick={() => decide(s.id, 'approve')}
                  disabled={Boolean(actioning[s.id])}
                  style={{
                    padding: '10px 12px',
                    borderRadius: 8,
                    border: '1px solid #0b6b2b',
                    background: '#0b6b2b',
                    color: '#fff',
                    cursor: 'pointer',
                  }}
                >
                  Approve
                </button>
                <button
                  onClick={() => decide(s.id, 'deny')}
                  disabled={Boolean(actioning[s.id])}
                  style={{
                    padding: '10px 12px',
                    borderRadius: 8,
                    border: '1px solid #b00020',
                    background: '#fff',
                    color: '#b00020',
                    cursor: 'pointer',
                  }}
                >
                  Deny
                </button>
              </div>
            </div>
          ))}
          {swaps.length === 0 ? <div style={{ color: '#555' }}>No pending requests.</div> : null}
        </div>
      ) : null}
    </div>
  )
}

