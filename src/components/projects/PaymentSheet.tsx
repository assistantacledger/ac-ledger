'use client'

import { useState, useEffect, useMemo, useCallback } from 'react'
import {
  Download, Share2, Check, X, ChevronUp, ChevronDown,
  Paperclip, ExternalLink, Printer, RefreshCw, FileSpreadsheet,
  Search, Trash2, Square, CheckSquare, FileDown, Flag,
} from 'lucide-react'
import { sb } from '@/lib/supabase'
import { cn, fmt, fmtDate, todayISO } from '@/lib/format'
import { toast } from '@/lib/toast'
import type { Invoice, InvoiceUpdate, ProjectCost, Project, BankDetails } from '@/types'

// ─── Types ────────────────────────────────────────────────────────────────────

interface ReconLinks { manual: { costId: string; invoiceId: string }[] }

export interface PaymentSheetProps {
  project: Project
  initialInvoices?: Invoice[]
  costs?: ProjectCost[]
  reconLinks?: ReconLinks
  updateInvoice?: (id: string, data: InvoiceUpdate) => Promise<Invoice>
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
  const notes = inv.notes ?? ''
  const metaEnd = notes.indexOf('||', 2)
  const stripped = (metaEnd > 0 ? notes.slice(metaEnd + 2) : notes).replace(/^\n/, '').trim()
  return stripped.split('\n')[0] ?? ''
}

function isOverdue(inv: Invoice): boolean {
  return inv.status !== 'paid' && !!inv.due && inv.due < todayISO()
}

// Parse internal field into notes + payment note parts
export function parseInternal(internal: string | null): { notes: string; paymentNote: string } {
  if (!internal) return { notes: '', paymentNote: '' }
  const lower = internal.toLowerCase()
  const idx = lower.indexOf('\npayment_note:')
  if (idx >= 0) {
    return { notes: internal.slice(0, idx).trim(), paymentNote: internal.slice(idx + 14).trim() }
  }
  if (lower.startsWith('payment_note:')) {
    return { notes: '', paymentNote: internal.slice(13).trim() }
  }
  return { notes: internal.trim(), paymentNote: '' }
}

export function buildInternal(notes: string, paymentNote: string): string {
  if (!notes && !paymentNote) return ''
  if (!paymentNote) return notes
  if (!notes) return `payment_note: ${paymentNote}`
  return `${notes}\npayment_note: ${paymentNote}`
}

// Priority localStorage helpers
function lsPriorityGet(id: string): boolean {
  try { return localStorage.getItem(`payment_sheet_priority_${id}`) === 'true' } catch { return false }
}
function lsPrioritySet(id: string, val: boolean) {
  try {
    if (val) localStorage.setItem(`payment_sheet_priority_${id}`, 'true')
    else localStorage.removeItem(`payment_sheet_priority_${id}`)
  } catch { /* ignore */ }
}

const STATUS_BADGE_CLS: Record<string, string> = {
  paid: 'badge-paid', pending: 'badge-pending', overdue: 'badge-overdue',
  draft: 'badge-draft', submitted: 'badge-submitted', approved: 'badge-approved',
  sent: 'badge-sent', 'part-paid': 'badge-part-paid',
}

// ─── Component ────────────────────────────────────────────────────────────────

export function PaymentSheet({ project, initialInvoices, costs, reconLinks, updateInvoice }: PaymentSheetProps) {
  // ── Data ───────────────────────────────────────────────────────────────────
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

  // ── Selection ──────────────────────────────────────────────────────────────
  const [selected, setSelected] = useState<Set<string>>(new Set())

  // ── Delete ─────────────────────────────────────────────────────────────────
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null)
  const [deletingIds, setDeletingIds] = useState<Set<string>>(new Set())

  // ── Priority ───────────────────────────────────────────────────────────────
  const [priorities, setPriorities] = useState<Set<string>>(() => {
    try {
      return new Set(
        Object.keys(localStorage)
          .filter(k => k.startsWith('payment_sheet_priority_') && localStorage.getItem(k) === 'true')
          .map(k => k.replace('payment_sheet_priority_', ''))
      )
    } catch { return new Set() }
  })
  const [showPriorityOnly, setShowPriorityOnly] = useState(false)

  // ── Notes editing ──────────────────────────────────────────────────────────
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null)
  const [noteValue, setNoteValue] = useState('')
  const [payNoteValue, setPayNoteValue] = useState('')

  // ── UI ─────────────────────────────────────────────────────────────────────
  const [lightbox, setLightbox] = useState<{ url: string; name: string; isPdf: boolean } | null>(null)
  const [shareCopied, setShareCopied] = useState(false)
  const [zipProgress, setZipProgress] = useState<{ current: number; total: number } | null>(null)
  const [pdfMergeProgress, setPdfMergeProgress] = useState<{ current: number; total: number } | null>(null)

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
    if (showPriorityOnly) rows = rows.filter(i => priorities.has(i.id))

    rows.sort((a, b) => {
      // Priority rows always first
      const ap = priorities.has(a.id) ? 0 : 1
      const bp = priorities.has(b.id) ? 0 : 1
      if (ap !== bp) return ap - bp
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
  }, [invoices, search, statusFilter, sortKey, sortDir, priorities, showPriorityOnly])

  // Selection derived
  const allSelected = displayed.length > 0 && displayed.every(i => selected.has(i.id))
  const someSelected = selected.size > 0

  function getExportRows() {
    if (someSelected) return displayed.filter(i => selected.has(i.id))
    return displayed
  }

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

  // ── Selection actions ──────────────────────────────────────────────────────

  function toggleSelect(id: string) {
    setSelected(prev => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n })
  }

  function selectAll() { setSelected(new Set(displayed.map(i => i.id))) }
  function deselectAll() { setSelected(new Set()) }
  function selectAllOutstanding() { setSelected(new Set(displayed.filter(i => i.status !== 'paid').map(i => i.id))) }

  // ── Delete actions ─────────────────────────────────────────────────────────

  async function doDelete(id: string) {
    setDeletingIds(prev => { const n = new Set(prev); n.add(id); return n })
    try {
      const { error } = await sb.from('invoices').delete().eq('id', id)
      if (error) throw error
      setInvoices(prev => prev.filter(i => i.id !== id))
      setSelected(prev => { const n = new Set(prev); n.delete(id); return n })
      toast('Invoice deleted')
    } catch (e) {
      toast(`Delete failed: ${String(e)}`, 'error')
    } finally {
      setDeletingIds(prev => { const n = new Set(prev); n.delete(id); return n })
      setDeleteConfirm(null)
    }
  }

  async function deleteSelected() {
    const ids = Array.from(selected)
    for (const id of ids) await doDelete(id)
  }

  // ── Priority ───────────────────────────────────────────────────────────────

  function togglePriority(id: string) {
    const newVal = !priorities.has(id)
    lsPrioritySet(id, newVal)
    setPriorities(prev => { const n = new Set(prev); newVal ? n.add(id) : n.delete(id); return n })
  }

  // ── Notes ─────────────────────────────────────────────────────────────────

  function startEditNote(inv: Invoice) {
    const { notes, paymentNote } = parseInternal(inv.internal)
    setNoteValue(notes)
    setPayNoteValue(paymentNote)
    setEditingNoteId(inv.id)
  }

  async function saveNote(inv: Invoice) {
    const { paymentNote } = parseInternal(inv.internal)
    const newInternal = buildInternal(noteValue, paymentNote) || null
    try {
      const { error } = await sb.from('invoices').update({ internal: newInternal }).eq('id', inv.id)
      if (error) throw error
      setInvoices(prev => prev.map(i => i.id === inv.id ? { ...i, internal: newInternal } : i))
      if (updateInvoice) void updateInvoice(inv.id, { internal: newInternal }).catch(() => {})
    } catch (e) {
      toast(`Note save failed: ${String(e)}`, 'error')
    }
    setEditingNoteId(null)
  }

  async function savePaymentNote(inv: Invoice) {
    const { notes } = parseInternal(inv.internal)
    const newInternal = buildInternal(notes, payNoteValue) || null
    try {
      const { error } = await sb.from('invoices').update({ internal: newInternal }).eq('id', inv.id)
      if (error) throw error
      setInvoices(prev => prev.map(i => i.id === inv.id ? { ...i, internal: newInternal } : i))
      if (updateInvoice) void updateInvoice(inv.id, { internal: newInternal }).catch(() => {})
      toast('Payment note saved')
    } catch (e) {
      toast(`Note save failed: ${String(e)}`, 'error')
    }
    setEditingNoteId(null)
  }

  // ── Exports ────────────────────────────────────────────────────────────────

  function buildRows(rows: Invoice[] = getExportRows()) {
    // Priority rows first in exports
    const sorted = [...rows].sort((a, b) => (priorities.has(a.id) ? 0 : 1) - (priorities.has(b.id) ? 0 : 1))
    return sorted.map(inv => {
      const bd = resolveBankDetails(inv)
      const { notes, paymentNote } = parseInternal(inv.internal)
      return {
        priority: priorities.has(inv.id) ? 'HIGH' : '',
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
        invoiceUrl: inv.pdf_url ?? '',
        status: inv.status,
        notes,
        paymentNote,
      }
    })
  }

  function exportCSV() {
    const rows = getExportRows()
    const outstanding = rows.filter(i => i.status !== 'paid').reduce((t, i) => t + Number(i.amount), 0)
    const paid = rows.filter(i => i.status === 'paid').reduce((t, i) => t + Number(i.amount), 0)
    const header = ['Priority', 'Paid', 'Supplier', 'Invoice Ref', 'Description', 'Category', 'Amount', 'Currency',
      'Due Date', 'Bank Name', 'Sort Code', 'Acc No', 'Acc Name', 'IBAN', 'SWIFT', 'Invoice URL', 'Status', 'Notes', 'Payment Note']
    const dataRows = buildRows(rows).map(r => Object.values(r))
    dataRows.push([])
    dataRows.push(['', '', '', '', '', '', outstanding, '', '', '', '', '', '', '', '', '', 'Total Outstanding', '', ''])
    dataRows.push(['', '', '', '', '', '', paid, '', '', '', '', '', '', '', '', '', 'Total Paid', '', ''])
    dataRows.push(['', '', '', '', '', '', outstanding + paid, '', '', '', '', '', '', '', '', '', 'Grand Total', '', ''])
    const csv = [header, ...dataRows].map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n')
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }))
    a.download = `${project.code}-payment-sheet-${todayISO()}.csv`
    a.click()
    toast(`CSV downloaded${someSelected ? ` (${rows.length} selected rows)` : ''}`)
  }

  async function exportXLSX() {
    try {
      const XLSX = await import('xlsx')
      const rows = getExportRows()
      const outstanding = rows.filter(i => i.status !== 'paid').reduce((t, i) => t + Number(i.amount), 0)
      const paid = rows.filter(i => i.status === 'paid').reduce((t, i) => t + Number(i.amount), 0)
      const header = ['Priority', 'Paid', 'Supplier', 'Invoice Ref', 'Description', 'Category', 'Amount', 'Currency',
        'Due Date', 'Bank Name', 'Sort Code', 'Acc No', 'Acc Name', 'IBAN', 'SWIFT', 'Invoice', 'Status', 'Notes', 'Payment Note']

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const dataRows: any[][] = buildRows(rows).map(r => {
        const vals: unknown[] = Object.values(r)
        const urlIdx = 15  // invoiceUrl is now at index 15 (shifted by priority col)
        const url = vals[urlIdx] ? String(vals[urlIdx]) : null
        if (url) vals[2] = { t: 's', v: String(vals[2]), l: { Target: url } }  // Supplier hyperlink
        vals[urlIdx] = url ? { t: 's', v: 'View Invoice', l: { Target: url } } : 'No attachment'
        return vals
      })
      dataRows.push([], ['', '', '', '', '', '', outstanding, '', '', '', '', '', '', '', '', '', 'Total Outstanding', '', ''])
      dataRows.push(['', '', '', '', '', '', paid, '', '', '', '', '', '', '', '', '', 'Total Paid', '', ''])
      dataRows.push(['', '', '', '', '', '', outstanding + paid, '', '', '', '', '', '', '', '', '', 'Grand Total', '', ''])

      const ws1 = XLSX.utils.aoa_to_sheet([header, ...dataRows])
      ws1['!cols'] = [6, 5, 22, 14, 28, 12, 10, 6, 12, 18, 10, 12, 18, 24, 12, 28, 12, 24, 24].map(w => ({ wch: w }))

      const catMap = new Map<string, { outstanding: number; paid: number }>()
      for (const inv of rows) {
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
        [], ['TOTAL', outstanding, paid, outstanding + paid],
      ]
      const ws2 = XLSX.utils.aoa_to_sheet(summary)
      ws2['!cols'] = [{ wch: 22 }, { wch: 14 }, { wch: 14 }, { wch: 14 }]

      const wb = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(wb, ws1, 'Payment Sheet')
      XLSX.utils.book_append_sheet(wb, ws2, 'Summary')
      XLSX.writeFile(wb, `${project.code}-payment-sheet-${todayISO()}.xlsx`)
      toast(`Excel downloaded${someSelected ? ` (${rows.length} selected rows)` : ''}`)
    } catch (e) {
      toast(`Export failed: ${String(e)}`, 'error')
    }
  }

  function exportPDF() {
    const rows = getExportRows()
    // Priority rows first
    const sortedRows = [...rows].sort((a, b) => (priorities.has(a.id) ? 0 : 1) - (priorities.has(b.id) ? 0 : 1))
    const outstanding = sortedRows.filter(i => i.status !== 'paid').sort((a, b) => (a.due ?? '9999').localeCompare(b.due ?? '9999'))
    const paid = sortedRows.filter(i => i.status === 'paid')
    const totOut = outstanding.reduce((t, i) => t + Number(i.amount), 0)
    const totPaid = paid.reduce((t, i) => t + Number(i.amount), 0)

    const thStyle = `padding:5px 7px;text-align:left;font-family:monospace;font-size:9px;text-transform:uppercase;letter-spacing:1px;white-space:nowrap;background:#f8f8f6;border-bottom:2px solid #1a1a1a;`
    const rowHtml = (inv: Invoice, isPaid: boolean) => {
      const bd = resolveBankDetails(inv)
      const overdue = isOverdue(inv)
      const isPriority = priorities.has(inv.id)
      const rowBg = isPaid ? '#f8f8f6' : isPriority ? '#fff8f0' : overdue ? '#fff5f5' : '#ffffff'
      const amtStyle = isPaid ? 'text-decoration:line-through;color:#9a9a9a;' : overdue ? 'color:#dc2626;' : ''
      const invLink = inv.pdf_url
        ? `<div style="margin-top:2px;"><a href="${inv.pdf_url}" style="font-size:8px;color:#6a6a6a;font-family:monospace;word-break:break-all;">${inv.pdf_url}</a></div>`
        : ''
      const { notes, paymentNote } = parseInternal(inv.internal)
      const payNoteHtml = paymentNote
        ? `<div style="font-size:8px;font-style:italic;color:#7a6a3a;margin-top:2px;">💳 ${paymentNote}</div>`
        : ''
      const notesHtml = notes
        ? `<span style="font-size:8px;color:#666;">${notes}</span>`
        : `<span style="color:#ccc;font-size:8px;">—</span>`
      return `<tr style="border-bottom:1px solid #e2e2e0;background:${rowBg};">
        <td style="padding:5px 4px;font-size:11px;text-align:center;">${isPriority ? '🚩' : ''}</td>
        <td style="padding:5px 7px;font-size:12px;text-align:center;">${isPaid ? '✓' : '☐'}</td>
        <td style="padding:5px 7px;font-size:10px;font-weight:600;">${inv.party}${invLink}${payNoteHtml}</td>
        <td style="padding:5px 7px;font-size:9px;font-family:monospace;">${inv.ref ?? ''}</td>
        <td style="padding:5px 7px;font-size:9px;color:#666;max-width:80px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${getDescription(inv)}</td>
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
        <td style="padding:5px 7px;">${notesHtml}</td>
      </tr>`
    }

    const tableHtml = (tableRows: Invoice[], isPaid: boolean) => `
      <table style="width:100%;border-collapse:collapse;font-size:10px;">
        <thead><tr>
          ${['', '', 'Supplier', 'Ref', 'Description', 'Category', 'Amount', 'Due', 'Bank', 'Sort', 'Acc No', 'Acc Name', 'IBAN', 'SWIFT', 'Status', 'Notes'].map(h => `<th style="${thStyle}">${h}</th>`).join('')}
        </tr></thead>
        <tbody>${tableRows.map(inv => rowHtml(inv, isPaid)).join('')}</tbody>
      </table>`

    const html = `<div style="font-family:Arial,sans-serif;">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:16px;">
        <div>
          <p style="font-size:9px;text-transform:uppercase;letter-spacing:2px;color:#9a9a9a;margin:0 0 4px;">Payment Sheet — Confidential${someSelected ? ` — ${rows.length} selected rows` : ''}</p>
          <h1 style="font-size:18px;font-weight:700;margin:0 0 3px;">${project.name}</h1>
          <p style="font-size:11px;color:#666;margin:0;">${project.code} · ${project.entity}</p>
        </div>
        <div style="text-align:right;">
          <p style="font-size:9px;color:#9a9a9a;margin:0 0 2px;font-family:monospace;text-transform:uppercase;">Generated</p>
          <p style="font-size:11px;font-family:monospace;margin:0;">${new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' })}</p>
        </div>
      </div>
      <div style="display:flex;gap:12px;margin-bottom:14px;">
        <div style="background:#fff9e6;padding:8px 14px;flex:1;"><p style="font-size:8px;text-transform:uppercase;letter-spacing:1px;color:#9a9a9a;margin:0 0 2px;">Outstanding (${outstanding.length})</p><p style="font-size:15px;font-weight:700;font-family:monospace;margin:0;">${fmt(totOut)}</p></div>
        <div style="background:#f0fdf4;padding:8px 14px;flex:1;"><p style="font-size:8px;text-transform:uppercase;letter-spacing:1px;color:#9a9a9a;margin:0 0 2px;">Paid (${paid.length})</p><p style="font-size:15px;font-weight:700;font-family:monospace;margin:0;color:#3a7a5a;">${fmt(totPaid)}</p></div>
        <div style="background:#f8f8f6;padding:8px 14px;flex:1;"><p style="font-size:8px;text-transform:uppercase;letter-spacing:1px;color:#9a9a9a;margin:0 0 2px;">Grand Total</p><p style="font-size:15px;font-weight:700;font-family:monospace;margin:0;">${fmt(totOut + totPaid)}</p></div>
      </div>
      ${outstanding.length > 0 ? `<p style="font-size:9px;text-transform:uppercase;letter-spacing:2px;font-weight:700;margin:0 0 5px;padding-bottom:4px;border-bottom:2px solid #1a1a1a;">Outstanding</p>${tableHtml(outstanding, false)}` : ''}
      ${paid.length > 0 ? `<p style="font-size:9px;text-transform:uppercase;letter-spacing:2px;font-weight:700;color:#9a9a9a;margin:12px 0 5px;padding-bottom:4px;border-bottom:1px solid #e2e2e0;">Paid</p>${tableHtml(paid, true)}` : ''}
      <div style="border-top:2px solid #1a1a1a;padding-top:10px;display:flex;gap:24px;margin-top:12px;">
        <div><p style="font-size:8px;text-transform:uppercase;letter-spacing:1px;color:#9a9a9a;margin:0 0 1px;">Outstanding</p><p style="font-size:13px;font-weight:700;font-family:monospace;margin:0;">${fmt(totOut)}</p></div>
        <div><p style="font-size:8px;text-transform:uppercase;letter-spacing:1px;color:#9a9a9a;margin:0 0 1px;">Paid</p><p style="font-size:13px;font-weight:700;font-family:monospace;margin:0;color:#3a7a5a;">${fmt(totPaid)}</p></div>
        <div><p style="font-size:8px;text-transform:uppercase;letter-spacing:1px;color:#9a9a9a;margin:0 0 1px;">Grand Total</p><p style="font-size:13px;font-weight:700;font-family:monospace;margin:0;">${fmt(totOut + totPaid)}</p></div>
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

  async function downloadZip(rows: Invoice[] = invoices) {
    const withUrls = rows.filter(i => i.pdf_url)
    if (withUrls.length === 0) { toast('No invoice attachments to download', 'error'); return }
    try {
      const JSZip = (await import('jszip')).default
      const zip = new JSZip()
      for (let i = 0; i < withUrls.length; i++) {
        const inv = withUrls[i]
        setZipProgress({ current: i + 1, total: withUrls.length })
        try {
          const resp = await fetch(inv.pdf_url!)
          if (!resp.ok) continue
          const blob = await resp.blob()
          const safeName = `${(inv.ref ?? 'invoice').replace(/[^a-z0-9_-]/gi, '-')}-${inv.party.replace(/[^a-z0-9_-]/gi, '-')}.pdf`
          zip.file(safeName, blob)
        } catch { /* skip */ }
      }
      setZipProgress(null)
      const content = await zip.generateAsync({ type: 'blob' })
      const a = document.createElement('a')
      a.href = URL.createObjectURL(content)
      a.download = `${project.code}-invoices-${todayISO()}.zip`
      a.click()
      toast(`Downloaded ${withUrls.length} invoice${withUrls.length !== 1 ? 's' : ''} as ZIP`)
    } catch (e) {
      setZipProgress(null)
      toast(`ZIP download failed: ${String(e)}`, 'error')
    }
  }

  async function exportPDFWithInvoices() {
    const rows = getExportRows()
    if (rows.length === 0) { toast('No rows to export', 'error'); return }

    try {
      const { PDFDocument, rgb, StandardFonts } = await import('pdf-lib')
      const mergedPdf = await PDFDocument.create()
      const helveticaBold = await mergedPdf.embedFont(StandardFonts.HelveticaBold)
      const helvetica = await mergedPdf.embedFont(StandardFonts.Helvetica)
      const courierBold = await mergedPdf.embedFont(StandardFonts.CourierBold)
      const courier = await mergedPdf.embedFont(StandardFonts.Courier)

      // Priority rows first
      const sortedRows = [...rows].sort((a, b) => (priorities.has(a.id) ? 0 : 1) - (priorities.has(b.id) ? 0 : 1))

      // ── Page 1: Summary (A4 landscape = 841.89 x 595.28 pts) ────────────────
      const W = 841.89, H = 595.28
      const M = 36
      const summaryPage = mergedPdf.addPage([W, H])

      const outstanding = sortedRows.filter(i => i.status !== 'paid')
      const paid = sortedRows.filter(i => i.status === 'paid')
      const totOut = outstanding.reduce((t, i) => t + Number(i.amount), 0)
      const totPaid = paid.reduce((t, i) => t + Number(i.amount), 0)

      summaryPage.drawText('PAYMENT SHEET — CONFIDENTIAL', { x: M, y: H - M - 10, font: courier, size: 7, color: rgb(0.6, 0.6, 0.6) })
      summaryPage.drawText(project.name, { x: M, y: H - M - 26, font: helveticaBold, size: 16, color: rgb(0.1, 0.1, 0.1) })
      summaryPage.drawText(`${project.code} · ${project.entity}`, { x: M, y: H - M - 42, font: helvetica, size: 9, color: rgb(0.4, 0.4, 0.4) })
      const dateStr = new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' })
      summaryPage.drawText('Generated', { x: W - M - 80, y: H - M - 10, font: courier, size: 7, color: rgb(0.6, 0.6, 0.6) })
      summaryPage.drawText(dateStr, { x: W - M - 80, y: H - M - 22, font: courier, size: 8, color: rgb(0.1, 0.1, 0.1) })

      const boxY = H - M - 70, boxH = 32
      const boxes = [
        { label: `Outstanding (${outstanding.length})`, val: fmt(totOut), x: M },
        { label: `Paid (${paid.length})`, val: fmt(totPaid), x: M + 160 },
        { label: 'Grand Total', val: fmt(totOut + totPaid), x: M + 320 },
      ]
      for (const b of boxes) {
        summaryPage.drawRectangle({ x: b.x, y: boxY, width: 150, height: boxH, color: rgb(0.97, 0.97, 0.95), borderColor: rgb(0.88, 0.88, 0.87), borderWidth: 0.5 })
        summaryPage.drawText(b.label.toUpperCase(), { x: b.x + 6, y: boxY + boxH - 12, font: courier, size: 6, color: rgb(0.6, 0.6, 0.6) })
        summaryPage.drawText(b.val, { x: b.x + 6, y: boxY + 6, font: courierBold, size: 12, color: rgb(0.1, 0.1, 0.1) })
      }

      const tY = boxY - 16
      const cols = [
        { header: '', w: 12 },
        { header: 'Supplier', w: 110 },
        { header: 'Ref', w: 70 },
        { header: 'Description', w: 90 },
        { header: 'Amount', w: 60 },
        { header: 'Due', w: 56 },
        { header: 'Bank', w: 70 },
        { header: 'Sort', w: 48 },
        { header: 'Acc No', w: 56 },
        { header: 'Acc Name', w: 72 },
        { header: 'Status', w: 52 },
        { header: 'Notes', w: 90 },
      ]
      const rowH = 14
      const headerH = 16

      let cx = M
      summaryPage.drawRectangle({ x: M, y: tY - headerH, width: W - 2 * M, height: headerH, color: rgb(0.97, 0.97, 0.95) })
      summaryPage.drawLine({ start: { x: M, y: tY }, end: { x: W - M, y: tY }, thickness: 1.5, color: rgb(0.1, 0.1, 0.1) })
      summaryPage.drawLine({ start: { x: M, y: tY - headerH }, end: { x: W - M, y: tY - headerH }, thickness: 0.5, color: rgb(0.88, 0.88, 0.87) })
      for (const col of cols) {
        summaryPage.drawText(col.header.toUpperCase(), { x: cx + 2, y: tY - 11, font: courier, size: 6, color: rgb(0.3, 0.3, 0.3) })
        cx += col.w
      }

      let rowY = tY - headerH
      const maxRows = Math.floor((rowY - M - 20) / rowH)
      const visibleRows = sortedRows.slice(0, maxRows)

      for (const inv of visibleRows) {
        const isPaid = inv.status === 'paid'
        const overdue = isOverdue(inv)
        const isPri = priorities.has(inv.id)
        const bd = resolveBankDetails(inv)
        const { notes } = parseInternal(inv.internal)
        rowY -= rowH

        if (isPri) summaryPage.drawRectangle({ x: M, y: rowY, width: W - 2 * M, height: rowH, color: rgb(1, 0.97, 0.93), opacity: 0.8 })
        else if (isPaid) summaryPage.drawRectangle({ x: M, y: rowY, width: W - 2 * M, height: rowH, color: rgb(0.97, 0.97, 0.95), opacity: 0.5 })
        else if (overdue) summaryPage.drawRectangle({ x: M, y: rowY, width: W - 2 * M, height: rowH, color: rgb(1, 0.97, 0.97), opacity: 0.8 })

        summaryPage.drawLine({ start: { x: M, y: rowY }, end: { x: W - M, y: rowY }, thickness: 0.3, color: rgb(0.88, 0.88, 0.87) })

        const cellData = [
          isPri ? '!' : isPaid ? '✓' : '',
          inv.party.slice(0, 18),
          (inv.ref ?? '').slice(0, 12),
          getDescription(inv).slice(0, 16),
          fmt(Number(inv.amount), inv.currency),
          inv.due ? fmtDate(inv.due) : '—',
          (bd.bankName ?? '').slice(0, 12),
          bd.sortCode ?? '',
          bd.accNum ?? '',
          (bd.accName ?? '').slice(0, 12),
          isPaid ? 'PAID' : overdue ? 'OVERDUE' : inv.status.toUpperCase(),
          notes.slice(0, 15),
        ]

        cx = M
        for (let ci = 0; ci < cols.length; ci++) {
          const textColor = isPaid ? rgb(0.6, 0.6, 0.6) : ci === 4 && overdue ? rgb(0.86, 0.15, 0.15) : rgb(0.1, 0.1, 0.1)
          const font = ci === 0 || ci === 4 || ci === 10 ? courierBold : courier
          summaryPage.drawText(cellData[ci], { x: cx + 2, y: rowY + 4, font, size: 6.5, color: textColor })
          cx += cols[ci].w
        }
      }

      if (sortedRows.length > maxRows) {
        summaryPage.drawText(`+ ${sortedRows.length - maxRows} more rows — see attached invoices below`, {
          x: M, y: rowY - 14, font: courier, size: 7, color: rgb(0.6, 0.6, 0.6),
        })
      }

      summaryPage.drawLine({ start: { x: M, y: M + 28 }, end: { x: W - M, y: M + 28 }, thickness: 1.5, color: rgb(0.1, 0.1, 0.1) })
      summaryPage.drawText(`Outstanding: ${fmt(totOut)}`, { x: M, y: M + 14, font: courierBold, size: 8, color: rgb(0.1, 0.1, 0.1) })
      summaryPage.drawText(`Paid: ${fmt(totPaid)}`, { x: M + 160, y: M + 14, font: courierBold, size: 8, color: rgb(0.23, 0.48, 0.35) })
      summaryPage.drawText(`Grand Total: ${fmt(totOut + totPaid)}`, { x: M + 300, y: M + 14, font: courierBold, size: 8, color: rgb(0.1, 0.1, 0.1) })
      summaryPage.drawText(`Generated by AC Ledger · ${dateStr}`, { x: W - M - 160, y: M + 8, font: courier, size: 6, color: rgb(0.7, 0.7, 0.7) })

      const withUrls = sortedRows.filter(i => i.pdf_url)
      const withoutUrls = sortedRows.filter(i => !i.pdf_url)

      for (let i = 0; i < withUrls.length; i++) {
        const inv = withUrls[i]
        setPdfMergeProgress({ current: i + 1, total: withUrls.length })
        try {
          const resp = await fetch(inv.pdf_url!)
          if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
          const bytes = await resp.arrayBuffer()
          const extPdf = await PDFDocument.load(bytes, { ignoreEncryption: true })
          const pages = await mergedPdf.copyPages(extPdf, extPdf.getPageIndices())
          pages.forEach(p => mergedPdf.addPage(p))
        } catch {
          const ph = mergedPdf.addPage([595.28, 841.89])
          ph.drawText('INVOICE NOT AVAILABLE', { x: 80, y: 500, font: courierBold, size: 14, color: rgb(0.3, 0.3, 0.3) })
          ph.drawText(`Supplier: ${inv.party}`, { x: 80, y: 470, font: courier, size: 10, color: rgb(0.4, 0.4, 0.4) })
          ph.drawText(`Ref: ${inv.ref ?? '—'}`, { x: 80, y: 454, font: courier, size: 10, color: rgb(0.4, 0.4, 0.4) })
          ph.drawText(`Amount: ${fmt(Number(inv.amount), inv.currency)}`, { x: 80, y: 438, font: courier, size: 10, color: rgb(0.4, 0.4, 0.4) })
          ph.drawText('Could not fetch the invoice PDF. Please check the attachment URL.', { x: 80, y: 410, font: courier, size: 8, color: rgb(0.6, 0.6, 0.6) })
        }
      }

      for (const inv of withoutUrls) {
        const ph = mergedPdf.addPage([595.28, 841.89])
        ph.drawText('NO INVOICE ATTACHED', { x: 80, y: 500, font: courierBold, size: 14, color: rgb(0.3, 0.3, 0.3) })
        ph.drawText(`Supplier: ${inv.party}`, { x: 80, y: 470, font: courier, size: 10, color: rgb(0.4, 0.4, 0.4) })
        ph.drawText(`Ref: ${inv.ref ?? '—'}`, { x: 80, y: 454, font: courier, size: 10, color: rgb(0.4, 0.4, 0.4) })
        ph.drawText(`Amount: ${fmt(Number(inv.amount), inv.currency)}`, { x: 80, y: 438, font: courier, size: 10, color: rgb(0.4, 0.4, 0.4) })
        ph.drawText(`Due: ${inv.due ? fmtDate(inv.due) : '—'}`, { x: 80, y: 422, font: courier, size: 10, color: rgb(0.4, 0.4, 0.4) })
      }

      setPdfMergeProgress(null)
      const pdfBytes = await mergedPdf.save()
      const blob = new Blob([pdfBytes as BlobPart], { type: 'application/pdf' })
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = `${project.code}-payment-sheet-with-invoices-${todayISO()}.pdf`
      a.click()
      toast(`PDF with invoices downloaded (${sortedRows.length} rows, ${withUrls.length} attachments)`)
    } catch (e) {
      setPdfMergeProgress(null)
      toast(`PDF export failed: ${String(e)}`, 'error')
    }
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
        <div className="flex items-center gap-2 flex-wrap flex-1">
          <div className="flex items-center gap-1.5 bg-ac-amber-pale border border-ac-amber/20 px-3 py-1.5">
            <span className="font-mono text-[10px] text-ac-amber uppercase tracking-wider">{allOutstanding.length} outstanding</span>
            <span className="font-mono text-sm font-bold text-ac-amber">{fmt(totalOutstanding)}</span>
          </div>
          <div className="flex items-center gap-1.5 bg-ac-green-pale border border-ac-green/20 px-3 py-1.5">
            <span className="font-mono text-[10px] text-ac-green uppercase tracking-wider">{allPaid.length} paid</span>
            <span className="font-mono text-sm font-bold text-ac-green">{fmt(totalPaid)}</span>
          </div>
          {invoices.length > 0 && (
            <div className="flex items-center gap-1.5 bg-paper border border-rule px-3 py-1.5">
              <span className="font-mono text-[10px] text-muted uppercase tracking-wider">grand total</span>
              <span className="font-mono text-sm font-bold text-ink">{fmt(grandTotal)}</span>
            </div>
          )}
          {(() => {
            const missing = invoices.filter(i => !i.pdf_url).length
            return missing > 0 ? (
              <div className="flex items-center gap-1.5 bg-ac-amber-pale border border-ac-amber/30 px-3 py-1.5">
                <Paperclip size={10} className="text-ac-amber" />
                <span className="font-mono text-[10px] text-ac-amber uppercase tracking-wider">{missing} invoice{missing !== 1 ? 's' : ''} missing attachment</span>
              </div>
            ) : null
          })()}
        </div>

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
          <button onClick={() => void downloadZip(invoices)} disabled={!!zipProgress}
            className="flex items-center gap-1 font-mono text-[10px] px-2 py-1.5 border border-rule text-muted hover:text-ink transition-colors uppercase tracking-wider disabled:opacity-50">
            <Download size={10} />
            {zipProgress ? `${zipProgress.current}/${zipProgress.total}…` : 'All Invoices ZIP'}
          </button>
          <button onClick={handleShare}
            className={cn(
              'flex items-center gap-1 font-mono text-[10px] px-2 py-1.5 border transition-colors uppercase tracking-wider',
              shareCopied ? 'border-ac-green text-ac-green bg-ac-green-pale' : 'border-rule text-muted hover:text-ink'
            )}>
            {shareCopied ? <Check size={10} /> : <Share2 size={10} />}
            {shareCopied ? 'Copied!' : 'Share'}
          </button>
        </div>
      </div>

      {/* ── Filter bar ── */}
      <div className="bg-white border border-rule p-3 flex items-center gap-2 flex-wrap">
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

        {/* Priority filter */}
        <button
          onClick={() => setShowPriorityOnly(v => !v)}
          className={cn(
            'flex items-center gap-1 font-mono text-[10px] px-2.5 py-1.5 border transition-colors uppercase tracking-wider',
            showPriorityOnly ? 'bg-red-600 border-red-600 text-white' : 'border-rule text-muted hover:text-ink'
          )}
          title="Show priority invoices only"
        >
          <Flag size={9} /> Priority only
        </button>

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

        {someSelected && (
          <button
            onClick={() => { if (window.confirm(`Delete ${selected.size} selected invoice${selected.size !== 1 ? 's' : ''} from Supabase? This cannot be undone.`)) void deleteSelected() }}
            className="flex items-center gap-1 font-mono text-[10px] px-2 py-1.5 border border-red-300 text-red-600 hover:bg-red-50 transition-colors uppercase tracking-wider"
          >
            <Trash2 size={10} /> Delete selected ({selected.size})
          </button>
        )}

        {(search || statusFilter !== 'all' || showPriorityOnly) && (
          <button onClick={() => { setSearch(''); setStatusFilter('all'); setShowPriorityOnly(false) }}
            className="font-mono text-[10px] text-muted hover:text-red-500 transition-colors flex items-center gap-1">
            <X size={9} /> Clear
          </button>
        )}
      </div>

      {/* ── Selection action bar ── */}
      {someSelected && (
        <div className="bg-ink text-white px-4 py-2.5 flex items-center gap-3 flex-wrap">
          <span className="font-mono text-[10px] uppercase tracking-wider text-white/70">
            {selected.size} row{selected.size !== 1 ? 's' : ''} selected
          </span>
          <span className="text-white/30">—</span>
          <span className="font-mono text-[10px] text-white/70 uppercase tracking-wider">Export selected as:</span>
          <button onClick={exportCSV}
            className="flex items-center gap-1 font-mono text-[10px] px-2.5 py-1 border border-white/30 text-white hover:bg-white/10 transition-colors uppercase tracking-wider">
            <Download size={9} /> CSV
          </button>
          <button onClick={() => void exportXLSX()}
            className="flex items-center gap-1 font-mono text-[10px] px-2.5 py-1 border border-white/30 text-white hover:bg-white/10 transition-colors uppercase tracking-wider">
            <FileSpreadsheet size={9} /> Excel
          </button>
          <button onClick={exportPDF}
            className="flex items-center gap-1 font-mono text-[10px] px-2.5 py-1 border border-white/30 text-white hover:bg-white/10 transition-colors uppercase tracking-wider">
            <Printer size={9} /> PDF
          </button>
          <button onClick={() => void downloadZip(getExportRows())} disabled={!!zipProgress}
            className="flex items-center gap-1 font-mono text-[10px] px-2.5 py-1 border border-white/30 text-white hover:bg-white/10 transition-colors uppercase tracking-wider disabled:opacity-50">
            <Download size={9} />
            {zipProgress ? `${zipProgress.current}/${zipProgress.total}…` : 'ZIP Invoices'}
          </button>
          <button onClick={() => void exportPDFWithInvoices()} disabled={!!pdfMergeProgress}
            className="flex items-center gap-1 font-mono text-[10px] px-2.5 py-1 border border-white/30 text-white hover:bg-white/10 transition-colors uppercase tracking-wider disabled:opacity-50">
            <FileDown size={9} />
            {pdfMergeProgress ? `Merging ${pdfMergeProgress.current}/${pdfMergeProgress.total}…` : '↓ PDF with Invoices'}
          </button>
          <div className="ml-auto flex items-center gap-2">
            <button onClick={selectAllOutstanding}
              className="font-mono text-[10px] text-white/60 hover:text-white transition-colors underline underline-offset-2">
              Select outstanding
            </button>
            <button onClick={deselectAll}
              className="font-mono text-[10px] text-white/60 hover:text-white transition-colors underline underline-offset-2">
              Deselect all
            </button>
          </div>
        </div>
      )}

      {/* ── Table ── */}
      {invoices.length === 0 ? (
        <div className="tbl-card py-16 text-center">
          <p className="font-mono text-xs text-muted uppercase tracking-wider">No payable invoices for this project</p>
          <p className="font-mono text-[10px] text-muted mt-2">Extract PDFs in the Costs tab or add invoices via the Invoices tab</p>
        </div>
      ) : displayed.length === 0 ? (
        <div className="tbl-card py-12 text-center">
          <p className="font-mono text-xs text-muted uppercase tracking-wider">No invoices match filters</p>
          <button onClick={() => { setSearch(''); setStatusFilter('all'); setShowPriorityOnly(false) }} className="mt-2 font-mono text-xs text-ink underline underline-offset-2">Clear filters</button>
        </div>
      ) : (
        <div className="tbl-card overflow-hidden">
          <div className="overflow-x-auto max-h-[calc(100vh-320px)] overflow-y-auto">
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr>
                  <TH cls="w-8 text-center">
                    <button onClick={allSelected ? deselectAll : selectAll} title={allSelected ? 'Deselect all' : 'Select all'}
                      className="text-muted hover:text-ink transition-colors mx-auto block">
                      {allSelected ? <CheckSquare size={13} className="text-ink" /> : someSelected ? <CheckSquare size={13} className="text-muted/50" /> : <Square size={13} />}
                    </button>
                  </TH>
                  <TH cls="w-8 text-center" >🚩</TH>
                  <TH cls="w-10 text-center">Paid</TH>
                  <TH cls="cursor-pointer hover:text-ink select-none">
                    <span onClick={() => toggleSort('party')}>Supplier <SortIcon k="party" /></span>
                  </TH>
                  <TH>Ref</TH>
                  <TH cls="min-w-[140px]">Description</TH>
                  <TH>Category</TH>
                  <TH cls="cursor-pointer hover:text-ink select-none text-right">
                    <span onClick={() => toggleSort('amount')}>Amount <SortIcon k="amount" /></span>
                  </TH>
                  <TH>Ccy</TH>
                  <TH cls="cursor-pointer hover:text-ink select-none">
                    <span onClick={() => toggleSort('due')}>Due Date <SortIcon k="due" /></span>
                  </TH>
                  <TH cls="bg-cream">Bank Name</TH>
                  <TH cls="bg-cream">Sort Code</TH>
                  <TH cls="bg-cream">Acc No</TH>
                  <TH cls="bg-cream">Acc Name</TH>
                  <TH cls="bg-cream">IBAN</TH>
                  <TH cls="bg-cream">SWIFT</TH>
                  <TH cls="w-28">Invoice</TH>
                  <TH cls="cursor-pointer hover:text-ink select-none">
                    <span onClick={() => toggleSort('status')}>Status <SortIcon k="status" /></span>
                  </TH>
                  <TH cls="min-w-[120px]">Notes</TH>
                  <TH cls="w-8">{''}</TH>
                </tr>
              </thead>
              <tbody>
                {displayed.map((inv, idx) => {
                  const bd = resolveBankDetails(inv)
                  const paid = inv.status === 'paid'
                  const overdue = isOverdue(inv)
                  const marking = markingPaid.has(inv.id)
                  const isSelected = selected.has(inv.id)
                  const isDeleting = deletingIds.has(inv.id)
                  const confirmingDelete = deleteConfirm === inv.id
                  const isPri = priorities.has(inv.id)
                  const isEditingNote = editingNoteId === inv.id
                  const { notes, paymentNote } = parseInternal(inv.internal)

                  const rowCls = cn(
                    'border-b border-rule last:border-0 transition-colors group',
                    isSelected ? 'bg-ac-green-pale/40' : isPri ? 'bg-ac-amber-pale/40' : paid ? 'bg-paper/60' : overdue ? 'bg-red-50/40' : idx % 2 === 1 ? 'bg-white' : 'bg-paper/20'
                  )
                  const textCls = paid ? 'text-muted' : 'text-ink'
                  const monoSmall = `font-mono text-[10px] ${paid ? 'text-muted/70' : 'text-muted'}`

                  return (
                    <tr key={inv.id} className={rowCls}>
                      {/* Selection */}
                      <td className="px-2 py-2 text-center">
                        <button onClick={() => toggleSelect(inv.id)} className="text-muted hover:text-ink transition-colors mx-auto block"
                          title={isSelected ? 'Deselect row' : 'Select row'}>
                          {isSelected ? <CheckSquare size={13} className="text-ink" /> : <Square size={13} className="opacity-40 group-hover:opacity-100 transition-opacity" />}
                        </button>
                      </td>

                      {/* Priority flag */}
                      <td className="px-2 py-2 text-center">
                        <button
                          onClick={() => togglePriority(inv.id)}
                          title={isPri ? 'Remove priority flag' : 'Flag as high priority'}
                          className={cn('text-sm transition-opacity', isPri ? 'opacity-100' : 'opacity-20 group-hover:opacity-60')}
                        >
                          🚩
                        </button>
                      </td>

                      {/* Paid checkbox */}
                      <td className="px-3 py-2 text-center">
                        <button onClick={() => void togglePaid(inv)} disabled={marking}
                          title={paid ? 'Mark as unpaid' : 'Mark as paid'}
                          className={cn('w-5 h-5 flex items-center justify-center border-2 transition-all mx-auto',
                            marking ? 'opacity-40' : '',
                            paid ? 'bg-ac-green border-ac-green' : 'border-rule hover:border-ink')}>
                          {paid && <Check size={11} className="text-white" />}
                        </button>
                      </td>

                      {/* Supplier */}
                      <td className="px-3 py-2">
                        <span className={`font-semibold text-sm ${textCls} ${paid ? 'line-through' : ''}`}>{inv.party}</span>
                        {paymentNote && (
                          <span className="block mt-0.5 font-mono text-[10px] text-ac-amber italic">💳 {paymentNote}</span>
                        )}
                        {inv.pdf_url ? (
                          <a href={inv.pdf_url} target="_blank" rel="noopener noreferrer"
                            className="block mt-0.5 font-mono text-[10px] text-muted hover:text-ink transition-colors">
                            📎 View Invoice →
                          </a>
                        ) : (
                          <span className="block mt-0.5 font-mono text-[10px] text-ac-amber">No invoice attached</span>
                        )}
                      </td>

                      {/* Ref */}
                      <td className={`px-3 py-2 ${monoSmall}`}>{inv.ref ?? <span className="text-muted/40">—</span>}</td>

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
                      <td className={`px-3 py-2 ${monoSmall} bg-cream/60`}>{bd.bankName ?? <span className="text-muted/30">—</span>}</td>
                      <td className={`px-3 py-2 ${monoSmall} bg-cream/60`}>{bd.sortCode ?? <span className="text-muted/30">—</span>}</td>
                      <td className={`px-3 py-2 ${monoSmall} bg-cream/60`}>{bd.accNum ?? <span className="text-muted/30">—</span>}</td>
                      <td className={`px-3 py-2 ${monoSmall} bg-cream/60`}>{bd.accName ?? <span className="text-muted/30">—</span>}</td>
                      <td className={`px-3 py-2 ${monoSmall} bg-cream/60 max-w-[130px] truncate`}>{bd.iban ?? <span className="text-muted/30">—</span>}</td>
                      <td className={`px-3 py-2 ${monoSmall} bg-cream/60`}>{bd.swift ?? <span className="text-muted/30">—</span>}</td>

                      {/* Invoice attachment */}
                      <td className="px-3 py-2 whitespace-nowrap">
                        {inv.pdf_url ? (
                          <a href={inv.pdf_url} target="_blank" rel="noopener noreferrer"
                            className="flex items-center gap-1 font-mono text-[10px] text-muted hover:text-ink transition-colors" title="Open invoice PDF">
                            <Paperclip size={10} /> View Invoice
                          </a>
                        ) : <span className="text-muted/30 font-mono text-[10px]">—</span>}
                      </td>

                      {/* Status */}
                      <td className="px-3 py-2">
                        <span className={cn('badge', STATUS_BADGE_CLS[inv.status] ?? 'badge-draft')}>{inv.status}</span>
                      </td>

                      {/* Notes — inline editable */}
                      <td className="px-2 py-1.5 min-w-[120px] max-w-[200px]">
                        {isEditingNote ? (
                          <div className="flex flex-col gap-1">
                            <input
                              autoFocus
                              value={noteValue}
                              onChange={e => setNoteValue(e.target.value)}
                              onBlur={() => void saveNote(inv)}
                              onKeyDown={e => {
                                if (e.key === 'Enter') void saveNote(inv)
                                if (e.key === 'Escape') setEditingNoteId(null)
                              }}
                              className="w-full border border-ink bg-white px-1.5 py-0.5 text-[10px] font-mono focus:outline-none"
                              placeholder="Internal note…"
                            />
                            <input
                              value={payNoteValue}
                              onChange={e => setPayNoteValue(e.target.value)}
                              onBlur={() => void savePaymentNote(inv)}
                              onKeyDown={e => {
                                if (e.key === 'Enter') void savePaymentNote(inv)
                                if (e.key === 'Escape') setEditingNoteId(null)
                              }}
                              className="w-full border border-dashed border-ac-amber/40 bg-ac-amber-pale/30 px-1.5 py-0.5 text-[10px] font-mono italic text-ac-amber focus:outline-none"
                              placeholder="💳 Payment note…"
                            />
                          </div>
                        ) : (
                          <button
                            className="text-left w-full"
                            onClick={() => startEditNote(inv)}
                            title={[notes, paymentNote].filter(Boolean).join('\n') || undefined}
                          >
                            {!notes && !paymentNote ? (
                              <span className="text-muted/20 group-hover:text-muted/50 text-[10px] font-mono transition-colors">+ note</span>
                            ) : (
                              <div>
                                {notes && (
                                  <span className="font-mono text-[10px] text-ink flex items-center gap-1">
                                    📝 <span className="truncate max-w-[140px] inline-block">{notes}</span>
                                  </span>
                                )}
                                {paymentNote && (
                                  <span className="block font-mono text-[10px] text-ac-amber italic truncate max-w-[140px]">💳 {paymentNote}</span>
                                )}
                              </div>
                            )}
                          </button>
                        )}
                      </td>

                      {/* Delete */}
                      <td className="px-2 py-2 text-center whitespace-nowrap">
                        {confirmingDelete ? (
                          <div className="flex items-center gap-1">
                            <button onClick={() => void doDelete(inv.id)} disabled={isDeleting}
                              className="font-mono text-[9px] px-1.5 py-0.5 bg-red-600 text-white hover:bg-red-700 transition-colors disabled:opacity-50">
                              {isDeleting ? '…' : 'Yes'}
                            </button>
                            <button onClick={() => setDeleteConfirm(null)}
                              className="font-mono text-[9px] px-1.5 py-0.5 border border-rule text-muted hover:text-ink transition-colors">No</button>
                          </div>
                        ) : (
                          <button onClick={() => setDeleteConfirm(inv.id)} disabled={isDeleting}
                            title="Delete invoice from Supabase"
                            className="opacity-0 group-hover:opacity-100 transition-opacity text-muted hover:text-red-600 disabled:opacity-50">
                            <X size={13} />
                          </button>
                        )}
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
              { label: 'Outstanding', val: totalOutstanding, cls: totalOutstanding > 0 ? 'text-ac-amber' : 'text-muted' },
              { label: 'Paid', val: totalPaid, cls: 'text-ac-green' },
            ].map(({ label, val, cls }) => (
              <div key={label}>
                <p className="font-mono text-[9px] uppercase tracking-widest text-muted">{label}</p>
                <p className={cn('font-mono text-lg font-bold mt-0.5', cls)}>{fmt(val)}</p>
              </div>
            ))}
            <div className="ml-auto flex items-center gap-4">
              <div className="flex items-center gap-2">
                <button onClick={selectAll} className="font-mono text-[10px] text-muted hover:text-ink transition-colors underline underline-offset-2">Select all</button>
                <button onClick={selectAllOutstanding} className="font-mono text-[10px] text-muted hover:text-ink transition-colors underline underline-offset-2">Select outstanding</button>
                {someSelected && (
                  <button onClick={deselectAll} className="font-mono text-[10px] text-muted hover:text-ink transition-colors underline underline-offset-2">Deselect all</button>
                )}
              </div>
              <span className="font-mono text-[10px] text-muted">
                {displayed.length !== invoices.length
                  ? `Showing ${displayed.length} of ${invoices.length} invoices`
                  : `${invoices.length} invoice${invoices.length !== 1 ? 's' : ''} total`}
              </span>
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
