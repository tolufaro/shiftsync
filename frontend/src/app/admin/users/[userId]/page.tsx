'use client'

import Link from 'next/link'
import { useParams } from 'next/navigation'
import { useCallback, useEffect, useMemo, useState } from 'react'

type UserRole = 'admin' | 'manager' | 'staff'

type LocationRow = { id: string; name: string; address: string | null; timezone: string }
type SkillRow = { id: string; name: string }

type UserDetail = {
  id: string
  email: string
  name: string | null
  role: UserRole
  created_at: string
}

export default function AdminUserDetailPage() {
  const { userId } = useParams<{ userId: string }>()
  const apiUrl = useMemo(() => process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001', [])

  const [me, setMe] = useState<{ id: string; email: string; role: UserRole } | null>(null)
  const [user, setUser] = useState<UserDetail | null>(null)
  const [locations, setLocations] = useState<LocationRow[]>([])
  const [skills, setSkills] = useState<SkillRow[]>([])
  const [allLocations, setAllLocations] = useState<LocationRow[]>([])
  const [allSkills, setAllSkills] = useState<SkillRow[]>([])

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const [editName, setEditName] = useState('')
  const [editEmail, setEditEmail] = useState('')
  const [editRole, setEditRole] = useState<UserRole>('staff')
  const [editPassword, setEditPassword] = useState('')
  const [selectedLocationIds, setSelectedLocationIds] = useState<Set<string>>(new Set())
  const [selectedSkillIds, setSelectedSkillIds] = useState<Set<string>>(new Set())

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
        return
      }

      const [userData, locData, skillsData] = await Promise.all([
        fetchJson<{ user: UserDetail; locations: LocationRow[]; skills: SkillRow[] }>(`/admin/users/${userId}`),
        fetchJson<{ locations: LocationRow[] }>('/admin/locations'),
        fetchJson<{ skills: SkillRow[] }>('/admin/skills'),
      ])

      setUser(userData.user)
      setLocations(userData.locations)
      setSkills(userData.skills)
      setAllLocations(locData.locations)
      setAllSkills(skillsData.skills)

      setEditName(userData.user.name || '')
      setEditEmail(userData.user.email)
      setEditRole(userData.user.role)
      setEditPassword('')
      setSelectedLocationIds(new Set(userData.locations.map((l) => l.id)))
      setSelectedSkillIds(new Set(userData.skills.map((s) => s.id)))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load')
    } finally {
      setLoading(false)
    }
  }, [fetchJson, userId])

  useEffect(() => {
    load()
  }, [load])

  function toggleInSet(setter: React.Dispatch<React.SetStateAction<Set<string>>>, id: string) {
    setter((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function saveProfile(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setError(null)
    try {
      await fetchJson(`/admin/users/${userId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: editName.trim() || null,
          email: editEmail.trim(),
          role: editRole,
          password: editPassword.trim() || undefined,
        }),
      })
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  async function saveLocations() {
    setSaving(true)
    setError(null)
    try {
      await fetchJson(`/admin/users/${userId}/locations`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ locationIds: Array.from(selectedLocationIds) }),
      })
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  async function saveSkills() {
    setSaving(true)
    setError(null)
    try {
      await fetchJson(`/admin/users/${userId}/skills`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ skillIds: Array.from(selectedSkillIds) }),
      })
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="container" style={{ maxWidth: 1100 }}>
      <div className="rowBetween">
        <h1 className="pageTitle" style={{ margin: 0 }}>
          Admin — User
        </h1>
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <Link href="/admin/users" className="btn">
            Back to Users
          </Link>
          <Link href="/" className="btn">
            Home
          </Link>
        </div>
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
      {loading ? (
        <div style={{ marginTop: 12 }} className="muted">
          Loading...
        </div>
      ) : null}

      {!loading && user ? (
        <div style={{ display: 'grid', gap: 16, marginTop: 16 }}>
          <div className="card">
            <div className="cardBody">
              <h2 style={{ margin: '0 0 10px 0' }}>Profile</h2>
              <form onSubmit={saveProfile} className="stack">
              <div style={{ display: 'grid', gap: 6 }}>
                <label>Name</label>
                <input value={editName} onChange={(e) => setEditName(e.target.value)} className="input" />
              </div>
              <div style={{ display: 'grid', gap: 6 }}>
                <label>Email</label>
                <input value={editEmail} onChange={(e) => setEditEmail(e.target.value)} type="email" required className="input" />
              </div>
              <div style={{ display: 'grid', gap: 6 }}>
                <label>Role</label>
                <select
                  value={editRole}
                  onChange={(e) => setEditRole(e.target.value as UserRole)}
                  className="select"
                >
                  <option value="staff">staff</option>
                  <option value="manager">manager</option>
                  <option value="admin">admin</option>
                </select>
              </div>
              <div style={{ display: 'grid', gap: 6 }}>
                <label>Reset Password (optional)</label>
                <input
                  value={editPassword}
                  onChange={(e) => setEditPassword(e.target.value)}
                  type="password"
                  placeholder="Leave blank to keep current password"
                  className="input"
                />
              </div>
              <button type="submit" disabled={saving} className="btn btnPrimary" style={{ width: 180 }}>
                {saving ? 'Saving...' : 'Save Profile'}
              </button>
            </form>
            </div>
          </div>

          <div className="card">
            <div className="cardBody">
              <div className="rowBetween">
                <h2 style={{ margin: 0 }}>Assigned Locations</h2>
                <span className="badge">Assigned: {locations.length}</span>
              </div>
              <div style={{ display: 'grid', gap: 8, marginTop: 10 }}>
              {allLocations.map((l) => (
                <label key={l.id} style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                  <input
                    type="checkbox"
                    checked={selectedLocationIds.has(l.id)}
                    onChange={() => toggleInSet(setSelectedLocationIds, l.id)}
                  />
                  <span>
                    {l.name} <span className="muted">({l.timezone})</span>
                  </span>
                </label>
              ))}
              {allLocations.length === 0 ? <div className="muted">No locations seeded.</div> : null}
            </div>
            <div style={{ marginTop: 12 }} className="row">
              <button onClick={saveLocations} disabled={saving} className="btn">
                {saving ? 'Saving...' : 'Save Locations'}
              </button>
            </div>
            </div>
          </div>

          <div className="card">
            <div className="cardBody">
              <div className="rowBetween">
                <h2 style={{ margin: 0 }}>Skills</h2>
                <span className="badge">Assigned: {skills.length}</span>
              </div>
              <div style={{ display: 'grid', gap: 8, marginTop: 10 }}>
              {allSkills.map((s) => (
                <label key={s.id} style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                  <input type="checkbox" checked={selectedSkillIds.has(s.id)} onChange={() => toggleInSet(setSelectedSkillIds, s.id)} />
                  <span>{s.name}</span>
                </label>
              ))}
              {allSkills.length === 0 ? <div className="muted">No skills seeded.</div> : null}
            </div>
            <div style={{ marginTop: 12 }} className="row">
              <button onClick={saveSkills} disabled={saving} className="btn">
                {saving ? 'Saving...' : 'Save Skills'}
              </button>
            </div>
            </div>
          </div>
        </div>
      ) : null}

      {!loading && !user && !error ? (
        <div style={{ marginTop: 16 }} className="muted">
          User not found.
        </div>
      ) : null}
    </div>
  )
}
