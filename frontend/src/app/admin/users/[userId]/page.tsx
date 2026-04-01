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
    <div style={{ maxWidth: 1000, margin: '40px auto', padding: 16 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12 }}>
        <h1 style={{ margin: 0 }}>Admin — User</h1>
        <div style={{ display: 'flex', gap: 12 }}>
          <Link href="/admin/users">Back to Users</Link>
          <Link href="/">Home</Link>
        </div>
      </div>

      {me ? <div style={{ marginTop: 8, color: '#555' }}>Signed in as {me.email}</div> : null}

      {error ? <div style={{ marginTop: 12, color: '#b00020' }}>{error}</div> : null}
      {loading ? <div style={{ marginTop: 12 }}>Loading...</div> : null}

      {!loading && user ? (
        <div style={{ display: 'grid', gap: 16, marginTop: 16 }}>
          <div style={{ padding: 12, border: '1px solid #e5e5e5', borderRadius: 12 }}>
            <h2 style={{ margin: '0 0 10px 0' }}>Profile</h2>
            <form onSubmit={saveProfile} style={{ display: 'grid', gap: 10 }}>
              <div style={{ display: 'grid', gap: 6 }}>
                <label>Name</label>
                <input
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  style={{ padding: 10, borderRadius: 8, border: '1px solid #ccc' }}
                />
              </div>
              <div style={{ display: 'grid', gap: 6 }}>
                <label>Email</label>
                <input
                  value={editEmail}
                  onChange={(e) => setEditEmail(e.target.value)}
                  type="email"
                  required
                  style={{ padding: 10, borderRadius: 8, border: '1px solid #ccc' }}
                />
              </div>
              <div style={{ display: 'grid', gap: 6 }}>
                <label>Role</label>
                <select
                  value={editRole}
                  onChange={(e) => setEditRole(e.target.value as UserRole)}
                  style={{ padding: 10, borderRadius: 8, border: '1px solid #ccc' }}
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
                  style={{ padding: 10, borderRadius: 8, border: '1px solid #ccc' }}
                />
              </div>
              <button
                type="submit"
                disabled={saving}
                style={{
                  width: 180,
                  padding: 10,
                  borderRadius: 8,
                  border: '1px solid #111',
                  background: '#111',
                  color: '#fff',
                  cursor: 'pointer',
                }}
              >
                {saving ? 'Saving...' : 'Save Profile'}
              </button>
            </form>
          </div>

          <div style={{ padding: 12, border: '1px solid #e5e5e5', borderRadius: 12 }}>
            <h2 style={{ margin: '0 0 10px 0' }}>Assigned Locations</h2>
            <div style={{ display: 'grid', gap: 8 }}>
              {allLocations.map((l) => (
                <label key={l.id} style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                  <input
                    type="checkbox"
                    checked={selectedLocationIds.has(l.id)}
                    onChange={() => toggleInSet(setSelectedLocationIds, l.id)}
                  />
                  <span>
                    {l.name} <span style={{ color: '#666' }}>({l.timezone})</span>
                  </span>
                </label>
              ))}
              {allLocations.length === 0 ? <div style={{ color: '#555' }}>No locations seeded.</div> : null}
            </div>
            <div style={{ marginTop: 10, display: 'flex', gap: 12, alignItems: 'center' }}>
              <button
                onClick={saveLocations}
                disabled={saving}
                style={{
                  width: 200,
                  padding: 10,
                  borderRadius: 8,
                  border: '1px solid #111',
                  background: '#fff',
                  cursor: 'pointer',
                }}
              >
                {saving ? 'Saving...' : 'Save Locations'}
              </button>
              <div style={{ color: '#555' }}>Currently assigned: {locations.length}</div>
            </div>
          </div>

          <div style={{ padding: 12, border: '1px solid #e5e5e5', borderRadius: 12 }}>
            <h2 style={{ margin: '0 0 10px 0' }}>Skills</h2>
            <div style={{ display: 'grid', gap: 8 }}>
              {allSkills.map((s) => (
                <label key={s.id} style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                  <input type="checkbox" checked={selectedSkillIds.has(s.id)} onChange={() => toggleInSet(setSelectedSkillIds, s.id)} />
                  <span>{s.name}</span>
                </label>
              ))}
              {allSkills.length === 0 ? <div style={{ color: '#555' }}>No skills seeded.</div> : null}
            </div>
            <div style={{ marginTop: 10, display: 'flex', gap: 12, alignItems: 'center' }}>
              <button
                onClick={saveSkills}
                disabled={saving}
                style={{
                  width: 200,
                  padding: 10,
                  borderRadius: 8,
                  border: '1px solid #111',
                  background: '#fff',
                  cursor: 'pointer',
                }}
              >
                {saving ? 'Saving...' : 'Save Skills'}
              </button>
              <div style={{ color: '#555' }}>Currently assigned: {skills.length}</div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
