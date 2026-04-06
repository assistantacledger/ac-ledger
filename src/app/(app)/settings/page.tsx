'use client'

import { useState } from 'react'
import { Header } from '@/components/layout/Header'
import { useAuth } from '@/contexts/AuthContext'
import { cn } from '@/lib/format'
import { ExternalLink, AlertTriangle } from 'lucide-react'

export default function SettingsPage() {
  const { config, saveConfig, resetConfig } = useAuth()

  const [slack, setSlack] = useState(config?.slack ?? '')
  const [reminderDays, setReminderDays] = useState(String(config?.reminderDays ?? 3))
  const [slackSaved, setSlackSaved] = useState(false)
  const [anthropicKey, setAnthropicKey] = useState(config?.anthropicKey ?? '')
  const [anthropicSaved, setAnthropicSaved] = useState(false)

  const [oldPass, setOldPass] = useState('')
  const [newPass, setNewPass] = useState('')
  const [confirmPass, setConfirmPass] = useState('')
  const [passError, setPassError] = useState('')
  const [passSaved, setPassSaved] = useState(false)

  const [resetConfirm, setResetConfirm] = useState(false)

  function saveSlack() {
    if (!config) return
    saveConfig({ ...config, slack: slack.trim(), reminderDays: parseInt(reminderDays) || 3 })
    setSlackSaved(true)
    setTimeout(() => setSlackSaved(false), 2500)
  }

  function saveAnthropicKey() {
    if (!config) return
    saveConfig({ ...config, anthropicKey: anthropicKey.trim() })
    setAnthropicSaved(true)
    setTimeout(() => setAnthropicSaved(false), 2500)
  }

  function changePassword() {
    setPassError('')
    setPassSaved(false)
    if (!config) return
    if (btoa(oldPass) !== config.pass) { setPassError('Current password is incorrect'); return }
    if (!newPass) { setPassError('New password is required'); return }
    if (newPass !== confirmPass) { setPassError('Passwords do not match'); return }
    saveConfig({ ...config, pass: btoa(newPass) })
    setOldPass(''); setNewPass(''); setConfirmPass('')
    setPassSaved(true)
    setTimeout(() => setPassSaved(false), 2500)
  }

  async function testSlack() {
    if (!slack) return
    try {
      const res = await fetch('/api/slack', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ webhookUrl: slack, text: '✅ AC Ledger — Slack connection test successful.' }),
      })
      alert(res.ok ? 'Test message sent!' : 'Failed to send. Check the webhook URL.')
    } catch {
      alert('Network error.')
    }
  }

  return (
    <>
      <Header title="Settings" subtitle="Slack & Security" />
      <main className="flex-1 overflow-y-auto px-6 py-6">
        <div className="max-w-xl space-y-5">

          {/* Slack */}
          <div className="s-section">
            <p className="tbl-lbl mb-4">Slack Notifications</p>
            <div className="space-y-4">
              <div>
                <label className="field-label">Webhook URL</label>
                <input
                  type="url"
                  value={slack}
                  onChange={e => { setSlack(e.target.value); setSlackSaved(false) }}
                  placeholder="https://hooks.slack.com/services/…"
                  className="w-full border border-rule bg-paper px-3 py-2 text-sm font-mono text-ink focus:outline-none focus:border-ink"
                />
                <p className="mt-1 font-mono text-[10px] text-muted">
                  Create a webhook at{' '}
                  <a
                    href="https://api.slack.com/apps"
                    target="_blank"
                    rel="noreferrer"
                    className="underline hover:text-ink"
                  >
                    api.slack.com/apps
                  </a>
                </p>
              </div>
              <div>
                <label className="field-label">Reminder Lead Time (days)</label>
                <input
                  type="number"
                  value={reminderDays}
                  onChange={e => { setReminderDays(e.target.value); setSlackSaved(false) }}
                  min="1" max="30"
                  className="w-24 border border-rule bg-paper px-3 py-2 text-sm font-mono text-ink focus:outline-none focus:border-ink"
                />
                <p className="mt-1 font-mono text-[10px] text-muted">
                  Alert for invoices due within this many days
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={saveSlack}
                  className={cn(
                    'px-4 py-2 text-xs font-mono uppercase tracking-wider transition-colors',
                    slackSaved ? 'bg-ac-green text-white' : 'bg-ink text-white hover:bg-[#333]'
                  )}
                >
                  {slackSaved ? 'Saved!' : 'Save Settings'}
                </button>
                {slack && (
                  <button
                    onClick={testSlack}
                    className="px-4 py-2 text-xs font-mono uppercase tracking-wider border border-rule text-muted hover:text-ink hover:border-ink transition-colors flex items-center gap-1.5"
                  >
                    <ExternalLink size={11} /> Test Webhook
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* Anthropic API */}
          <div className="s-section">
            <p className="tbl-lbl mb-4">AI Invoice Scanning</p>
            <div className="space-y-3">
              <div>
                <label className="field-label">Anthropic API Key</label>
                <input
                  type="password"
                  value={anthropicKey}
                  onChange={e => { setAnthropicKey(e.target.value); setAnthropicSaved(false) }}
                  placeholder="sk-ant-…"
                  className="w-full border border-rule bg-paper px-3 py-2 text-sm font-mono text-ink focus:outline-none focus:border-ink"
                />
                <p className="mt-1 font-mono text-[10px] text-muted">
                  Used by the Scan page to extract invoice data from PDFs and images.
                </p>
              </div>
              <button
                onClick={saveAnthropicKey}
                className={cn(
                  'px-4 py-2 text-xs font-mono uppercase tracking-wider transition-colors',
                  anthropicSaved ? 'bg-ac-green text-white' : 'bg-ink text-white hover:bg-[#333]'
                )}
              >
                {anthropicSaved ? 'Saved!' : 'Save Key'}
              </button>
            </div>
          </div>

          {/* Change password */}
          <div className="s-section">
            <p className="tbl-lbl mb-4">Change Password</p>
            <div className="space-y-3">
              <div>
                <label className="field-label">Current Password</label>
                <input
                  type="password"
                  value={oldPass}
                  onChange={e => { setOldPass(e.target.value); setPassError(''); setPassSaved(false) }}
                  className="w-full border border-rule bg-paper px-3 py-2 text-sm text-ink focus:outline-none focus:border-ink"
                />
              </div>
              <div>
                <label className="field-label">New Password</label>
                <input
                  type="password"
                  value={newPass}
                  onChange={e => { setNewPass(e.target.value); setPassError(''); setPassSaved(false) }}
                  className="w-full border border-rule bg-paper px-3 py-2 text-sm text-ink focus:outline-none focus:border-ink"
                />
              </div>
              <div>
                <label className="field-label">Confirm New Password</label>
                <input
                  type="password"
                  value={confirmPass}
                  onChange={e => { setConfirmPass(e.target.value); setPassError(''); setPassSaved(false) }}
                  className="w-full border border-rule bg-paper px-3 py-2 text-sm text-ink focus:outline-none focus:border-ink"
                />
              </div>
              {passError && <p className="font-mono text-xs text-red-600">{passError}</p>}
              <button
                onClick={changePassword}
                className={cn(
                  'px-4 py-2 text-xs font-mono uppercase tracking-wider transition-colors',
                  passSaved ? 'bg-ac-green text-white' : 'bg-ink text-white hover:bg-[#333]'
                )}
              >
                {passSaved ? 'Password Updated!' : 'Update Password'}
              </button>
            </div>
          </div>

          {/* Danger zone */}
          <div className="s-section" style={{ borderTopColor: '#dc2626' }}>
            <div className="flex items-center gap-2 mb-4">
              <AlertTriangle size={13} className="text-red-500" />
              <p className="tbl-lbl text-red-500">Danger Zone</p>
            </div>
            <p className="font-mono text-xs text-muted mb-4">
              Resetting the app clears all local configuration including company settings, password, and payment run history.
              Your Supabase data is not affected.
            </p>
            {!resetConfirm ? (
              <button
                onClick={() => setResetConfirm(true)}
                className="px-4 py-2 text-xs font-mono uppercase tracking-wider border border-red-300 text-red-500 hover:bg-red-50 transition-colors"
              >
                Reset App Config
              </button>
            ) : (
              <div className="flex items-center gap-3">
                <button
                  onClick={resetConfig}
                  className="px-4 py-2 text-xs font-mono uppercase tracking-wider bg-red-600 text-white hover:bg-red-700 transition-colors"
                >
                  Confirm Reset
                </button>
                <button
                  onClick={() => setResetConfirm(false)}
                  className="px-4 py-2 text-xs font-mono uppercase tracking-wider border border-rule text-muted hover:text-ink transition-colors"
                >
                  Cancel
                </button>
              </div>
            )}
          </div>

          {/* App info */}
          <div className="px-0 py-2">
            <p className="font-mono text-[10px] text-muted uppercase tracking-widest">
              AC Ledger · Built for Actually Creative · Supabase backend
            </p>
          </div>
        </div>
      </main>
    </>
  )
}
