'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState } from 'react'

type PreferenceRow = { type: string; emailEnabled: boolean }

const KNOWN_TYPES: { type: string; label: string }[] = [
  { type: 'assignment.new', label: 'New assignment' },
  { type: 'shift.updated', label: 'Shift updated' },
  { type: 'shift.published', label: 'Shift published' },
  { type: 'shift.unpublished', label: 'Shift unpublished' },
  { type: 'shift.deleted', label: 'Shift deleted' },
  { type: 'swap.new', label: 'Swap request received' },
  { type: 'swap.submitted', label: 'Swap request submitted' },
  { type: 'swap.accepted', label: 'Swap accepted' },
  { type: 'swap.declined', label: 'Swap declined' },
  { type: 'swap.pending_approval', label: 'Swap pending approval' },
  { type: 'swap.approved', label: 'Swap approved' },
  { type: 'swap.denied', label: 'Swap denied' },
  { type: 'swap.cancelled', label: 'Swap cancelled' },
  { type: 'drop.submitted', label: 'Drop submitted' },
  { type: 'drop.pending_approval', label: 'Drop pending approval' },
  { type: 'overtime.warning', label: 'Overtime warning' },
  { type: 'availability.updated', label: 'Availability updated' },
]

export default function NotificationSettingsPage() {
  const apiUrl = useMemo(() => process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001', [])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [prefs, setPrefs] = useState<Record<string, boolean>>({})

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
      const data = await fetchJson<{ preferences: PreferenceRow[] }>('/me/notification-preferences')
      const next: Record<string, boolean> = {}
      for (const p of data.preferences) next[p.type] = Boolean(p.emailEnabled)
      setPrefs(next)
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
      const payload = KNOWN_TYPES.map((t) => ({ type: t.type, emailEnabled: Boolean(prefs[t.type]) }))
      const data = await fetchJson<{ preferences: PreferenceRow[] }>('/me/notification-preferences', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ preferences: payload }),
      })
      const next: Record<string, boolean> = {}
      for (const p of data.preferences) next[p.type] = Boolean(p.emailEnabled)
      setPrefs(next)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div style={{ maxWidth: 900, margin: '40px auto', padding: 16 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12 }}>
        <h1 style={{ margin: 0 }}>Notification Settings</h1>
        <Link href="/">Home</Link>
      </div>

      {error ? <div style={{ marginTop: 12, color: '#b00020' }}>{error}</div> : null}
      {loading ? <div style={{ marginTop: 12 }}>Loading...</div> : null}

      {!loading ? (
        <div style={{ marginTop: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center' }}>
            <div style={{ color: '#555' }}>Toggle email delivery per notification type (in-app is always on).</div>
            <button
              onClick={save}
              disabled={saving}
              style={{ padding: '10px 12px', borderRadius: 8, border: '1px solid #111', background: '#111', color: '#fff', cursor: 'pointer' }}
            >
              {saving ? 'Saving...' : 'Save'}
            </button>
          </div>

          <div style={{ marginTop: 12, border: '1px solid #e5e5e5', borderRadius: 12, overflow: 'hidden' }}>
            {KNOWN_TYPES.map((t, idx) => {
              const enabled = Boolean(prefs[t.type])
              return (
                <div
                  key={t.type}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    gap: 12,
                    padding: 12,
                    borderTop: idx === 0 ? 'none' : '1px solid #f2f2f2',
                    alignItems: 'center',
                  }}
                >
                  <div>
                    <div style={{ fontWeight: 700 }}>{t.label}</div>
                    <div style={{ color: '#666' }}>{t.type}</div>
                  </div>
                  <label style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                    <span style={{ color: '#555' }}>{enabled ? 'In-app + email' : 'In-app only'}</span>
                    <input
                      type="checkbox"
                      checked={enabled}
                      onChange={(e) => setPrefs((p) => ({ ...p, [t.type]: e.target.checked }))}
                    />
                  </label>
                </div>
              )
            })}
          </div>
        </div>
      ) : null}
    </div>
  )
}

