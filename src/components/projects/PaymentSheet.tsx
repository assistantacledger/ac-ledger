'use client'

import { useState, useEffect, useMemo, useCallback } from 'react'
import {
  Download, Share2, Check, X, ChevronUp, ChevronDown,
  Paperclip, ExternalLink, Printer, RefreshCw, FileSpreadsheet,
  Search,
} from 'lucide-react'
import { sb } from '@/lib/supabase'
import { cn, fmt, fmtDate, todayISO } from '@/lib/format'
import { toast } from '@/lib/toast'
import type { Invoice, InvoiceUpdate, ProjectCost, Project, BankDetails } from '@/types'

// ─── Types ────────────────────────────────────────────────────────────────────

interface ReconLinks { manual: { costId: string; invoiceId: string }[] }

export interface PaymentSheetProps {
  project: Project
  initialInvoices?: Invoice[]  // from parent — may be stale; component self-fetches
  costs?: ProjectCost[]
  reconLinks?: ReconLinks
  updateInvoice?: (id: string, data: InvoiceUpdate) => Promise<Invoice>  // keeps parent in sync
}

type SortKey = 'party' | 'due' | 'amount' | 'status'
type SortDir = 'asc' | 'desc'
type StatusFilter = 'all' | 'outstanding' | 'paid'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function resolveBankDetails(inv: Invoice): Partial<BankDetails> {
  if (inv.bank_details) return inv.bank_details
  try {
    const ls = localStorage.getItem(`invoice_bank_${inv.id}`)
    if (ls) return JSON.parse(ls) as BankDetails
  } catch { /* ignore */ }
  // Parse from formatted notes (legacy)
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
  // Strip meta prefix from notes before showing
  const notes = inv.notes ?? ''
  // Strip ||JSON|| meta prefix (may span multiple chars but is always first line up to second ||)
  const metaEnd = notes.indexOf('||', 2)
  const stripped = (metaEnd > 0 ? notes.slice(metaEnd + 2) : notes).replace(/^\n/, '').trim()
  return stripped.split('\n')[0] ?? ''
}

function isOverdue(inv: Invoice): boolean {
  return inv.status !== 'paid' && !!inv.due && inv.due < todayISO()
}

const STATUS_BADGE_CLS: Record<string, string> = {
  paid: 'badge-paid', pending: 'badge-pending', overdue: 'badge-overdue',
  draft: 'badge-draft', submitted: 'badge-submitted', approved: 'badge-approved',
  sent: 'badge-sent', 'part-paid': 'badge-part-paid',
}

// ─── Component ────────────────────────────────────────────────────────────────

export function PaymentSheet({ project, initialInvoices, costs, reconLinks, updateInvoice }: PaymentSheetProps) {
  // ── Data (self-fetched from Supabase) ──────────────────────────────────────
  const [invoices, setInvoices] = useState<Invoice[]>(
    initialInvoices?.filter(i => i.type === 'payable') ?? []
  )
  const [loading, setLoading] = useState(true)
  const [markingPaid, setMarkingPaid] = useState<Set<string>>(new Set())

  // ── Filter / sort ──────────────────────────────────────────────────────────
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [sortKey, setSortKey] = useState<SortKey>('due')
  const [sortDir, setSortDir] = useState<SortDir>('asc')

  // ── UI ─────────────────────────────────────────────────────────────────────
  const [lightbox, setLightbox] = useState<{ url: string; name: string; isPdf: boolean } | null>(null)
  const [shareCopied, setShareCopied] = useState(false)

  // ── Fetch ──────────────────────────────────────────────────────────────────

  const fetchInvoices = useCallback(async () => {
    setLoading(true)
    try {
      const { data, error } = await sb
        .from('invoices')
        .select('*')
        .eq('type', 'payable')
        .eq('project_code', project.code)
        .order('created_at', { ascending: false })
      if (error) throw error
      setInvoices((data as Invoice[]) ?? [])
    } catch (e) {
      toast(`Failed to load payment sheet: ${String(e)}`, 'error')
    } finally {
      setLoading(false)
    }
  }, [project.code])

  useEffect(() => { void fetchInvoices() }, [fetchInvoices])

  // ── Category lookup ────────────────────────────────────────────────────────

  function getCategory(inv: Invoice): string {
    if (!reconLinks?.manual || !costs) return ''
    const link = reconLinks.manual.find(m => m.invoiceId === inv.id)
    return costs.find(c => c.id === link?.costId)?.category ?? ''
  }

  // ── Computed ───────────────────────────────────────────────────────────────

  const allOutstanding = invoices.filter(i => i.status !== 'paid')
  const allPaid = invoices.filter(i => i.status === 'paid')
  const totalOutstanding = allOutstanding.reduce((t, i) => t + Number(i.amount), 0)
  const totalPaid = allPaid.reduce((t, i) => t + Number(i.amount), 0)
  const grandTotal = totalOutstanding + totalPaid

  const displayed = useMemo(() => {
    let rows = [...invoices]
    if (search.trim()) {
      const q = search.toLowerCase()
      rows = rows.filter(i =>
        i.party.toLowerCase().includes(q) ||
        (i.ref ?? '').toLowerCase().includes(q)
      )
    }
    if (statusFilter === 'outstanding') rows = rows.filter(i => i.status !== 'paid')
    else if (statusFilter === 'paid') rows = rows.filter(i => i.status === 'paid')

    rows.sort((a, b) => {
      let av: string | number = '', bv: string | number = ''
      if (sortKey === 'party')  { av = a.party.toLowerCase(); bv = b.party.toLowerCase() }
      if (sortKey === 'due')    { av = a.due ?? '9999'; bv = b.due ?? '9999' }
      if (sortKey === 'amount') { av = Number(a.amount); bv = Number(b.amount) }
      if (sortKey === 'status') { av = a.status; bv = b.status }
      if (av < bv) return sortDir === 'asc' ? -1 : 1
      if (av > bv) return sortDir === 'asc' ? 1 : -1
      return 0
    })
    return rows
  }, [invoices, search, statusFilter, sortKey, sortDir])

  // ── Actions ────────────────────────────────────────────────────────────────

  async function togglePaid(inv: Invoice) {
    const newStatus = inv.status === 'paid' ? 'pending' : 'paid'
    setMarkingPaid(s => { const n = new Set(s); n.add(inv.id); return n })
    try {
      const { error } = await sb.from('invoices').update({ status: newStatus }).eq('id', inv.id)
      if (error) throw error
      setInvoices(prev => prev.map(i => i.id === inv.id ? { ...i, status: newStatus } : i))
      if (updateInvoice) void updateInvoice(inv.id, { status: newStatus }).catch(() => {})
      toast(newStatus === 'paid' ? 'Marked paid' : 'Marked unpaid')
    } catch (e) {
      toast(`Update failed: ${String(e)}`, 'error')
    } finally {
      setMarkingPaid(s => { const n = new Set(s); n.delete(inv.id); return n })
    }
  }

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortKey(key); setSortDir('asc') }
  }

  function SortIcon({ k }: { k: SortKey }) {
    if (sortKey !== k) return null
    return sortDir === 'asc'
      ? <ChevronUp size={9} className="inline ml-0.5" />
      : <ChevronDown size={9} className="inline ml-0.5" />
  }

  // ── Exports ────────────────────────────────────────────────────────────────

  function buildRows() {
    return displayed.map(inv => {
      const bd = resolveBankDetails(inv)
      return {
        paid: inv.status === 'paid' ? '✓' : '',
        party: inv.party,
        ref: inv.ref ?? '',
        description: getDescription(inv),
        category: getCategory(inv),
        amount: Number(inv.amount),
        currency: inv.currency,
        due: inv.due ?? '',
        bankName: bd.bankName ?? '',
        sortCode: bd.sortCode ?? '',
        accNum: bd.accNum ?? '',
        accName: bd.accName ?? '',
        iban: bd.iban ?? '',
        swift: bd.swift ?? '',
        receipt: inv.pdf_url ?? '',
        status: inv.status,
      }
    })
  }

  function exportCSV() {
    const header = ['Paid', 'Supplier', 'Invoice Ref', 'Description', 'Category', 'Amount', 'Currency',
      'Due Date', 'Bank Name', 'Sort Code', 'Acc No', 'Acc Name', 'IBAN', 'SWIFT', 'Receipt URL', 'Status']
    const rows = buildRows().map(r => Object.values(r))
    rows.push([])
    rows.push(['', '', '', '', '', totalOutstanding, '', '', '', '', '', '', '', '', '', 'Total Outstanding'])
    rows.push(['', '', '', '', '', totalPaid, '', '', '', '', '', '', '', '', '', 'Total Paid'])
    rows.push(['', '', '', '', '', grandTotal, '', '', '', '', '', '', '', '', '', 'Grand Total'])
    const csv = [header, ...rows].map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n')
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }))
    a.download = `${project.code}-payment-sheet-${todayISO()}.csv`
    a.click()
    toast('CSV downloaded')
  }

  async function exportXLSX() {
    try {
      const XLSX = await import('xlsx')
      const header = ['Paid', 'Supplier', 'Invoice Ref', 'Description', 'Category', 'Amount', 'Currency',
        'Due Date', 'Bank Name', 'Sort Code', 'Acc No', 'Acc Name', 'IBAN', 'SWIFT', 'Receipt URL', 'Status']

      const rows = buildRows().map(r => Object.values(r))
      rows.push([], ['', '', '', '', '', totalOutstanding, '', '', '', '', '', '', '', '', '', 'Total Outstanding'])
      rows.push(['', '', '', '', '', totalPaid, '', '', '', '', '', '', '', '', '', 'Total Paid'])
      rows.push(['', '', '', '', '', grandTotal, '', '', '', '', '', '', '', '', '', 'Grand Total'])

      const ws1 = XLSX.utils.aoa_to_sheet([header, ...rows])
      ws1['!cols'] = [5, 22, 14, 28, 12, 10, 6, 12, 18, 10, 12, 18, 24, 12, 28, 12].map(w => ({ wch: w }))

      // Summary sheet
      const catMap = new Map<string, { outstanding: number; paid: number }>()
      for (const inv of invoices) {
        const cat = getCategory(inv) || 'Uncategorised'
        const cur = catMap.get(cat) ?? { outstanding: 0, paid: 0 }
        if (inv.status === 'paid') catMap.set(cat, { ...cur, paid: cur.paid + Number(inv.amount) })
        else catMap.set(cat, { ...cur, outstanding: cur.outstanding + Number(inv.amount) })
      }

      const summary = [
        ['Project', project.name], ['Code', project.code], ['Entity', project.entity],
        ['Budget', project.budget > 0 ? project.budget : 'N/A'],
        ['Generated', new Date().toLocaleDateString('en-GB')], [],
        ['Category', 'Outstanding', 'Paid', 'Total'],
        ...Array.from(catMap.entries()).map(([cat, v]) => [cat, v.outstanding, v.paid, v.outstanding + v.paid]),
        [], ['TOTAL', totalOutstanding, totalPaid, grandTotal],
      ]
      const ws2 = XLSX.utils.aoa_to_sheet(summary)
      ws2['!cols'] = [{ wch: 22 }, { wch: 14 }, { wch: 14 }, { wch: 14 }]

      const wb = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(wb, ws1, 'Payment Sheet')
      XLSX.utils.book_append_sheet(wb, ws2, 'Summary')
      XLSX.writeFile(wb, `${project.code}-payment-sheet-${todayISO()}.xlsx`)
      toast('Excel downloaded')
    } catch (e) {
      toast(`Export failed: ${String(e)}`, 'error')
    }
  }

  function exportPDF() {
    const outstanding = invoices.filter(i => i.status !== 'paid').sort((a, b) => (a.due ?? '9999').localeCompare(b.due ?? '9999'))
    const paid = invoices.filter(i => i.status === 'paid')

    const thStyle = `padding:5px 7px;text-align:left;font-family:monospace;font-size:9px;text-transform:uppercase;letter-spacing:1px;white-space:nowrap;background:#f8f8f6;border-bottom:2px solid #1a1a1a;`
    const rowHtml = (inv: Invoice, isPaid: boolean) => {
      const bd = resolveBankDetails(inv)
      const overdue = isOverdue(inv)
      const rowBg = isPaid ? '#f8f8f6' : overdue ? '#fff5f5' : '#ffffff'
      const amtStyle = isPaid ? 'text-decoration:line-through;color:#9a9a9a;' : overdue ? 'color:#dc2626;' : ''
      return `<tr style="border-bottom:1px solid #e2e2e0;background:${rowBg};">
        <td style="padding:5px 7px;font-size:12px;text-align:center;">${isPaid ? '✓' : '☐'}</td>
        <td style="padding:5px 7px;font-size:10px;font-weight:600;">${inv.party}</td>
        <td style="padding:5px 7px;font-size:9px;font-family:monospace;">${inv.ref ?? ''}</td>
        <td style="padding:5px 7px;font-size:9px;color:#666;max-width:100px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${getDescription(inv)}</td>
        <td style="padding:5px 7px;font-size:9px;font-family:monospace;color:#9a9a9a;">${getCategory(inv)}</td>
        <td style="padding:5px 7px;font-size:10px;font-family:monospace;font-weight:700;text-align:right;${amtStyle}">${fmt(Number(inv.amount), inv.currency)}</td>
        <td style="padding:5px 7px;font-size:9px;font-family:monospace;${overdue ? 'color:#dc2626;font-weight:700;' : ''}">${inv.due ? fmtDate(inv.due) : '—'}</td>
        <td style="padding:5px 7px;font-size:9px;font-family:monospace;">${bd.bankName ?? ''}</td>
        <td style="padding:5px 7px;font-size:9px;font-family:monospace;">${bd.sortCode ?? ''}</td>
        <td style="padding:5px 7px;font-size:9px;font-family:monospace;">${bd.accNum ?? ''}</td>
        <td style="padding:5px 7px;font-size:9px;font-family:monospace;">${bd.accName ?? ''}</td>
        <td style="padding:5px 7px;font-size:9px;font-family:monospace;">${bd.iban ?? ''}</td>
        <td style="padding:5px 7px;font-size:9px;font-family:monospace;">${bd.swift ?? ''}</td>
        <td style="padding:5px 7px;font-size:9px;font-family:monospace;${isPaid ? 'color:#3a7a5a;' : overdue ? 'color:#dc2626;' : ''}">${isPaid ? 'PAID' : overdue ? 'OVERDUE' : inv.status.toUpperCase()}</td>
      </tr>`
    }

    const tableHtml = (rows: Invoice[], isPaid: boolean) => `
      <table style="width:100%;border-collapse:collapse;font-size:10px;">
        <thead><tr>
          ${['', 'Supplier', 'Ref', 'Description', 'Category', 'Amount', 'Due', 'Bank', 'Sort', 'Acc No', 'Acc Name', 'IBAN', 'SWIFT', 'Status'].map(h => `<th style="${thStyle}">${h}</th>`).join('')}
        </tr></thead>
        <tbody>${rows.map(inv => rowHtml(inv, isPaid)).join('')}</tbody>
      </table>`

    const html = `<div style="font-family:Arial,sans-serif;">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:16px;">
        <div>
          <p style="font-size:9px;text-transform:uppercase;letter-spacing:2px;color:#9a9a9a;margin:0 0 4px;">Payment Sheet — Confidential</p>
          <h1 style="font-size:18px;font-weight:700;margin:0 0 3px;">${project.name}</h1>
          <p style="font-size:11px;color:#666;margin:0;">${project.code} · ${project.entity}</p>
        </div>
        <div style="text-align:right;">
          <p style="font-size:9px;color:#9a9a9a;margin:0 0 2px;font-family:monospace;text-transform:uppercase;">Generated</p>
          <p style="font-size:11px;font-family:monospace;margin:0;">${new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' })}</p>
        </div>
      </div>
      <div style="display:flex;gap:12px;margin-bottom:14px;">
        <div style="background:#fff9e6;padding:8px 14px;flex:1;"><p style="font-size:8px;text-transform:uppercase;letter-spacing:1px;color:#9a9a9a;margin:0 0 2px;">Outstanding (${outstanding.length})</p><p style="font-size:15px;font-weight:700;font-family:monospace;margin:0;">${fmt(totalOutstanding)}</p></div>
        <div style="background:#f0fdf4;padding:8px 14px;flex:1;"><p style="font-size:8px;text-transform:uppercase;letter-spacing:1px;color:#9a9a9a;margin:0 0 2px;">Paid (${paid.length})</p><p style="font-size:15px;font-weight:700;font-family:monospace;margin:0;color:#3a7a5a;">${fmt(totalPaid)}</p></div>
        <div style="background:#f8f8f6;padding:8px 14px;flex:1;"><p style="font-size:8px;text-transform:uppercase;letter-spacing:1px;color:#9a9a9a;margin:0 0 2px;">Grand Total</p><p style="font-size:15px;font-weight:700;font-family:monospace;margin:0;">${fmt(grandTotal)}</p></div>
      </div>
      ${outstanding.length > 0 ? `<p style="font-size:9px;text-transform:uppercase;letter-spacing:2px;font-weight:700;margin:0 0 5px;padding-bottom:4px;border-bottom:2px solid #1a1a1a;">Outstanding</p>${tableHtml(outstanding, false)}` : ''}
      ${paid.length > 0 ? `<p style="font-size:9px;text-transform:uppercase;letter-spacing:2px;font-weight:700;color:#9a9a9a;margin:12px 0 5px;padding-bottom:4px;border-bottom:1px solid #e2e2e0;">Paid</p>${tableHtml(paid, true)}` : ''}
      <div style="border-top:2px solid #1a1a1a;padding-top:10px;display:flex;gap:24px;margin-top:12px;">
        <div><p style="font-size:8px;text-transform:uppercase;letter-spacing:1px;color:#9a9a9a;margin:0 0 1px;">Outstanding</p><p style="font-size:13px;font-weight:700;font-family:monospace;margin:0;">${fmt(totalOutstanding)}</p></div>
        <div><p style="font-size:8px;text-transform:uppercase;letter-spacing:1px;color:#9a9a9a;margin:0 0 1px;">Paid</p><p style="font-size:13px;font-weight:700;font-family:monospace;margin:0;color:#3a7a5a;">${fmt(totalPaid)}</p></div>
        <div><p style="font-size:8px;text-transform:uppercase;letter-spacing:1px;color:#9a9a9a;margin:0 0 1px;">Grand Total</p><p style="font-size:13px;font-weight:700;font-family:monospace;margin:0;">${fmt(grandTotal)}</p></div>
      </div>
      <p style="margin-top:20px;font-size:8px;color:#ccc;text-align:center;font-family:monospace;text-transform:uppercase;letter-spacing:1px;">Generated by AC Ledger · ${new Date().toLocaleDateString('en-GB')}</p>
    </div>`

    const printWin = window.open('', '_blank')
    if (!printWin) return
    printWin.document.write(
      `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${project.name} — Payment Sheet</title>` +
      `<style>* { box-sizing: border-box; } body { margin: 1cm; background: white; -webkit-print-color-adjust: exact; print-color-adjust: exact; } @page { size: A4 landscape; margin: 1cm; }</style>` +
      `</head><body>${html}</body></html>`
    )
    printWin.document.close()
    printWin.focus()
    setTimeout(() => { printWin.print(); printWin.close() }, 500)
  }

  function handleShare() {
    const url = `${window.location.origin}/payment-sheet/${project.code}`
    navigator.clipboard.writeText(url)
      .then(() => { setShareCopied(true); toast('Link copied — share this URL with your accounts team'); setTimeout(() => setShareCopied(false), 2500) })
      .catch(() => toast('Could not copy — check browser permissions', 'error'))
  }

  // ── Table header helper ────────────────────────────────────────────────────

  const TH = ({ children, cls = '' }: { children: React.ReactNode; cls?: string }) => (
    <th className={`tbl-lbl text-left px-3 py-2.5 bg-cream border-b-2 border-ink sticky top-0 whitespace-nowrap ${cls}`}>
      {children}
    </th>
  )

  // ── Loading state ──────────────────────────────────────────────────────────

  if (loading && invoices.length === 0) {
    return (
      <div className="flex items-center justify-center py-24">
        <div className="w-5 h-5 border-2 border-ink border-t-transparent animate-spin" />
        <span className="ml-3 font-mono text-xs text-muted">Loading payment sheet…</span>
      </div>
    )
  }

  // ─── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-3">

      {/* ── Summary pills + action bar ── */}
      <div className="flex items-center gap-2 flex-wrap">
        {/* Stats */}
        <div className="flex items-center gap-2 flex-wrap flex-1">
          <div className="flex items-center gap-1.5 bg-amber-50 border border-amber-200 px-3 py-1.5">
            <span className="font-mono text-[10px] text-amber-700 uppercase tracking-wider">{allOutstanding.length} outstanding</span>
            <span className="font-mono text-sm font-bold text-amber-800">{fmt(totalOutstanding)}</span>
          </div>
          <div className="flex items-center gap-1.5 bg-green-50 border border-green-200 px-3 py-1.5">
            <span className="font-mono text-[10px] text-green-700 uppercase tracking-wider">{allPaid.length} paid</span>
            <span className="font-mono text-sm font-bold text-green-800">{fmt(totalPaid)}</span>
          </div>
          {invoices.length > 0 && (
            <div className="flex items-center gap-1.5 bg-paper border border-rule px-3 py-1.5">
              <span className="font-mono text-[10px] text-muted uppercase tracking-wider">grand total</span>
              <span className="font-mono text-sm font-bold text-ink">{fmt(grandTotal)}</span>
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-1.5 flex-wrap">
          <button onClick={() => void fetchInvoices()} title="Refresh"
            className="flex items-center gap-1 font-mono text-[10px] px-2 py-1.5 border border-rule text-muted hover:text-ink transition-colors">
            <RefreshCw size={10} className={loading ? 'animate-spin' : ''} /> Refresh
          </button>
          <button onClick={exportCSV}
            className="flex items-center gap-1 font-mono text-[10px] px-2 py-1.5 border border-rule text-muted hover:text-ink transition-colors uppercase tracking-wider">
            <Download size={10} /> CSV
          </button>
          <button onClick={() => void exportXLSX()}
            className="flex items-center gap-1 font-mono text-[10px] px-2 py-1.5 border border-rule text-muted hover:text-ink transition-colors uppercase tracking-wider">
            <FileSpreadsheet size={10} /> Excel
          </button>
          <button onClick={exportPDF}
            className="flex items-center gap-1 font-mono text-[10px] px-2 py-1.5 border border-rule text-muted hover:text-ink transition-colors uppercase tracking-wider">
            <Printer size={10} /> PDF
          </button>
          <button onClick={handleShare}
            className={cn(
              'flex items-center gap-1 font-mono text-[10px] px-2 py-1.5 border transition-colors uppercase tracking-wider',
              shareCopied ? 'border-green-400 text-green-700 bg-green-50' : 'border-rule text-muted hover:text-ink'
            )}>
            {shareCopied ? <Check size={10} /> : <Share2 size={10} />}
            {shareCopied ? 'Copied!' : 'Share'}
          </button>
        </div>
      </div>

      {/* ── Filter bar ── */}
      <div className="bg-white border border-rule p-3 flex items-center gap-2 flex-wrap">
        {/* Search */}
        <div className="relative flex-1 min-w-[180px]">
          <Search size={11} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted pointer-events-none" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search supplier or ref…"
            className="w-full border border-rule bg-paper pl-7 pr-2 py-1.5 text-xs font-mono text-ink focus:outline-none focus:border-ink"
          />
          {search && (
            <button onClick={() => setSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted hover:text-ink">
              <X size={10} />
            </button>
          )}
        </div>

        {/* Status filter */}
        <div className="flex items-center gap-0 border border-rule overflow-hidden">
          {(['all', 'outstanding', 'paid'] as StatusFilter[]).map(f => (
            <button key={f} onClick={() => setStatusFilter(f)}
              className={cn(
                'px-3 py-1.5 font-mono text-[10px] uppercase tracking-wider transition-colors',
                statusFilter === f ? 'bg-ink text-white' : 'text-muted hover:text-ink bg-white'
              )}>
              {f === 'outstanding' ? 'Outstanding' : f === 'paid' ? 'Paid' : 'All'}
            </button>
          ))}
        </div>

        {/* Sort */}
        <div className="flex items-center gap-1">
          <span className="font-mono text-[10px] text-muted uppercase tracking-wider">Sort:</span>
          {(['party', 'due', 'amount', 'status'] as SortKey[]).map(k => (
            <button key={k} onClick={() => toggleSort(k)}
              className={cn(
                'flex items-center font-mono text-[10px] px-2 py-1 border transition-colors',
                sortKey === k ? 'border-ink bg-ink text-white' : 'border-rule text-muted hover:text-ink'
              )}>
              {k === 'party' ? 'Supplier' : k === 'due' ? 'Due Date' : k === 'amount' ? 'Amount' : 'Status'}
              <SortIcon k={k} />
            </button>
          ))}
        </div>

        {(search || statusFilter !== 'all') && (
          <button onClick={() => { setSearch(''); setStatusFilter('all') }}
            className="font-mono text-[10px] text-muted hover:text-red-500 transition-colors flex items-center gap-1">
            <X size={9} /> Clear
          </button>
        )}
      </div>

      {/* ── Table ── */}
      {invoices.length === 0 ? (
        <div className="tbl-card py-16 text-center">
          <p className="font-mono text-xs text-muted uppercase tracking-wider">No payable invoices for this project</p>
          <p className="font-mono text-[10px] text-muted mt-2">Extract PDFs in the Costs tab or add invoices via the Invoices tab</p>
        </div>
      ) : displayed.length === 0 ? (
        <div className="tbl-card py-12 text-center">
          <p className="font-mono text-xs text-muted uppercase tracking-wider">No invoices match filters</p>
          <button onClick={() => { setSearch(''); setStatusFilter('all') }} className="mt-2 font-mono text-xs text-ink underline underline-offset-2">Clear filters</button>
        </div>
      ) : (
        <div className="tbl-card overflow-hidden">
          <div className="overflow-x-auto max-h-[calc(100vh-320px)] overflow-y-auto">
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr>
                  <TH cls="w-10 text-center">Paid</TH>
                  <TH
                    cls="cursor-pointer hover:text-ink select-none"
                  >
                    <span onClick={() => toggleSort('party')}>Supplier <SortIcon k="party" /></span>
                  </TH>
                  <TH>Ref</TH>
                  <TH cls="min-w-[140px]">Description</TH>
                  <TH>Category</TH>
                  <TH
                    cls="cursor-pointer hover:text-ink select-none text-right"
                  >
                    <span onClick={() => toggleSort('amount')}>Amount <SortIcon k="amount" /></span>
                  </TH>
                  <TH>Ccy</TH>
                  <TH
                    cls="cursor-pointer hover:text-ink select-none"
                  >
                    <span onClick={() => toggleSort('due')}>Due Date <SortIcon k="due" /></span>
                  </TH>
                  <TH cls="bg-blue-50/80">Bank Name</TH>
                  <TH cls="bg-blue-50/80">Sort Code</TH>
                  <TH cls="bg-blue-50/80">Acc No</TH>
                  <TH cls="bg-blue-50/80">Acc Name</TH>
                  <TH cls="bg-blue-50/80">IBAN</TH>
                  <TH cls="bg-blue-50/80">SWIFT</TH>
                  <TH cls="w-14">Receipt</TH>
                  <TH
                    cls="cursor-pointer hover:text-ink select-none"
                  >
                    <span onClick={() => toggleSort('status')}>Status <SortIcon k="status" /></span>
                  </TH>
                </tr>
              </thead>
              <tbody>
                {displayed.map((inv, idx) => {
                  const bd = resolveBankDetails(inv)
                  const paid = inv.status === 'paid'
                  const overdue = isOverdue(inv)
                  const marking = markingPaid.has(inv.id)
                  const rowCls = cn(
                    'border-b border-rule last:border-0 transition-colors group',
                    paid ? 'bg-paper/60' : overdue ? 'bg-red-50/40' : idx % 2 === 1 ? 'bg-white' : 'bg-paper/20'
                  )
                  const textCls = paid ? 'text-muted' : 'text-ink'
                  const monoSmall = `font-mono text-[10px] ${paid ? 'text-muted/70' : 'text-muted'}`

                  return (
                    <tr key={inv.id} className={rowCls}>
                      {/* Paid checkbox */}
                      <td className="px-3 py-2 text-center">
                        <button
                          onClick={() => void togglePaid(inv)}
                          disabled={marking}
                          title={paid ? 'Mark as unpaid' : 'Mark as paid'}
                          className={cn(
                            'w-5 h-5 flex items-center justify-center border-2 transition-all mx-auto',
                            marking ? 'opacity-40' : '',
                            paid ? 'bg-green-500 border-green-500' : 'border-rule hover:border-ink'
                          )}
                        >
                          {paid && <Check size={11} className="text-white" />}
                        </button>
                      </td>

                      {/* Supplier */}
                      <td className={`px-3 py-2 font-semibold text-sm ${textCls} ${paid ? 'line-through' : ''}`}>
                        {inv.party}
                      </td>

                      {/* Ref */}
                      <td className={`px-3 py-2 ${monoSmall}`}>
                        {inv.ref ?? <span className="text-muted/40">—</span>}
                      </td>

                      {/* Description */}
                      <td className={`px-3 py-2 max-w-[180px] truncate ${monoSmall}`} title={getDescription(inv)}>
                        {getDescription(inv) || <span className="text-muted/40">—</span>}
                      </td>

                      {/* Category */}
                      <td className={`px-3 py-2 ${monoSmall} uppercase tracking-wider`}>
                        {getCategory(inv) || <span className="text-muted/40">—</span>}
                      </td>

                      {/* Amount */}
                      <td className={cn('px-3 py-2 text-right font-mono text-xs font-bold', paid ? 'text-muted line-through' : overdue ? 'text-red-600' : 'text-ink')}>
                        {fmt(Number(inv.amount), inv.currency)}
                      </td>

                      {/* Currency */}
                      <td className={`px-3 py-2 ${monoSmall}`}>{inv.currency}</td>

                      {/* Due date */}
                      <td className={cn('px-3 py-2 font-mono text-[10px]', overdue ? 'text-red-600 font-bold' : paid ? 'text-muted/70' : 'text-muted')}>
                        {inv.due ? fmtDate(inv.due) : <span className="text-muted/40">—</span>}
                        {overdue && <span className="ml-1 text-[9px]">!</span>}
                      </td>

                      {/* Bank details */}
                      <td className={`px-3 py-2 ${monoSmall} bg-blue-50/20`}>{bd.bankName ?? <span className="text-muted/30">—</span>}</td>
                      <td className={`px-3 py-2 ${monoSmall} bg-blue-50/20`}>{bd.sortCode ?? <span className="text-muted/30">—</span>}</td>
                      <td className={`px-3 py-2 ${monoSmall} bg-blue-50/20`}>{bd.accNum ?? <span className="text-muted/30">—</span>}</td>
                      <td className={`px-3 py-2 ${monoSmall} bg-blue-50/20`}>{bd.accName ?? <span className="text-muted/30">—</span>}</td>
                      <td className={`px-3 py-2 ${monoSmall} bg-blue-50/20 max-w-[130px] truncate`}>{bd.iban ?? <span className="text-muted/30">—</span>}</td>
                      <td className={`px-3 py-2 ${monoSmall} bg-blue-50/20`}>{bd.swift ?? <span className="text-muted/30">—</span>}</td>

                      {/* Receipt */}
                      <td className="px-3 py-2 text-center">
                        {inv.pdf_url ? (
                          <button
                            onClick={() => {
                              const isPdf = !inv.pdf_url!.match(/\.(jpg|jpeg|png|gif|webp)/i)
                              setLightbox({ url: inv.pdf_url!, name: inv.party, isPdf })
                            }}
                            className="text-muted hover:text-ink transition-colors"
                            title="View receipt"
                          >
                            <Paperclip size={12} />
                          </button>
                        ) : <span className="text-muted/30">—</span>}
                      </td>

                      {/* Status */}
                      <td className="px-3 py-2">
                        <span className={cn('badge', STATUS_BADGE_CLS[inv.status] ?? 'badge-draft')}>
                          {inv.status}
                        </span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {/* Totals row */}
          <div className="border-t-2 border-ink bg-cream px-4 py-3 flex flex-wrap gap-8 items-center">
            {[
              { label: 'Grand Total', val: grandTotal, cls: 'text-ink' },
              { label: 'Outstanding', val: totalOutstanding, cls: totalOutstanding > 0 ? 'text-amber-700' : 'text-muted' },
              { label: 'Paid', val: totalPaid, cls: 'text-green-700' },
            ].map(({ label, val, cls }) => (
              <div key={label}>
                <p className="font-mono text-[9px] uppercase tracking-widest text-muted">{label}</p>
                <p className={cn('font-mono text-lg font-bold mt-0.5', cls)}>{fmt(val)}</p>
              </div>
            ))}
            <div className="ml-auto font-mono text-[10px] text-muted">
              {displayed.length !== invoices.length
                ? `Showing ${displayed.length} of ${invoices.length} invoices`
                : `${invoices.length} invoice${invoices.length !== 1 ? 's' : ''} total`}
            </div>
          </div>
        </div>
      )}

      {/* ── Lightbox ── */}
      {lightbox && (
        <div className="fixed inset-0 z-[70] flex flex-col bg-black/90" onClick={() => setLightbox(null)}>
          <div className="flex items-center justify-between px-6 py-3 flex-shrink-0" onClick={e => e.stopPropagation()}>
            <span className="font-mono text-xs text-white/60">{lightbox.name}</span>
            <div className="flex items-center gap-4">
              <a href={lightbox.url} target="_blank" rel="noopener noreferrer"
                className="text-white/60 hover:text-white transition-colors" title="Open in new tab">
                <ExternalLink size={14} />
              </a>
              <button onClick={() => setLightbox(null)} className="text-white/60 hover:text-white transition-colors">
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
