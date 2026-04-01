'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState } from 'react'

import { getSocket } from '../lib/socket'

type User = { id: string; email: string; role?: string; created_at?: string }

export default function Home() {
  const apiUrl = useMemo(() => process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001', [])
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)
  const [unreadCount, setUnreadCount] = useState<number>(0)

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

  const loadUnreadCount = useCallback(async () => {
    try {
      const res = await fetch(`${apiUrl}/me/notifications/unread-count`, { credentials: 'include' })
      if (!res.ok) return
      const data = await res.json()
      setUnreadCount(Number(data?.count || 0))
    } catch {}
  }, [apiUrl])

  useEffect(() => {
    if (!user) return
    loadUnreadCount()
  }, [user, loadUnreadCount])

  useEffect(() => {
    if (!user) return
    const socket = getSocket(apiUrl)
    function onNotificationNew() {
      loadUnreadCount()
    }
    socket.on('notification:new', onNotificationNew)
    return () => {
      socket.off('notification:new', onNotificationNew)
    }
  }, [apiUrl, user, loadUnreadCount])

  async function logout() {
    await fetch(`${apiUrl}/auth/logout`, { method: 'POST', credentials: 'include' })
    setUser(null)
  }

  function BellIcon(props: { size?: number }) {
    const size = props.size || 18
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path
          d="M18 8a6 6 0 10-12 0c0 7-3 7-3 7h18s-3 0-3-7Z"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path d="M13.73 21a2 2 0 01-3.46 0" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      </svg>
    )
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
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12 }}>
            <div>
              Logged in as <strong>{user.email}</strong>
            </div>
            <Link href="/notifications" style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
              <BellIcon />
              <span>{unreadCount > 0 ? `(${unreadCount})` : ''}</span>
            </Link>
          </div>
          <Link href="/availability">My Availability</Link>
          <Link href="/my/schedule">My Schedule</Link>
          <Link href="/available-shifts">Available Shifts</Link>
          <Link href="/settings/notifications">Notification Settings</Link>
          <Link href="/settings/timezone">Timezone Settings</Link>
          {user.role === 'admin' || user.role === 'manager' ? <Link href="/manager/schedule">Manager Schedule</Link> : null}
          {user.role === 'admin' || user.role === 'manager' ? <Link href="/manager/approvals">Manager Approvals</Link> : null}
          {user.role === 'admin' || user.role === 'manager' ? <Link href="/manager/analytics">Fairness Analytics</Link> : null}
          {user.role === 'admin' ? <Link href="/admin/users">Admin: User Management</Link> : null}
          {user.role === 'admin' ? <Link href="/admin/audit">Admin: Audit Export</Link> : null}
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
