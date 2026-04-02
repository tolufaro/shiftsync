'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState } from 'react'

type ProfileUser = { id: string; email: string; name: string | null; role: string; homeTimeZone: string }

export default function TimezoneSettingsPage() {
  const apiUrl = useMemo(() => process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001', [])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [user, setUser] = useState<ProfileUser | null>(null)
  const [timeZone, setTimeZone] = useState('')

  const timeZones = useMemo(() => {
    const intl = Intl as unknown as { supportedValuesOf?: (key: 'timeZone') => string[] }
    if (typeof intl.supportedValuesOf === 'function') {
      try {
        return intl.supportedValuesOf('timeZone')
      } catch {}
    }
    return []
  }, [])

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
      const data = await fetchJson<{ user: ProfileUser }>('/me/profile')
      setUser(data.user)
      setTimeZone(data.user.homeTimeZone || 'UTC')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load')
    } finally {
      setLoading(false)
    }
  }, [fetchJson])

  useEffect(() => {
    load()
  }, [load])

  async function save() {
    setSaving(true)
    setError(null)
    try {
      await fetchJson('/me/profile/timezone', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ timeZone }),
      })
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="container" style={{ maxWidth: 960 }}>
      <div className="rowBetween">
        <h1 className="pageTitle" style={{ margin: 0 }}>
          Timezone Settings
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
      {loading ? <div className="muted" style={{ marginTop: 12 }}>Loading...</div> : null}

      {!loading && user ? (
        <div style={{ marginTop: 16 }} className="stack">
          <div className="card">
            <div className="cardBody rowBetween" style={{ alignItems: 'center' }}>
              <div className="muted">
                Availability checks use your home timezone: <strong>{user.homeTimeZone}</strong>
              </div>
              <span className="badge">IANA</span>
            </div>
          </div>

          <div className="card">
            <div className="cardBody stack">
              <label style={{ display: 'grid', gap: 8 }}>
                <div style={{ fontWeight: 700 }}>Home timezone</div>
            {timeZones.length ? (
              <select
                value={timeZone}
                onChange={(e) => setTimeZone(e.target.value)}
                className="select"
              >
                {timeZones.map((tz) => (
                  <option key={tz} value={tz}>
                    {tz}
                  </option>
                ))}
              </select>
            ) : (
              <input
                value={timeZone}
                onChange={(e) => setTimeZone(e.target.value)}
                placeholder="e.g. America/New_York"
                className="input"
              />
            )}
              </label>
              <button onClick={save} disabled={saving || !timeZone.trim()} className="btn btnPrimary" style={{ width: 200 }}>
                {saving ? 'Saving...' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
