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
    <div className="container" style={{ maxWidth: 960 }}>
      <div className="rowBetween">
        <h1 className="pageTitle" style={{ margin: 0 }}>
          Notification Settings
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

      {!loading ? (
        <div style={{ marginTop: 16 }} className="stack">
          <div className="card">
            <div className="cardBody rowBetween" style={{ alignItems: 'center' }}>
              <div className="muted">Toggle email delivery per notification type (in-app is always on).</div>
              <button onClick={save} disabled={saving} className="btn btnPrimary">
                {saving ? 'Saving...' : 'Save'}
              </button>
            </div>
          </div>

          <div className="card" style={{ overflow: 'hidden' }}>
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
                    borderTop: idx === 0 ? 'none' : '1px solid var(--border)',
                    alignItems: 'center',
                  }}
                >
                  <div>
                    <div style={{ fontWeight: 800 }}>{t.label}</div>
                    <div className="muted">{t.type}</div>
                  </div>
                  <label style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                    <span className="muted">{enabled ? 'In-app + email' : 'In-app only'}</span>
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
