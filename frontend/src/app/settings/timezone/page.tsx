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
    <div style={{ maxWidth: 900, margin: '40px auto', padding: 16 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12 }}>
        <h1 style={{ margin: 0 }}>Timezone Settings</h1>
        <Link href="/">Home</Link>
      </div>

      {error ? <div style={{ marginTop: 12, color: '#b00020' }}>{error}</div> : null}
      {loading ? <div style={{ marginTop: 12 }}>Loading...</div> : null}

      {!loading && user ? (
        <div style={{ marginTop: 16, display: 'grid', gap: 12 }}>
          <div style={{ color: '#555' }}>
            Availability checks use your home timezone: <strong>{user.homeTimeZone}</strong>
          </div>
          <label style={{ display: 'grid', gap: 8 }}>
            <div>Home timezone (IANA)</div>
            {timeZones.length ? (
              <select
                value={timeZone}
                onChange={(e) => setTimeZone(e.target.value)}
                style={{ padding: 10, borderRadius: 8, border: '1px solid #ccc' }}
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
                style={{ padding: 10, borderRadius: 8, border: '1px solid #ccc' }}
              />
            )}
          </label>
          <button
            onClick={save}
            disabled={saving || !timeZone.trim()}
            style={{ width: 200, padding: '10px 12px', borderRadius: 8, border: '1px solid #111', background: '#111', color: '#fff', cursor: 'pointer' }}
          >
            {saving ? 'Saving...' : 'Save'}
          </button>
        </div>
      ) : null}
    </div>
  )
}
