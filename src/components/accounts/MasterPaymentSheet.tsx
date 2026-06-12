'use client'

import { useState, useEffect, useMemo, useCallback } from 'react'
import {
  Download, Check, X, ChevronUp, ChevronDown, ChevronRight,
  Paperclip, Printer, RefreshCw, FileSpreadsheet,
  Search, Trash2, Square, CheckSquare, FileDown, Flag, Layers,
} from 'lucide-react'
import { sb } from '@/lib/supabase'
import { cn, fmt, fmtDate, todayISO } from '@/lib/format'
import { toast } from '@/lib/toast'
import { parseInternal, buildInternal } from '@/components/projects/PaymentSheet'
import type { Invoice, InvoiceUpdate, Entity, BankDetails } from '@/types'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface MasterPaymentSheetProps {
  updateInvoice?: (id: string, data: InvoiceUpdate) => Promise<Invoice>
}

type SortKey = 'party' | 'due' | 'amount' | 'status' | 'project'
type SortDir = 'asc' | 'desc'
type EntityFilter = Entity | 'all'

const ENTITIES: Entity[] = ['Actually Creative', '419Studios', 'RTW Records']
const ENTITY_SHORT: Record<Entity, string> = {
  'Actually Creative': 'AC',
  '419Studios': '419',
  'RTW Records': 'RTW',
}

const OUTSTANDING_STATUSES = ['pending', 'overdue', 'part-paid', 'submitted', 'approved', 'sent']

// ─── Helpers ──────────────────────────────────────────────────────────────────

function resolveBankDetails(inv: Invoice): Partial<BankDetails> {
  if (inv.bank_details) return inv.bank_details
  try {
    const ls = localStorage.getItem(`invoice_bank_${inv.id}`)
    if (ls) return JSON.parse(ls) as BankDetails
  } catch { /* ignore */ }
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

export function MasterPaymentSheet({ updateInvoice }: MasterPaymentSheetProps) {
  // ── Data ───────────────────────────────────────────────────────────────────
  const [invoices, setInvoices] = useState<Invoice[]>([])
  const [loading, setLoading] = useState(true)
  const [markingPaid, setMarkingPaid] = useState<Set<string>>(new Set())

  // ── Filters ────────────────────────────────────────────────────────────────
  const [search, setSearch] = useState('')
  const [entityFilter, setEntityFilter] = useState<EntityFilter>('all')
  const [projectFilter, setProjectFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState<'outstanding' | 'all' | 'paid'>('outstanding')
  const [dueDateFrom, setDueDateFrom] = useState('')
  const [dueDateTo, setDueDateTo] = useState('')
  const [sortKey, setSortKey] = useState<SortKey>('due')
  const [sortDir, setSortDir] = useState<SortDir>('asc')

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

  // ── Selection ──────────────────────────────────────────────────────────────
  const [selected, setSelected] = useState<Set<string>>(new Set())

  // ── Delete ─────────────────────────────────────────────────────────────────
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null)
  const [deletingIds, setDeletingIds] = useState<Set<string>>(new Set())

  // ── Group by project ───────────────────────────────────────────────────────
  const [groupByProject, setGroupByProject] = useState(false)
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set())

  // ── Export progress ────────────────────────────────────────────────────────
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
        .order('due', { ascending: true })
      if (error) throw error
      setInvoices((data as Invoice[]) ?? [])
    } catch (e) {
      toast(`Failed to load invoices: ${String(e)}`, 'error')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void fetchInvoices() }, [fetchInvoices])

  // ── Derived projects list (from invoices) ──────────────────────────────────
  const projectOptions = useMemo(() => {
    const map = new Map<string, string>()
    for (const inv of invoices) {
      if (inv.project_code) map.set(inv.project_code, inv.project_name ?? inv.project_code)
    }
    return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0]))
  }, [invoices])

  // ── Summary stats ──────────────────────────────────────────────────────────
  const summaryStats = useMemo(() => {
    const all = invoices.filter(i => OUTSTANDING_STATUSES.includes(i.status))
    const totalOutstanding = all.reduce((t, i) => t + Number(i.amount), 0)
    const totalOverdue = all.filter(i => isOverdue(i)).reduce((t, i) => t + Number(i.amount), 0)
    const byEntity = Object.fromEntries(
      ENTITIES.map(e => [e, all.filter(i => i.entity === e).reduce((t, i) => t + Number(i.amount), 0)])
    )
    return { totalOutstanding, totalOverdue, count: all.length, byEntity }
  }, [invoices])

  // ── Filtered + sorted rows ─────────────────────────────────────────────────
  const displayed = useMemo(() => {
    let rows = [...invoices]
    if (statusFilter === 'outstanding') rows = rows.filter(i => OUTSTANDING_STATUSES.includes(i.status))
    else if (statusFilter === 'paid') rows = rows.filter(i => i.status === 'paid')
    if (entityFilter !== 'all') rows = rows.filter(i => i.entity === entityFilter)
    if (projectFilter) rows = rows.filter(i => i.project_code === projectFilter)
    if (dueDateFrom) rows = rows.filter(i => i.due && i.due >= dueDateFrom)
    if (dueDateTo) rows = rows.filter(i => i.due && i.due <= dueDateTo)
    if (search.trim()) {
      const q = search.toLowerCase()
      rows = rows.filter(i =>
        i.party.toLowerCase().includes(q) ||
        (i.ref ?? '').toLowerCase().includes(q) ||
        (i.project_code ?? '').toLowerCase().includes(q) ||
        (i.project_name ?? '').toLowerCase().includes(q)
      )
    }
    if (showPriorityOnly) rows = rows.filter(i => priorities.has(i.id))

    rows.sort((a, b) => {
      const ap = priorities.has(a.id) ? 0 : 1
      const bp = priorities.has(b.id) ? 0 : 1
      if (ap !== bp) return ap - bp
      let av: string | number = '', bv: string | number = ''
      if (sortKey === 'party')   { av = a.party.toLowerCase(); bv = b.party.toLowerCase() }
      if (sortKey === 'due')     { av = a.due ?? '9999'; bv = b.due ?? '9999' }
      if (sortKey === 'amount')  { av = Number(a.amount); bv = Number(b.amount) }
      if (sortKey === 'status')  { av = a.status; bv = b.status }
      if (sortKey === 'project') { av = (a.project_code ?? '').toLowerCase(); bv = (b.project_code ?? '').toLowerCase() }
      if (av < bv) return sortDir === 'asc' ? -1 : 1
      if (av > bv) return sortDir === 'asc' ? 1 : -1
      return 0
    })
    return rows
  }, [invoices, search, entityFilter, projectFilter, statusFilter, dueDateFrom, dueDateTo, sortKey, sortDir, priorities, showPriorityOnly])

  const allSelected = displayed.length > 0 && displayed.every(i => selected.has(i.id))
  const someSelected = selected.size > 0
  const missingCount = displayed.filter(i => !i.pdf_url && i.status !== 'paid').length

  function getExportRows() {
    const rows = someSelected ? displayed.filter(i => selected.has(i.id)) : displayed
    return [...rows].sort((a, b) => (priorities.has(a.id) ? 0 : 1) - (priorities.has(b.id) ? 0 : 1))
  }

  // ── Grouped view ───────────────────────────────────────────────────────────
  const grouped = useMemo(() => {
    if (!groupByProject) return null
    const map = new Map<string, Invoice[]>()
    for (const inv of displayed) {
      const key = inv.project_code ?? '(No Project)'
      const arr = map.get(key) ?? []
      arr.push(inv)
      map.set(key, arr)
    }
    return map
  }, [displayed, groupByProject])

  function toggleGroup(key: string) {
    setCollapsedGroups(prev => { const n = new Set(prev); n.has(key) ? n.delete(key) : n.add(key); return n })
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
    return sortDir === 'asc' ? <ChevronUp size={9} className="inline ml-0.5" /> : <ChevronDown size={9} className="inline ml-0.5" />
  }

  function toggleSelect(id: string) {
    setSelected(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })
  }
  function selectAll() { setSelected(new Set(displayed.map(i => i.id))) }
  function deselectAll() { setSelected(new Set()) }
  function selectAllOutstanding() { setSelected(new Set(displayed.filter(i => OUTSTANDING_STATUSES.includes(i.status)).map(i => i.id))) }

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

  function togglePriority(id: string) {
    const newVal = !priorities.has(id)
    lsPrioritySet(id, newVal)
    setPriorities(prev => { const n = new Set(prev); newVal ? n.add(id) : n.delete(id); return n })
  }

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
    } catch (e) { toast(`Note save failed: ${String(e)}`, 'error') }
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
    } catch (e) { toast(`Note save failed: ${String(e)}`, 'error') }
    setEditingNoteId(null)
  }

  // ── Exports ────────────────────────────────────────────────────────────────

  function buildRows(rows: Invoice[]) {
    return rows.map(inv => {
      const bd = resolveBankDetails(inv)
      const { notes, paymentNote } = parseInternal(inv.internal)
      return {
        priority: priorities.has(inv.id) ? 'HIGH' : '',
        paid: inv.status === 'paid' ? '✓' : '',
        party: inv.party,
        ref: inv.ref ?? '',
        project: inv.project_code ? `${inv.project_code}${inv.project_name ? ` — ${inv.project_name}` : ''}` : '',
        entity: inv.entity,
        description: getDescription(inv),
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
    const outstanding = rows.filter(i => OUTSTANDING_STATUSES.includes(i.status)).reduce((t, i) => t + Number(i.amount), 0)
    const paid = rows.filter(i => i.status === 'paid').reduce((t, i) => t + Number(i.amount), 0)
    const header = ['Priority', 'Paid', 'Supplier', 'Invoice Ref', 'Project', 'Entity',
      'Description', 'Amount', 'Currency', 'Due Date', 'Bank Name', 'Sort Code', 'Acc No', 'Acc Name',
      'IBAN', 'SWIFT', 'Invoice URL', 'Status', 'Notes', 'Payment Note']
    const dataRows = buildRows(rows).map(r => Object.values(r))
    dataRows.push([])
    dataRows.push(['', '', '', '', '', '', '', outstanding, '', '', '', '', '', '', '', '', '', 'Total Outstanding', '', ''])
    dataRows.push(['', '', '', '', '', '', '', paid, '', '', '', '', '', '', '', '', '', 'Total Paid', '', ''])
    dataRows.push(['', '', '', '', '', '', '', outstanding + paid, '', '', '', '', '', '', '', '', '', 'Grand Total', '', ''])
    const csv = [header, ...dataRows].map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n')
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }))
    a.download = `master-payment-sheet-${todayISO()}.csv`
    a.click()
    toast(`CSV downloaded (${rows.length} rows)`)
  }

  async function exportXLSX() {
    try {
      const XLSX = await import('xlsx')
      const rows = getExportRows()
      const outstanding = rows.filter(i => OUTSTANDING_STATUSES.includes(i.status)).reduce((t, i) => t + Number(i.amount), 0)
      const paid = rows.filter(i => i.status === 'paid').reduce((t, i) => t + Number(i.amount), 0)
      const header = ['Priority', 'Paid', 'Supplier', 'Invoice Ref', 'Project', 'Entity',
        'Description', 'Amount', 'Currency', 'Due Date', 'Bank Name', 'Sort Code', 'Acc No', 'Acc Name',
        'IBAN', 'SWIFT', 'Invoice', 'Status', 'Notes', 'Payment Note']

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const dataRows: any[][] = buildRows(rows).map(r => {
        const vals: unknown[] = Object.values(r)
        const urlIdx = 16
        const url = vals[urlIdx] ? String(vals[urlIdx]) : null
        if (url) vals[2] = { t: 's', v: String(vals[2]), l: { Target: url } }
        vals[urlIdx] = url ? { t: 's', v: 'View Invoice', l: { Target: url } } : 'No attachment'
        return vals
      })
      dataRows.push([], ['', '', '', '', '', '', '', outstanding, '', '', '', '', '', '', '', '', '', 'Total Outstanding', '', ''])
      dataRows.push(['', '', '', '', '', '', '', paid, '', '', '', '', '', '', '', '', '', 'Total Paid', '', ''])
      dataRows.push(['', '', '', '', '', '', '', outstanding + paid, '', '', '', '', '', '', '', '', '', 'Grand Total', '', ''])

      const ws1 = XLSX.utils.aoa_to_sheet([header, ...dataRows])
      ws1['!cols'] = [6, 5, 22, 14, 22, 16, 28, 10, 6, 12, 18, 10, 12, 18, 24, 12, 28, 12, 24, 24].map(w => ({ wch: w }))

      // Summary by entity
      const entitySummary = ENTITIES.map(e => {
        const entityRows = rows.filter(i => i.entity === e)
        const ent_out = entityRows.filter(i => OUTSTANDING_STATUSES.includes(i.status)).reduce((t, i) => t + Number(i.amount), 0)
        const ent_paid = entityRows.filter(i => i.status === 'paid').reduce((t, i) => t + Number(i.amount), 0)
        return [e, ent_out, ent_paid, ent_out + ent_paid]
      })

      const summary = [
        ['Master Payment Sheet'], ['Generated', new Date().toLocaleDateString('en-GB')], [],
        ['Entity', 'Outstanding', 'Paid', 'Total'],
        ...entitySummary,
        [], ['ALL ENTITIES', outstanding, paid, outstanding + paid],
      ]
      const ws2 = XLSX.utils.aoa_to_sheet(summary)
      ws2['!cols'] = [{ wch: 22 }, { wch: 14 }, { wch: 14 }, { wch: 14 }]

      const wb = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(wb, ws1, 'Payment Sheet')
      XLSX.utils.book_append_sheet(wb, ws2, 'Summary')
      XLSX.writeFile(wb, `master-payment-sheet-${todayISO()}.xlsx`)
      toast(`Excel downloaded (${rows.length} rows)`)
    } catch (e) {
      toast(`Export failed: ${String(e)}`, 'error')
    }
  }

  function exportPDF() {
    const rows = getExportRows()
    const outstanding = rows.filter(i => OUTSTANDING_STATUSES.includes(i.status))
    const paid = rows.filter(i => i.status === 'paid')
    const totOut = outstanding.reduce((t, i) => t + Number(i.amount), 0)
    const totPaid = paid.reduce((t, i) => t + Number(i.amount), 0)

    const thStyle = `padding:5px 7px;text-align:left;font-family:monospace;font-size:8px;text-transform:uppercase;letter-spacing:1px;white-space:nowrap;background:#f8f8f6;border-bottom:2px solid #1a1a1a;`

    const rowHtml = (inv: Invoice, isPaid: boolean) => {
      const bd = resolveBankDetails(inv)
      const overdue = isOverdue(inv)
      const isPri = priorities.has(inv.id)
      const rowBg = isPaid ? '#f8f8f6' : isPri ? '#fff8f0' : overdue ? '#fff5f5' : '#ffffff'
      const amtStyle = isPaid ? 'text-decoration:line-through;color:#9a9a9a;' : overdue ? 'color:#dc2626;' : ''
      const { notes, paymentNote } = parseInternal(inv.internal)
      const payNoteHtml = paymentNote ? `<div style="font-size:7px;font-style:italic;color:#7a6a3a;">💳 ${paymentNote}</div>` : ''
      const projectLabel = inv.project_code ? `<div style="font-size:7px;color:#9a9a9a;font-family:monospace;">${inv.project_code}</div>` : ''
      return `<tr style="border-bottom:1px solid #e2e2e0;background:${rowBg};">
        <td style="padding:5px 4px;font-size:11px;">${isPri ? '🚩' : ''}</td>
        <td style="padding:5px 7px;font-size:11px;text-align:center;">${isPaid ? '✓' : '☐'}</td>
        <td style="padding:5px 7px;font-size:9px;font-weight:600;">${inv.party}${payNoteHtml}</td>
        <td style="padding:5px 7px;font-size:8px;font-family:monospace;">${inv.ref ?? ''}</td>
        <td style="padding:5px 7px;font-size:8px;font-family:monospace;">${projectLabel}${inv.project_name ? `<div style="font-size:8px;">${inv.project_name}</div>` : ''}</td>
        <td style="padding:5px 7px;font-size:7px;font-family:monospace;color:#9a9a9a;">${ENTITY_SHORT[inv.entity as Entity] ?? inv.entity}</td>
        <td style="padding:5px 7px;font-size:9px;font-family:monospace;font-weight:700;text-align:right;${amtStyle}">${fmt(Number(inv.amount), inv.currency)}</td>
        <td style="padding:5px 7px;font-size:8px;font-family:monospace;${overdue ? 'color:#dc2626;font-weight:700;' : ''}">${inv.due ? fmtDate(inv.due) : '—'}</td>
        <td style="padding:5px 7px;font-size:8px;font-family:monospace;">${bd.sortCode ?? ''} ${bd.accNum ?? ''}</td>
        <td style="padding:5px 7px;font-size:8px;font-family:monospace;${isPaid ? 'color:#3a7a5a;' : overdue ? 'color:#dc2626;' : ''}">${isPaid ? 'PAID' : overdue ? 'OVERDUE' : inv.status.toUpperCase()}</td>
        <td style="padding:5px 7px;font-size:7px;color:#666;max-width:80px;">${notes}</td>
      </tr>`
    }

    const tableHtml = (tableRows: Invoice[], isPaid: boolean) => `
      <table style="width:100%;border-collapse:collapse;font-size:9px;">
        <thead><tr>
          ${['', '', 'Supplier', 'Ref', 'Project', 'Entity', 'Amount', 'Due', 'Bank Acc', 'Status', 'Notes'].map(h => `<th style="${thStyle}">${h}</th>`).join('')}
        </tr></thead>
        <tbody>${tableRows.map(inv => rowHtml(inv, isPaid)).join('')}</tbody>
      </table>`

    const entityBreakdown = ENTITIES.map(e => {
      const amt = outstanding.filter(i => i.entity === e).reduce((t, i) => t + Number(i.amount), 0)
      return amt > 0 ? `<div><p style="font-size:7px;text-transform:uppercase;letter-spacing:1px;color:#9a9a9a;margin:0 0 1px;">${ENTITY_SHORT[e]}</p><p style="font-size:11px;font-weight:700;font-family:monospace;margin:0;">${fmt(amt)}</p></div>` : ''
    }).filter(Boolean).join('')

    const html = `<div style="font-family:Arial,sans-serif;">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:12px;">
        <div>
          <p style="font-size:9px;text-transform:uppercase;letter-spacing:2px;color:#9a9a9a;margin:0 0 4px;">Master Payment Sheet — Confidential${someSelected ? ` — ${rows.length} selected rows` : ''}</p>
          <h1 style="font-size:18px;font-weight:700;margin:0 0 3px;">AC Accounts — All Payables</h1>
        </div>
        <p style="font-size:11px;font-family:monospace;margin:0;">${new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' })}</p>
      </div>
      <div style="display:flex;gap:10px;margin-bottom:14px;flex-wrap:wrap;">
        <div style="background:#fff9e6;padding:8px 14px;"><p style="font-size:7px;text-transform:uppercase;letter-spacing:1px;color:#9a9a9a;margin:0 0 2px;">Outstanding (${outstanding.length})</p><p style="font-size:14px;font-weight:700;font-family:monospace;margin:0;">${fmt(totOut)}</p></div>
        <div style="background:#fff5f5;padding:8px 14px;"><p style="font-size:7px;text-transform:uppercase;letter-spacing:1px;color:#9a9a9a;margin:0 0 2px;">Overdue</p><p style="font-size:14px;font-weight:700;font-family:monospace;margin:0;color:#dc2626;">${fmt(outstanding.filter(i => isOverdue(i)).reduce((t, i) => t + Number(i.amount), 0))}</p></div>
        ${entityBreakdown}
        <div style="background:#f8f8f6;padding:8px 14px;"><p style="font-size:7px;text-transform:uppercase;letter-spacing:1px;color:#9a9a9a;margin:0 0 2px;">Grand Total</p><p style="font-size:14px;font-weight:700;font-family:monospace;margin:0;">${fmt(totOut + totPaid)}</p></div>
      </div>
      ${outstanding.length > 0 ? `<p style="font-size:8px;text-transform:uppercase;letter-spacing:2px;font-weight:700;margin:0 0 5px;padding-bottom:4px;border-bottom:2px solid #1a1a1a;">Outstanding</p>${tableHtml(outstanding, false)}` : ''}
      ${paid.length > 0 ? `<p style="font-size:8px;text-transform:uppercase;letter-spacing:2px;font-weight:700;color:#9a9a9a;margin:10px 0 5px;padding-bottom:4px;border-bottom:1px solid #e2e2e0;">Paid</p>${tableHtml(paid, true)}` : ''}
      <p style="margin-top:16px;font-size:7px;color:#ccc;text-align:center;font-family:monospace;text-transform:uppercase;letter-spacing:1px;">Generated by AC Ledger · ${new Date().toLocaleDateString('en-GB')}</p>
    </div>`

    const printWin = window.open('', '_blank')
    if (!printWin) return
    printWin.document.write(
      `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Master Payment Sheet</title>` +
      `<style>* { box-sizing: border-box; } body { margin: 1cm; background: white; -webkit-print-color-adjust: exact; print-color-adjust: exact; } @page { size: A4 landscape; margin: 1cm; }</style>` +
      `</head><body>${html}</body></html>`
    )
    printWin.document.close()
    printWin.focus()
    setTimeout(() => { printWin.print(); printWin.close() }, 500)
  }

  async function downloadZip() {
    const rows = getExportRows()
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
          const prefix = inv.project_code ? `${inv.project_code}-` : ''
          const safeName = `${prefix}${(inv.ref ?? 'invoice').replace(/[^a-z0-9_-]/gi, '-')}-${inv.party.replace(/[^a-z0-9_-]/gi, '-')}.pdf`
          zip.file(safeName, blob)
        } catch { /* skip */ }
      }
      setZipProgress(null)
      const content = await zip.generateAsync({ type: 'blob' })
      const a = document.createElement('a')
      a.href = URL.createObjectURL(content)
      a.download = `all-invoices-${todayISO()}.zip`
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
      const courierBold = await mergedPdf.embedFont(StandardFonts.CourierBold)
      const courier = await mergedPdf.embedFont(StandardFonts.Courier)

      const W = 841.89, H = 595.28, M = 36
      const summaryPage = mergedPdf.addPage([W, H])

      const outstanding = rows.filter(i => OUTSTANDING_STATUSES.includes(i.status))
      const paid = rows.filter(i => i.status === 'paid')
      const totOut = outstanding.reduce((t, i) => t + Number(i.amount), 0)
      const totPaid = paid.reduce((t, i) => t + Number(i.amount), 0)

      summaryPage.drawText('MASTER PAYMENT SHEET — CONFIDENTIAL', { x: M, y: H - M - 10, font: courier, size: 7, color: rgb(0.6, 0.6, 0.6) })
      summaryPage.drawText('AC Accounts — All Payables', { x: M, y: H - M - 26, font: helveticaBold, size: 14, color: rgb(0.1, 0.1, 0.1) })
      summaryPage.drawText(new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' }), { x: W - M - 100, y: H - M - 10, font: courier, size: 8, color: rgb(0.1, 0.1, 0.1) })

      const boxY = H - M - 70, boxH = 32
      const boxes = [
        { label: `Outstanding (${outstanding.length})`, val: fmt(totOut), x: M },
        { label: `Overdue`, val: fmt(outstanding.filter(i => isOverdue(i)).reduce((t, i) => t + Number(i.amount), 0)), x: M + 160 },
        { label: `Paid (${paid.length})`, val: fmt(totPaid), x: M + 320 },
        { label: 'Grand Total', val: fmt(totOut + totPaid), x: M + 480 },
      ]
      for (const b of boxes) {
        summaryPage.drawRectangle({ x: b.x, y: boxY, width: 148, height: boxH, color: rgb(0.97, 0.97, 0.95), borderColor: rgb(0.88, 0.88, 0.87), borderWidth: 0.5 })
        summaryPage.drawText(b.label.toUpperCase(), { x: b.x + 6, y: boxY + boxH - 12, font: courier, size: 6, color: rgb(0.6, 0.6, 0.6) })
        summaryPage.drawText(b.val, { x: b.x + 6, y: boxY + 6, font: courierBold, size: 11, color: rgb(0.1, 0.1, 0.1) })
      }

      const tY = boxY - 16
      const cols = [
        { header: '', w: 12 }, { header: 'Supplier', w: 100 }, { header: 'Ref', w: 60 },
        { header: 'Project', w: 80 }, { header: 'Entity', w: 30 }, { header: 'Amount', w: 60 },
        { header: 'Due', w: 56 }, { header: 'Acc', w: 90 }, { header: 'Status', w: 50 }, { header: 'Notes', w: 80 },
      ]
      const rowH = 13, headerH = 16
      let cx = M
      summaryPage.drawRectangle({ x: M, y: tY - headerH, width: W - 2 * M, height: headerH, color: rgb(0.97, 0.97, 0.95) })
      summaryPage.drawLine({ start: { x: M, y: tY }, end: { x: W - M, y: tY }, thickness: 1.5, color: rgb(0.1, 0.1, 0.1) })
      for (const col of cols) {
        summaryPage.drawText(col.header.toUpperCase(), { x: cx + 2, y: tY - 11, font: courier, size: 6, color: rgb(0.3, 0.3, 0.3) })
        cx += col.w
      }

      let rowY = tY - headerH
      const maxRows = Math.floor((rowY - M - 20) / rowH)

      for (const inv of rows.slice(0, maxRows)) {
        const isPaid = inv.status === 'paid'
        const overdue = isOverdue(inv)
        const isPri = priorities.has(inv.id)
        const bd = resolveBankDetails(inv)
        const { notes } = parseInternal(inv.internal)
        rowY -= rowH
        if (isPri) summaryPage.drawRectangle({ x: M, y: rowY, width: W - 2 * M, height: rowH, color: rgb(1, 0.97, 0.93) })
        else if (isPaid) summaryPage.drawRectangle({ x: M, y: rowY, width: W - 2 * M, height: rowH, color: rgb(0.97, 0.97, 0.95), opacity: 0.5 })
        else if (overdue) summaryPage.drawRectangle({ x: M, y: rowY, width: W - 2 * M, height: rowH, color: rgb(1, 0.97, 0.97) })
        summaryPage.drawLine({ start: { x: M, y: rowY }, end: { x: W - M, y: rowY }, thickness: 0.3, color: rgb(0.88, 0.88, 0.87) })

        const cellData = [
          isPri ? '!' : isPaid ? '✓' : '',
          inv.party.slice(0, 16),
          (inv.ref ?? '').slice(0, 10),
          (inv.project_code ?? '').slice(0, 12),
          ENTITY_SHORT[inv.entity as Entity] ?? '',
          fmt(Number(inv.amount), inv.currency),
          inv.due ? fmtDate(inv.due) : '—',
          `${bd.sortCode ?? ''} ${bd.accNum ?? ''}`.trim(),
          isPaid ? 'PAID' : overdue ? 'OVERDUE' : inv.status.toUpperCase(),
          notes.slice(0, 14),
        ]
        cx = M
        for (let ci = 0; ci < cols.length; ci++) {
          const textColor = isPaid ? rgb(0.6, 0.6, 0.6) : ci === 5 && overdue ? rgb(0.86, 0.15, 0.15) : rgb(0.1, 0.1, 0.1)
          summaryPage.drawText(cellData[ci], { x: cx + 2, y: rowY + 3, font: ci === 5 || ci === 8 ? courierBold : courier, size: 6.5, color: textColor })
          cx += cols[ci].w
        }
      }

      summaryPage.drawLine({ start: { x: M, y: M + 28 }, end: { x: W - M, y: M + 28 }, thickness: 1.5, color: rgb(0.1, 0.1, 0.1) })
      summaryPage.drawText(`Outstanding: ${fmt(totOut)}`, { x: M, y: M + 14, font: courierBold, size: 8, color: rgb(0.1, 0.1, 0.1) })
      summaryPage.drawText(`Paid: ${fmt(totPaid)}`, { x: M + 160, y: M + 14, font: courierBold, size: 8, color: rgb(0.23, 0.48, 0.35) })
      summaryPage.drawText(`Grand Total: ${fmt(totOut + totPaid)}`, { x: M + 300, y: M + 14, font: courierBold, size: 8, color: rgb(0.1, 0.1, 0.1) })

      const withUrls = rows.filter(i => i.pdf_url)
      const withoutUrls = rows.filter(i => !i.pdf_url)

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
        }
      }
      for (const inv of withoutUrls) {
        const ph = mergedPdf.addPage([595.28, 841.89])
        ph.drawText('NO INVOICE ATTACHED', { x: 80, y: 500, font: courierBold, size: 14, color: rgb(0.3, 0.3, 0.3) })
        ph.drawText(`Supplier: ${inv.party}  ·  Ref: ${inv.ref ?? '—'}`, { x: 80, y: 470, font: courier, size: 10, color: rgb(0.4, 0.4, 0.4) })
        ph.drawText(`Amount: ${fmt(Number(inv.amount), inv.currency)}  ·  Due: ${inv.due ? fmtDate(inv.due) : '—'}`, { x: 80, y: 454, font: courier, size: 10, color: rgb(0.4, 0.4, 0.4) })
      }

      setPdfMergeProgress(null)
      const pdfBytes = await mergedPdf.save()
      const blob = new Blob([pdfBytes as BlobPart], { type: 'application/pdf' })
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = `master-payment-sheet-with-invoices-${todayISO()}.pdf`
      a.click()
      toast(`PDF with invoices downloaded (${rows.length} rows, ${withUrls.length} attachments)`)
    } catch (e) {
      setPdfMergeProgress(null)
      toast(`PDF export failed: ${String(e)}`, 'error')
    }
  }

  // ── Table header helper ────────────────────────────────────────────────────

  const TH = ({ children, cls = '' }: { children: React.ReactNode; cls?: string }) => (
    <th className={`tbl-lbl text-left px-3 py-2.5 bg-cream border-b-2 border-ink sticky top-0 whitespace-nowrap ${cls}`}>
      {children}
    </th>
  )

  // ─── Row renderer (shared between grouped and flat views) ─────────────────

  function renderRow(inv: Invoice, idx: number) {
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
      isSelected ? 'bg-blue-50/50' : isPri ? 'bg-orange-50/40' : paid ? 'bg-paper/60' : overdue ? 'bg-red-50/40' : idx % 2 === 1 ? 'bg-white' : 'bg-paper/20'
    )
    const monoSmall = `font-mono text-[10px] ${paid ? 'text-muted/70' : 'text-muted'}`

    return (
      <tr key={inv.id} className={rowCls}>
        {/* Select */}
        <td className="px-2 py-2 text-center">
          <button onClick={() => toggleSelect(inv.id)} className="text-muted hover:text-ink transition-colors mx-auto block">
            {isSelected ? <CheckSquare size={13} className="text-ink" /> : <Square size={13} className="opacity-40 group-hover:opacity-100 transition-opacity" />}
          </button>
        </td>

        {/* Priority */}
        <td className="px-2 py-2 text-center">
          <button onClick={() => togglePriority(inv.id)}
            title={isPri ? 'Remove priority flag' : 'Flag as high priority'}
            className={cn('text-sm transition-opacity', isPri ? 'opacity-100' : 'opacity-20 group-hover:opacity-60')}>
            🚩
          </button>
        </td>

        {/* Paid */}
        <td className="px-3 py-2 text-center">
          <button onClick={() => void togglePaid(inv)} disabled={marking}
            title={paid ? 'Mark as unpaid' : 'Mark as paid'}
            className={cn('w-5 h-5 flex items-center justify-center border-2 transition-all mx-auto',
              marking ? 'opacity-40' : '',
              paid ? 'bg-green-500 border-green-500' : 'border-rule hover:border-ink')}>
            {paid && <Check size={11} className="text-white" />}
          </button>
        </td>

        {/* Supplier */}
        <td className="px-3 py-2">
          <span className={cn('font-semibold text-sm', paid ? 'text-muted line-through' : 'text-ink')}>{inv.party}</span>
          {paymentNote && <span className="block mt-0.5 font-mono text-[10px] text-amber-700 italic">💳 {paymentNote}</span>}
          {inv.pdf_url
            ? <a href={inv.pdf_url} target="_blank" rel="noopener noreferrer" className="block mt-0.5 font-mono text-[10px] text-muted hover:text-ink transition-colors">📎 View →</a>
            : <span className="block mt-0.5 font-mono text-[10px] text-amber-600">No invoice attached</span>}
        </td>

        {/* Ref */}
        <td className={`px-3 py-2 ${monoSmall}`}>{inv.ref ?? <span className="text-muted/40">—</span>}</td>

        {/* Project */}
        <td className="px-3 py-2">
          {inv.project_code ? (
            <div>
              <span className="font-mono text-[10px] text-ink font-semibold">{inv.project_code}</span>
              {inv.project_name && <span className="block font-mono text-[10px] text-muted truncate max-w-[140px]">{inv.project_name}</span>}
            </div>
          ) : <span className="text-muted/40 font-mono text-[10px]">—</span>}
        </td>

        {/* Entity */}
        <td className="px-3 py-2">
          <span className={cn('font-mono text-[10px] px-1.5 py-0.5 uppercase tracking-wider',
            inv.entity === 'Actually Creative' ? 'bg-ink/10 text-ink' :
            inv.entity === '419Studios' ? 'bg-blue-100 text-blue-800' :
            'bg-purple-100 text-purple-800'
          )}>
            {ENTITY_SHORT[inv.entity as Entity] ?? inv.entity}
          </span>
        </td>

        {/* Amount */}
        <td className={cn('px-3 py-2 text-right font-mono text-xs font-bold', paid ? 'text-muted line-through' : overdue ? 'text-red-600' : 'text-ink')}>
          {fmt(Number(inv.amount), inv.currency)}
        </td>

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
        <td className={`px-3 py-2 ${monoSmall} bg-blue-50/20 max-w-[120px] truncate`}>{bd.iban ?? <span className="text-muted/30">—</span>}</td>
        <td className={`px-3 py-2 ${monoSmall} bg-blue-50/20`}>{bd.swift ?? <span className="text-muted/30">—</span>}</td>

        {/* Invoice */}
        <td className="px-3 py-2 whitespace-nowrap">
          {inv.pdf_url
            ? <a href={inv.pdf_url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 font-mono text-[10px] text-muted hover:text-ink transition-colors"><Paperclip size={10} /> View</a>
            : <span className="text-muted/30 font-mono text-[10px]">—</span>}
        </td>

        {/* Status */}
        <td className="px-3 py-2">
          <span className={cn('badge', STATUS_BADGE_CLS[inv.status] ?? 'badge-draft')}>{inv.status}</span>
        </td>

        {/* Notes */}
        <td className="px-2 py-1.5 min-w-[120px] max-w-[180px]">
          {isEditingNote ? (
            <div className="flex flex-col gap-1">
              <input autoFocus value={noteValue} onChange={e => setNoteValue(e.target.value)}
                onBlur={() => void saveNote(inv)}
                onKeyDown={e => { if (e.key === 'Enter') void saveNote(inv); if (e.key === 'Escape') setEditingNoteId(null) }}
                className="w-full border border-ink bg-white px-1.5 py-0.5 text-[10px] font-mono focus:outline-none"
                placeholder="Internal note…" />
              <input value={payNoteValue} onChange={e => setPayNoteValue(e.target.value)}
                onBlur={() => void savePaymentNote(inv)}
                onKeyDown={e => { if (e.key === 'Enter') void savePaymentNote(inv); if (e.key === 'Escape') setEditingNoteId(null) }}
                className="w-full border border-dashed border-amber-400 bg-amber-50/30 px-1.5 py-0.5 text-[10px] font-mono italic text-amber-800 focus:outline-none"
                placeholder="💳 Payment note…" />
            </div>
          ) : (
            <button className="text-left w-full" onClick={() => startEditNote(inv)}
              title={[notes, paymentNote].filter(Boolean).join('\n') || undefined}>
              {!notes && !paymentNote
                ? <span className="text-muted/20 group-hover:text-muted/50 text-[10px] font-mono transition-colors">+ note</span>
                : <div>
                    {notes && <span className="font-mono text-[10px] text-ink flex items-center gap-1">📝 <span className="truncate max-w-[120px] inline-block">{notes}</span></span>}
                    {paymentNote && <span className="block font-mono text-[10px] text-amber-700 italic truncate max-w-[120px]">💳 {paymentNote}</span>}
                  </div>}
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
  }

  // ─── Render ───────────────────────────────────────────────────────────────

  const displayedOutstanding = displayed.filter(i => OUTSTANDING_STATUSES.includes(i.status))
  const displayedOverdue = displayed.filter(i => isOverdue(i))

  if (loading && invoices.length === 0) {
    return (
      <div className="flex items-center justify-center py-24">
        <div className="w-5 h-5 border-2 border-ink border-t-transparent animate-spin" />
        <span className="ml-3 font-mono text-xs text-muted">Loading all invoices…</span>
      </div>
    )
  }

  return (
    <div className="space-y-3">

      {/* ── Summary bar ── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="stat-card" style={{ borderTopColor: '#7a6a3a' } as React.CSSProperties}>
          <p className="font-mono text-[9px] uppercase tracking-widest text-muted mb-1">Total Outstanding</p>
          <p className="font-mono text-xl font-bold text-ink">{fmt(summaryStats.totalOutstanding)}</p>
          <p className="font-mono text-[10px] text-muted mt-1">{summaryStats.count} invoice{summaryStats.count !== 1 ? 's' : ''}</p>
        </div>
        <div className="stat-card" style={{ borderTopColor: '#dc2626' } as React.CSSProperties}>
          <p className="font-mono text-[9px] uppercase tracking-widest text-muted mb-1">Total Overdue</p>
          <p className="font-mono text-xl font-bold text-red-600">{fmt(summaryStats.totalOverdue)}</p>
          <p className="font-mono text-[10px] text-muted mt-1">{displayedOverdue.length} overdue showing</p>
        </div>
        <div className="stat-card col-span-2">
          <p className="font-mono text-[9px] uppercase tracking-widest text-muted mb-2">By Entity</p>
          <div className="flex gap-4">
            {ENTITIES.map(e => summaryStats.byEntity[e] > 0 && (
              <div key={e}>
                <p className="font-mono text-[9px] text-muted uppercase">{ENTITY_SHORT[e]}</p>
                <p className="font-mono text-sm font-bold text-ink">{fmt(summaryStats.byEntity[e])}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── Missing invoices badge ── */}
      {missingCount > 0 && (
        <div className="flex items-center gap-2 bg-amber-50 border border-amber-300 px-4 py-2.5">
          <Paperclip size={12} className="text-amber-600 flex-shrink-0" />
          <span className="font-mono text-xs text-amber-800">
            {missingCount} invoice{missingCount !== 1 ? 's' : ''} in current view have no attachment
          </span>
        </div>
      )}

      {/* ── Action bar ── */}
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
        <button onClick={() => void downloadZip()} disabled={!!zipProgress}
          className="flex items-center gap-1 font-mono text-[10px] px-2 py-1.5 border border-rule text-muted hover:text-ink transition-colors uppercase tracking-wider disabled:opacity-50">
          <Download size={10} />
          {zipProgress ? `${zipProgress.current}/${zipProgress.total}…` : 'Download ZIP'}
        </button>
        <button onClick={() => void exportPDFWithInvoices()} disabled={!!pdfMergeProgress}
          className="flex items-center gap-1 font-mono text-[10px] px-2 py-1.5 border border-rule text-muted hover:text-ink transition-colors uppercase tracking-wider disabled:opacity-50">
          <FileDown size={10} />
          {pdfMergeProgress ? `Merging ${pdfMergeProgress.current}/${pdfMergeProgress.total}…` : 'PDF with Invoices'}
        </button>
        <div className="flex-1" />
        <button onClick={() => setGroupByProject(v => !v)}
          className={cn('flex items-center gap-1 font-mono text-[10px] px-2.5 py-1.5 border transition-colors uppercase tracking-wider',
            groupByProject ? 'bg-ink text-white border-ink' : 'border-rule text-muted hover:text-ink')}>
          <Layers size={10} /> Group by Project
        </button>
      </div>

      {/* ── Filter bar ── */}
      <div className="bg-white border border-rule p-3 space-y-2">
        <div className="flex items-center gap-2 flex-wrap">
          {/* Search */}
          <div className="relative flex-1 min-w-[200px]">
            <Search size={11} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted pointer-events-none" />
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search supplier, ref or project…"
              className="w-full border border-rule bg-paper pl-7 pr-2 py-1.5 text-xs font-mono text-ink focus:outline-none focus:border-ink" />
            {search && <button onClick={() => setSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted hover:text-ink"><X size={10} /></button>}
          </div>

          {/* Project */}
          <select value={projectFilter} onChange={e => setProjectFilter(e.target.value)}
            className="border border-rule bg-paper px-2 py-1.5 text-xs font-mono text-ink focus:outline-none focus:border-ink min-w-[160px]">
            <option value="">All Projects</option>
            {projectOptions.map(([code, name]) => (
              <option key={code} value={code}>{code} — {name}</option>
            ))}
          </select>

          {/* Status */}
          <div className="flex items-center gap-0 border border-rule overflow-hidden">
            {(['outstanding', 'all', 'paid'] as const).map(f => (
              <button key={f} onClick={() => setStatusFilter(f)}
                className={cn('px-3 py-1.5 font-mono text-[10px] uppercase tracking-wider transition-colors',
                  statusFilter === f ? 'bg-ink text-white' : 'text-muted hover:text-ink bg-white')}>
                {f}
              </button>
            ))}
          </div>

          {/* Priority filter */}
          <button onClick={() => setShowPriorityOnly(v => !v)}
            className={cn('flex items-center gap-1 font-mono text-[10px] px-2.5 py-1.5 border transition-colors uppercase tracking-wider',
              showPriorityOnly ? 'bg-red-600 border-red-600 text-white' : 'border-rule text-muted hover:text-ink')}>
            <Flag size={9} /> Priority only
          </button>

          {(search || projectFilter || entityFilter !== 'all' || statusFilter !== 'outstanding' || dueDateFrom || dueDateTo || showPriorityOnly) && (
            <button onClick={() => { setSearch(''); setProjectFilter(''); setEntityFilter('all'); setStatusFilter('outstanding'); setDueDateFrom(''); setDueDateTo(''); setShowPriorityOnly(false) }}
              className="font-mono text-[10px] text-muted hover:text-red-500 transition-colors flex items-center gap-1">
              <X size={9} /> Clear filters
            </button>
          )}
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {/* Entity filter */}
          <div className="flex items-center gap-0 border border-rule overflow-hidden">
            <button onClick={() => setEntityFilter('all')}
              className={cn('px-3 py-1.5 font-mono text-[10px] uppercase tracking-wider transition-colors',
                entityFilter === 'all' ? 'bg-ink text-white' : 'text-muted hover:text-ink bg-white')}>
              All
            </button>
            {ENTITIES.map(e => (
              <button key={e} onClick={() => setEntityFilter(e)}
                className={cn('px-3 py-1.5 font-mono text-[10px] uppercase tracking-wider transition-colors',
                  entityFilter === e ? 'bg-ink text-white' : 'text-muted hover:text-ink bg-white')}>
                {ENTITY_SHORT[e]}
              </button>
            ))}
          </div>

          {/* Due date range */}
          <div className="flex items-center gap-1.5">
            <span className="font-mono text-[10px] text-muted uppercase tracking-wider">Due:</span>
            <input type="date" value={dueDateFrom} onChange={e => setDueDateFrom(e.target.value)}
              className="border border-rule bg-paper px-2 py-1 text-xs font-mono text-ink focus:outline-none focus:border-ink" />
            <span className="font-mono text-[10px] text-muted">→</span>
            <input type="date" value={dueDateTo} onChange={e => setDueDateTo(e.target.value)}
              className="border border-rule bg-paper px-2 py-1 text-xs font-mono text-ink focus:outline-none focus:border-ink" />
          </div>

          {/* Sort */}
          <div className="flex items-center gap-1">
            <span className="font-mono text-[10px] text-muted uppercase tracking-wider">Sort:</span>
            {(['party', 'due', 'amount', 'project', 'status'] as SortKey[]).map(k => (
              <button key={k} onClick={() => toggleSort(k)}
                className={cn('flex items-center font-mono text-[10px] px-2 py-1 border transition-colors',
                  sortKey === k ? 'border-ink bg-ink text-white' : 'border-rule text-muted hover:text-ink')}>
                {k === 'party' ? 'Supplier' : k === 'due' ? 'Due' : k === 'amount' ? 'Amount' : k === 'project' ? 'Project' : 'Status'}
                <SortIcon k={k} />
              </button>
            ))}
          </div>

          {someSelected && (
            <button
              onClick={() => { if (window.confirm(`Delete ${selected.size} selected invoice${selected.size !== 1 ? 's' : ''} from Supabase? This cannot be undone.`)) void deleteSelected() }}
              className="flex items-center gap-1 font-mono text-[10px] px-2 py-1.5 border border-red-300 text-red-600 hover:bg-red-50 transition-colors uppercase tracking-wider">
              <Trash2 size={10} /> Delete selected ({selected.size})
            </button>
          )}
        </div>
      </div>

      {/* ── Selection action bar ── */}
      {someSelected && (
        <div className="bg-ink text-white px-4 py-2.5 flex items-center gap-3 flex-wrap">
          <span className="font-mono text-[10px] uppercase tracking-wider text-white/70">
            {selected.size} row{selected.size !== 1 ? 's' : ''} selected —
          </span>
          <span className="font-mono text-[10px] text-white/70 uppercase tracking-wider">Export:</span>
          <button onClick={exportCSV} className="flex items-center gap-1 font-mono text-[10px] px-2.5 py-1 border border-white/30 text-white hover:bg-white/10 transition-colors uppercase tracking-wider">
            <Download size={9} /> CSV
          </button>
          <button onClick={() => void exportXLSX()} className="flex items-center gap-1 font-mono text-[10px] px-2.5 py-1 border border-white/30 text-white hover:bg-white/10 transition-colors uppercase tracking-wider">
            <FileSpreadsheet size={9} /> Excel
          </button>
          <button onClick={exportPDF} className="flex items-center gap-1 font-mono text-[10px] px-2.5 py-1 border border-white/30 text-white hover:bg-white/10 transition-colors uppercase tracking-wider">
            <Printer size={9} /> PDF
          </button>
          <button onClick={() => void downloadZip()} disabled={!!zipProgress} className="flex items-center gap-1 font-mono text-[10px] px-2.5 py-1 border border-white/30 text-white hover:bg-white/10 transition-colors uppercase tracking-wider disabled:opacity-50">
            <Download size={9} /> {zipProgress ? `${zipProgress.current}/${zipProgress.total}…` : 'ZIP Invoices'}
          </button>
          <button onClick={() => void exportPDFWithInvoices()} disabled={!!pdfMergeProgress} className="flex items-center gap-1 font-mono text-[10px] px-2.5 py-1 border border-white/30 text-white hover:bg-white/10 transition-colors uppercase tracking-wider disabled:opacity-50">
            <FileDown size={9} /> {pdfMergeProgress ? `Merging ${pdfMergeProgress.current}/${pdfMergeProgress.total}…` : '↓ PDF with Invoices'}
          </button>
          <div className="ml-auto flex items-center gap-2">
            <button onClick={selectAllOutstanding} className="font-mono text-[10px] text-white/60 hover:text-white transition-colors underline underline-offset-2">Select outstanding</button>
            <button onClick={deselectAll} className="font-mono text-[10px] text-white/60 hover:text-white transition-colors underline underline-offset-2">Deselect all</button>
          </div>
        </div>
      )}

      {/* ── Table ── */}
      {displayed.length === 0 ? (
        <div className="tbl-card py-16 text-center">
          <p className="font-mono text-xs text-muted uppercase tracking-wider">No payable invoices match filters</p>
          <button onClick={() => { setSearch(''); setProjectFilter(''); setEntityFilter('all'); setStatusFilter('outstanding'); setDueDateFrom(''); setDueDateTo(''); setShowPriorityOnly(false) }}
            className="mt-2 font-mono text-xs text-ink underline underline-offset-2">Clear all filters</button>
        </div>
      ) : (
        <div className="tbl-card overflow-hidden">
          <div className="overflow-x-auto max-h-[calc(100vh-380px)] overflow-y-auto">
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr>
                  <TH cls="w-8 text-center">
                    <button onClick={allSelected ? deselectAll : selectAll} title={allSelected ? 'Deselect all' : 'Select all'}
                      className="text-muted hover:text-ink transition-colors mx-auto block">
                      {allSelected ? <CheckSquare size={13} className="text-ink" /> : someSelected ? <CheckSquare size={13} className="text-muted/50" /> : <Square size={13} />}
                    </button>
                  </TH>
                  <TH cls="w-8 text-center">🚩</TH>
                  <TH cls="w-10 text-center">Paid</TH>
                  <TH cls="cursor-pointer hover:text-ink select-none">
                    <span onClick={() => toggleSort('party')}>Supplier <SortIcon k="party" /></span>
                  </TH>
                  <TH>Ref</TH>
                  <TH cls="cursor-pointer hover:text-ink select-none min-w-[140px]">
                    <span onClick={() => toggleSort('project')}>Project <SortIcon k="project" /></span>
                  </TH>
                  <TH>Entity</TH>
                  <TH cls="cursor-pointer hover:text-ink select-none text-right">
                    <span onClick={() => toggleSort('amount')}>Amount <SortIcon k="amount" /></span>
                  </TH>
                  <TH cls="cursor-pointer hover:text-ink select-none">
                    <span onClick={() => toggleSort('due')}>Due Date <SortIcon k="due" /></span>
                  </TH>
                  <TH cls="bg-blue-50/80">Bank Name</TH>
                  <TH cls="bg-blue-50/80">Sort Code</TH>
                  <TH cls="bg-blue-50/80">Acc No</TH>
                  <TH cls="bg-blue-50/80">Acc Name</TH>
                  <TH cls="bg-blue-50/80">IBAN</TH>
                  <TH cls="bg-blue-50/80">SWIFT</TH>
                  <TH cls="w-20">Invoice</TH>
                  <TH cls="cursor-pointer hover:text-ink select-none">
                    <span onClick={() => toggleSort('status')}>Status <SortIcon k="status" /></span>
                  </TH>
                  <TH cls="min-w-[120px]">Notes</TH>
                  <TH cls="w-8">{''}</TH>
                </tr>
              </thead>
              <tbody>
                {groupByProject && grouped ? (
                  Array.from(grouped.entries()).map(([projectKey, rows]) => {
                    const isCollapsed = collapsedGroups.has(projectKey)
                    const groupTotal = rows.reduce((t, i) => t + Number(i.amount), 0)
                    const groupOutstanding = rows.filter(i => OUTSTANDING_STATUSES.includes(i.status)).reduce((t, i) => t + Number(i.amount), 0)
                    return (
                      <>
                        <tr key={`group-${projectKey}`} className="bg-cream border-b-2 border-ink cursor-pointer select-none" onClick={() => toggleGroup(projectKey)}>
                          <td colSpan={3} className="px-3 py-2">
                            <button className="text-muted hover:text-ink transition-colors">
                              {isCollapsed ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
                            </button>
                          </td>
                          <td colSpan={6} className="px-3 py-2">
                            <span className="font-mono text-xs font-bold text-ink">{projectKey}</span>
                            <span className="ml-2 font-mono text-[10px] text-muted">{rows.length} invoice{rows.length !== 1 ? 's' : ''}</span>
                          </td>
                          <td colSpan={7} />
                          <td colSpan={3} className="px-3 py-2 text-right">
                            <span className="font-mono text-xs font-bold text-amber-700">{fmt(groupOutstanding)} outstanding</span>
                            {groupTotal !== groupOutstanding && <span className="ml-3 font-mono text-xs text-muted">{fmt(groupTotal)} total</span>}
                          </td>
                        </tr>
                        {!isCollapsed && rows.map((inv, idx) => renderRow(inv, idx))}
                      </>
                    )
                  })
                ) : (
                  displayed.map((inv, idx) => renderRow(inv, idx))
                )}
              </tbody>
            </table>
          </div>

          {/* Totals footer */}
          <div className="border-t-2 border-ink bg-cream px-4 py-3 flex flex-wrap gap-8 items-center">
            {[
              { label: 'Outstanding', val: displayedOutstanding.reduce((t, i) => t + Number(i.amount), 0), cls: 'text-amber-700' },
              { label: 'Overdue', val: displayedOverdue.reduce((t, i) => t + Number(i.amount), 0), cls: 'text-red-600' },
              { label: 'All Displayed', val: displayed.reduce((t, i) => t + Number(i.amount), 0), cls: 'text-ink' },
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
                {someSelected && <button onClick={deselectAll} className="font-mono text-[10px] text-muted hover:text-ink transition-colors underline underline-offset-2">Deselect all</button>}
              </div>
              <span className="font-mono text-[10px] text-muted">{displayed.length} of {invoices.length} invoices</span>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
