'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Header } from '@/components/layout/Header'
import { InvoicePreviewModal } from '@/components/invoices/InvoicePreviewModal'
import { fetchInvoices, fetchExpenses, autoMarkOverdue, sb } from '@/lib/supabase'
import { fmt, fmtDate, daysOverdue } from '@/lib/format'
import { toast } from '@/lib/toast'
import type { Invoice, Expense } from '@/types'
import { TrendingUp, TrendingDown, AlertCircle, Scale, Clock, ArrowRight, Eye, CheckCircle, X } from 'lucide-react'
import Link from 'next/link'
import { cn } from '@/lib/format'

type StatCardProps = {
  label: string
  value: string
  sub?: string
  accent: string
  icon: React.ReactNode
  trend?: 'up' | 'down' | 'neutral'
}

function StatCard({ label, value, sub, accent, icon, trend }: StatCardProps) {
  return (
    <div className="stat-card" style={{ borderTopColor: accent } as React.CSSProperties}>
      <div className="flex items-start justify-between mb-3">
        <p className="font-mono text-[10px] uppercase tracking-widest text-muted">{label}</p>
        <span className="text-muted">{icon}</span>
      </div>
      <p className="font-sans font-semibold text-2xl text-ink tracking-tight">{value}</p>
      {sub && <p className="font-mono text-xs text-muted mt-1">{sub}</p>}
    </div>
  )
}

function StatusBadge({ status }: { status: string }) {
  const cls: Record<string, string> = {
    paid: 'badge-paid',
    pending: 'badge-pending',
    overdue: 'badge-overdue',
    draft: 'badge-draft',
    submitted: 'badge-submitted',
    approved: 'badge-approved',
    sent: 'badge-sent',
    'part-paid': 'badge-part-paid',
  }
  return (
    <span className={cn('badge', cls[status] ?? 'badge-draft')}>
      {status}
    </span>
  )
}

export default function DashboardPage() {
  const router = useRouter()
  const [invoices, setInvoices] = useState<Invoice[]>([])
  const [expenses, setExpenses] = useState<Expense[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [previewing, setPreviewing] = useState<Invoice | null>(null)
  const [payNoteInvoice, setPayNoteInvoice] = useState<Invoice | null>(null)
  const [payNoteRef, setPayNoteRef] = useState('')

  async function markPaidInline(id: string, paymentRef?: string) {
    const inv = invoices.find(i => i.id === id)
    let newNotes = inv?.notes ?? null
    if (paymentRef?.trim()) {
      newNotes = `Payment ref: ${paymentRef.trim()}${newNotes ? `\n${newNotes}` : ''}`
    }
    await sb.from('invoices').update({ status: 'paid', notes: newNotes }).eq('id', id)
    setInvoices(prev => prev.map(i => i.id === id ? { ...i, status: 'paid' as const, notes: newNotes } : i))
    toast('Marked paid')
  }

  function promptMarkPaid(inv: Invoice) {
    setPayNoteRef('')
    setPayNoteInvoice(inv)
  }

  async function confirmMarkPaid() {
    if (!payNoteInvoice) return
    await markPaidInline(payNoteInvoice.id, payNoteRef)
    setPayNoteInvoice(null)
  }

  useEffect(() => {
    async function load() {
      try {
        const [inv, exp] = await Promise.all([fetchInvoices(), fetchExpenses()])
        await autoMarkOverdue(inv)
        // Re-apply overdue status locally without refetching
        const today = new Date().toISOString().split('T')[0]
        const updated = inv.map(i =>
          i.status === 'pending' && i.due && i.due < today ? { ...i, status: 'overdue' as const } : i
        )
        setInvoices(updated)
        setExpenses(exp)
      } catch (e) {
        setError(String(e))
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  // ─── Computed stats ───────────────────────────────────────────────────────

  const openPayable = invoices.filter(
    i => i.type === 'payable' && !['paid', 'draft'].includes(i.status)
  )
  const openReceivable = invoices.filter(
    i => i.type === 'receivable' && !['paid', 'draft'].includes(i.status)
  )
  const overdue = invoices.filter(i => i.status === 'overdue')
  const pendingExpenses = expenses.filter(i => i.status === 'submitted')

  const sum = (arr: Invoice[]) => arr.reduce((t, i) => t + Number(i.amount), 0)
  const sumExp = (arr: Expense[]) => arr.reduce((t, e) => t + Number(e.total), 0)

  const totalPayable = sum(openPayable)
  const totalReceivable = sum(openReceivable)
  const totalOverdue = sum(overdue)
  const netPosition = totalReceivable - totalPayable

  // Recent invoices (last 8)
  const recent = [...invoices]
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    .slice(0, 8)

  // Upcoming dues (next 14 days)
  const today = new Date()
  const in14 = new Date(today)
  in14.setDate(in14.getDate() + 14)
  const upcoming = invoices
    .filter(i => {
      if (!i.due || ['paid', 'draft'].includes(i.status)) return false
      const d = new Date(i.due)
      return d >= today && d <= in14
    })
    .sort((a, b) => (a.due! > b.due! ? 1 : -1))
    .slice(0, 5)

  // Sort overdue by most overdue first (earliest due date)
  const overdueChase = [...overdue].sort((a, b) =>
    (a.due ?? '') < (b.due ?? '') ? -1 : 1
  )

  return (
    <>
      <InvoicePreviewModal invoice={previewing} onClose={() => setPreviewing(null)} />

      {/* Payment reference dialog */}
      {payNoteInvoice && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white border border-rule shadow-xl w-80">
            <div className="flex items-center justify-between px-5 py-4 border-b border-rule">
              <p className="font-mono text-xs uppercase tracking-wider text-ink">Mark as Paid</p>
              <button onClick={() => setPayNoteInvoice(null)} className="text-muted hover:text-ink">
                <X size={14} />
              </button>
            </div>
            <div className="px-5 py-4">
              <p className="text-sm text-ink mb-1">{payNoteInvoice.party}</p>
              <p className="font-mono text-xs text-muted mb-4">{payNoteInvoice.ref} · {fmt(payNoteInvoice.amount, payNoteInvoice.currency)}</p>
              <label className="field-label">Payment Reference <span className="normal-case text-muted">(optional)</span></label>
              <input
                autoFocus
                type="text"
                value={payNoteRef}
                onChange={e => setPayNoteRef(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && void confirmMarkPaid()}
                placeholder="e.g. bank transfer ref, cheque no."
                className="w-full border border-rule bg-paper px-3 py-2 text-sm text-ink focus:outline-none focus:border-ink mt-1"
              />
            </div>
            <div className="flex gap-2 px-5 pb-4">
              <button
                onClick={() => setPayNoteInvoice(null)}
                className="flex-1 px-3 py-2 text-xs font-mono uppercase tracking-wider border border-rule text-muted hover:text-ink hover:border-ink transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => void confirmMarkPaid()}
                className="flex-1 px-3 py-2 text-xs font-mono uppercase tracking-wider bg-ac-green text-white hover:bg-ac-green/90 transition-colors"
              >
                Mark Paid
              </button>
            </div>
          </div>
        </div>
      )}

      <Header title="Dashboard" />

      <main className="flex-1 overflow-y-auto px-6 py-6">
        {error && (
          <div className="mb-5 border border-red-200 bg-red-50 px-4 py-3 font-mono text-xs text-red-700">
            Failed to load data: {error}
          </div>
        )}

        {/* ── Stat cards ──────────────────────────────────────────────── */}
        <div className="grid grid-cols-2 xl:grid-cols-4 gap-4 mb-6">
          <StatCard
            label="To Receive"
            value={loading ? '—' : fmt(totalReceivable)}
            sub={loading ? undefined : `${openReceivable.length} open invoice${openReceivable.length !== 1 ? 's' : ''}`}
            accent="#3a7a5a"
            icon={<TrendingDown size={16} />}
          />
          <StatCard
            label="To Pay"
            value={loading ? '—' : fmt(totalPayable)}
            sub={loading ? undefined : `${openPayable.length} open invoice${openPayable.length !== 1 ? 's' : ''}`}
            accent="#7a6a3a"
            icon={<TrendingUp size={16} />}
          />
          <StatCard
            label="Overdue"
            value={loading ? '—' : fmt(totalOverdue)}
            sub={loading ? undefined : `${overdue.length} invoice${overdue.length !== 1 ? 's' : ''} past due`}
            accent={overdue.length > 0 ? '#dc2626' : '#2a2a2a'}
            icon={<AlertCircle size={16} />}
          />
          <StatCard
            label="Net Position"
            value={loading ? '—' : `${netPosition >= 0 ? '+' : ''}${fmt(netPosition)}`}
            sub={loading ? undefined : `${pendingExpenses.length} expense${pendingExpenses.length !== 1 ? 's' : ''} pending approval`}
            accent="#2a2a2a"
            icon={<Scale size={16} />}
          />
        </div>

        {/* ── Overdue Chase List ───────────────────────────────────────── */}
        {!loading && overdueChase.length > 0 && (
          <div className="mb-6 tbl-card" style={{ borderTopColor: '#dc2626', borderTopWidth: 3 }}>
            <div className="tbl-hd">
              <div className="flex items-center gap-2">
                <AlertCircle size={13} className="text-red-500" />
                <p className="tbl-lbl text-red-600">Overdue — Action Required</p>
              </div>
              <span className="font-mono text-xs text-red-500">
                {overdueChase.length} invoice{overdueChase.length !== 1 ? 's' : ''} · {fmt(totalOverdue)}
              </span>
            </div>
            <table className="w-full">
              <thead>
                <tr className="border-b border-rule bg-red-50/30">
                  <th className="tbl-lbl text-left px-5 py-2.5">Overdue</th>
                  <th className="tbl-lbl text-left px-3 py-2.5">Party</th>
                  <th className="tbl-lbl text-left px-3 py-2.5">Ref</th>
                  <th className="tbl-lbl text-left px-3 py-2.5 hidden md:table-cell">Project</th>
                  <th className="tbl-lbl text-left px-3 py-2.5 hidden lg:table-cell">Entity</th>
                  <th className="tbl-lbl text-right px-5 py-2.5">Amount</th>
                  <th className="w-28 px-3 py-2.5" />
                </tr>
              </thead>
              <tbody>
                {overdueChase.map(inv => (
                  <tr key={inv.id} className="border-b border-rule last:border-0 hover:bg-red-50/30 transition-colors group">
                    <td className="px-5 py-2.5">
                      <span className="font-mono text-xs font-semibold text-red-600">
                        +{daysOverdue(inv.due!)}d
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-sm text-ink font-medium max-w-[160px] truncate">{inv.party}</td>
                    <td className="px-3 py-2.5 font-mono text-xs text-muted">{inv.ref || '—'}</td>
                    <td className="px-3 py-2.5 font-mono text-xs text-muted hidden md:table-cell">
                      {inv.project_code ?? '—'}
                    </td>
                    <td className="px-3 py-2.5 font-mono text-[10px] text-muted hidden lg:table-cell truncate">
                      {inv.entity}
                    </td>
                    <td className="px-5 py-2.5 text-sm font-semibold text-right text-red-600 whitespace-nowrap">
                      {fmt(inv.amount, inv.currency)}
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="row-actions justify-end opacity-0 group-hover:opacity-100 gap-1">
                        <button
                          onClick={() => setPreviewing(inv)}
                          title="View"
                          className="p-1 text-muted hover:text-ink transition-colors"
                        >
                          <Eye size={12} />
                        </button>
                        <button
                          onClick={() => promptMarkPaid(inv)}
                          className="flex items-center gap-1 px-2 py-1 text-[10px] font-mono uppercase tracking-wider bg-ac-green text-white hover:bg-ac-green/80 transition-colors whitespace-nowrap"
                        >
                          <CheckCircle size={9} /> Mark Paid
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
          {/* ── Recent Invoices ──────────────────────────────────────── */}
          <div className="xl:col-span-2 tbl-card">
            <div className="tbl-hd">
              <p className="tbl-lbl">Recent Invoices</p>
              <div className="flex gap-3">
                <Link href="/receivable" className="font-mono text-xs text-muted hover:text-ink transition-colors flex items-center gap-1">
                  Receivable <ArrowRight size={10} />
                </Link>
                <Link href="/payable" className="font-mono text-xs text-muted hover:text-ink transition-colors flex items-center gap-1">
                  Payable <ArrowRight size={10} />
                </Link>
              </div>
            </div>

            {loading ? (
              <div className="px-5 py-10 text-center">
                <div className="w-5 h-5 border-2 border-rule border-t-ink animate-spin mx-auto" />
              </div>
            ) : recent.length === 0 ? (
              <div className="px-5 py-10 text-center font-mono text-xs text-muted">
                No invoices yet
              </div>
            ) : (
              <table className="w-full">
                <thead>
                  <tr className="border-b border-rule">
                    <th className="tbl-lbl text-left px-5 py-2.5">Ref</th>
                    <th className="tbl-lbl text-left px-3 py-2.5">Party</th>
                    <th className="tbl-lbl text-left px-3 py-2.5">Type</th>
                    <th className="tbl-lbl text-left px-3 py-2.5">Due</th>
                    <th className="tbl-lbl text-right px-5 py-2.5">Amount</th>
                    <th className="tbl-lbl text-left px-3 py-2.5">Status</th>
                    <th className="w-16 px-3 py-2.5" />
                  </tr>
                </thead>
                <tbody>
                  {recent.map((inv, i) => (
                    <tr key={inv.id} className={cn('border-b border-rule last:border-0 hover:bg-cream/60 transition-colors group', i % 2 === 0 ? '' : 'bg-paper/40')}>
                      <td className="px-5 py-2.5 font-mono text-xs text-ink whitespace-nowrap">{inv.ref || '—'}</td>
                      <td className="px-3 py-2.5 text-sm text-ink max-w-[160px] truncate">
                        {inv.project_code
                          ? <button onClick={() => router.push(`/projects?open=${inv.project_code}`)} className="hover:underline">{inv.party}</button>
                          : inv.party}
                      </td>
                      <td className="px-3 py-2.5">
                        <span className={cn('font-mono text-[10px] uppercase tracking-wider', inv.type === 'receivable' ? 'text-ac-green' : 'text-ac-amber')}>
                          {inv.type === 'receivable' ? 'IN' : 'OUT'}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 font-mono text-xs whitespace-nowrap">
                        {inv.due ? (
                          <span className={cn(inv.status === 'overdue' ? 'text-red-600' : 'text-muted')}>
                            {fmtDate(inv.due)}{inv.status === 'overdue' && <span className="ml-1 text-red-500">(+{daysOverdue(inv.due)}d)</span>}
                          </span>
                        ) : '—'}
                      </td>
                      <td className="px-5 py-2.5 text-sm font-semibold text-right whitespace-nowrap">{fmt(inv.amount, inv.currency)}</td>
                      <td className="px-3 py-2.5"><StatusBadge status={inv.status} /></td>
                      <td className="px-3 py-2.5">
                        <div className="row-actions justify-end opacity-0 group-hover:opacity-100">
                          <button onClick={() => setPreviewing(inv)} title="View PDF" className="p-1 text-muted hover:text-ink transition-colors"><Eye size={12} /></button>
                          {inv.status !== 'paid' && (
                            <button onClick={() => promptMarkPaid(inv)} title="Mark paid" className="p-1 text-muted hover:text-ac-green transition-colors"><CheckCircle size={12} /></button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {/* ── Right column ─────────────────────────────────────────── */}
          <div className="flex flex-col gap-4">
            {/* Upcoming dues */}
            <div className="tbl-card">
              <div className="tbl-hd">
                <p className="tbl-lbl">Due in 14 Days</p>
                <Clock size={13} className="text-muted" />
              </div>
              {loading ? (
                <div className="px-5 py-6 text-center">
                  <div className="w-4 h-4 border-2 border-rule border-t-ink animate-spin mx-auto" />
                </div>
              ) : upcoming.length === 0 ? (
                <div className="px-5 py-6 text-center font-mono text-xs text-muted">
                  Nothing due soon
                </div>
              ) : (
                <div className="divide-y divide-rule">
                  {upcoming.map(inv => (
                    <div key={inv.id} className="px-5 py-3 flex items-center justify-between gap-2 group">
                      <div className="min-w-0">
                        <p className="text-sm text-ink truncate">{inv.party}</p>
                        <p className="font-mono text-xs text-muted">{fmtDate(inv.due)}</p>
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <div className="row-actions opacity-0 group-hover:opacity-100">
                          <button onClick={() => setPreviewing(inv)} title="View PDF" className="p-1 text-muted hover:text-ink"><Eye size={12} /></button>
                          {inv.status !== 'paid' && (
                            <button onClick={() => markPaidInline(inv.id)} title="Mark paid" className="p-1 text-muted hover:text-ac-green"><CheckCircle size={12} /></button>
                          )}
                        </div>
                        <div className="text-right">
                          <p className="text-sm font-semibold text-ink">{fmt(inv.amount, inv.currency)}</p>
                          <StatusBadge status={inv.status} />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Pending expenses */}
            <div className="tbl-card">
              <div className="tbl-hd">
                <p className="tbl-lbl">Pending Expenses</p>
                <Link href="/expenses" className="font-mono text-xs text-muted hover:text-ink transition-colors">
                  View all
                </Link>
              </div>
              {loading ? (
                <div className="px-5 py-6 text-center">
                  <div className="w-4 h-4 border-2 border-rule border-t-ink animate-spin mx-auto" />
                </div>
              ) : pendingExpenses.length === 0 ? (
                <div className="px-5 py-6 text-center font-mono text-xs text-muted">
                  No pending expenses
                </div>
              ) : (
                <div className="divide-y divide-rule">
                  {pendingExpenses.slice(0, 5).map(exp => (
                    <div key={exp.id} className="px-5 py-3 flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-sm text-ink truncate">{exp.employee}</p>
                        <p className="font-mono text-xs text-muted">{fmtDate(exp.date)}</p>
                      </div>
                      <p className="text-sm font-semibold text-ink flex-shrink-0">
                        {fmt(exp.total)}
                      </p>
                    </div>
                  ))}
                  {pendingExpenses.length > 5 && (
                    <div className="px-5 py-2.5">
                      <Link href="/expenses" className="font-mono text-xs text-muted hover:text-ink transition-colors">
                        +{pendingExpenses.length - 5} more
                      </Link>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </main>
    </>
  )
}
