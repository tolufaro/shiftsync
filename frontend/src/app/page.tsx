'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'

type User = { id: string; email: string; role?: string; created_at?: string }

export default function Home() {
  const apiUrl = useMemo(() => process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001', [])
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      try {
        const res = await fetch(`${apiUrl}/auth/me`, { credentials: 'include' })
        if (!res.ok) {
          if (!cancelled) setUser(null)
          return
        }
        const data = await res.json()
        if (!cancelled) setUser(data.user)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [apiUrl])

  async function logout() {
    await fetch(`${apiUrl}/auth/logout`, { method: 'POST', credentials: 'include' })
    setUser(null)
  }

  return (
    <div style={{ maxWidth: 720, margin: '40px auto', padding: 16 }}>
      <h1 style={{ marginBottom: 12 }}>ShiftSync</h1>
      {loading ? <div>Loading...</div> : null}
      {!loading && !user ? (
        <div style={{ display: 'grid', gap: 12 }}>
          <div>You are not logged in.</div>
          <Link href="/login">Go to Login</Link>
        </div>
      ) : null}
      {!loading && user ? (
        <div style={{ display: 'grid', gap: 12 }}>
          <div>
            Logged in as <strong>{user.email}</strong>
          </div>
          <Link href="/availability">My Availability</Link>
          <Link href="/my/schedule">My Schedule</Link>
          <Link href="/available-shifts">Available Shifts</Link>
          {user.role === 'admin' || user.role === 'manager' ? <Link href="/manager/schedule">Manager Schedule</Link> : null}
          {user.role === 'admin' || user.role === 'manager' ? <Link href="/manager/approvals">Manager Approvals</Link> : null}
          {user.role === 'admin' || user.role === 'manager' ? <Link href="/manager/analytics">Fairness Analytics</Link> : null}
          {user.role === 'admin' ? <Link href="/admin/users">Admin: User Management</Link> : null}
          <button
            onClick={logout}
            style={{
              width: 160,
              padding: 10,
              borderRadius: 8,
              border: '1px solid #111',
              background: '#fff',
              cursor: 'pointer',
            }}
          >
            Logout
          </button>
        </div>
      ) : null}
    </div>
  )
}
