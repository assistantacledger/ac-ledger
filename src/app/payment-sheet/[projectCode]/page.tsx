'use client'

import { useState, useEffect, useCallback } from 'react'
import { useParams } from 'next/navigation'
import { Check, X, Paperclip, ExternalLink, RefreshCw, Lock } from 'lucide-react'
import { sb } from '@/lib/supabase'
import { cn, fmt, fmtDate, todayISO } from '@/lib/format'
import type { Invoice, BankDetails } from '@/types'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function resolveBankDetails(inv: Invoice): Partial<BankDetails> {
  if (inv.bank_details) return inv.bank_details
  if (inv.notes?.includes('Bank:')) {
    const get = (label: string) => {
      const m = inv.notes!.match(new RegExp(`${label}:\\s*([^|\\n]+)`))
      return m ? m[1].trim() : undefined
    }
    const bankName = get('Bank')
    if (bankName) return { bankName, sortCode: get('Sort'), accNum: get('Acc'), accName: get('Name'), iban: get('IBAN'), swift: get('SWIFT') }
  }
  return {}
}

function getDescription(inv: Invoice): string {
  const lines = inv.line_items?.map(l => l.description).filter(Boolean) ?? []
  if (lines.length > 0) return lines.join(', ')
  const raw = inv.notes ?? ''
  const metaEnd = raw.indexOf('||', 2)
  return ((metaEnd > 0 ? raw.slice(metaEnd + 2) : raw).replace(/^\n/, '').split('\n')[0] ?? '').trim()
}

function isOverdue(inv: Invoice): boolean {
  return inv.status !== 'paid' && !!inv.due && inv.due < todayISO()
}

// Simple password check against stored app config
function checkPassword(entered: string): boolean {
  try {
    const raw = localStorage.getItem('ledger_cfg3')
    if (!raw) return false
    const cfg = JSON.parse(raw) as { pass: string }
    return entered === atob(cfg.pass)
  } catch { return false }
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function PublicPaymentSheetPage() {
  const params = useParams()
  const projectCode = typeof params.projectCode === 'string' ? params.projectCode : ''

  // Auth state
  const [authed, setAuthed] = useState(false)
  const [password, setPassword] = useState('')
  const [pwError, setPwError] = useState('')
  const [checkingAuto, setCheckingAuto] = useState(true)

  // Data
  const [invoices, setInvoices] = useState<Invoice[]>([])
  const [projectName, setProjectName] = useState(projectCode)
  const [loading, setLoading] = useState(false)
  const [markingPaid, setMarkingPaid] = useState<Set<string>>(new Set())
  const [lightbox, setLightbox] = useState<{ url: string; name: string; isPdf: boolean } | null>(null)
  const [filter, setFilter] = useState<'all' | 'outstanding' | 'paid'>('all')

  // On mount: try auto-auth from local config (same browser/device as admin)
  useEffect(() => {
    try {
      const raw = localStorage.getItem('ledger_cfg3')
      if (raw) {
        // If they have the config stored, they're the admin — auto-auth
        setAuthed(true)
      }
      // Also load project name from localStorage
      const projects = JSON.parse(localStorage.getItem('ledger_projects') ?? '[]') as { code: string; name: string }[]
      const proj = projects.find(p => p.code === projectCode)
      if (proj) setProjectName(proj.name)
    } catch { /* ignore */ }
    setCheckingAuto(false)
  }, [projectCode])

  const fetchInvoices = useCallback(async () => {
    if (!projectCode) return
    setLoading(true)
    try {
      const { data, error } = await sb
        .from('invoices')
        .select('*')
        .eq('type', 'payable')
        .eq('project_code', projectCode)
        .order('created_at', { ascending: false })
      if (error) throw error
      setInvoices((data as Invoice[]) ?? [])
    } catch { /* silent - anon key may have RLS */ }
    finally { setLoading(false) }
  }, [projectCode])

  useEffect(() => {
    if (authed) void fetchInvoices()
  }, [authed, fetchInvoices])

  function handleLogin(e: React.FormEvent) {
    e.preventDefault()
    if (checkPassword(password)) {
      setAuthed(true)
      setPwError('')
    } else {
      setPwError('Incorrect password')
      setPassword('')
    }
  }

  async function togglePaid(inv: Invoice) {
    const newStatus = inv.status === 'paid' ? 'pending' : 'paid'
    setMarkingPaid(s => { const n = new Set(s); n.add(inv.id); return n })
    try {
      const { error } = await sb.from('invoices').update({ status: newStatus }).eq('id', inv.id)
      if (error) throw error
      setInvoices(prev => prev.map(i => i.id === inv.id ? { ...i, status: newStatus } : i))
    } catch { /* ignore */ }
    finally {
      setMarkingPaid(s => { const n = new Set(s); n.delete(inv.id); return n })
    }
  }

  const outstanding = invoices.filter(i => i.status !== 'paid')
  const paid = invoices.filter(i => i.status === 'paid')
  const totalOutstanding = outstanding.reduce((t, i) => t + Number(i.amount), 0)
  const totalPaid = paid.reduce((t, i) => t + Number(i.amount), 0)

  const displayed = filter === 'outstanding' ? outstanding : filter === 'paid' ? paid : invoices

  // ── Loading auto-auth check ──────────────────────────────────────────────────

  if (checkingAuto) {
    return (
      <div className="min-h-screen bg-[#f8f8f6] flex items-center justify-center">
        <div className="w-5 h-5 border-2 border-[#1a1a1a] border-t-transparent animate-spin" />
      </div>
    )
  }

  // ── Password screen ──────────────────────────────────────────────────────────

  if (!authed) {
    return (
      <div className="min-h-screen bg-[#f8f8f6] flex items-center justify-center p-6">
        <div className="w-full max-w-sm">
          {/* Header */}
          <div className="mb-8">
            <p className="font-mono text-[10px] uppercase tracking-widest text-[#9a9a9a] mb-2">AC Ledger</p>
            <h1 className="font-sans font-semibold text-2xl text-[#1a1a1a] leading-tight">Payment Sheet</h1>
            <p className="font-mono text-xs text-[#9a9a9a] mt-1">{projectCode}</p>
          </div>

          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label className="block font-mono text-[10px] uppercase tracking-wider text-[#9a9a9a] mb-1.5">
                Password
              </label>
              <div className="relative">
                <Lock size={12} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#9a9a9a]" />
                <input
                  type="password"
                  autoFocus
                  value={password}
                  onChange={e => { setPassword(e.target.value); setPwError('') }}
                  className="w-full border border-[#e2e2e0] bg-white pl-8 pr-3 py-2.5 text-sm text-[#1a1a1a] focus:outline-none focus:border-[#1a1a1a]"
                  placeholder="Enter app password"
                />
              </div>
              {pwError && <p className="font-mono text-xs text-red-600 mt-1.5">{pwError}</p>}
            </div>
            <button
              type="submit"
              className="w-full py-2.5 bg-[#1a1a1a] text-white font-mono text-xs uppercase tracking-wider hover:bg-[#333] transition-colors"
            >
              View Payment Sheet
            </button>
          </form>

          <p className="mt-6 font-mono text-[10px] text-[#9a9a9a] text-center">
            Enter the AC Ledger password to access this payment sheet
          </p>
        </div>
      </div>
    )
  }

  // ── Payment sheet view ──────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-[#f8f8f6]">
      {/* Header */}
      <div className="bg-[#181818] border-b border-[#2a2a2a] px-4 sm:px-6 py-4">
        <div className="max-w-7xl mx-auto flex items-center justify-between flex-wrap gap-3">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-widest text-[#666] mb-0.5">AC Ledger · Payment Sheet</p>
            <h1 className="font-sans font-semibold text-white text-base leading-none">{projectName}</h1>
            <p className="font-mono text-[10px] text-[#666] mt-0.5">{projectCode}</p>
          </div>
          <button
            onClick={() => void fetchInvoices()}
            className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-[#888] hover:text-white border border-[#333] px-3 py-1.5 transition-colors"
          >
            <RefreshCw size={10} className={loading ? 'animate-spin' : ''} /> Refresh
          </button>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 space-y-4">

        {/* Summary cards */}
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          <div className="bg-amber-50 border border-amber-200 px-4 py-3">
            <p className="font-mono text-[10px] uppercase tracking-wider text-amber-700 mb-1">Outstanding</p>
            <p className="font-mono text-xl font-bold text-amber-900">{fmt(totalOutstanding)}</p>
            <p className="font-mono text-[10px] text-amber-600 mt-0.5">{outstanding.length} invoice{outstanding.length !== 1 ? 's' : ''}</p>
          </div>
          <div className="bg-green-50 border border-green-200 px-4 py-3">
            <p className="font-mono text-[10px] uppercase tracking-wider text-green-700 mb-1">Paid</p>
            <p className="font-mono text-xl font-bold text-green-800">{fmt(totalPaid)}</p>
            <p className="font-mono text-[10px] text-green-600 mt-0.5">{paid.length} invoice{paid.length !== 1 ? 's' : ''}</p>
          </div>
          <div className="bg-white border border-[#e2e2e0] px-4 py-3 col-span-2 sm:col-span-1">
            <p className="font-mono text-[10px] uppercase tracking-wider text-[#9a9a9a] mb-1">Grand Total</p>
            <p className="font-mono text-xl font-bold text-[#1a1a1a]">{fmt(totalOutstanding + totalPaid)}</p>
            <p className="font-mono text-[10px] text-[#9a9a9a] mt-0.5">{invoices.length} invoice{invoices.length !== 1 ? 's' : ''} total</p>
          </div>
        </div>

        {/* Filter tabs */}
        <div className="flex border border-[#e2e2e0] overflow-hidden w-fit">
          {(['all', 'outstanding', 'paid'] as const).map(f => (
            <button key={f} onClick={() => setFilter(f)}
              className={cn(
                'px-4 py-2 font-mono text-[10px] uppercase tracking-wider transition-colors',
                filter === f ? 'bg-[#1a1a1a] text-white' : 'bg-white text-[#9a9a9a] hover:text-[#1a1a1a]'
              )}>
              {f === 'outstanding' ? `Outstanding (${outstanding.length})` : f === 'paid' ? `Paid (${paid.length})` : `All (${invoices.length})`}
            </button>
          ))}
        </div>

        {/* Table */}
        {loading && invoices.length === 0 ? (
          <div className="bg-white border border-[#e2e2e0] py-16 flex items-center justify-center gap-3">
            <div className="w-4 h-4 border-2 border-[#1a1a1a] border-t-transparent animate-spin" />
            <span className="font-mono text-xs text-[#9a9a9a]">Loading…</span>
          </div>
        ) : displayed.length === 0 ? (
          <div className="bg-white border border-[#e2e2e0] py-16 text-center">
            <p className="font-mono text-xs text-[#9a9a9a] uppercase tracking-wider">No invoices found</p>
          </div>
        ) : (
          <div className="bg-white border border-[#e2e2e0] overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-xs border-collapse">
                <thead>
                  <tr className="border-b-2 border-[#1a1a1a] bg-[#f8f8f6]">
                    {['Paid', 'Supplier', 'Ref', 'Amount', 'Due Date', 'Bank Name', 'Sort Code', 'Acc No', 'Acc Name', 'IBAN', 'Receipt', 'Status'].map(h => (
                      <th key={h} className="px-3 py-2.5 text-left font-mono text-[9px] uppercase tracking-wider text-[#9a9a9a] whitespace-nowrap">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {displayed.map((inv, idx) => {
                    const bd = resolveBankDetails(inv)
                    const isPaid = inv.status === 'paid'
                    const overdue = isOverdue(inv)
                    const marking = markingPaid.has(inv.id)

                    return (
                      <tr key={inv.id} className={cn(
                        'border-b border-[#e2e2e0] last:border-0',
                        isPaid ? 'bg-[#f8f8f6]' : overdue ? 'bg-red-50/50' : idx % 2 === 1 ? 'bg-white' : 'bg-[#fafafa]'
                      )}>
                        {/* Paid checkbox */}
                        <td className="px-3 py-3 text-center">
                          <button
                            onClick={() => void togglePaid(inv)}
                            disabled={marking}
                            title={isPaid ? 'Mark unpaid' : 'Mark paid'}
                            className={cn(
                              'w-6 h-6 flex items-center justify-center border-2 transition-all mx-auto rounded-sm',
                              marking ? 'opacity-40' : '',
                              isPaid ? 'bg-green-500 border-green-500' : 'border-[#e2e2e0] hover:border-[#1a1a1a]'
                            )}
                          >
                            {isPaid && <Check size={13} className="text-white" />}
                          </button>
                        </td>

                        <td className={cn('px-3 py-3 font-semibold text-sm', isPaid ? 'text-[#9a9a9a] line-through' : 'text-[#1a1a1a]')}>
                          {inv.party}
                          {getDescription(inv) && (
                            <p className="font-normal font-mono text-[10px] text-[#9a9a9a] mt-0.5 truncate max-w-[200px]">{getDescription(inv)}</p>
                          )}
                        </td>

                        <td className={cn('px-3 py-3 font-mono text-[10px]', isPaid ? 'text-[#9a9a9a]' : 'text-[#666]')}>
                          {inv.ref ?? '—'}
                        </td>

                        <td className={cn(
                          'px-3 py-3 font-mono font-bold text-sm',
                          isPaid ? 'text-[#9a9a9a] line-through' : overdue ? 'text-red-600' : 'text-[#1a1a1a]'
                        )}>
                          {fmt(Number(inv.amount), inv.currency)}
                        </td>

                        <td className={cn('px-3 py-3 font-mono text-[10px]', overdue ? 'text-red-600 font-bold' : isPaid ? 'text-[#9a9a9a]' : 'text-[#666]')}>
                          {inv.due ? fmtDate(inv.due) : '—'}
                          {overdue && <span className="ml-1">(!)</span>}
                        </td>

                        <td className="px-3 py-3 font-mono text-[10px] text-[#666]">{bd.bankName ?? '—'}</td>
                        <td className="px-3 py-3 font-mono text-[10px] text-[#666]">{bd.sortCode ?? '—'}</td>
                        <td className="px-3 py-3 font-mono text-[10px] text-[#666]">{bd.accNum ?? '—'}</td>
                        <td className="px-3 py-3 font-mono text-[10px] text-[#666]">{bd.accName ?? '—'}</td>
                        <td className="px-3 py-3 font-mono text-[10px] text-[#666] max-w-[120px] truncate">{bd.iban ?? '—'}</td>

                        <td className="px-3 py-3 text-center">
                          {inv.pdf_url ? (
                            <button
                              onClick={() => {
                                const isPdf = !inv.pdf_url!.match(/\.(jpg|jpeg|png|gif|webp)/i)
                                setLightbox({ url: inv.pdf_url!, name: inv.party, isPdf })
                              }}
                              className="text-[#9a9a9a] hover:text-[#1a1a1a] transition-colors"
                            >
                              <Paperclip size={13} />
                            </button>
                          ) : '—'}
                        </td>

                        <td className="px-3 py-3">
                          <span className={cn(
                            'inline-block font-mono text-[9px] uppercase tracking-wider px-1.5 py-0.5 border',
                            isPaid ? 'border-green-300 text-green-700 bg-green-50' :
                            overdue ? 'border-red-300 text-red-700 bg-red-50' :
                            'border-[#e2e2e0] text-[#9a9a9a]'
                          )}>
                            {inv.status}
                          </span>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            {/* Totals */}
            <div className="border-t-2 border-[#1a1a1a] bg-[#f8f8f6] px-4 py-3 flex flex-wrap gap-6">
              <div>
                <p className="font-mono text-[9px] uppercase tracking-widest text-[#9a9a9a]">Outstanding</p>
                <p className="font-mono text-lg font-bold text-[#1a1a1a]">{fmt(totalOutstanding)}</p>
              </div>
              <div>
                <p className="font-mono text-[9px] uppercase tracking-widest text-[#9a9a9a]">Paid</p>
                <p className="font-mono text-lg font-bold text-green-700">{fmt(totalPaid)}</p>
              </div>
              <div>
                <p className="font-mono text-[9px] uppercase tracking-widest text-[#9a9a9a]">Grand Total</p>
                <p className="font-mono text-lg font-bold text-[#1a1a1a]">{fmt(totalOutstanding + totalPaid)}</p>
              </div>
            </div>
          </div>
        )}

        <p className="font-mono text-[10px] text-[#9a9a9a] text-center pb-4">
          AC Ledger · Tick a row to mark as paid · Changes save immediately
        </p>
      </div>

      {/* Lightbox */}
      {lightbox && (
        <div className="fixed inset-0 z-50 flex flex-col bg-black/90" onClick={() => setLightbox(null)}>
          <div className="flex items-center justify-between px-6 py-3 flex-shrink-0" onClick={e => e.stopPropagation()}>
            <span className="font-mono text-xs text-white/60">{lightbox.name}</span>
            <div className="flex items-center gap-4">
              <a href={lightbox.url} target="_blank" rel="noopener noreferrer" className="text-white/60 hover:text-white">
                <ExternalLink size={14} />
              </a>
              <button onClick={() => setLightbox(null)} className="text-white/60 hover:text-white">
                <X size={16} />
              </button>
            </div>
          </div>
          <div className="flex-1 p-4 flex items-center justify-center" onClick={e => e.stopPropagation()}>
            {lightbox.isPdf
              ? <iframe src={lightbox.url} className="w-full border-0 bg-white" style={{ height: 'calc(100vh - 80px)' }} title={lightbox.name} />
              // eslint-disable-next-line @next/next/no-img-element
              : <img src={lightbox.url} alt={lightbox.name} className="max-w-full max-h-full object-contain" style={{ maxHeight: 'calc(100vh - 80px)' }} />
            }
          </div>
        </div>
      )}
    </div>
  )
}
