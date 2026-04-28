'use client'

import { useState, useMemo } from 'react'
import { cn, fmt, fmtDate } from '@/lib/format'
import { toast } from '@/lib/toast'
import { Download, FileText, CheckCircle, Eye, ExternalLink, X } from 'lucide-react'
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

const STATUS_OPTIONS = ['draft', 'pending', 'submitted', 'approved', 'sent', 'overdue', 'part-paid', 'paid']
const CURRENCIES = ['£', '$', '€', 'AED', 'USD', 'EUR']

const INV_COLS: { key: InvField; label: string; cls: string }[] = [
  { key: 'party',    label: 'Supplier / Party', cls: 'min-w-[140px]' },
  { key: 'ref',      label: 'Invoice Ref',       cls: 'min-w-[100px]' },
  { key: 'due',      label: 'Due Date',          cls: 'min-w-[95px]' },
  { key: 'amount',   label: 'Amount',            cls: 'min-w-[85px] text-right' },
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

// ─── Component ────────────────────────────────────────────────────────────────

export function PaymentSheet({ invoices, project, costs, reconLinks, updateInvoice, onAddToRun }: PaymentSheetProps) {
  const payable = useMemo(() => invoices.filter(i => i.type === 'payable'), [invoices])

  const [editing, setEditing] = useState<{ id: string; field: FieldKey } | null>(null)
  const [editVal, setEditVal] = useState('')
  const [saving, setSaving] = useState<string | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [lightbox, setLightbox] = useState<{ url: string; name: string } | null>(null)

  // ── Helpers ──
  function getReceipt(inv: Invoice): { url: string; type: 'image' | 'pdf' } | null {
    if (!reconLinks?.manual || !costs) return null
    const link = reconLinks.manual.find(m => m.invoiceId === inv.id)
    if (!link) return null
    const cost = costs.find(c => c.id === link.costId)
    if (!cost?.receiptUrl) return null
    return { url: cost.receiptUrl, type: cost.receiptType ?? 'pdf' }
  }

  function getCategory(inv: Invoice): string {
    if (!reconLinks?.manual || !costs) return '—'
    const link = reconLinks.manual.find(m => m.invoiceId === inv.id)
    return costs.find(c => c.id === link?.costId)?.category ?? '—'
  }

  function rawVal(inv: Invoice, field: FieldKey): string {
    if (field === 'due')      return inv.due ?? ''
    if (field === 'amount')   return String(inv.amount)
    if (field === 'bankName') return inv.bank_details?.bankName ?? ''
    if (field === 'sortCode') return inv.bank_details?.sortCode ?? ''
    if (field === 'accNum')   return inv.bank_details?.accNum ?? ''
    if (field === 'accName')  return inv.bank_details?.accName ?? ''
    if (field === 'iban')     return inv.bank_details?.iban ?? ''
    if (field === 'swift')    return inv.bank_details?.swift ?? ''
    return String((inv as unknown as Record<string, unknown>)[field] ?? '')
  }

  // ── Editing ──
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
        const bd: Partial<BankDetails> = inv.bank_details ?? {}
        const updated: BankDetails = {
          accName:  field === 'accName'  ? editVal : (bd.accName ?? ''),
          sortCode: field === 'sortCode' ? editVal : (bd.sortCode ?? ''),
          accNum:   field === 'accNum'   ? editVal : (bd.accNum ?? ''),
          bankName: field === 'bankName' ? editVal : bd.bankName,
          iban:     field === 'iban'     ? editVal : bd.iban,
          swift:    field === 'swift'    ? editVal : bd.swift,
        }
        await updateInvoice(id, { bank_details: updated })
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
    setSelected(s => s.size === payable.length ? new Set() : new Set(payable.map(i => i.id)))
  }
  function toggleRow(id: string) {
    setSelected(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })
  }

  // ── Totals ──
  const totalDue = payable.reduce((t, i) => t + Number(i.amount), 0)
  const totalPaid = payable.filter(i => i.status === 'paid').reduce((t, i) => t + Number(i.amount), 0)
  const outstanding = totalDue - totalPaid

  // ── Exports ──
  function exportCSV() {
    const header = ['Category', 'Supplier', 'Invoice Ref', 'Due Date', 'Amount', 'Currency', 'Status',
      'Bank Name', 'Sort Code', 'Acc No', 'Acc Name', 'IBAN', 'SWIFT', 'Receipt']
    const rows = payable.map(inv => {
      const rec = getReceipt(inv)
      return [
        getCategory(inv), inv.party, inv.ref ?? '', inv.due ?? '', inv.amount, inv.currency, inv.status,
        inv.bank_details?.bankName ?? '', inv.bank_details?.sortCode ?? '', inv.bank_details?.accNum ?? '',
        inv.bank_details?.accName ?? '', inv.bank_details?.iban ?? '', inv.bank_details?.swift ?? '',
        rec ? rec.url : '',
      ]
    })
    rows.push(['', '', '', 'TOTAL DUE', totalDue, '', '', '', '', '', '', '', '', ''])
    rows.push(['', '', '', 'TOTAL PAID', totalPaid, '', '', '', '', '', '', '', '', ''])
    rows.push(['', '', '', 'OUTSTANDING', outstanding, '', '', '', '', '', '', '', '', ''])
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
        'Bank Name', 'Sort Code', 'Acc No', 'Acc Name', 'IBAN', 'SWIFT', 'Receipt']
      const rows = payable.map(inv => {
        const rec = getReceipt(inv)
        return [
          getCategory(inv), inv.party, inv.ref ?? '', inv.due ?? '', Number(inv.amount), inv.currency, inv.status,
          inv.bank_details?.bankName ?? '', inv.bank_details?.sortCode ?? '', inv.bank_details?.accNum ?? '',
          inv.bank_details?.accName ?? '', inv.bank_details?.iban ?? '', inv.bank_details?.swift ?? '',
          rec ? rec.url : '',
        ]
      })
      // Summary rows
      rows.push(['', '', '', 'Total Due', totalDue, '', '', '', '', '', '', '', '', ''])
      rows.push(['', '', '', 'Total Paid', totalPaid, '', '', '', '', '', '', '', '', ''])
      rows.push(['', '', '', 'Outstanding', outstanding, '', '', '', '', '', '', '', '', ''])

      const ws = XLSX.utils.aoa_to_sheet([header, ...rows])
      // Column widths
      ws['!cols'] = [16, 20, 14, 12, 10, 6, 10, 16, 10, 12, 16, 22, 12, 30].map(w => ({ wch: w }))
      const wb = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(wb, ws, `${project.code} Payment Sheet`)
      XLSX.writeFile(wb, `${project.code}-payment-sheet.xlsx`)
      toast('XLSX exported')
    } catch (e) {
      toast(`Export failed: ${String(e)}`, 'error')
    }
  }

  // ── Render cell ──
  function Cell({ inv, field, cls }: { inv: Invoice; field: FieldKey; cls?: string }) {
    const isEditing = editing?.id === inv.id && editing.field === field
    const val = rawVal(inv, field)
    const canEdit = !!updateInvoice
    const isBankField = ['bankName', 'sortCode', 'accNum', 'accName', 'iban', 'swift'].includes(field)

    if (isEditing) {
      if (field === 'status') {
        return (
          <select autoFocus value={editVal} onChange={e => setEditVal(e.target.value)}
            onBlur={commitEdit}
            className="w-full border border-rule bg-white px-1 py-0.5 text-xs font-mono focus:outline-none">
            {STATUS_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        )
      }
      if (field === 'currency') {
        return (
          <select autoFocus value={editVal} onChange={e => setEditVal(e.target.value)}
            onBlur={commitEdit}
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

    const display = field === 'due' ? (val ? fmtDate(val) : '—')
      : field === 'amount' ? fmt(Number(val), inv.currency)
      : field === 'status' ? <span className={cn('badge', STATUS_BADGE[val] ?? 'badge-draft')}>{val}</span>
      : (val || <span className="text-muted/30">—</span>)

    return (
      <div
        onClick={() => startEdit(inv.id, field, inv)}
        title={canEdit ? `Click to edit: ${val || 'empty'}` : val}
        className={cn(
          'text-xs font-mono truncate min-w-0',
          canEdit && 'cursor-text hover:bg-cream/80 rounded-sm px-0.5 -mx-0.5 transition-colors',
          saving === inv.id && 'opacity-40',
          !val && 'italic',
          isBankField && 'text-blue-700',
          cls,
        )}
      >
        {display}
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex items-center gap-3 flex-wrap">
        <p className="font-mono text-xs text-muted">
          {payable.length} payable invoice{payable.length !== 1 ? 's' : ''}
          {updateInvoice && ' · Click any cell to edit'}
        </p>
        <div className="flex-1" />
        {onAddToRun && selected.size > 0 && (
          <button
            onClick={() => { onAddToRun(payable.filter(i => selected.has(i.id))); setSelected(new Set()) }}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-mono uppercase tracking-wider bg-ac-green text-white hover:opacity-90 transition-opacity">
            <CheckCircle size={11} /> Add {selected.size} to Payment Run
          </button>
        )}
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
      ) : (
        <div className="tbl-card">
          <div className="overflow-x-auto">
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr className="border-b-2 border-ink bg-paper/50">
                  {onAddToRun && (
                    <th className="px-2 py-2.5 w-8 flex-shrink-0">
                      <input type="checkbox" checked={selected.size === payable.length && payable.length > 0}
                        onChange={toggleAll} className="accent-ink" />
                    </th>
                  )}
                  <th className="tbl-lbl text-left px-2 py-2.5 w-20">Category</th>
                  {INV_COLS.map(c => (
                    <th key={c.key} className={cn('tbl-lbl text-left px-2 py-2.5', c.cls)}>{c.label}</th>
                  ))}
                  <th className="tbl-lbl text-left px-2 py-2.5 bg-blue-50/60" colSpan={6}>
                    Bank Details
                  </th>
                  <th className="tbl-lbl text-left px-2 py-2.5 w-14">Receipt</th>
                </tr>
                {/* Bank detail sub-headers */}
                <tr className="border-b border-rule bg-blue-50/30">
                  {onAddToRun && <th className="px-2 py-1" />}
                  <th className="px-2 py-1" />
                  {INV_COLS.map(c => <th key={c.key} className="px-2 py-1" />)}
                  {BANK_COLS.map(c => (
                    <th key={c.key} className={cn('tbl-lbl text-left px-2 py-1 bg-blue-50/40 text-blue-600', c.cls)}>
                      {c.label}
                    </th>
                  ))}
                  <th className="px-2 py-1" />
                </tr>
              </thead>
              <tbody>
                {payable.map((inv, idx) => {
                  const receipt = getReceipt(inv)
                  return (
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
                        <td key={c.key} className={cn('px-2 py-2', c.cls.includes('right') ? 'text-right' : '')}>
                          <Cell inv={inv} field={c.key} />
                        </td>
                      ))}
                      {BANK_COLS.map(c => (
                        <td key={c.key} className="px-2 py-2 bg-blue-50/20">
                          <Cell inv={inv} field={c.key} />
                        </td>
                      ))}
                      <td className="px-2 py-2">
                        {receipt ? (
                          receipt.type === 'image' ? (
                            <button onClick={() => setLightbox({ url: receipt.url, name: inv.party })}
                              className="text-ac-green hover:text-[#2d6147] transition-colors" title="View receipt">
                              <Eye size={13} />
                            </button>
                          ) : (
                            <a href={receipt.url} target="_blank" rel="noopener noreferrer"
                              className="text-ac-green hover:text-[#2d6147] transition-colors" title="View receipt PDF">
                              <ExternalLink size={13} />
                            </a>
                          )
                        ) : (
                          <span className="text-muted/30 font-mono text-[10px]">—</span>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {/* Totals bar */}
          <div className="border-t-2 border-ink bg-cream px-4 py-3 flex flex-wrap gap-8">
            {[
              { label: 'Total Due',    val: totalDue,    cls: '' },
              { label: 'Total Paid',   val: totalPaid,   cls: 'text-ac-green' },
              { label: 'Outstanding',  val: outstanding, cls: outstanding > 0 ? 'text-red-600' : 'text-ac-green' },
            ].map(({ label, val, cls }) => (
              <div key={label}>
                <p className="font-mono text-[9px] uppercase tracking-widest text-muted">{label}</p>
                <p className={cn('font-mono text-base font-bold mt-0.5', cls || 'text-ink')}>{fmt(val)}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Lightbox */}
      {lightbox && (
        <div className="fixed inset-0 z-[70] flex flex-col bg-black/90" onClick={() => setLightbox(null)}>
          <div className="flex items-center justify-between px-6 py-3 flex-shrink-0" onClick={e => e.stopPropagation()}>
            <span className="font-mono text-xs text-white/60">{lightbox.name}</span>
            <button onClick={() => setLightbox(null)} className="text-white/60 hover:text-white transition-colors">
              <X size={16} />
            </button>
          </div>
          <div className="flex-1 flex items-center justify-center p-6" onClick={e => e.stopPropagation()}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={lightbox.url} alt={lightbox.name} className="max-w-full max-h-full object-contain" />
          </div>
        </div>
      )}
    </div>
  )
}
