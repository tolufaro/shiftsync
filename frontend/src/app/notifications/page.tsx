'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState } from 'react'

import { getSocket } from '../../lib/socket'

type NotificationRow = {
  id: string
  type: string
  message: string
  read: boolean
  metadata: unknown
  createdAt: string
}

export default function NotificationsPage() {
  const apiUrl = useMemo(() => process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001', [])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [rows, setRows] = useState<NotificationRow[]>([])
  const [unreadCount, setUnreadCount] = useState(0)

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
      const [list, cnt] = await Promise.all([
        fetchJson<{ notifications: NotificationRow[] }>('/me/notifications?limit=100'),
        fetchJson<{ count: number }>('/me/notifications/unread-count'),
      ])
      setRows(list.notifications)
      setUnreadCount(Number(cnt.count || 0))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load')
    } finally {
      setLoading(false)
    }
  }, [fetchJson])

  useEffect(() => {
    load()
  }, [load])

  useEffect(() => {
    const socket = getSocket(apiUrl)
    function onNotificationNew() {
      load()
    }
    socket.on('notification:new', onNotificationNew)
    return () => {
      socket.off('notification:new', onNotificationNew)
    }
  }, [apiUrl, load])

  async function markRead(id: string) {
    try {
      await fetchJson(`/me/notifications/${id}/read`, { method: 'PATCH' })
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed')
    }
  }

  async function markAllRead() {
    try {
      await fetchJson('/me/notifications/read-all', { method: 'POST' })
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed')
    }
  }

  return (
    <div className="container" style={{ maxWidth: 960 }}>
      <div className="rowBetween">
        <h1 className="pageTitle" style={{ margin: 0 }}>
          Notifications
        </h1>
        <Link href="/" className="btn">
          Home
        </Link>
      </div>

      <div className="rowBetween" style={{ marginTop: 12, alignItems: 'center' }}>
        <div className="badge">{unreadCount} unread</div>
        <div className="row">
          <button onClick={load} className="btn">
            Refresh
          </button>
          <button onClick={markAllRead} disabled={unreadCount === 0} className="btn btnPrimary">
            Mark all read
          </button>
        </div>
      </div>

      {error ? (
        <div className="card" style={{ marginTop: 12, borderColor: 'color-mix(in srgb, var(--danger) 35%, var(--border))' }}>
          <div className="cardBody" style={{ color: 'var(--danger)' }}>
            {error}
          </div>
        </div>
      ) : null}
      {loading ? <div style={{ marginTop: 12 }} className="muted">Loading...</div> : null}

      {!loading ? (
        <div className="stack" style={{ marginTop: 16 }}>
          {rows.map((n) => (
            <div
              key={n.id}
              className="card"
              style={{ background: n.read ? 'var(--surface)' : 'color-mix(in srgb, var(--primary) 8%, var(--surface))' }}
            >
              <div className="cardBody">
                <div className="rowBetween">
                  <div style={{ fontWeight: 800 }}>{n.type}</div>
                  <div className="muted">{new Date(n.createdAt).toLocaleString()}</div>
                </div>
                <div style={{ marginTop: 6 }}>{n.message}</div>
                <div className="rowBetween" style={{ marginTop: 10, alignItems: 'center' }}>
                  <div className={`badge ${n.read ? '' : 'badgeSuccess'}`}>{n.read ? 'Read' : 'Unread'}</div>
                  {!n.read ? (
                    <button onClick={() => markRead(n.id)} className="btn btnSmall">
                      Mark read
                    </button>
                  ) : null}
                </div>
              </div>
            </div>
          ))}
          {rows.length === 0 ? <div className="muted">No notifications.</div> : null}
        </div>
      ) : null}
    </div>
  )
}
