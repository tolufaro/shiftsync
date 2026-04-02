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
    <div className="container" style={{ maxWidth: 840 }}>
      <div className="rowBetween">
        <h1 className="pageTitle" style={{ marginBottom: 12 }}>
          ShiftSync
        </h1>
        {user ? (
          <Link href="/notifications" className="btn" style={{ padding: '8px 10px' }}>
            <BellIcon />
            <span style={{ fontWeight: 700 }}>{unreadCount > 0 ? unreadCount : ''}</span>
          </Link>
        ) : null}
      </div>
      {loading ? <div>Loading...</div> : null}
      {!loading && !user ? (
        <div className="card">
          <div className="cardBody stack">
            <div className="muted">You are not logged in.</div>
            <Link href="/login" className="btn btnPrimary" style={{ width: 160 }}>
              Go to Login
            </Link>
          </div>
        </div>
      ) : null}
      {!loading && user ? (
        <div className="stack">
          <div className="card">
            <div className="cardBody rowBetween">
              <div>
                Logged in as <strong>{user.email}</strong>
              </div>
              <span className="badge">{user.role}</span>
            </div>
          </div>

          <div className="card">
            <div className="cardBody stack">
              <div className="row" style={{ flexWrap: 'wrap' }}>
                <Link href="/availability" className="btn">
                  My Availability
                </Link>
                <Link href="/my/schedule" className="btn">
                  My Schedule
                </Link>
                <Link href="/available-shifts" className="btn">
                  Available Shifts
                </Link>
                <Link href="/settings/notifications" className="btn">
                  Notification Settings
                </Link>
                <Link href="/settings/timezone" className="btn">
                  Timezone Settings
                </Link>
              </div>

              {(user.role === 'admin' || user.role === 'manager') && (
                <div className="row" style={{ flexWrap: 'wrap' }}>
                  <Link href="/manager/schedule" className="btn btnPrimary">
                    Manager Schedule
                  </Link>
                  <Link href="/manager/approvals" className="btn">
                    Manager Approvals
                  </Link>
                  <Link href="/manager/analytics" className="btn">
                    Fairness Analytics
                  </Link>
                </div>
              )}

              {user.role === 'admin' ? (
                <div className="row" style={{ flexWrap: 'wrap' }}>
                  <Link href="/admin/users" className="btn">
                    Admin: User Management
                  </Link>
                  <Link href="/admin/audit" className="btn">
                    Admin: Audit Export
                  </Link>
                </div>
              ) : null}

              <button onClick={logout} className="btn" style={{ width: 160 }}>
                Logout
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
