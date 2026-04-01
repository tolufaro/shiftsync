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
    <div style={{ maxWidth: 900, margin: '40px auto', padding: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'baseline' }}>
        <h1 style={{ margin: 0 }}>Notifications</h1>
        <Link href="/">Home</Link>
      </div>

      <div style={{ marginTop: 10, display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center' }}>
        <div style={{ color: '#555' }}>{unreadCount} unread</div>
        <div style={{ display: 'flex', gap: 10 }}>
          <button
            onClick={load}
            style={{ padding: '10px 12px', borderRadius: 8, border: '1px solid #111', background: '#fff', cursor: 'pointer' }}
          >
            Refresh
          </button>
          <button
            onClick={markAllRead}
            disabled={unreadCount === 0}
            style={{ padding: '10px 12px', borderRadius: 8, border: '1px solid #111', background: '#111', color: '#fff', cursor: 'pointer' }}
          >
            Mark all read
          </button>
        </div>
      </div>

      {error ? <div style={{ marginTop: 12, color: '#b00020' }}>{error}</div> : null}
      {loading ? <div style={{ marginTop: 12 }}>Loading...</div> : null}

      {!loading ? (
        <div style={{ marginTop: 16, display: 'grid', gap: 10 }}>
          {rows.map((n) => (
            <div
              key={n.id}
              style={{
                padding: 12,
                border: '1px solid #e5e5e5',
                borderRadius: 12,
                background: n.read ? '#fff' : '#f7fbff',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'baseline' }}>
                <div style={{ fontWeight: 700 }}>{n.type}</div>
                <div style={{ color: '#666' }}>{new Date(n.createdAt).toLocaleString()}</div>
              </div>
              <div style={{ marginTop: 6, color: '#222' }}>{n.message}</div>
              <div style={{ marginTop: 10, display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                <div style={{ color: '#666' }}>{n.read ? 'Read' : 'Unread'}</div>
                {!n.read ? (
                  <button
                    onClick={() => markRead(n.id)}
                    style={{ padding: '8px 10px', borderRadius: 8, border: '1px solid #111', background: '#fff', cursor: 'pointer' }}
                  >
                    Mark read
                  </button>
                ) : null}
              </div>
            </div>
          ))}
          {rows.length === 0 ? <div style={{ color: '#555' }}>No notifications.</div> : null}
        </div>
      ) : null}
    </div>
  )
}
