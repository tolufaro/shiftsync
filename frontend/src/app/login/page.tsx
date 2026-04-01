'use client'

import { useRouter } from 'next/navigation'
import { useMemo, useState } from 'react'

export default function LoginPage() {
  const router = useRouter()
  const apiUrl = useMemo(() => process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001', [])

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSubmitting(true)
    setError(null)

    try {
      const res = await fetch(`${apiUrl}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ email, password }),
      })

      if (!res.ok) {
        setError('Invalid email or password')
        return
      }

      router.push('/')
    } catch {
      setError('Login failed')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div style={{ maxWidth: 420, margin: '40px auto', padding: 16 }}>
      <h1 style={{ marginBottom: 12 }}>Login</h1>
      <form onSubmit={onSubmit} style={{ display: 'grid', gap: 12 }}>
        <label style={{ display: 'grid', gap: 6 }}>
          <span>Email</span>
          <input
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            type="email"
            required
            autoComplete="email"
            style={{ padding: 10, borderRadius: 8, border: '1px solid #ccc' }}
          />
        </label>
        <label style={{ display: 'grid', gap: 6 }}>
          <span>Password</span>
          <input
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            type="password"
            required
            autoComplete="current-password"
            style={{ padding: 10, borderRadius: 8, border: '1px solid #ccc' }}
          />
        </label>
        {error ? <div style={{ color: '#b00020' }}>{error}</div> : null}
        <button
          type="submit"
          disabled={submitting}
          style={{
            padding: 10,
            borderRadius: 8,
            border: '1px solid #111',
            background: '#111',
            color: '#fff',
            cursor: 'pointer',
          }}
        >
          {submitting ? 'Logging in...' : 'Login'}
        </button>
      </form>
    </div>
  )
}
