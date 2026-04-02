'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState } from 'react'

import { formatDayLabel, formatTimeRange } from '../../../lib/time'

type SwapRow = {
  id: string
  type: 'swap' | 'drop'
  status: string
  expiresAt: string | null
  createdAt: string
  requestedBy: { id: string; email: string; name: string | null }
  targetStaff: { id: string; email: string; name: string | null } | null
  shift: {
    id: string
    startAt: string
    endAt: string
    location: { id: string; name: string; timezone: string }
  }
}

export default function MySwapsPage() {
  const apiUrl = useMemo(() => process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001', [])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [rows, setRows] = useState<SwapRow[]>([])
  const [me, setMe] = useState<{ id: string; email: string; role: string } | null>(null)
  const [acting, setActing] = useState<Record<string, boolean>>({})

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
      const meData = await fetchJson<{ user: { id: string; email: string; role: string } }>('/auth/me')
      setMe(meData.user)
      const data = await fetchJson<{ swaps: SwapRow[] }>('/swaps/mine')
      setRows(data.swaps)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load')
    } finally {
      setLoading(false)
    }
  }, [fetchJson])

  useEffect(() => {
    load()
  }, [load])

  async function cancel(swapId: string) {
    setActing((p) => ({ ...p, [swapId]: true }))
    setError(null)
    try {
      await fetchJson(`/swaps/${swapId}/cancel`, { method: 'POST' })
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Cancel failed')
    } finally {
      setActing((p) => ({ ...p, [swapId]: false }))
    }
  }

  async function respond(swapId: string, response: 'accept' | 'decline') {
    setActing((p) => ({ ...p, [swapId]: true }))
    setError(null)
    try {
      await fetchJson(`/swaps/${swapId}/respond`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ response }),
      })
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Action failed')
    } finally {
      setActing((p) => ({ ...p, [swapId]: false }))
    }
  }

  const canCancel = (r: SwapRow) => Boolean(me && r.requestedBy.id === me.id && (r.status === 'pending' || r.status === 'pending_manager_approval'))
  const canRespond = (r: SwapRow) => Boolean(me && r.type === 'swap' && r.targetStaff && r.targetStaff.id === me.id && r.status === 'pending')

  return (
    <div className="container" style={{ maxWidth: 960 }}>
      <div className="rowBetween">
        <h1 className="pageTitle" style={{ margin: 0 }}>
          My Swaps
        </h1>
        <Link href="/" className="btn">
          Home
        </Link>
      </div>

      <div className="card" style={{ marginTop: 12 }}>
        <div className="cardBody rowBetween" style={{ alignItems: 'center' }}>
          <div className="muted">You can cancel your pending swap/drop requests before manager approval.</div>
          <button onClick={load} className="btn btnSmall">
            Refresh
          </button>
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
          {rows.map((r) => (
            <div key={r.id} className="card">
              <div className="cardBody">
                <div className="rowBetween">
                  <div style={{ fontWeight: 800 }}>
                    {r.type.toUpperCase()} — {r.shift.location.name}
                  </div>
                  <span className="badge">{r.status}</span>
                </div>

                <div style={{ marginTop: 8 }}>
                  <div>
                    {formatDayLabel(r.shift.startAt, r.shift.location.timezone)} — {formatTimeRange(r.shift.startAt, r.shift.endAt, r.shift.location.timezone)}{' '}
                    <span className="muted">({r.shift.location.timezone})</span>
                  </div>
                  <div className="muted" style={{ marginTop: 4 }}>
                    Requested by: {r.requestedBy.name ? `${r.requestedBy.name} (${r.requestedBy.email})` : r.requestedBy.email}
                  </div>
                  {r.targetStaff ? (
                    <div className="muted">
                      Target: {r.targetStaff.name ? `${r.targetStaff.name} (${r.targetStaff.email})` : r.targetStaff.email}
                    </div>
                  ) : null}
                  {r.expiresAt ? <div className="muted">Expires: {new Date(r.expiresAt).toLocaleString()}</div> : null}
                </div>

                <div className="row" style={{ marginTop: 12, flexWrap: 'wrap' }}>
                  {canRespond(r) ? (
                    <>
                      <button onClick={() => respond(r.id, 'accept')} disabled={Boolean(acting[r.id])} className="btn btnPrimary">
                        Accept
                      </button>
                      <button onClick={() => respond(r.id, 'decline')} disabled={Boolean(acting[r.id])} className="btn">
                        Decline
                      </button>
                    </>
                  ) : null}
                  {canCancel(r) ? (
                    <button
                      onClick={() => cancel(r.id)}
                      disabled={Boolean(acting[r.id])}
                      className="btn"
                      style={{ borderColor: 'color-mix(in srgb, var(--danger) 35%, var(--border))', color: 'var(--danger)' }}
                    >
                      Cancel Request
                    </button>
                  ) : null}
                </div>
              </div>
            </div>
          ))}

          {rows.length === 0 ? <div className="muted">No swap/drop requests.</div> : null}
        </div>
      ) : null}
    </div>
  )
}

