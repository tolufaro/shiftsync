'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState } from 'react'

type UserRole = 'admin' | 'manager' | 'staff'

type UserRow = {
  id: string
  email: string
  name: string | null
  role: UserRole
  created_at: string
}

export default function AdminUsersPage() {
  const apiUrl = useMemo(() => process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001', [])

  const [me, setMe] = useState<{ id: string; email: string; role: UserRole } | null>(null)
  const [users, setUsers] = useState<UserRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [q, setQ] = useState('')
  const [role, setRole] = useState<UserRole | ''>('')

  const [createName, setCreateName] = useState('')
  const [createEmail, setCreateEmail] = useState('')
  const [createPassword, setCreatePassword] = useState('')
  const [createRole, setCreateRole] = useState<UserRole>('staff')
  const [creating, setCreating] = useState(false)

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
        setUsers([])
        setError('Admin access required')
        return
      }

      const params = new URLSearchParams()
      if (q.trim()) params.set('q', q.trim())
      if (role) params.set('role', role)
      const qs = params.toString()

      const usersData = await fetchJson<{ users: UserRow[] }>(`/admin/users${qs ? `?${qs}` : ''}`)
      setUsers(usersData.users)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load')
    } finally {
      setLoading(false)
    }
  }, [fetchJson, q, role])

  useEffect(() => {
    load()
  }, [load])

  async function onCreate(e: React.FormEvent) {
    e.preventDefault()
    setCreating(true)
    setError(null)
    try {
      await fetchJson('/admin/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: createName.trim() || null,
          email: createEmail.trim(),
          password: createPassword,
          role: createRole,
        }),
      })
      setCreateName('')
      setCreateEmail('')
      setCreatePassword('')
      setCreateRole('staff')
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Create failed')
    } finally {
      setCreating(false)
    }
  }

  return (
    <div style={{ maxWidth: 1000, margin: '40px auto', padding: 16 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12 }}>
        <h1 style={{ margin: 0 }}>Admin — Users</h1>
        <Link href="/">Home</Link>
      </div>

      {me ? <div style={{ marginTop: 8, color: '#555' }}>Signed in as {me.email}</div> : null}

      <div style={{ marginTop: 20, padding: 12, border: '1px solid #e5e5e5', borderRadius: 12 }}>
        <h2 style={{ margin: '0 0 10px 0' }}>Create User</h2>
        <form onSubmit={onCreate} style={{ display: 'grid', gap: 10 }}>
          <div style={{ display: 'grid', gap: 6 }}>
            <label>Name</label>
            <input
              value={createName}
              onChange={(e) => setCreateName(e.target.value)}
              style={{ padding: 10, borderRadius: 8, border: '1px solid #ccc' }}
            />
          </div>
          <div style={{ display: 'grid', gap: 6 }}>
            <label>Email</label>
            <input
              value={createEmail}
              onChange={(e) => setCreateEmail(e.target.value)}
              type="email"
              required
              style={{ padding: 10, borderRadius: 8, border: '1px solid #ccc' }}
            />
          </div>
          <div style={{ display: 'grid', gap: 6 }}>
            <label>Password</label>
            <input
              value={createPassword}
              onChange={(e) => setCreatePassword(e.target.value)}
              type="password"
              required
              style={{ padding: 10, borderRadius: 8, border: '1px solid #ccc' }}
            />
          </div>
          <div style={{ display: 'grid', gap: 6 }}>
            <label>Role</label>
            <select
              value={createRole}
              onChange={(e) => setCreateRole(e.target.value as UserRole)}
              style={{ padding: 10, borderRadius: 8, border: '1px solid #ccc' }}
            >
              <option value="staff">staff</option>
              <option value="manager">manager</option>
              <option value="admin">admin</option>
            </select>
          </div>
          <button
            type="submit"
            disabled={creating}
            style={{
              width: 160,
              padding: 10,
              borderRadius: 8,
              border: '1px solid #111',
              background: '#111',
              color: '#fff',
              cursor: 'pointer',
            }}
          >
            {creating ? 'Creating...' : 'Create'}
          </button>
        </form>
      </div>

      <div style={{ marginTop: 20, padding: 12, border: '1px solid #e5e5e5', borderRadius: 12 }}>
        <h2 style={{ margin: '0 0 10px 0' }}>Users</h2>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
          <input
            placeholder="Search name/email..."
            value={q}
            onChange={(e) => setQ(e.target.value)}
            style={{ padding: 10, borderRadius: 8, border: '1px solid #ccc', minWidth: 240 }}
          />
          <select
            value={role}
            onChange={(e) => setRole(e.target.value as UserRole | '')}
            style={{ padding: 10, borderRadius: 8, border: '1px solid #ccc' }}
          >
            <option value="">all roles</option>
            <option value="admin">admin</option>
            <option value="manager">manager</option>
            <option value="staff">staff</option>
          </select>
          <button
            onClick={load}
            style={{
              padding: '10px 12px',
              borderRadius: 8,
              border: '1px solid #111',
              background: '#fff',
              cursor: 'pointer',
            }}
          >
            Refresh
          </button>
        </div>

        {error ? <div style={{ marginTop: 12, color: '#b00020' }}>{error}</div> : null}
        {loading ? <div style={{ marginTop: 12 }}>Loading...</div> : null}

        {!loading ? (
          <div style={{ marginTop: 12, overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={{ textAlign: 'left', padding: 8, borderBottom: '1px solid #eee' }}>Email</th>
                  <th style={{ textAlign: 'left', padding: 8, borderBottom: '1px solid #eee' }}>Name</th>
                  <th style={{ textAlign: 'left', padding: 8, borderBottom: '1px solid #eee' }}>Role</th>
                  <th style={{ textAlign: 'left', padding: 8, borderBottom: '1px solid #eee' }}>Created</th>
                  <th style={{ textAlign: 'right', padding: 8, borderBottom: '1px solid #eee' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.id}>
                    <td style={{ padding: 8, borderBottom: '1px solid #f3f3f3' }}>{u.email}</td>
                    <td style={{ padding: 8, borderBottom: '1px solid #f3f3f3' }}>{u.name || '-'}</td>
                    <td style={{ padding: 8, borderBottom: '1px solid #f3f3f3' }}>{u.role}</td>
                    <td style={{ padding: 8, borderBottom: '1px solid #f3f3f3' }}>
                      {new Date(u.created_at).toLocaleString()}
                    </td>
                    <td style={{ padding: 8, borderBottom: '1px solid #f3f3f3', textAlign: 'right' }}>
                      <Link href={`/admin/users/${u.id}`}>Manage</Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {users.length === 0 ? <div style={{ marginTop: 10, color: '#555' }}>No users found.</div> : null}
          </div>
        ) : null}
      </div>
    </div>
  )
}
