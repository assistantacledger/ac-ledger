'use client'

import { useState, useMemo } from 'react'
import { cn, fmt, fmtDate } from '@/lib/format'
import { toast } from '@/lib/toast'
import {
  Download, FileText, CheckCircle, ExternalLink, X,
  ChevronUp, ChevronDown, Search, Filter,
} from 'lucide-react'
import type { Invoice, InvoiceUpdate, ProjectCost, Project, BankDetails } from '@/types'

// ─── Types ────────────────────────────────────────────────────────────────────

interface ReconLinks { manual: { costId: string; invoiceId: string }[] }

export interface PaymentSheetProps {
  invoices: Invoice[]
  project: Project
  costs?: ProjectCost[]
  reconLinks?: ReconLinks
  updateInvoice?: (id: string, data: InvoiceUpdate) => Promise<Invoice>
  onAddToRun?: (invoices: Invoice[]) => void
}

type BankField = 'bankName' | 'sortCode' | 'accNum' | 'accName' | 'iban' | 'swift'
type InvField = 'party' | 'ref' | 'due' | 'amount' | 'currency' | 'status'
type FieldKey = InvField | BankField
type SortKey = 'party' | 'due' | 'amount' | 'status'
type SortDir = 'asc' | 'desc'

const STATUS_OPTIONS = ['draft', 'pending', 'submitted', 'approved', 'sent', 'overdue', 'part-paid', 'paid']
const CURRENCIES = ['£', '$', '€', 'AED', 'USD', 'EUR']

const INV_COLS: { key: InvField; label: string; cls: string }[] = [
  { key: 'party',    label: 'Supplier / Party', cls: 'min-w-[140px]' },
  { key: 'ref',      label: 'Invoice Ref',       cls: 'min-w-[100px]' },
  { key: 'due',      label: 'Due Date',          cls: 'min-w-[95px]' },
  { key: 'amount',   label: 'Amount',            cls: 'min-w-[85px]' },
  { key: 'currency', label: 'Ccy',               cls: 'w-12' },
  { key: 'status',   label: 'Status',            cls: 'min-w-[80px]' },
]

const BANK_COLS: { key: BankField; label: string; cls: string }[] = [
  { key: 'bankName', label: 'Bank Name', cls: 'min-w-[110px]' },
  { key: 'sortCode', label: 'Sort Code', cls: 'min-w-[80px]' },
  { key: 'accNum',   label: 'Acc No',    cls: 'min-w-[90px]' },
  { key: 'accName',  label: 'Acc Name',  cls: 'min-w-[110px]' },
  { key: 'iban',     label: 'IBAN',      cls: 'min-w-[130px]' },
  { key: 'swift',    label: 'SWIFT',     cls: 'min-w-[80px]' },
]

const STATUS_BADGE: Record<string, string> = {
  paid: 'badge-paid', pending: 'badge-pending', overdue: 'badge-overdue',
  draft: 'badge-draft', submitted: 'badge-submitted', approved: 'badge-approved',
  sent: 'badge-sent', 'part-paid': 'badge-part-paid',
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function urlType(url: string): 'image' | 'pdf' {
  const l = url.toLowerCase().split('?')[0]
  if (l.match(/\.(jpg|jpeg|png|gif|webp)/)) return 'image'
  return 'pdf'
}

/** Parse bank details from the formatted notes string written by createInvoiceFromCost */
function parseBankFromNotes(notes: string | null): Partial<BankDetails> | null {
  if (!notes || !notes.includes('Bank:')) return null
  const get = (label: string) => {
    const m = notes.match(new RegExp(`${label}:\\s*([^|\\n]+)`))
    return m ? m[1].trim() : undefined
  }
  const bankName = get('Bank')
  if (!bankName) return null
  return { bankName, sortCode: get('Sort'), accNum: get('Acc'), accName: get('Name'), iban: get('IBAN'), swift: get('SWIFT') }
}

/** Resolve bank details from invoice (Supabase column → LS fallback → parsed notes) */
function resolveBankDetails(inv: Invoice): Partial<BankDetails> {
  if (inv.bank_details) return inv.bank_details
  try {
    const ls = localStorage.getItem(`invoice_bank_${inv.id}`)
    if (ls) return JSON.parse(ls) as BankDetails
  } catch { /* ignore */ }
  return parseBankFromNotes(inv.notes) ?? {}
}

/** Get receipt info: check inv.pdf_url first, then linked cost via reconLinks */
function resolveReceipt(inv: Invoice, costs?: ProjectCost[], reconLinks?: ReconLinks): { url: string; type: 'image' | 'pdf' } | null {
  if (inv.pdf_url) return { url: inv.pdf_url, type: urlType(inv.pdf_url) }
  if (!reconLinks?.manual || !costs) return null
  const link = reconLinks.manual.find(m => m.invoiceId === inv.id)
  const cost = link ? costs.find(c => c.id === link.costId) : null
  if (!cost?.receiptUrl) return null
  return { url: cost.receiptUrl, type: cost.receiptType ?? 'pdf' }
}

// ─── Component ────────────────────────────────────────────────────────────────

export function PaymentSheet({ invoices, project, costs, reconLinks, updateInvoice, onAddToRun }: PaymentSheetProps) {
  const payable = useMemo(() => invoices.filter(i => i.type === 'payable'), [invoices])

  // ── Cell editing state ──
  const [editing, setEditing] = useState<{ id: string; field: FieldKey } | null>(null)
  const [editVal, setEditVal] = useState('')
  const [saving, setSaving] = useState<string | null>(null)

  // ── Selection (for add-to-run) ──
  const [selected, setSelected] = useState<Set<string>>(new Set())

  // ── Lightbox ──
  const [lightbox, setLightbox] = useState<{ url: string; name: string; type: 'image' | 'pdf' } | null>(null)

  // ── Filters / sort ──
  const [search, setSearch] = useState('')
  const [filterStatus, setFilterStatus] = useState('all')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [sortBy, setSortBy] = useState<SortKey>('due')
  const [sortDir, setSortDir] = useState<SortDir>('asc')

  // ── Category lookup ──
  function getCategory(inv: Invoice): string {
    if (!reconLinks?.manual || !costs) return '—'
    const link = reconLinks.manual.find(m => m.invoiceId === inv.id)
    return costs.find(c => c.id === link?.costId)?.category ?? '—'
  }

  // ── Raw value for a cell (for editing) ──
  function rawVal(inv: Invoice, field: FieldKey): string {
    const bankFields: BankField[] = ['bankName', 'sortCode', 'accNum', 'accName', 'iban', 'swift']
    if (bankFields.includes(field as BankField)) {
      const bd = resolveBankDetails(inv)
      if (field === 'bankName') return bd.bankName ?? ''
      if (field === 'sortCode') return bd.sortCode ?? ''
      if (field === 'accNum')   return bd.accNum ?? ''
      if (field === 'accName')  return bd.accName ?? ''
      if (field === 'iban')     return bd.iban ?? ''
      if (field === 'swift')    return bd.swift ?? ''
    }
    if (field === 'due')    return inv.due ?? ''
    if (field === 'amount') return String(inv.amount)
    return String((inv as unknown as Record<string, unknown>)[field] ?? '')
  }

  // ── Filter + sort ──
  const filtered = useMemo(() => {
    let rows = [...payable]

    if (search.trim()) {
      const q = search.toLowerCase()
      rows = rows.filter(i =>
        i.party.toLowerCase().includes(q) ||
        (i.ref ?? '').toLowerCase().includes(q)
      )
    }
    if (filterStatus !== 'all') rows = rows.filter(i => i.status === filterStatus)
    if (dateFrom) rows = rows.filter(i => i.due && i.due >= dateFrom)
    if (dateTo)   rows = rows.filter(i => i.due && i.due <= dateTo)

    rows.sort((a, b) => {
      let av: string | number = '', bv: string | number = ''
      if (sortBy === 'party')  { av = a.party.toLowerCase(); bv = b.party.toLowerCase() }
      if (sortBy === 'due')    { av = a.due ?? '9999'; bv = b.due ?? '9999' }
      if (sortBy === 'amount') { av = Number(a.amount); bv = Number(b.amount) }
      if (sortBy === 'status') { av = a.status; bv = b.status }
      if (av < bv) return sortDir === 'asc' ? -1 : 1
      if (av > bv) return sortDir === 'asc' ? 1 : -1
      return 0
    })

    return rows
  }, [payable, search, filterStatus, dateFrom, dateTo, sortBy, sortDir])

  function toggleSort(key: SortKey) {
    if (sortBy === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortBy(key); setSortDir('asc') }
  }
  function SortIcon({ k }: { k: SortKey }) {
    if (sortBy !== k) return null
    return sortDir === 'asc' ? <ChevronUp size={10} className="inline ml-0.5" /> : <ChevronDown size={10} className="inline ml-0.5" />
  }

  // ── Totals (from filtered) ──
  const totalDue  = filtered.reduce((t, i) => t + Number(i.amount), 0)
  const totalPaid = filtered.filter(i => i.status === 'paid').reduce((t, i) => t + Number(i.amount), 0)
  const outstanding = totalDue - totalPaid

  // ── Edit ──
  function startEdit(id: string, field: FieldKey, inv: Invoice) {
    if (!updateInvoice) return
    setEditing({ id, field })
    setEditVal(rawVal(inv, field))
  }

  async function commitEdit() {
    if (!editing || !updateInvoice) { setEditing(null); return }
    const { id, field } = editing
    const inv = payable.find(i => i.id === id)
    if (!inv) { setEditing(null); return }
    setSaving(id)
    try {
      const bankFields: BankField[] = ['bankName', 'sortCode', 'accNum', 'accName', 'iban', 'swift']
      if (bankFields.includes(field as BankField)) {
        const bd: Partial<BankDetails> = resolveBankDetails(inv)
        const updated: BankDetails = {
          accName:  field === 'accName'  ? editVal : (bd.accName ?? ''),
          sortCode: field === 'sortCode' ? editVal : (bd.sortCode ?? ''),
          accNum:   field === 'accNum'   ? editVal : (bd.accNum ?? ''),
          bankName: field === 'bankName' ? editVal : bd.bankName,
          iban:     field === 'iban'     ? editVal : bd.iban,
          swift:    field === 'swift'    ? editVal : bd.swift,
        }
        await updateInvoice(id, { bank_details: updated })
        // Also update LS fallback
        try { localStorage.setItem(`invoice_bank_${id}`, JSON.stringify(updated)) } catch { /* ignore */ }
      } else if (field === 'amount') {
        await updateInvoice(id, { amount: parseFloat(editVal) || inv.amount })
      } else if (field === 'due') {
        await updateInvoice(id, { due: editVal || null })
      } else {
        await updateInvoice(id, { [field]: editVal } as InvoiceUpdate)
      }
      toast('Saved')
    } catch (e) {
      toast(`Save failed: ${String(e)}`, 'error')
    } finally {
      setSaving(null)
      setEditing(null)
    }
  }

  // ── Selection ──
  function toggleAll() {
    setSelected(s => s.size === filtered.length ? new Set() : new Set(filtered.map(i => i.id)))
  }
  function toggleRow(id: string) {
    setSelected(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })
  }

  // ── Exports ──
  function buildRows() {
    return filtered.map(inv => {
      const bd = resolveBankDetails(inv)
      const rec = resolveReceipt(inv, costs, reconLinks)
      return [
        getCategory(inv), inv.party, inv.ref ?? '', inv.due ?? '', Number(inv.amount), inv.currency, inv.status,
        bd.bankName ?? '', bd.sortCode ?? '', bd.accNum ?? '', bd.accName ?? '', bd.iban ?? '', bd.swift ?? '',
        rec ? rec.url : '',
      ]
    })
  }

  function exportCSV() {
    const header = ['Category', 'Supplier', 'Invoice Ref', 'Due Date', 'Amount', 'Currency', 'Status',
      'Bank Name', 'Sort Code', 'Acc No', 'Acc Name', 'IBAN', 'SWIFT', 'Receipt URL']
    const rows = buildRows()
    rows.push(['', '', '', 'Total Due',    totalDue,    '', '', '', '', '', '', '', '', ''])
    rows.push(['', '', '', 'Total Paid',   totalPaid,   '', '', '', '', '', '', '', '', ''])
    rows.push(['', '', '', 'Outstanding',  outstanding, '', '', '', '', '', '', '', '', ''])
    const csv = [header, ...rows].map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n')
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }))
    a.download = `${project.code}-payment-sheet.csv`
    a.click()
    toast('CSV exported')
  }

  async function exportXLSX() {
    try {
      const XLSX = await import('xlsx')
      const header = ['Category', 'Supplier', 'Invoice Ref', 'Due Date', 'Amount', 'Currency', 'Status',
        'Bank Name', 'Sort Code', 'Acc No', 'Acc Name', 'IBAN', 'SWIFT', 'Receipt URL']
      const rows = buildRows()
      rows.push(['', '', '', 'Total Due',   totalDue,    '', '', '', '', '', '', '', '', ''])
      rows.push(['', '', '', 'Total Paid',  totalPaid,   '', '', '', '', '', '', '', '', ''])
      rows.push(['', '', '', 'Outstanding', outstanding, '', '', '', '', '', '', '', '', ''])
      const ws = XLSX.utils.aoa_to_sheet([header, ...rows])
      ws['!cols'] = [16, 22, 14, 12, 10, 6, 10, 16, 10, 12, 16, 24, 12, 30].map(w => ({ wch: w }))
      const wb = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(wb, ws, `${project.code} Payment Sheet`)
      XLSX.writeFile(wb, `${project.code}-payment-sheet.xlsx`)
      toast('XLSX exported')
    } catch (e) {
      toast(`Export failed: ${String(e)}`, 'error')
    }
  }

  // ── Cell renderer ──
  function Cell({ inv, field, cls }: { inv: Invoice; field: FieldKey; cls?: string }) {
    const isEditing = editing?.id === inv.id && editing.field === field
    const val = rawVal(inv, field)
    const isBankField = ['bankName', 'sortCode', 'accNum', 'accName', 'iban', 'swift'].includes(field)

    if (isEditing) {
      if (field === 'status') {
        return (
          <select autoFocus value={editVal} onChange={e => setEditVal(e.target.value)} onBlur={commitEdit}
            className="w-full border border-rule bg-white px-1 py-0.5 text-xs font-mono focus:outline-none">
            {STATUS_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        )
      }
      if (field === 'currency') {
        return (
          <select autoFocus value={editVal} onChange={e => setEditVal(e.target.value)} onBlur={commitEdit}
            className="w-full border border-rule bg-white px-1 py-0.5 text-xs font-mono focus:outline-none">
            {CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        )
      }
      return (
        <input autoFocus
          type={field === 'due' ? 'date' : field === 'amount' ? 'number' : 'text'}
          value={editVal}
          onChange={e => setEditVal(e.target.value)}
          onBlur={commitEdit}
          onKeyDown={e => { if (e.key === 'Enter') commitEdit(); if (e.key === 'Escape') setEditing(null) }}
          className={cn('w-full border border-rule bg-white px-1 py-0.5 text-xs font-mono focus:outline-none', cls)}
        />
      )
    }

    const display = field === 'due'    ? (val ? fmtDate(val) : <span className="text-muted/40">—</span>)
      : field === 'amount'  ? fmt(Number(val), inv.currency)
      : field === 'status'  ? <span className={cn('badge', STATUS_BADGE[val] ?? 'badge-draft')}>{val}</span>
      : (val || <span className="text-muted/30">—</span>)

    return (
      <div
        onClick={() => updateInvoice && startEdit(inv.id, field, inv)}
        title={updateInvoice ? `Click to edit` : val}
        className={cn(
          'text-xs font-mono truncate min-w-0',
          updateInvoice && 'cursor-text hover:bg-cream/80 rounded-sm px-0.5 -mx-0.5 transition-colors',
          saving === inv.id && 'opacity-40',
          isBankField && val && 'text-blue-700',
          cls,
        )}
      >
        {display}
      </div>
    )
  }

  // ── Receipt cell ──
  function ReceiptCell({ inv }: { inv: Invoice }) {
    const rec = resolveReceipt(inv, costs, reconLinks)
    if (!rec) return <span className="text-muted/30 font-mono text-[10px]">—</span>
    if (rec.type === 'image') {
      return (
        <button onClick={() => setLightbox({ url: rec.url, name: inv.party, type: 'image' })}
          className="block border border-rule overflow-hidden hover:opacity-80 transition-opacity"
          title="View receipt">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={rec.url} alt="" className="w-8 h-8 object-cover" />
        </button>
      )
    }
    return (
      <button onClick={() => setLightbox({ url: rec.url, name: inv.party, type: 'pdf' })}
        className="flex items-center gap-1 font-mono text-[10px] text-muted hover:text-ink border border-rule px-1.5 py-1 transition-colors"
        title="View receipt PDF">
        <FileText size={10} /> PDF
      </button>
    )
  }

  const hasFilters = search || filterStatus !== 'all' || dateFrom || dateTo

  return (
    <div className="space-y-3">

      {/* ── Filter bar ── */}
      <div className="bg-white border border-rule p-3 space-y-2">
        <div className="flex items-center gap-2 flex-wrap">
          {/* Search */}
          <div className="relative flex-1 min-w-[160px]">
            <Search size={11} className="absolute left-2 top-1/2 -translate-y-1/2 text-muted pointer-events-none" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search supplier or ref…"
              className="w-full border border-rule bg-paper pl-6 pr-2 py-1.5 text-xs font-mono text-ink focus:outline-none focus:border-ink"
            />
          </div>

          {/* Status filter */}
          <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)}
            className="border border-rule bg-paper px-2 py-1.5 text-xs font-mono text-ink focus:outline-none">
            <option value="all">All statuses</option>
            {STATUS_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
          </select>

          {/* Date from */}
          <div className="flex items-center gap-1">
            <span className="font-mono text-[10px] text-muted uppercase tracking-wider whitespace-nowrap">Due from</span>
            <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
              className="border border-rule bg-paper px-2 py-1.5 text-xs font-mono text-ink focus:outline-none" />
          </div>

          {/* Date to */}
          <div className="flex items-center gap-1">
            <span className="font-mono text-[10px] text-muted uppercase tracking-wider">to</span>
            <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
              className="border border-rule bg-paper px-2 py-1.5 text-xs font-mono text-ink focus:outline-none" />
          </div>

          {/* Clear filters */}
          {hasFilters && (
            <button onClick={() => { setSearch(''); setFilterStatus('all'); setDateFrom(''); setDateTo('') }}
              className="font-mono text-[10px] text-muted hover:text-red-500 transition-colors flex items-center gap-1">
              <X size={9} /> Clear
            </button>
          )}
        </div>

        {/* Sort + count row */}
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <Filter size={10} className="text-muted" />
            <span className="font-mono text-[10px] text-muted uppercase tracking-wider">Sort</span>
            <div className="flex gap-1">
              {([
                { key: 'party' as SortKey, label: 'Supplier' },
                { key: 'due' as SortKey,   label: 'Due Date' },
                { key: 'amount' as SortKey, label: 'Amount' },
                { key: 'status' as SortKey, label: 'Status' },
              ]).map(({ key, label }) => (
                <button key={key} onClick={() => toggleSort(key)}
                  className={cn(
                    'font-mono text-[10px] px-2 py-0.5 border transition-colors flex items-center',
                    sortBy === key ? 'border-ink bg-ink text-white' : 'border-rule text-muted hover:text-ink'
                  )}>
                  {label}<SortIcon k={key} />
                </button>
              ))}
            </div>
          </div>
          <div className="flex-1" />
          <span className="font-mono text-[10px] text-muted">
            {filtered.length === payable.length
              ? `${payable.length} payable invoice${payable.length !== 1 ? 's' : ''}`
              : `${filtered.length} of ${payable.length} invoices`}
            {updateInvoice && ' · Click any cell to edit'}
          </span>
        </div>
      </div>

      {/* ── Toolbar ── */}
      <div className="flex items-center gap-3 flex-wrap">
        {onAddToRun && selected.size > 0 && (
          <button
            onClick={() => { onAddToRun(filtered.filter(i => selected.has(i.id))); setSelected(new Set()) }}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-mono uppercase tracking-wider bg-ac-green text-white hover:opacity-90 transition-opacity">
            <CheckCircle size={11} /> Add {selected.size} to Payment Run
          </button>
        )}
        <div className="flex-1" />
        <button onClick={exportCSV}
          className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-mono uppercase tracking-wider border border-rule text-muted hover:text-ink transition-colors">
          <Download size={11} /> CSV
        </button>
        <button onClick={exportXLSX}
          className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-mono uppercase tracking-wider border border-rule text-muted hover:text-ink transition-colors">
          <FileText size={11} /> XLSX
        </button>
      </div>

      {payable.length === 0 ? (
        <div className="tbl-card py-16 text-center">
          <p className="font-mono text-xs text-muted uppercase tracking-wider">No payable invoices for this project</p>
          <p className="font-mono text-[10px] text-muted mt-2">Use the Costs tab to create payable invoices from cost items</p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="tbl-card py-12 text-center">
          <p className="font-mono text-xs text-muted uppercase tracking-wider">No invoices match the current filters</p>
          <button onClick={() => { setSearch(''); setFilterStatus('all'); setDateFrom(''); setDateTo('') }}
            className="mt-2 font-mono text-xs text-ink underline underline-offset-2">Clear filters</button>
        </div>
      ) : (
        <div className="tbl-card">
          <div className="overflow-x-auto">
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr className="border-b-2 border-ink bg-paper/50">
                  {onAddToRun && (
                    <th className="px-2 py-2.5 w-8">
                      <input type="checkbox"
                        checked={selected.size === filtered.length && filtered.length > 0}
                        onChange={toggleAll} className="accent-ink" />
                    </th>
                  )}
                  <th className="tbl-lbl text-left px-2 py-2.5 w-20">Category</th>
                  {INV_COLS.map(c => (
                    <th key={c.key}
                      onClick={() => ['party', 'due', 'amount', 'status'].includes(c.key) ? toggleSort(c.key as SortKey) : undefined}
                      className={cn(
                        'tbl-lbl text-left px-2 py-2.5 select-none',
                        c.cls,
                        ['party', 'due', 'amount', 'status'].includes(c.key) && 'cursor-pointer hover:text-ink transition-colors'
                      )}>
                      {c.label}
                      {['party', 'due', 'amount', 'status'].includes(c.key) && <SortIcon k={c.key as SortKey} />}
                    </th>
                  ))}
                  {/* Bank details spanning header */}
                  <th className="tbl-lbl text-center px-2 py-2.5 bg-blue-50/60 text-blue-600" colSpan={6}>
                    Bank Details
                  </th>
                  <th className="tbl-lbl text-left px-2 py-2.5 w-16">Receipt</th>
                </tr>
                {/* Bank sub-headers */}
                <tr className="border-b border-rule bg-blue-50/20">
                  {onAddToRun && <th />}
                  <th />{INV_COLS.map(c => <th key={c.key} />)}
                  {BANK_COLS.map(c => (
                    <th key={c.key} className={cn('tbl-lbl text-left px-2 py-1 text-blue-600/80', c.cls)}>
                      {c.label}
                    </th>
                  ))}
                  <th />
                </tr>
              </thead>
              <tbody>
                {filtered.map((inv, idx) => (
                  <tr key={inv.id}
                    className={cn('border-b border-rule last:border-0 group', idx % 2 === 1 && 'bg-paper/30')}>
                    {onAddToRun && (
                      <td className="px-2 py-2">
                        <input type="checkbox" checked={selected.has(inv.id)} onChange={() => toggleRow(inv.id)} className="accent-ink" />
                      </td>
                    )}
                    <td className="px-2 py-2">
                      <span className="font-mono text-[9px] text-muted uppercase tracking-wider">{getCategory(inv)}</span>
                    </td>
                    {INV_COLS.map(c => (
                      <td key={c.key} className="px-2 py-2">
                        <Cell inv={inv} field={c.key} />
                      </td>
                    ))}
                    {BANK_COLS.map(c => (
                      <td key={c.key} className="px-2 py-2 bg-blue-50/10">
                        <Cell inv={inv} field={c.key} />
                      </td>
                    ))}
                    <td className="px-2 py-1.5">
                      <ReceiptCell inv={inv} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Totals bar */}
          <div className="border-t-2 border-ink bg-cream px-4 py-3 flex flex-wrap gap-8">
            {[
              { label: 'Total Due',   val: totalDue,    cls: '' },
              { label: 'Total Paid',  val: totalPaid,   cls: 'text-ac-green' },
              { label: 'Outstanding', val: outstanding, cls: outstanding > 0 ? 'text-red-600' : 'text-ac-green' },
            ].map(({ label, val, cls }) => (
              <div key={label}>
                <p className="font-mono text-[9px] uppercase tracking-widest text-muted">{label}</p>
                <p className={cn('font-mono text-base font-bold mt-0.5', cls || 'text-ink')}>{fmt(val)}</p>
              </div>
            ))}
            {hasFilters && (
              <div className="ml-auto self-center">
                <p className="font-mono text-[9px] text-muted">Filtered: {filtered.length} of {payable.length}</p>
              </div>
            )}
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
          <div className="flex-1 p-4" onClick={e => e.stopPropagation()}>
            {lightbox.type === 'image' ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={lightbox.url} alt={lightbox.name} className="max-w-full max-h-full object-contain mx-auto block" style={{ maxHeight: 'calc(100vh - 80px)' }} />
            ) : (
              <iframe src={lightbox.url} className="w-full h-full border-0 bg-white" style={{ minHeight: 'calc(100vh - 80px)' }} title={lightbox.name} />
            )}
          </div>
        </div>
      )}
    </div>
  )
}
