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
    <div style={{ maxWidth: 900, margin: '40px auto', padding: 16 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12 }}>
        <h1 style={{ margin: 0 }}>Admin — Audit Export</h1>
        <Link href="/">Home</Link>
      </div>

      {me ? <div style={{ marginTop: 8, color: '#555' }}>Signed in as {me.email}</div> : null}
      {error ? <div style={{ marginTop: 12, color: '#b00020' }}>{error}</div> : null}
      {loading ? <div style={{ marginTop: 12 }}>Loading...</div> : null}

      {!loading && !error ? (
        <div style={{ marginTop: 16, padding: 12, border: '1px solid #e5e5e5', borderRadius: 12 }}>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
            <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <span>From</span>
              <input
                type="date"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
                style={{ padding: 10, borderRadius: 8, border: '1px solid #ccc' }}
              />
            </label>
            <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <span>To</span>
              <input
                type="date"
                value={to}
                onChange={(e) => setTo(e.target.value)}
                style={{ padding: 10, borderRadius: 8, border: '1px solid #ccc' }}
              />
            </label>
            <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <span>Location</span>
              <select
                value={locationId}
                onChange={(e) => setLocationId(e.target.value)}
                style={{ padding: 10, borderRadius: 8, border: '1px solid #ccc' }}
              >
                <option value="">All</option>
                {locations.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </select>
            </label>
            <button
              onClick={download}
              style={{ padding: '10px 12px', borderRadius: 8, border: '1px solid #111', background: '#111', color: '#fff', cursor: 'pointer' }}
            >
              Download CSV
            </button>
          </div>
          <div style={{ marginTop: 10, color: '#555' }}>
            Exports audit log entries for shifts/assignments/swaps in the selected range. Location filter applies to entries that can be mapped to a location.
          </div>
        </div>
      ) : null}
    </div>
  )
}

