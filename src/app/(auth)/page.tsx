'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/contexts/AuthContext'
import type { AppConfig } from '@/types'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? ''

export default function AuthPage() {
  const { isAuthenticated, config, login, saveConfig } = useAuth()
  const router = useRouter()

  const [mode, setMode] = useState<'loading' | 'setup' | 'login'>('loading')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')

  // Setup form state
  const [company, setCompany] = useState('Actually Creative')
  const [newPass, setNewPass] = useState('')
  const [confirmPass, setConfirmPass] = useState('')
  const [slack, setSlack] = useState('')

  useEffect(() => {
    if (isAuthenticated) {
      router.replace('/dashboard')
      return
    }
    setMode(config ? 'login' : 'setup')
  }, [isAuthenticated, config, router])

  function handleLogin(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    const ok = login(password)
    if (ok) {
      router.replace('/dashboard')
    } else {
      setError('Incorrect password')
      setPassword('')
    }
  }

  function handleSetup(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    if (!company.trim()) { setError('Company name is required'); return }
    if (!newPass) { setError('Password is required'); return }
    if (newPass !== confirmPass) { setError('Passwords do not match'); return }

    const cfg: AppConfig = {
      url: SUPABASE_URL,
      key: SUPABASE_KEY,
      company: company.trim(),
      pass: btoa(newPass),
      slack: slack.trim(),
      reminderDays: 3,
    }
    saveConfig(cfg)
    const ok = login(newPass)
    if (ok) router.replace('/dashboard')
  }

  if (mode === 'loading') {
    return (
      <div className="min-h-screen bg-paper flex items-center justify-center">
        <div className="w-5 h-5 border-2 border-ink border-t-transparent animate-spin" />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-paper flex flex-col items-center justify-center px-4">
      {/* Wordmark */}
      <div className="mb-10 text-center">
        <h1 className="font-sans font-semibold text-3xl tracking-tight text-ink">AC Ledger</h1>
        <p className="font-mono text-xs uppercase tracking-widest text-muted mt-1">
          {mode === 'setup' ? 'First-time setup' : 'Financial management platform'}
        </p>
      </div>

      <div className="w-full max-w-sm">
        <div className="bg-white border border-rule" style={{ borderTopWidth: 2, borderTopColor: '#1a1a1a' }}>
          <div className="px-6 py-5 border-b border-rule bg-cream">
            <p className="font-mono text-xs uppercase tracking-widest text-muted">
              {mode === 'setup' ? 'Create Your Ledger' : 'Sign In'}
            </p>
          </div>

          <div className="px-6 py-6">
            {mode === 'setup' ? (
              <form onSubmit={handleSetup} className="space-y-4">
                <div>
                  <label className="field-label">Company Name</label>
                  <input
                    type="text"
                    value={company}
                    onChange={e => setCompany(e.target.value)}
                    className="w-full border border-rule bg-paper px-3 py-2 text-sm text-ink focus:outline-none focus:border-ink"
                    placeholder="Actually Creative"
                    required
                  />
                </div>
                <div>
                  <label className="field-label">Password</label>
                  <input
                    type="password"
                    value={newPass}
                    onChange={e => setNewPass(e.target.value)}
                    className="w-full border border-rule bg-paper px-3 py-2 text-sm text-ink focus:outline-none focus:border-ink"
                    placeholder="Choose a password"
                    required
                  />
                </div>
                <div>
                  <label className="field-label">Confirm Password</label>
                  <input
                    type="password"
                    value={confirmPass}
                    onChange={e => setConfirmPass(e.target.value)}
                    className="w-full border border-rule bg-paper px-3 py-2 text-sm text-ink focus:outline-none focus:border-ink"
                    placeholder="Repeat password"
                    required
                  />
                </div>
                <div>
                  <label className="field-label">Slack Webhook <span className="normal-case">(optional)</span></label>
                  <input
                    type="url"
                    value={slack}
                    onChange={e => setSlack(e.target.value)}
                    className="w-full border border-rule bg-paper px-3 py-2 text-sm text-ink focus:outline-none focus:border-ink"
                    placeholder="https://hooks.slack.com/..."
                  />
                </div>
                {error && (
                  <p className="font-mono text-xs text-red-600">{error}</p>
                )}
                <button
                  type="submit"
                  className="w-full bg-ink text-white px-4 py-2.5 text-sm font-medium hover:bg-[#333] transition-colors"
                >
                  Set Up Ledger
                </button>
              </form>
            ) : (
              <form onSubmit={handleLogin} className="space-y-4">
                <div>
                  <label className="field-label">Password</label>
                  <input
                    type="password"
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    className="w-full border border-rule bg-paper px-3 py-2 text-sm text-ink focus:outline-none focus:border-ink"
                    placeholder="Enter your password"
                    autoFocus
                    required
                  />
                </div>
                {error && (
                  <p className="font-mono text-xs text-red-600">{error}</p>
                )}
                <button
                  type="submit"
                  className="w-full bg-ink text-white px-4 py-2.5 text-sm font-medium hover:bg-[#333] transition-colors"
                >
                  Sign In
                </button>
              </form>
            )}
          </div>
        </div>

        {mode === 'login' && (
          <p className="mt-4 text-center font-mono text-xs text-muted">
            Actually Creative · Financial management
          </p>
        )}
      </div>
    </div>
  )
}
