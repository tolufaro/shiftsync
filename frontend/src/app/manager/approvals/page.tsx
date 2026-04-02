'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState } from 'react'

import { getSocket } from '../../../lib/socket'
import { formatDayLabel, formatTimeRange } from '../../../lib/time'

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

  useEffect(() => {
    const socket = getSocket(apiUrl)
    function onSwapNew() {
      load()
    }
    socket.on('swap:new', onSwapNew)
    socket.on('swap:updated', onSwapNew)
    socket.on('swap:approved', onSwapNew)
    socket.on('swap:denied', onSwapNew)
    return () => {
      socket.off('swap:new', onSwapNew)
      socket.off('swap:updated', onSwapNew)
      socket.off('swap:approved', onSwapNew)
      socket.off('swap:denied', onSwapNew)
    }
  }, [apiUrl, load])

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
    <div className="container" style={{ maxWidth: 1100 }}>
      <div className="rowBetween">
        <h1 className="pageTitle" style={{ margin: 0 }}>
          Manager Approvals
        </h1>
        <Link href="/" className="btn">
          Home
        </Link>
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
          <span>Location</span>
          <select
            value={locationId}
            onChange={(e) => setLocationId(e.target.value)}
            className="select"
            style={{ width: 260 }}
          >
            {locations.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
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
          {swaps.map((s) => (
            <div key={s.id} className="card">
              <div className="cardBody">
                <div className="rowBetween">
                  <div style={{ fontWeight: 800 }}>
                    {s.type.toUpperCase()} — {s.shift.location.name}
                  </div>
                  <span className="badge">{s.status}</span>
                </div>

                <div style={{ marginTop: 6 }}>
                  <div>
                    {formatDayLabel(s.shift.startAt, s.shift.location.timezone)} —{' '}
                    {formatTimeRange(s.shift.startAt, s.shift.endAt, s.shift.location.timezone)}{' '}
                    <span className="muted">({s.shift.location.timezone})</span>
                  </div>
                  <div style={{ marginTop: 4 }}>
                    Requested by: <strong>{s.requestedBy.name || s.requestedBy.email}</strong>
                  </div>
                  {s.targetStaff ? (
                    <div>
                      Target: <strong>{s.targetStaff.name || s.targetStaff.email}</strong>
                    </div>
                  ) : null}
                  {s.expiresAt ? <div className="muted">Expires: {new Date(s.expiresAt).toLocaleString()}</div> : null}
                </div>

                <div className="row" style={{ marginTop: 12 }}>
                  <button onClick={() => decide(s.id, 'approve')} disabled={Boolean(actioning[s.id])} className="btn btnPrimary">
                    Approve
                  </button>
                  <button
                    onClick={() => decide(s.id, 'deny')}
                    disabled={Boolean(actioning[s.id])}
                    className="btn"
                    style={{ borderColor: 'color-mix(in srgb, var(--danger) 35%, var(--border))', color: 'var(--danger)' }}
                  >
                    Deny
                  </button>
                </div>
              </div>
            </div>
          ))}
          {swaps.length === 0 ? <div className="muted">No pending requests.</div> : null}
        </div>
      ) : null}
    </div>
  )
}
