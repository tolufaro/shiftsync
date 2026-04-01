'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState } from 'react'

type Location = { id: string; name: string; timezone: string }

type StaffRow = {
  id: string
  email: string
  name: string | null
  hours: number
  desiredWeeklyHours: number | null
  desiredHoursForRange: number | null
  premiumShifts: number
  fairnessScore: number
}

type FairnessResponse = {
  locationId: string
  from: string
  to: string
  avgPremiumPerStaff: number
  staff: StaffRow[]
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

export default function ManagerAnalyticsPage() {
  const apiUrl = useMemo(() => process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001', [])

  const [locations, setLocations] = useState<Location[]>([])
  const [locationId, setLocationId] = useState('')
  const [from, setFrom] = useState(() => toYmd(startOfWeekMonday(new Date())))
  const [to, setTo] = useState(() => addDaysYmd(toYmd(startOfWeekMonday(new Date())), 7))

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [data, setData] = useState<FairnessResponse | null>(null)

  const fetchJson = useCallback(
    async <T,>(path: string, init?: RequestInit) => {
      const res = await fetch(`${apiUrl}${path}`, { ...init, credentials: 'include' })
      const json = await res.json().catch(() => null)
      if (!res.ok) {
        const message = json?.error ? String(json.error) : `Request failed (${res.status})`
        throw new Error(message)
      }
      return json as T
    },
    [apiUrl],
  )

  const loadBase = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const locData = await fetchJson<{ locations: Location[] }>('/locations')
      setLocations(locData.locations)
      if (!locationId && locData.locations.length) setLocationId(locData.locations[0].id)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load')
    } finally {
      setLoading(false)
    }
  }, [fetchJson, locationId])

  const load = useCallback(async () => {
    if (!locationId) return
    setLoading(true)
    setError(null)
    try {
      const qs = `?locationId=${encodeURIComponent(locationId)}&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`
      const fairness = await fetchJson<FairnessResponse>(`/analytics/fairness${qs}`)
      setData(fairness)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load')
    } finally {
      setLoading(false)
    }
  }, [fetchJson, locationId, from, to])

  useEffect(() => {
    loadBase()
  }, [loadBase])

  useEffect(() => {
    if (locationId) load()
  }, [locationId, load])

  const maxHours = useMemo(() => {
    let max = 0
    for (const r of data?.staff || []) max = Math.max(max, r.hours)
    return Math.max(40, max)
  }, [data])

  const maxPremium = useMemo(() => {
    let max = 0
    for (const r of data?.staff || []) max = Math.max(max, r.premiumShifts)
    return Math.max(1, max)
  }, [data])

  return (
    <div style={{ maxWidth: 1100, margin: '40px auto', padding: 16 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12 }}>
        <h1 style={{ margin: 0 }}>Fairness Analytics</h1>
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

        <button
          onClick={load}
          style={{ padding: '10px 12px', borderRadius: 8, border: '1px solid #111', background: '#fff', cursor: 'pointer' }}
        >
          Refresh
        </button>

        {data ? <div style={{ color: '#555' }}>Avg premium per staff: {data.avgPremiumPerStaff.toFixed(2)}</div> : null}
      </div>

      {loading ? <div style={{ marginTop: 12 }}>Loading...</div> : null}

      {!loading && data ? (
        <div style={{ marginTop: 16, display: 'grid', gap: 16 }}>
          <div style={{ padding: 12, border: '1px solid #e5e5e5', borderRadius: 12 }}>
            <h2 style={{ margin: '0 0 10px 0' }}>Hours (range)</h2>
            <div style={{ display: 'grid', gap: 8 }}>
              {data.staff.map((s) => {
                const pct = Math.min(100, (s.hours / maxHours) * 100)
                const color = s.hours >= 60 ? '#b00020' : s.hours >= 40 ? '#d07a00' : s.hours >= 38 ? '#b38900' : '#0b6b2b'
                return (
                  <div key={s.id} style={{ display: 'grid', gridTemplateColumns: '260px 1fr 60px', gap: 10, alignItems: 'center' }}>
                    <div style={{ color: '#222' }}>{s.name ? `${s.name} (${s.email})` : s.email}</div>
                    <div style={{ height: 10, background: '#eee', borderRadius: 999, overflow: 'hidden' }}>
                      <div style={{ width: `${pct}%`, height: '100%', background: color }} />
                    </div>
                    <div style={{ textAlign: 'right', color: '#333' }}>{s.hours.toFixed(1)}h</div>
                  </div>
                )
              })}
            </div>
          </div>

          <div style={{ padding: 12, border: '1px solid #e5e5e5', borderRadius: 12 }}>
            <h2 style={{ margin: '0 0 10px 0' }}>Premium Shifts (range)</h2>
            <div style={{ display: 'grid', gap: 8 }}>
              {data.staff.map((s) => {
                const pct = Math.min(100, (s.premiumShifts / maxPremium) * 100)
                return (
                  <div key={s.id} style={{ display: 'grid', gridTemplateColumns: '260px 1fr 60px', gap: 10, alignItems: 'center' }}>
                    <div style={{ color: '#222' }}>{s.name ? `${s.name} (${s.email})` : s.email}</div>
                    <div style={{ height: 10, background: '#eee', borderRadius: 999, overflow: 'hidden' }}>
                      <div style={{ width: `${pct}%`, height: '100%', background: '#4e79a7' }} />
                    </div>
                    <div style={{ textAlign: 'right', color: '#333' }}>{s.premiumShifts}</div>
                  </div>
                )
              })}
            </div>
          </div>

          <div style={{ padding: 12, border: '1px solid #e5e5e5', borderRadius: 12, overflowX: 'auto' }}>
            <h2 style={{ margin: '0 0 10px 0' }}>Details</h2>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={{ textAlign: 'left', padding: 8, borderBottom: '1px solid #eee' }}>Staff</th>
                  <th style={{ textAlign: 'right', padding: 8, borderBottom: '1px solid #eee' }}>Hours</th>
                  <th style={{ textAlign: 'right', padding: 8, borderBottom: '1px solid #eee' }}>Desired</th>
                  <th style={{ textAlign: 'right', padding: 8, borderBottom: '1px solid #eee' }}>Δ</th>
                  <th style={{ textAlign: 'right', padding: 8, borderBottom: '1px solid #eee' }}>Premium</th>
                  <th style={{ textAlign: 'right', padding: 8, borderBottom: '1px solid #eee' }}>Fairness</th>
                </tr>
              </thead>
              <tbody>
                {data.staff.map((s) => {
                  const desired = s.desiredHoursForRange
                  const delta = desired === null ? null : s.hours - desired
                  return (
                    <tr key={s.id}>
                      <td style={{ padding: 8, borderBottom: '1px solid #f3f3f3' }}>{s.name || s.email}</td>
                      <td style={{ padding: 8, borderBottom: '1px solid #f3f3f3', textAlign: 'right' }}>{s.hours.toFixed(1)}</td>
                      <td style={{ padding: 8, borderBottom: '1px solid #f3f3f3', textAlign: 'right' }}>
                        {desired === null ? '-' : desired.toFixed(1)}
                      </td>
                      <td style={{ padding: 8, borderBottom: '1px solid #f3f3f3', textAlign: 'right' }}>
                        {delta === null ? '-' : delta.toFixed(1)}
                      </td>
                      <td style={{ padding: 8, borderBottom: '1px solid #f3f3f3', textAlign: 'right' }}>{s.premiumShifts}</td>
                      <td style={{ padding: 8, borderBottom: '1px solid #f3f3f3', textAlign: 'right' }}>{s.fairnessScore}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
    </div>
  )
}

