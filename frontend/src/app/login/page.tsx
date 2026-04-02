'use client'

'use client'

import Link from 'next/link'
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
    <div className="container" style={{ maxWidth: 520 }}>
      <div className="rowBetween">
        <h1 className="pageTitle" style={{ margin: 0 }}>
          Login
        </h1>
        <Link href="/" className="btn">
          Home
        </Link>
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <div className="cardBody stack">
          {error ? (
            <div className="card" style={{ borderColor: 'color-mix(in srgb, var(--danger) 35%, var(--border))' }}>
              <div className="cardBody" style={{ color: 'var(--danger)' }}>
                {error}
              </div>
            </div>
          ) : null}

          <form onSubmit={onSubmit} className="stack">
            <label style={{ display: 'grid', gap: 6 }}>
              <span style={{ fontWeight: 700 }}>Email</span>
              <input
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                type="email"
                required
                autoComplete="email"
                className="input"
              />
            </label>
            <label style={{ display: 'grid', gap: 6 }}>
              <span style={{ fontWeight: 700 }}>Password</span>
              <input
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                type="password"
                required
                autoComplete="current-password"
                className="input"
              />
            </label>
            <button type="submit" disabled={submitting} className="btn btnPrimary" style={{ width: '100%' }}>
              {submitting ? 'Logging in...' : 'Login'}
            </button>
          </form>
        </div>
      </div>
    </div>
  )
}
