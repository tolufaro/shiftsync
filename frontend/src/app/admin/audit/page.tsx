'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState } from 'react'

type Location = { id: string; name: string; timezone: string; address?: string | null }
type UserRole = 'admin' | 'manager' | 'staff'

function toYmd(date: Date) {
  return date.toISOString().slice(0, 10)
}

export default function AdminAuditExportPage() {
  const apiUrl = useMemo(() => process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001', [])

  const [me, setMe] = useState<{ id: string; email: string; role: UserRole } | null>(null)
  const [locations, setLocations] = useState<Location[]>([])

  const [from, setFrom] = useState(() => toYmd(new Date(Date.now() - 7 * 86400000)))
  const [to, setTo] = useState(() => toYmd(new Date()))
  const [locationId, setLocationId] = useState('')

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

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
      const meData = await fetchJson<{ user: { id: string; email: string; role: UserRole } }>('/auth/me')
      setMe(meData.user)
      if (meData.user.role !== 'admin') {
        setError('Admin access required')
        setLocations([])
        return
      }
      const locData = await fetchJson<{ locations: Location[] }>('/admin/locations')
      setLocations(locData.locations)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load')
    } finally {
      setLoading(false)
    }
  }, [fetchJson])

  useEffect(() => {
    load()
  }, [load])

  function download() {
    setError(null)
    const params = new URLSearchParams()
    params.set('from', from)
    params.set('to', to)
    if (locationId) params.set('locationId', locationId)
    window.location.href = `${apiUrl}/admin/audit/export?${params.toString()}`
  }

  return (
    <div className="container" style={{ maxWidth: 960 }}>
      <div className="rowBetween">
        <h1 className="pageTitle" style={{ margin: 0 }}>
          Admin - Audit Export
        </h1>
        <Link href="/" className="btn">
          Home
        </Link>
      </div>

      {me ? (
        <div style={{ marginTop: 10 }} className="row">
          <span className="badge">Admin</span>
          <span className="muted">Signed in as {me.email}</span>
        </div>
      ) : null}
      {error ? (
        <div className="card" style={{ marginTop: 12, borderColor: 'color-mix(in srgb, var(--danger) 35%, var(--border))' }}>
          <div className="cardBody" style={{ color: 'var(--danger)' }}>
            {error}
          </div>
        </div>
      ) : null}
      {loading ? <div className="muted" style={{ marginTop: 12 }}>Loading...</div> : null}

      {!loading && !error ? (
        <div className="card" style={{ marginTop: 16 }}>
          <div className="cardBody">
            <div className="row" style={{ flexWrap: 'wrap' }}>
            <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <span>From</span>
              <input
                type="date"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
                className="input"
              />
            </label>
            <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <span>To</span>
              <input
                type="date"
                value={to}
                onChange={(e) => setTo(e.target.value)}
                className="input"
              />
            </label>
            <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <span>Location</span>
              <select
                value={locationId}
                onChange={(e) => setLocationId(e.target.value)}
                className="select"
              >
                <option value="">All</option>
                {locations.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </select>
            </label>
            <button onClick={download} className="btn btnPrimary">
              Download CSV
            </button>
          </div>
          <div className="muted" style={{ marginTop: 10 }}>
            Exports audit log entries for shifts/assignments/swaps in the selected range. Location filter applies to entries that can be mapped to a location.
          </div>
        </div>
        </div>
      ) : null}
    </div>
  )
}
