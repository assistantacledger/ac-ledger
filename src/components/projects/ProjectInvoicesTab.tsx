'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { DragDropContext, Droppable, Draggable, DropResult } from '@hello-pangea/dnd'
import {
  ChevronDown, ChevronRight, GripVertical, Pencil, CheckCircle,
  FileText, Download, Trash2, SplitSquareHorizontal, MessageSquare,
  MessageSquareDot, Eye, AlertTriangle, X, Plus, Minus,
} from 'lucide-react'
import { sb } from '@/lib/supabase'
import { cn, fmt, fmtDate, todayISO } from '@/lib/format'
import { toast } from '@/lib/toast'
import type { Invoice, InvoiceStatus, InvoiceUpdate, InvoiceInsert, Project } from '@/types'

// ─── Types ───────────────────────────────────────────────────────────────────

type ViewMode = 'status' | 'party' | 'flat'
type EditCell = { id: string; field: 'party' | 'ref' | 'amount' | 'due' | 'status' }

interface DuplicateGroup {
  reason: 'ref' | 'amount'
  invoices: Invoice[]
}

interface SplitRow {
  party: string
  ref: string
  amount: string
}

interface ExportPreview {
  headers: string[]
  rows: string[][]
  filename: string
  allRows: string[][]
}

const STATUS_ORDER: InvoiceStatus[] = ['overdue', 'pending', 'submitted', 'approved', 'sent', 'draft', 'part-paid', 'paid']
const ALL_STATUSES: InvoiceStatus[] = ['draft', 'pending', 'submitted', 'approved', 'sent', 'overdue', 'part-paid', 'paid']

function statusBadge(s: InvoiceStatus) {
  const map: Record<InvoiceStatus, string> = {
    paid: 'badge-paid', pending: 'badge-pending', overdue: 'badge-overdue',
    draft: 'badge-draft', submitted: 'badge-submitted', approved: 'badge-approved',
    sent: 'badge-sent', 'part-paid': 'badge-part-paid',
  }
  return map[s] ?? 'badge-draft'
}

function rowBorder(inv: Invoice): string {
  if (inv.status === 'overdue') return 'border-l-2 border-l-red-400'
  const days = inv.due ? (new Date(inv.due).getTime() - Date.now()) / 86400000 : null
  if (days !== null && days >= 0 && days <= 14) return 'border-l-2 border-l-amber-400'
  return 'border-l-2 border-l-transparent'
}

function rowTextMuted(inv: Invoice): boolean {
  return inv.status === 'paid'
}

function isDueSoon(inv: Invoice): boolean {
  if (!inv.due) return false
  const days = (new Date(inv.due).getTime() - Date.now()) / 86400000
  return days >= 0 && days <= 14
}

// ─── Props ───────────────────────────────────────────────────────────────────

interface Props {
  invoices: Invoice[]
  project: Project
  updateInvoice?: (id: string, data: InvoiceUpdate) => Promise<Invoice>
  createInvoice?: (data: InvoiceInsert) => Promise<Invoice>
  markInvoicePaid?: (id: string) => Promise<void>
  onPreview?: (inv: Invoice) => void
  onEdit?: (inv: Invoice) => void
}

// ─── Component ───────────────────────────────────────────────────────────────

export function ProjectInvoicesTab({
  invoices: allInvoices,
  project,
  updateInvoice,
  createInvoice,
  markInvoicePaid,
  onPreview,
  onEdit,
}: Props) {
  const code = project.code
  const DRAG_KEY = `project_invoice_order_${code}`

  // ── View state ──
  const [view, setView] = useState<ViewMode>('status')
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({ paid: true })
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [editCell, setEditCell] = useState<EditCell | null>(null)
  const [editValue, setEditValue] = useState('')
  const [notesOpen, setNotesOpen] = useState<Record<string, boolean>>({})
  const [noteValues, setNoteValues] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState<Record<string, boolean>>({})
  const [dragOrder, setDragOrder] = useState<string[]>([])

  // ── Duplicate state ──
  const [dupeGroups, setDupeGroups] = useState<DuplicateGroup[]>([])
  const [dupeReviewOpen, setDupeReviewOpen] = useState(false)
  const [mergingId, setMergingId] = useState<string | null>(null)

  // ── Split state ──
  const [splitInv, setSplitInv] = useState<Invoice | null>(null)
  const [splitRows, setSplitRows] = useState<SplitRow[]>([
    { party: '', ref: '', amount: '' },
    { party: '', ref: '', amount: '' },
  ])

  // ── Bulk ──
  const [bulkStatus, setBulkStatus] = useState<InvoiceStatus>('paid')
  const [bulkDeleteConfirm, setBulkDeleteConfirm] = useState(false)

  // ── Export ──
  const [exportPreview, setExportPreview] = useState<ExportPreview | null>(null)
  const [exportDropOpen, setExportDropOpen] = useState(false)

  const editInputRef = useRef<HTMLInputElement | HTMLSelectElement>(null)

  // ── Load drag order ──
  useEffect(() => {
    try {
      const saved = localStorage.getItem(DRAG_KEY)
      if (saved) setDragOrder(JSON.parse(saved) as string[])
    } catch { /* ignore */ }
  }, [DRAG_KEY])

  // ── Detect duplicates ──
  useEffect(() => {
    const groups: DuplicateGroup[] = []

    // Same non-empty ref
    const byRef: Record<string, Invoice[]> = {}
    for (const inv of allInvoices) {
      if (inv.ref && inv.ref.trim()) {
        const k = inv.ref.trim().toLowerCase()
        byRef[k] = [...(byRef[k] ?? []), inv]
      }
    }
    for (const [, invs] of Object.entries(byRef)) {
      if (invs.length > 1) groups.push({ reason: 'ref', invoices: invs })
    }

    // Same party + amount within 10%
    const checked = new Set<string>()
    for (let i = 0; i < allInvoices.length; i++) {
      for (let j = i + 1; j < allInvoices.length; j++) {
        const a = allInvoices[i], b = allInvoices[j]
        const key = [a.id, b.id].sort().join('|')
        if (checked.has(key)) continue
        checked.add(key)
        if (a.party?.toLowerCase() === b.party?.toLowerCase()) {
          const diff = Math.abs(Number(a.amount) - Number(b.amount))
          const avg = (Number(a.amount) + Number(b.amount)) / 2
          if (avg > 0 && diff / avg < 0.1) {
            // Only add if not already captured by ref
            const alreadyCaptured = groups.some(g => g.reason === 'ref' && g.invoices.some(i => i.id === a.id) && g.invoices.some(i => i.id === b.id))
            if (!alreadyCaptured) groups.push({ reason: 'amount', invoices: [a, b] })
          }
        }
      }
    }
    setDupeGroups(groups)
  }, [allInvoices])

  // ── Focus edit input ──
  useEffect(() => {
    if (editCell && editInputRef.current) editInputRef.current.focus()
  }, [editCell])

  // ── Totals ──
  const totalPayable = allInvoices.filter(i => i.type === 'payable').reduce((s, i) => s + Number(i.amount), 0)
  const totalReceivable = allInvoices.filter(i => i.type === 'receivable').reduce((s, i) => s + Number(i.amount), 0)
  const totalPaid = allInvoices.filter(i => i.status === 'paid').reduce((s, i) => s + Number(i.amount), 0)
  const totalOutstanding = allInvoices.filter(i => i.status !== 'paid').reduce((s, i) => s + Number(i.amount), 0)
  const selectedTotal = allInvoices.filter(i => selected.has(i.id)).reduce((s, i) => s + Number(i.amount), 0)

  // ── Sorted for flat/drag view ──
  const flatSorted = dragOrder.length
    ? [...allInvoices].sort((a, b) => {
        const ai = dragOrder.indexOf(a.id)
        const bi = dragOrder.indexOf(b.id)
        if (ai === -1 && bi === -1) return 0
        if (ai === -1) return 1
        if (bi === -1) return -1
        return ai - bi
      })
    : allInvoices

  // ── Grouping ──
  function groupByStatus(): Array<{ key: string; label: string; headerClass: string; invoices: Invoice[] }> {
    const overdue = allInvoices.filter(i => i.status === 'overdue')
    const dueSoon = allInvoices.filter(i => i.status !== 'overdue' && i.status !== 'paid' && isDueSoon(i))
    const pending = allInvoices.filter(i => !['overdue', 'paid'].includes(i.status) && !isDueSoon(i))
    const paid = allInvoices.filter(i => i.status === 'paid')

    const groups = []
    if (overdue.length) groups.push({ key: 'overdue', label: 'Overdue', headerClass: 'bg-red-50 border-red-200 text-red-700', invoices: overdue })
    if (dueSoon.length) groups.push({ key: 'due-soon', label: 'Due Soon (≤14 days)', headerClass: 'bg-amber-50 border-amber-200 text-amber-700', invoices: dueSoon })
    if (pending.length) groups.push({ key: 'pending', label: 'Pending', headerClass: 'bg-paper border-rule text-ink', invoices: pending })
    if (paid.length) groups.push({ key: 'paid', label: 'Paid', headerClass: 'bg-cream border-rule text-muted', invoices: paid })
    return groups
  }

  function groupByParty(): Array<{ key: string; label: string; headerClass: string; invoices: Invoice[] }> {
    const map: Record<string, Invoice[]> = {}
    for (const inv of allInvoices) {
      const k = inv.party ?? 'Unknown'
      map[k] = [...(map[k] ?? []), inv]
    }
    return Object.entries(map)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([party, invs]) => ({ key: party, label: party, headerClass: 'bg-paper border-rule text-ink', invoices: invs }))
  }

  // ── Selection ──
  const visibleIds = allInvoices.map(i => i.id)
  const allSelected = visibleIds.length > 0 && visibleIds.every(id => selected.has(id))

  function toggleAll() {
    if (allSelected) setSelected(new Set())
    else setSelected(new Set(visibleIds))
  }
  function toggleOne(id: string) {
    setSelected(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  // ── Inline edit ──
  function startEdit(inv: Invoice, field: EditCell['field']) {
    setEditCell({ id: inv.id, field })
    setEditValue(
      field === 'amount' ? String(inv.amount)
        : field === 'due' ? (inv.due ?? '')
        : field === 'status' ? inv.status
        : field === 'party' ? (inv.party ?? '')
        : (inv.ref ?? '')
    )
  }

  async function commitEdit() {
    if (!editCell || !updateInvoice) { setEditCell(null); return }
    const { id, field } = editCell
    const inv = allInvoices.find(i => i.id === id)
    if (!inv) { setEditCell(null); return }

    let patch: InvoiceUpdate = {}
    if (field === 'amount') {
      const n = parseFloat(editValue)
      if (isNaN(n)) { setEditCell(null); return }
      patch = { amount: n }
    } else if (field === 'due') {
      patch = { due: editValue || null }
    } else if (field === 'status') {
      patch = { status: editValue as InvoiceStatus }
    } else if (field === 'party') {
      patch = { party: editValue }
    } else if (field === 'ref') {
      patch = { ref: editValue }
    }

    setSaving(s => ({ ...s, [id]: true }))
    try {
      await updateInvoice(id, patch)
    } catch {
      toast('Save failed', 'error')
    }
    setSaving(s => ({ ...s, [id]: false }))
    setEditCell(null)
  }

  // ── Notes ──
  function toggleNotes(inv: Invoice) {
    setNotesOpen(prev => {
      const next = { ...prev, [inv.id]: !prev[inv.id] }
      if (next[inv.id] && !(inv.id in noteValues)) {
        setNoteValues(v => ({ ...v, [inv.id]: inv.internal ?? '' }))
      }
      return next
    })
  }

  async function saveNote(id: string) {
    if (!updateInvoice) return
    setSaving(s => ({ ...s, [id]: true }))
    try {
      await updateInvoice(id, { internal: noteValues[id] ?? '' })
      toast('Note saved')
    } catch {
      toast('Save failed', 'error')
    }
    setSaving(s => ({ ...s, [id]: false }))
  }

  // ── Bulk actions ──
  async function bulkMarkPaid() {
    if (!updateInvoice) return
    for (const id of Array.from(selected)) {
      await updateInvoice(id, { status: 'paid' }).catch(() => null)
    }
    toast(`Marked ${selected.size} as paid`)
    setSelected(new Set())
  }

  async function bulkChangeStatus() {
    if (!updateInvoice) return
    for (const id of Array.from(selected)) {
      await updateInvoice(id, { status: bulkStatus }).catch(() => null)
    }
    toast(`Updated ${selected.size} invoices`)
    setSelected(new Set())
  }

  async function bulkDelete() {
    for (const id of Array.from(selected)) {
      await sb.from('invoices').delete().eq('id', id)
    }
    toast(`Deleted ${selected.size} invoices`)
    setSelected(new Set())
    setBulkDeleteConfirm(false)
    // Note: parent will re-fetch
  }

  // ── Duplicate merge ──
  async function keepOne(keepId: string, group: DuplicateGroup) {
    if (!updateInvoice) return
    setMergingId(keepId)
    const others = group.invoices.filter(i => i.id !== keepId)
    for (const inv of others) {
      await sb.from('invoices').delete().eq('id', inv.id)
    }
    toast('Kept invoice, deleted duplicates')
    setMergingId(null)
  }

  async function mergeGroup(group: DuplicateGroup) {
    if (!updateInvoice) return
    setMergingId('merge')
    // Keep highest amount, merge notes
    const sorted = [...group.invoices].sort((a, b) => Number(b.amount) - Number(a.amount))
    const [keep, ...rest] = sorted
    const mergedNotes = [keep.notes, ...rest.map(i => i.notes)].filter(Boolean).join('; ')
    await updateInvoice(keep.id, { notes: mergedNotes || keep.notes })
    for (const inv of rest) {
      await sb.from('invoices').delete().eq('id', inv.id)
    }
    toast('Merged duplicates')
    setMergingId(null)
  }

  // ── Split invoice ──
  function openSplit(inv: Invoice) {
    setSplitInv(inv)
    setSplitRows([
      { party: inv.party ?? '', ref: (inv.ref ?? '') + '-1', amount: '' },
      { party: inv.party ?? '', ref: (inv.ref ?? '') + '-2', amount: '' },
    ])
  }

  async function executeSplit() {
    if (!splitInv || !createInvoice) return
    const total = splitRows.reduce((s, r) => s + (parseFloat(r.amount) || 0), 0)
    const orig = Number(splitInv.amount)
    if (Math.abs(total - orig) > 0.01) { toast('Amounts must sum to original total', 'error'); return }
    for (const row of splitRows) {
      const a = parseFloat(row.amount)
      if (isNaN(a) || a <= 0) { toast('All amounts must be positive', 'error'); return }
    }
    for (const row of splitRows) {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { id: _id, created_at: _ca, ...base } = splitInv
      const insert: InvoiceInsert = { ...base, party: row.party, ref: row.ref, amount: parseFloat(row.amount) }
      await createInvoice(insert)
    }
    await sb.from('invoices').delete().eq('id', splitInv.id)
    toast('Invoice split successfully')
    setSplitInv(null)
  }

  // ── Drag reorder ──
  function onDragEnd(result: DropResult) {
    if (!result.destination) return
    const ids = flatSorted.map(i => i.id)
    const [moved] = ids.splice(result.source.index, 1)
    ids.splice(result.destination.index, 0, moved)
    setDragOrder(ids)
    try { localStorage.setItem(DRAG_KEY, JSON.stringify(ids)) } catch { /* ignore */ }
  }

  // ── Exports ──
  function toCSVRow(inv: Invoice, fields: string[]): string[] {
    const bd = inv.bank_details as Record<string, string> | null | undefined
    const map: Record<string, string> = {
      Date: inv.due ?? inv.created_at?.slice(0, 10) ?? '',
      Ref: inv.ref ?? '',
      Party: inv.party ?? '',
      Description: inv.notes ?? '',
      Amount: String(inv.amount),
      Currency: inv.currency ?? '£',
      VAT: '',
      Status: inv.status,
      'Bank Name': bd?.bankName ?? '',
      'Sort Code': bd?.sortCode ?? '',
      'Account Number': bd?.accNum ?? '',
      'Account Name': bd?.accName ?? '',
      IBAN: bd?.iban ?? '',
      'Project Code': inv.project_code ?? '',
      Entity: inv.entity ?? '',
      Type: inv.type,
      Due: inv.due ?? '',
    }
    return fields.map(f => `"${(map[f] ?? '').replace(/"/g, '""')}"`)
  }

  function buildCSV(rows: Invoice[], fields: string[]): string[][] {
    return rows.map(inv => toCSVRow(inv, fields))
  }

  function downloadCSV(rows: string[][], headers: string[], filename: string) {
    const content = [headers.map(h => `"${h}"`).join(','), ...rows.map(r => r.join(','))].join('\n')
    const blob = new Blob([content], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a'); a.href = url; a.download = filename; a.click()
    URL.revokeObjectURL(url)
  }

  function openExportAll() {
    const fields = ['Ref', 'Party', 'Type', 'Due', 'Amount', 'Currency', 'Status']
    const all = buildCSV(allInvoices, fields)
    setExportPreview({ headers: fields, rows: all.slice(0, 5), allRows: all, filename: `${code}-invoices.csv` })
  }

  function openExportSelected() {
    const rows = allInvoices.filter(i => selected.has(i.id))
    const fields = ['Ref', 'Party', 'Type', 'Due', 'Amount', 'Currency', 'Status']
    const all = buildCSV(rows, fields)
    setExportPreview({ headers: fields, rows: all.slice(0, 5), allRows: all, filename: `${code}-selected.csv` })
  }

  function openExportAccountant() {
    const fields = ['Date', 'Ref', 'Party', 'Description', 'Amount', 'Currency', 'VAT', 'Status', 'Bank Name', 'Sort Code', 'Account Number', 'Account Name', 'IBAN', 'Project Code', 'Entity']
    const all = buildCSV(allInvoices, fields)
    setExportPreview({ headers: fields, rows: all.slice(0, 5), allRows: all, filename: `${code}-accountant.csv` })
  }

  function exportOutstandingPDF() {
    const outstanding = allInvoices.filter(i => i.status !== 'paid')
    const html = `<!DOCTYPE html><html><head><title>Outstanding Invoices — ${code}</title>
<style>
body{font-family:'Helvetica Neue',sans-serif;font-size:11px;color:#1a1a1a;margin:0;padding:32px}
h1{font-size:18px;font-weight:700;margin:0 0 4px}
.meta{font-size:10px;color:#9a9a9a;margin-bottom:24px}
table{width:100%;border-collapse:collapse}
th{font-size:9px;text-transform:uppercase;letter-spacing:.08em;color:#9a9a9a;border-bottom:1px solid #e2e2e0;padding:6px 8px;text-align:left}
td{padding:7px 8px;border-bottom:1px solid #f0f0ee;font-size:10px}
.amount{font-weight:600;text-align:right}
.overdue{color:#b91c1c}
.total-row td{border-top:2px solid #1a1a1a;font-weight:700;padding-top:10px}
@media print{@page{size:A4;margin:1.5cm}}
</style></head><body>
<h1>Outstanding Payment List</h1>
<div class="meta">Project: ${code} &nbsp;·&nbsp; Generated: ${new Date().toLocaleDateString('en-GB')}</div>
<table><thead><tr><th>Ref</th><th>Party</th><th>Due</th><th>Status</th><th style="text-align:right">Amount</th><th>Bank</th><th>Sort Code</th><th>Account No.</th><th>Account Name</th></tr></thead><tbody>
${outstanding.map(inv => {
  const bd = inv.bank_details as Record<string, string> | null | undefined
  const cls = inv.status === 'overdue' ? 'class="overdue"' : ''
  return `<tr ${cls}><td>${inv.ref ?? '—'}</td><td>${inv.party ?? '—'}</td><td>${inv.due ? fmtDate(inv.due) : '—'}</td><td>${inv.status}</td><td class="amount">${fmt(inv.amount, inv.currency)}</td><td>${bd?.bankName ?? '—'}</td><td>${bd?.sortCode ?? '—'}</td><td>${bd?.accNum ?? '—'}</td><td>${bd?.accName ?? '—'}</td></tr>`
}).join('')}
<tr class="total-row"><td colspan="4">Total Outstanding</td><td class="amount">${fmt(outstanding.reduce((s, i) => s + Number(i.amount), 0))}</td><td colspan="4"></td></tr>
</tbody></table></body></html>`
    const win = window.open('', '_blank')
    if (win) { win.document.write(html); win.document.close(); win.print() }
  }

  // ── Row renderer ──
  function renderRow(inv: Invoice, index: number, isDraggable = false) {
    const isEditing = (field: EditCell['field']) => editCell?.id === inv.id && editCell.field === field
    const muted = rowTextMuted(inv)
    const hasNote = !!(inv.internal?.trim())
    const noteExpanded = !!notesOpen[inv.id]

    const cellClass = (field: EditCell['field']) => cn(
      'px-3 py-2 text-sm group/cell relative cursor-pointer select-none',
      muted && 'text-muted',
      saving[inv.id] && 'opacity-50',
    )

    const editIcon = (field: EditCell['field']) => (
      <span className="absolute right-1 top-1/2 -translate-y-1/2 opacity-0 group-hover/cell:opacity-40 transition-opacity pointer-events-none">
        <Pencil size={9} />
      </span>
    )

    function inlineInput(field: EditCell['field'], display: React.ReactNode) {
      if (isEditing(field)) {
        if (field === 'status') {
          return (
            <select
              ref={editInputRef as React.RefObject<HTMLSelectElement>}
              value={editValue}
              onChange={e => setEditValue(e.target.value)}
              onBlur={commitEdit}
              className="w-full font-mono text-xs border border-ink bg-white px-1 py-0.5 outline-none"
            >
              {ALL_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          )
        }
        return (
          <input
            ref={editInputRef as React.RefObject<HTMLInputElement>}
            type={field === 'amount' ? 'number' : field === 'due' ? 'date' : 'text'}
            value={editValue}
            onChange={e => setEditValue(e.target.value)}
            onBlur={commitEdit}
            onKeyDown={e => { if (e.key === 'Enter') void commitEdit(); if (e.key === 'Escape') setEditCell(null) }}
            className="w-full font-mono text-xs border border-ink bg-white px-1 py-0.5 outline-none"
          />
        )
      }
      return (
        <div className="relative" onClick={() => updateInvoice && startEdit(inv, field)}>
          {display}
          {updateInvoice && editIcon(field)}
        </div>
      )
    }

    const row = (
      <tr key={inv.id} className={cn('border-b border-rule last:border-0 group', rowBorder(inv), index % 2 === 1 && 'bg-paper/30')}>
        {/* Drag handle (flat only) */}
        {isDraggable && (
          <td className="pl-2 pr-0 py-2 w-6">
            <div className="opacity-0 group-hover:opacity-30 cursor-grab text-muted">
              <GripVertical size={12} />
            </div>
          </td>
        )}

        {/* Checkbox */}
        <td className="pl-3 pr-1 py-2 w-8">
          <input type="checkbox" checked={selected.has(inv.id)} onChange={() => toggleOne(inv.id)}
            className="w-3 h-3 cursor-pointer" />
        </td>

        {/* Ref */}
        <td className={cn(cellClass('ref'), 'font-mono text-xs w-28')}>
          {inlineInput('ref', <span>{inv.ref || <span className="text-muted/50 italic">—</span>}</span>)}
        </td>

        {/* Party */}
        <td className={cn(cellClass('party'), 'min-w-[120px]')}>
          {inlineInput('party', <span>{inv.party}</span>)}
        </td>

        {/* Type */}
        <td className="px-3 py-2 font-mono text-[10px] uppercase tracking-wider text-muted w-20">
          {inv.type}
        </td>

        {/* Due */}
        <td className={cn(cellClass('due'), 'font-mono text-xs w-24')}>
          {inlineInput('due', <span className={inv.status === 'overdue' ? 'text-red-600' : ''}>{inv.due ? fmtDate(inv.due) : '—'}</span>)}
        </td>

        {/* Amount */}
        <td className={cn(cellClass('amount'), 'font-mono text-sm font-semibold w-28 text-right')}>
          {inlineInput('amount', <span>{fmt(inv.amount, inv.currency)}</span>)}
        </td>

        {/* Status */}
        <td className={cn(cellClass('status'), 'w-28')}>
          {inlineInput('status', <span className={cn('badge', statusBadge(inv.status))}>{inv.status}</span>)}
        </td>

        {/* Notes icon */}
        <td className="px-1 py-2 w-7">
          <button onClick={() => toggleNotes(inv)} title="Internal notes"
            className={cn('p-0.5 transition-colors', hasNote ? 'text-ink' : 'text-muted/40 hover:text-muted')}>
            {hasNote ? <MessageSquareDot size={13} /> : <MessageSquare size={13} />}
          </button>
        </td>

        {/* Actions */}
        <td className="px-2 py-2">
          <div className="row-actions justify-end gap-0.5">
            {onPreview && (
              <button onClick={() => onPreview(inv)} title="Preview"
                className="p-1 text-muted hover:text-ink opacity-0 group-hover:opacity-100 transition-all">
                <Eye size={12} />
              </button>
            )}
            {onEdit && (
              <button onClick={() => onEdit(inv)} title="Edit"
                className="p-1 text-muted hover:text-ink opacity-0 group-hover:opacity-100 transition-all">
                <Pencil size={12} />
              </button>
            )}
            {markInvoicePaid && inv.status !== 'paid' && (
              <button onClick={() => markInvoicePaid(inv.id)} title="Mark paid"
                className="p-1 text-muted hover:text-green-600 opacity-0 group-hover:opacity-100 transition-all">
                <CheckCircle size={12} />
              </button>
            )}
            {createInvoice && (
              <button onClick={() => openSplit(inv)} title="Split invoice"
                className="p-1 text-muted hover:text-ink opacity-0 group-hover:opacity-100 transition-all">
                <SplitSquareHorizontal size={12} />
              </button>
            )}
          </div>
        </td>
      </tr>
    )

    if (!noteExpanded) return row

    return (
      <>
        {row}
        <tr key={`${inv.id}-note`} className="border-b border-rule bg-cream/50">
          <td colSpan={isDraggable ? 10 : 9} className="px-4 py-2">
            <div className="flex items-end gap-2">
              <textarea
                rows={2}
                value={noteValues[inv.id] ?? inv.internal ?? ''}
                onChange={e => setNoteValues(v => ({ ...v, [inv.id]: e.target.value }))}
                placeholder="Internal notes (not shown on invoice)…"
                className="flex-1 font-mono text-xs border border-rule bg-white px-2 py-1 outline-none focus:border-ink resize-none"
              />
              <button onClick={() => saveNote(inv.id)} disabled={saving[inv.id]}
                className="px-3 py-1 font-mono text-xs bg-ink text-white hover:bg-[#333] disabled:opacity-50">
                Save
              </button>
            </div>
          </td>
        </tr>
      </>
    )
  }

  // ── Group renderer ──
  function renderGroup(group: { key: string; label: string; headerClass: string; invoices: Invoice[] }) {
    const isCollapsed = !!collapsed[group.key]
    const subtotal = group.invoices.reduce((s, i) => s + Number(i.amount), 0)
    return (
      <div key={group.key} className="mb-4">
        <button
          onClick={() => setCollapsed(c => ({ ...c, [group.key]: !c[group.key] }))}
          className={cn('w-full flex items-center justify-between px-4 py-2 border text-left', group.headerClass)}
        >
          <div className="flex items-center gap-2">
            {isCollapsed ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
            <span className="font-mono text-xs uppercase tracking-wider font-semibold">{group.label}</span>
            <span className="font-mono text-xs opacity-60">({group.invoices.length})</span>
          </div>
          <span className="font-mono text-xs font-semibold">{fmt(subtotal)}</span>
        </button>
        {!isCollapsed && (
          <div className="tbl-card mt-0 border-t-0">
            <table className="w-full">
              {renderTableHead(false)}
              <tbody>{group.invoices.map((inv, i) => renderRow(inv, i, false))}</tbody>
            </table>
          </div>
        )}
      </div>
    )
  }

  function renderTableHead(isDraggable: boolean) {
    return (
      <thead>
        <tr className="border-b border-rule bg-paper/50">
          {isDraggable && <th className="w-6" />}
          <th className="pl-3 pr-1 py-2 w-8">
            <input type="checkbox" checked={allSelected} onChange={toggleAll} className="w-3 h-3 cursor-pointer" />
          </th>
          {['Ref', 'Party', 'Type', 'Due', 'Amount', 'Status', '', ''].map((h, i) => (
            <th key={i} className="tbl-lbl text-left px-3 py-2">{h}</th>
          ))}
        </tr>
      </thead>
    )
  }

  // ─── Render ───────────────────────────────────────────────────────────────

  if (allInvoices.length === 0) {
    return (
      <div className="p-6">
        <p className="font-mono text-xs text-muted text-center py-16 uppercase tracking-wider">No invoices for this project</p>
      </div>
    )
  }

  return (
    <div className="p-6 pb-24 relative">

      {/* ── Duplicate warning ── */}
      {dupeGroups.length > 0 && (
        <div className="mb-4 px-4 py-3 bg-amber-50 border border-amber-200 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <AlertTriangle size={13} className="text-amber-600 flex-shrink-0" />
            <span className="font-mono text-xs text-amber-800">
              {dupeGroups.length} possible duplicate{dupeGroups.length !== 1 ? 's' : ''} found
            </span>
          </div>
          <button onClick={() => setDupeReviewOpen(true)}
            className="font-mono text-xs px-3 py-1 border border-amber-300 text-amber-700 hover:bg-amber-100 transition-colors">
            Review
          </button>
        </div>
      )}

      {/* ── Toolbar ── */}
      <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
        {/* View toggle */}
        <div className="flex items-center border border-rule bg-cream divide-x divide-rule">
          {(['status', 'party', 'flat'] as ViewMode[]).map(v => (
            <button key={v} onClick={() => setView(v)}
              className={cn('px-3 py-1.5 font-mono text-[10px] uppercase tracking-wider transition-colors',
                view === v ? 'bg-ink text-white' : 'text-muted hover:text-ink')}>
              {v === 'status' ? 'By Status' : v === 'party' ? 'By Party' : 'Flat List'}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2">
          {/* Clear filters */}
          {(view !== 'status' || Object.values(collapsed).some(Boolean)) && (
            <button onClick={() => { setView('status'); setCollapsed({ paid: true }) }}
              className="font-mono text-[10px] text-muted hover:text-ink border border-rule px-2 py-1 transition-colors flex items-center gap-1">
              <X size={10} /> Clear filters
            </button>
          )}

          {/* Export dropdown */}
          <div className="relative">
            <button onClick={() => setExportDropOpen(o => !o)}
              className="flex items-center gap-1.5 font-mono text-xs px-3 py-1.5 border border-rule text-muted hover:text-ink hover:border-ink transition-colors">
              <Download size={12} /> Export
              <ChevronDown size={10} />
            </button>
            {exportDropOpen && (
              <div className="absolute right-0 top-full mt-1 z-20 bg-white border border-rule shadow-md min-w-[220px]">
                {[
                  { label: 'Export all as CSV', fn: () => { openExportAll(); setExportDropOpen(false) } },
                  { label: 'Export selected as CSV', fn: () => { openExportSelected(); setExportDropOpen(false) }, disabled: selected.size === 0 },
                  { label: 'Export outstanding as PDF', fn: () => { exportOutstandingPDF(); setExportDropOpen(false) } },
                  { label: 'Export for accountant', fn: () => { openExportAccountant(); setExportDropOpen(false) } },
                ].map(item => (
                  <button key={item.label}
                    onClick={item.fn}
                    disabled={item.disabled}
                    className="w-full text-left px-4 py-2.5 font-mono text-xs hover:bg-cream disabled:opacity-40 disabled:cursor-not-allowed transition-colors border-b border-rule last:border-0">
                    {item.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Bulk action bar ── */}
      {selected.size > 0 && (
        <div className="mb-4 px-4 py-2.5 bg-ink text-white flex items-center gap-4 flex-wrap">
          <span className="font-mono text-xs">{selected.size} selected — {fmt(selectedTotal)}</span>
          <div className="flex items-center gap-2 ml-auto flex-wrap">
            <button onClick={bulkMarkPaid}
              className="font-mono text-xs px-3 py-1 bg-white/10 hover:bg-white/20 transition-colors">
              Mark as Paid
            </button>
            <div className="flex items-center gap-1">
              <select value={bulkStatus} onChange={e => setBulkStatus(e.target.value as InvoiceStatus)}
                className="font-mono text-xs bg-white/10 border-0 outline-none text-white px-1 py-1">
                {ALL_STATUSES.map(s => <option key={s} value={s} className="text-ink">{s}</option>)}
              </select>
              <button onClick={bulkChangeStatus}
                className="font-mono text-xs px-2 py-1 bg-white/10 hover:bg-white/20 transition-colors">
                Change Status
              </button>
            </div>
            <button onClick={() => openExportSelected()}
              className="font-mono text-xs px-3 py-1 bg-white/10 hover:bg-white/20 transition-colors">
              Export
            </button>
            {bulkDeleteConfirm ? (
              <div className="flex items-center gap-1">
                <span className="font-mono text-xs text-red-300">Delete {selected.size}?</span>
                <button onClick={bulkDelete} className="font-mono text-xs px-2 py-1 bg-red-600 hover:bg-red-700 transition-colors">Yes</button>
                <button onClick={() => setBulkDeleteConfirm(false)} className="font-mono text-xs px-2 py-1 bg-white/10 hover:bg-white/20">No</button>
              </div>
            ) : (
              <button onClick={() => setBulkDeleteConfirm(true)}
                className="font-mono text-xs px-3 py-1 bg-red-600/80 hover:bg-red-600 transition-colors flex items-center gap-1">
                <Trash2 size={10} /> Delete
              </button>
            )}
            <button onClick={() => setSelected(new Set())} className="p-1 hover:text-white/60 transition-colors">
              <X size={13} />
            </button>
          </div>
        </div>
      )}

      {/* ── Views ── */}

      {/* Group by Status */}
      {view === 'status' && groupByStatus().map(group => renderGroup(group))}

      {/* Group by Party */}
      {view === 'party' && groupByParty().map(group => renderGroup(group))}

      {/* Flat list with drag */}
      {view === 'flat' && (
        <div className="tbl-card">
          <DragDropContext onDragEnd={onDragEnd}>
            <Droppable droppableId="invoice-list">
              {provided => (
                <table className="w-full" ref={provided.innerRef} {...provided.droppableProps}>
                  {renderTableHead(true)}
                  <tbody>
                    {flatSorted.map((inv, i) => (
                      <Draggable key={inv.id} draggableId={inv.id} index={i}>
                        {(drag, snap) => (
                          <tr ref={drag.innerRef} {...drag.draggableProps}
                            className={cn('border-b border-rule last:border-0 group', rowBorder(inv), i % 2 === 1 && 'bg-paper/30', snap.isDragging && 'bg-cream shadow-md')}>
                            {/* Drag handle */}
                            <td className="pl-2 pr-0 py-2 w-6" {...drag.dragHandleProps}>
                              <GripVertical size={12} className="text-muted/40 group-hover:text-muted cursor-grab transition-colors" />
                            </td>
                            {/* Reuse row content (minus the outer <tr>) */}
                            <td className="pl-3 pr-1 py-2 w-8">
                              <input type="checkbox" checked={selected.has(inv.id)} onChange={() => toggleOne(inv.id)} className="w-3 h-3 cursor-pointer" />
                            </td>
                            <td className={cn('px-3 py-2 font-mono text-xs w-28', rowTextMuted(inv) && 'text-muted', 'cursor-pointer group/cell relative')}>
                              {editCell?.id === inv.id && editCell.field === 'ref'
                                ? <input ref={editInputRef as React.RefObject<HTMLInputElement>} type="text" value={editValue} onChange={e => setEditValue(e.target.value)} onBlur={commitEdit} onKeyDown={e => { if (e.key === 'Enter') void commitEdit(); if (e.key === 'Escape') setEditCell(null) }} className="w-full font-mono text-xs border border-ink bg-white px-1 py-0.5 outline-none" />
                                : <div className="relative" onClick={() => updateInvoice && startEdit(inv, 'ref')}>{inv.ref || <span className="text-muted/50 italic">—</span>}<span className="absolute right-1 top-1/2 -translate-y-1/2 opacity-0 group-hover/cell:opacity-40 transition-opacity pointer-events-none"><Pencil size={9} /></span></div>}
                            </td>
                            <td className={cn('px-3 py-2 text-sm min-w-[120px]', rowTextMuted(inv) && 'text-muted', 'cursor-pointer group/cell relative')}>
                              {editCell?.id === inv.id && editCell.field === 'party'
                                ? <input ref={editInputRef as React.RefObject<HTMLInputElement>} type="text" value={editValue} onChange={e => setEditValue(e.target.value)} onBlur={commitEdit} onKeyDown={e => { if (e.key === 'Enter') void commitEdit(); if (e.key === 'Escape') setEditCell(null) }} className="w-full font-mono text-xs border border-ink bg-white px-1 py-0.5 outline-none" />
                                : <div className="relative" onClick={() => updateInvoice && startEdit(inv, 'party')}>{inv.party}<span className="absolute right-1 top-1/2 -translate-y-1/2 opacity-0 group-hover/cell:opacity-40 transition-opacity pointer-events-none"><Pencil size={9} /></span></div>}
                            </td>
                            <td className="px-3 py-2 font-mono text-[10px] uppercase tracking-wider text-muted w-20">{inv.type}</td>
                            <td className={cn('px-3 py-2 font-mono text-xs w-24', rowTextMuted(inv) && 'text-muted', 'cursor-pointer group/cell relative')}>
                              {editCell?.id === inv.id && editCell.field === 'due'
                                ? <input ref={editInputRef as React.RefObject<HTMLInputElement>} type="date" value={editValue} onChange={e => setEditValue(e.target.value)} onBlur={commitEdit} onKeyDown={e => { if (e.key === 'Enter') void commitEdit(); if (e.key === 'Escape') setEditCell(null) }} className="w-full font-mono text-xs border border-ink bg-white px-1 py-0.5 outline-none" />
                                : <div className={cn('relative', inv.status === 'overdue' && 'text-red-600')} onClick={() => updateInvoice && startEdit(inv, 'due')}>{inv.due ? fmtDate(inv.due) : '—'}<span className="absolute right-1 top-1/2 -translate-y-1/2 opacity-0 group-hover/cell:opacity-40 transition-opacity pointer-events-none"><Pencil size={9} /></span></div>}
                            </td>
                            <td className={cn('px-3 py-2 font-mono text-sm font-semibold w-28 text-right', rowTextMuted(inv) && 'text-muted', 'cursor-pointer group/cell relative')}>
                              {editCell?.id === inv.id && editCell.field === 'amount'
                                ? <input ref={editInputRef as React.RefObject<HTMLInputElement>} type="number" value={editValue} onChange={e => setEditValue(e.target.value)} onBlur={commitEdit} onKeyDown={e => { if (e.key === 'Enter') void commitEdit(); if (e.key === 'Escape') setEditCell(null) }} className="w-full font-mono text-xs border border-ink bg-white px-1 py-0.5 outline-none" />
                                : <div className="relative" onClick={() => updateInvoice && startEdit(inv, 'amount')}>{fmt(inv.amount, inv.currency)}<span className="absolute right-1 top-1/2 -translate-y-1/2 opacity-0 group-hover/cell:opacity-40 transition-opacity pointer-events-none"><Pencil size={9} /></span></div>}
                            </td>
                            <td className={cn('px-3 py-2 w-28', 'cursor-pointer group/cell relative')}>
                              {editCell?.id === inv.id && editCell.field === 'status'
                                ? <select ref={editInputRef as React.RefObject<HTMLSelectElement>} value={editValue} onChange={e => setEditValue(e.target.value)} onBlur={commitEdit} className="w-full font-mono text-xs border border-ink bg-white px-1 py-0.5 outline-none">{ALL_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}</select>
                                : <div className="relative" onClick={() => updateInvoice && startEdit(inv, 'status')}><span className={cn('badge', statusBadge(inv.status))}>{inv.status}</span><span className="absolute right-1 top-1/2 -translate-y-1/2 opacity-0 group-hover/cell:opacity-40 transition-opacity pointer-events-none"><Pencil size={9} /></span></div>}
                            </td>
                            <td className="px-1 py-2 w-7">
                              <button onClick={() => toggleNotes(inv)} className={cn('p-0.5 transition-colors', inv.internal?.trim() ? 'text-ink' : 'text-muted/40 hover:text-muted')}>
                                {inv.internal?.trim() ? <MessageSquareDot size={13} /> : <MessageSquare size={13} />}
                              </button>
                            </td>
                            <td className="px-2 py-2">
                              <div className="row-actions justify-end gap-0.5">
                                {onPreview && <button onClick={() => onPreview(inv)} className="p-1 text-muted hover:text-ink opacity-0 group-hover:opacity-100 transition-all"><Eye size={12} /></button>}
                                {onEdit && <button onClick={() => onEdit(inv)} className="p-1 text-muted hover:text-ink opacity-0 group-hover:opacity-100 transition-all"><Pencil size={12} /></button>}
                                {markInvoicePaid && inv.status !== 'paid' && <button onClick={() => markInvoicePaid(inv.id)} className="p-1 text-muted hover:text-green-600 opacity-0 group-hover:opacity-100 transition-all"><CheckCircle size={12} /></button>}
                                {createInvoice && <button onClick={() => openSplit(inv)} className="p-1 text-muted hover:text-ink opacity-0 group-hover:opacity-100 transition-all"><SplitSquareHorizontal size={12} /></button>}
                              </div>
                            </td>
                          </tr>
                        )}
                      </Draggable>
                    ))}
                    {provided.placeholder}
                  </tbody>
                </table>
              )}
            </Droppable>
          </DragDropContext>
          {/* Note rows for flat view */}
          {Object.entries(notesOpen).map(([id, open]) => {
            if (!open) return null
            const inv = allInvoices.find(i => i.id === id)
            if (!inv) return null
            return (
              <div key={`${id}-note`} className="px-4 py-2 bg-cream/50 border-t border-rule">
                <div className="flex items-end gap-2">
                  <textarea rows={2} value={noteValues[id] ?? inv.internal ?? ''} onChange={e => setNoteValues(v => ({ ...v, [id]: e.target.value }))} placeholder="Internal notes…" className="flex-1 font-mono text-xs border border-rule bg-white px-2 py-1 outline-none focus:border-ink resize-none" />
                  <button onClick={() => saveNote(id)} disabled={saving[id]} className="px-3 py-1 font-mono text-xs bg-ink text-white hover:bg-[#333] disabled:opacity-50">Save</button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* ── Sticky footer ── */}
      <div className="fixed bottom-0 left-0 right-0 z-10 bg-white border-t border-rule px-6 py-2.5 flex items-center gap-6 flex-wrap shadow-[0_-2px_8px_rgba(0,0,0,0.05)]">
        <div className="flex items-center gap-6">
          <span className="font-mono text-[10px] text-muted uppercase tracking-wider">
            Payable <span className="text-ink font-semibold">{fmt(totalPayable)}</span>
          </span>
          <span className="font-mono text-[10px] text-muted uppercase tracking-wider">
            Receivable <span className="text-ink font-semibold">{fmt(totalReceivable)}</span>
          </span>
          <span className="font-mono text-[10px] text-muted uppercase tracking-wider">
            Paid <span className="text-green-700 font-semibold">{fmt(totalPaid)}</span>
          </span>
          <span className="font-mono text-[10px] text-muted uppercase tracking-wider">
            Outstanding <span className="text-amber-700 font-semibold">{fmt(totalOutstanding)}</span>
          </span>
        </div>
        {selected.size > 0 && (
          <span className="ml-auto font-mono text-xs font-semibold text-ink">
            {selected.size} selected — {fmt(selectedTotal)}
          </span>
        )}
      </div>

      {/* ── Duplicate review modal ── */}
      {dupeReviewOpen && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={() => setDupeReviewOpen(false)}>
          <div className="bg-white max-w-3xl w-full max-h-[80vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-6 py-4 border-b border-rule">
              <h2 className="font-display text-base font-semibold">Possible Duplicates</h2>
              <button onClick={() => setDupeReviewOpen(false)} className="p-1 hover:text-muted"><X size={16} /></button>
            </div>
            <div className="p-6 space-y-6">
              {dupeGroups.map((group, gi) => (
                <div key={gi} className="border border-rule">
                  <div className="px-4 py-2 bg-amber-50 border-b border-amber-200 flex items-center justify-between">
                    <span className="font-mono text-xs text-amber-700 uppercase tracking-wider">
                      {group.reason === 'ref' ? 'Same reference number' : 'Same party + similar amount'}
                    </span>
                    <button onClick={() => mergeGroup(group)} disabled={mergingId !== null}
                      className="font-mono text-xs px-3 py-1 bg-amber-600 text-white hover:bg-amber-700 disabled:opacity-50 transition-colors">
                      Merge (keep highest)
                    </button>
                  </div>
                  <div className={cn('grid gap-0 divide-x divide-rule', `grid-cols-${Math.min(group.invoices.length, 3)}`)}>
                    {group.invoices.map(inv => (
                      <div key={inv.id} className="p-4 space-y-1.5">
                        <div className="font-mono text-xs font-semibold">{fmt(inv.amount, inv.currency)}</div>
                        <div className="text-sm">{inv.party}</div>
                        <div className="font-mono text-[10px] text-muted">{inv.ref || '—'}</div>
                        <div className="font-mono text-[10px] text-muted">{inv.due ? fmtDate(inv.due) : 'No due date'}</div>
                        <span className={cn('badge', statusBadge(inv.status))}>{inv.status}</span>
                        <div className="pt-2">
                          <button onClick={() => keepOne(inv.id, group)} disabled={mergingId !== null}
                            className="font-mono text-[10px] px-3 py-1 bg-ink text-white hover:bg-[#333] disabled:opacity-50 transition-colors w-full">
                            Keep this one
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── Split invoice modal ── */}
      {splitInv && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={() => setSplitInv(null)}>
          <div className="bg-white max-w-xl w-full" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-6 py-4 border-b border-rule">
              <h2 className="font-display text-base font-semibold">Split Invoice</h2>
              <button onClick={() => setSplitInv(null)} className="p-1 hover:text-muted"><X size={16} /></button>
            </div>
            <div className="p-6 space-y-4">
              <p className="font-mono text-xs text-muted">
                Original: <strong className="text-ink">{fmt(splitInv.amount, splitInv.currency)}</strong> — {splitInv.party} ({splitInv.ref || '—'})
              </p>
              <div className="space-y-2">
                {splitRows.map((row, i) => (
                  <div key={i} className="grid grid-cols-[1fr_1fr_100px_32px] gap-2 items-center">
                    <input type="text" value={row.party} onChange={e => setSplitRows(rows => rows.map((r, j) => j === i ? { ...r, party: e.target.value } : r))}
                      placeholder="Party" className="font-mono text-xs border border-rule px-2 py-1.5 outline-none focus:border-ink" />
                    <input type="text" value={row.ref} onChange={e => setSplitRows(rows => rows.map((r, j) => j === i ? { ...r, ref: e.target.value } : r))}
                      placeholder="Ref" className="font-mono text-xs border border-rule px-2 py-1.5 outline-none focus:border-ink" />
                    <input type="number" value={row.amount} onChange={e => setSplitRows(rows => rows.map((r, j) => j === i ? { ...r, amount: e.target.value } : r))}
                      placeholder="Amount" className="font-mono text-xs border border-rule px-2 py-1.5 outline-none focus:border-ink" />
                    {splitRows.length > 2 && (
                      <button onClick={() => setSplitRows(rows => rows.filter((_, j) => j !== i))} className="p-1 text-muted hover:text-red-500 transition-colors">
                        <Minus size={13} />
                      </button>
                    )}
                  </div>
                ))}
              </div>
              {/* Running total */}
              {(() => {
                const tot = splitRows.reduce((s, r) => s + (parseFloat(r.amount) || 0), 0)
                const diff = Math.abs(tot - Number(splitInv.amount))
                return (
                  <div className={cn('font-mono text-xs flex items-center justify-between', diff > 0.01 ? 'text-red-600' : 'text-green-700')}>
                    <span>Total: {fmt(tot, splitInv.currency)}</span>
                    {diff > 0.01 && <span>Remaining: {fmt(Number(splitInv.amount) - tot, splitInv.currency)}</span>}
                    {diff <= 0.01 && <span>✓ Balanced</span>}
                  </div>
                )
              })()}
              <div className="flex items-center gap-2">
                <button onClick={() => setSplitRows(rows => [...rows, { party: splitInv.party ?? '', ref: `${splitInv.ref ?? ''}-${rows.length + 1}`, amount: '' }])}
                  className="font-mono text-xs px-3 py-1.5 border border-rule text-muted hover:text-ink flex items-center gap-1 transition-colors">
                  <Plus size={11} /> Add split
                </button>
                <button onClick={executeSplit}
                  className="ml-auto font-mono text-xs px-4 py-1.5 bg-ink text-white hover:bg-[#333] transition-colors flex items-center gap-1.5">
                  <SplitSquareHorizontal size={12} /> Execute Split
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Export preview modal ── */}
      {exportPreview && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={() => setExportPreview(null)}>
          <div className="bg-white max-w-3xl w-full max-h-[80vh] flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-6 py-4 border-b border-rule flex-shrink-0">
              <div>
                <h2 className="font-display text-base font-semibold">Export Preview</h2>
                <p className="font-mono text-[10px] text-muted mt-0.5">{exportPreview.allRows.length} rows · {exportPreview.filename}</p>
              </div>
              <button onClick={() => setExportPreview(null)} className="p-1 hover:text-muted"><X size={16} /></button>
            </div>
            <div className="flex-1 overflow-auto p-6">
              <div className="overflow-x-auto">
                <table className="w-full text-left border border-rule">
                  <thead>
                    <tr className="bg-cream">
                      {exportPreview.headers.map(h => (
                        <th key={h} className="tbl-lbl px-3 py-2 border-b border-rule whitespace-nowrap">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {exportPreview.rows.map((row, i) => (
                      <tr key={i} className="border-b border-rule last:border-0">
                        {row.map((cell, j) => (
                          <td key={j} className="px-3 py-2 font-mono text-xs text-muted whitespace-nowrap max-w-[180px] truncate">{cell.replace(/^"|"$/g, '')}</td>
                        ))}
                      </tr>
                    ))}
                    {exportPreview.allRows.length > 5 && (
                      <tr>
                        <td colSpan={exportPreview.headers.length} className="px-3 py-2 font-mono text-xs text-muted/50 italic">
                          …and {exportPreview.allRows.length - 5} more rows
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
            <div className="px-6 py-4 border-t border-rule flex justify-end flex-shrink-0">
              <button onClick={() => { downloadCSV(exportPreview.allRows, exportPreview.headers, exportPreview.filename); setExportPreview(null) }}
                className="flex items-center gap-2 px-4 py-2 bg-ink text-white font-mono text-xs hover:bg-[#333] transition-colors">
                <Download size={13} /> Download {exportPreview.filename}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Close export dropdown on outside click */}
      {exportDropOpen && <div className="fixed inset-0 z-10" onClick={() => setExportDropOpen(false)} />}
    </div>
  )
}
