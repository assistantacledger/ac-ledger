'use client'

import { useState, useEffect, useCallback } from 'react'
import { Plus, Trash2, RefreshCw } from 'lucide-react'
import { Modal } from '@/components/ui/Modal'
import { cn, fmt, getNextRef, todayISO } from '@/lib/format'
import type { Invoice, InvoiceInsert, InvoiceStatus, Entity, LineItem, PaymentInstalment } from '@/types'
import { ENTITIES } from '@/types'

const STATUSES: InvoiceStatus[] = [
  'draft', 'pending', 'submitted', 'approved', 'sent', 'overdue', 'part-paid', 'paid',
]

const CURRENCIES = ['£', '$', '€']
const PAYMENT_METHODS = ['Bank Transfer', 'Wise', 'Card', 'Cash', 'Other']

// ─── Invoice metadata stored in internal field ───────────────────────────────
// Format: ||{"v":20,"pm":"Bank Transfer","pa":500}||\nRest of notes
// v  = vat rate (0 = explicitly off, >0 = on at that %)
// pm = payment method
// pa = paid amount so far (for part-paid)

interface InvMeta { v?: number; pm?: string; pa?: number }

function parseMeta(internal: string | null): { meta: InvMeta; text: string } {
  if (!internal) return { meta: {}, text: '' }
  const m = internal.match(/^\|\|(.+?)\|\|\n?([\s\S]*)$/)
  if (m) {
    try { return { meta: JSON.parse(m[1]) as InvMeta, text: m[2] } } catch { /* */ }
  }
  return { meta: {}, text: internal }
}

function buildInternal(meta: InvMeta, text: string): string | null {
  const hasMeta = Object.keys(meta).length > 0
  if (!hasMeta) return text || null
  return `||${JSON.stringify(meta)}||\n${text}`
}

// ─── Form helpers ─────────────────────────────────────────────────────────────

const blankLine = (): LineItem => ({ description: '', qty: 1, unit: 0, total: 0 })

function emptyForm(defaultType: 'payable' | 'receivable' = 'payable'): InvoiceInsert {
  return {
    type: defaultType,
    party: '',
    ref: '',
    amount: 0,
    currency: '£',
    due: null,
    status: 'pending',
    notes: null,
    internal: null,
    line_items: [blankLine()],
    entity: 'Actually Creative',
    project_code: null,
    project_name: null,
    recurring: false,
    pdf_url: null,
    payment_schedule: null,
  }
}

function fromInvoice(inv: Invoice): InvoiceInsert {
  return {
    type: inv.type,
    party: inv.party,
    ref: inv.ref,
    amount: inv.amount,
    currency: inv.currency,
    due: inv.due,
    status: inv.status,
    notes: inv.notes,
    internal: inv.internal,
    line_items: inv.line_items?.length ? inv.line_items : [blankLine()],
    entity: inv.entity,
    project_code: inv.project_code,
    project_name: inv.project_name,
    recurring: inv.recurring,
    pdf_url: inv.pdf_url,
    payment_schedule: inv.payment_schedule,
  }
}

interface InvoiceModalProps {
  isOpen: boolean
  onClose: () => void
  invoice?: Invoice | null
  existingInvoices: Invoice[]
  defaultType?: 'payable' | 'receivable'
  defaultValues?: Partial<InvoiceInsert>
  onSave: (data: InvoiceInsert) => Promise<void>
}

export function InvoiceModal({
  isOpen, onClose, invoice, existingInvoices, defaultType = 'payable', defaultValues, onSave,
}: InvoiceModalProps) {
  const [form, setForm] = useState<InvoiceInsert>(() =>
    invoice ? fromInvoice(invoice) : emptyForm(defaultType)
  )
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [scheduleEnabled, setScheduleEnabled] = useState(false)
  const [refWarn, setRefWarn] = useState(false)

  // Extra fields stored in internal meta
  const [vatEnabled, setVatEnabled] = useState(false)
  const [vatRate, setVatRate] = useState(20)
  const [paymentMethod, setPaymentMethod] = useState('')
  const [partPaidAmount, setPartPaidAmount] = useState(0)
  const [internalNotes, setInternalNotes] = useState('')

  useEffect(() => {
    if (isOpen) {
      const base = invoice ? fromInvoice(invoice) : emptyForm(defaultType)
      const merged = defaultValues && !invoice ? { ...base, ...defaultValues } : base

      // Parse meta from internal field
      const { meta, text } = parseMeta(merged.internal)
      setVatEnabled(meta.v !== undefined && meta.v > 0)
      setVatRate(meta.v && meta.v > 0 ? meta.v : 20)
      setPaymentMethod(meta.pm ?? '')
      setPartPaidAmount(meta.pa ?? 0)
      setInternalNotes(text)

      // Store form without internal (we manage it via internalNotes state)
      setForm({ ...merged, internal: null })
      setError(null)
      setSaving(false)
      setRefWarn(false)
      setScheduleEnabled(!!(invoice?.payment_schedule?.length))
    }
  }, [isOpen, invoice, defaultType, defaultValues])

  // Recompute total from line items whenever they change
  const lineTotal = (form.line_items ?? []).reduce((t, l) => t + Number(l.total), 0)
  const vatAmt = vatEnabled ? parseFloat((lineTotal * vatRate / 100).toFixed(2)) : 0
  const grandTotal = lineTotal > 0 ? lineTotal + vatAmt : form.amount

  function set<K extends keyof InvoiceInsert>(key: K, val: InvoiceInsert[K]) {
    setForm(f => ({ ...f, [key]: val }))
  }

  // Line item helpers
  function updateLine(idx: number, key: keyof LineItem, raw: string) {
    const lines = [...(form.line_items ?? [])]
    const line = { ...lines[idx] }
    if (key === 'description') {
      line.description = raw
    } else {
      const num = parseFloat(raw) || 0
      ;(line as Record<string, number | string>)[key] = num
      if (key === 'qty' || key === 'unit') {
        line.total = parseFloat((line.qty * line.unit).toFixed(2))
      }
    }
    lines[idx] = line
    set('line_items', lines)
    const total = lines.reduce((t, l) => t + Number(l.total), 0)
    set('amount', parseFloat(total.toFixed(2)))
  }

  function addLine() {
    set('line_items', [...(form.line_items ?? []), blankLine()])
  }

  function removeLine(idx: number) {
    const lines = (form.line_items ?? []).filter((_, i) => i !== idx)
    set('line_items', lines)
    const total = lines.reduce((t, l) => t + Number(l.total), 0)
    set('amount', parseFloat(total.toFixed(2)))
  }

  function autoRef() {
    const prefix = form.entity === 'Actually Creative' ? 'AC'
      : form.entity === '419Studios' ? '419'
      : 'RTW'
    const ref = getNextRef(existingInvoices, form.entity, prefix)
    set('ref', ref)
  }

  function setDueDatePreset(days: number) {
    const d = new Date()
    d.setDate(d.getDate() + days)
    set('due', d.toISOString().split('T')[0])
  }

  // Payment schedule helpers
  function addInstalment() {
    const current = form.payment_schedule ?? []
    const newItem: PaymentInstalment = {
      label: `Instalment ${current.length + 1}`,
      pct: 0,
      dueDate: form.due ?? todayISO(),
      paid: false,
    }
    set('payment_schedule', [...current, newItem])
  }

  function updateInstalment(idx: number, key: keyof PaymentInstalment, val: string | boolean | number) {
    const items = [...(form.payment_schedule ?? [])]
    ;(items[idx] as unknown as Record<string, string | boolean | number>)[key] = val
    set('payment_schedule', items)
  }

  function removeInstalment(idx: number) {
    set('payment_schedule', (form.payment_schedule ?? []).filter((_, i) => i !== idx))
  }

  async function handleSave(force = false, statusOverride?: InvoiceStatus) {
    if (!form.party.trim()) { setError('Party is required'); return }
    if (!form.ref.trim()) { setError('Ref / invoice number is required'); return }

    // Duplicate ref check
    if (!force && form.ref.trim()) {
      const clash = existingInvoices.some(i =>
        i.ref?.trim().toLowerCase() === form.ref.trim().toLowerCase() &&
        (!invoice || i.id !== invoice.id)
      )
      if (clash) { setRefWarn(true); return }
    }

    setRefWarn(false)
    setError(null)
    setSaving(true)
    try {
      // Build internal with meta
      const meta: InvMeta = {}
      meta.v = vatEnabled ? vatRate : 0  // always write v so PDF knows the intent
      if (paymentMethod) meta.pm = paymentMethod
      if (partPaidAmount > 0) meta.pa = partPaidAmount
      const internalField = buildInternal(meta, internalNotes)

      // Compute VAT-inclusive amount
      const vatAmount = vatEnabled ? parseFloat((lineTotal * vatRate / 100).toFixed(2)) : 0
      const totalAmount = lineTotal > 0
        ? parseFloat((lineTotal + vatAmount).toFixed(2))
        : form.amount

      const data: InvoiceInsert = {
        ...form,
        status: statusOverride ?? form.status,
        amount: totalAmount,
        internal: internalField,
        payment_schedule: scheduleEnabled ? form.payment_schedule : null,
      }
      await onSave(data)
      onClose()
    } catch (e) {
      setError(String(e))
    } finally {
      setSaving(false)
    }
  }

  const footer = (
    <>
      <div className="mr-auto space-y-1">
        {error && <p className="text-xs font-mono text-red-600">{error}</p>}
        {refWarn && (
          <p className="text-xs font-mono text-ac-amber">
            Ref <span className="font-semibold">{form.ref}</span> already exists.{' '}
            <button onClick={() => handleSave(true)} className="underline hover:no-underline">
              Save anyway
            </button>
          </p>
        )}
      </div>
      <button
        onClick={onClose}
        className="px-4 py-2 text-xs font-mono uppercase tracking-wider border border-rule text-muted hover:text-ink hover:border-ink transition-colors"
      >
        Cancel
      </button>
      <button
        onClick={() => handleSave(false, 'draft')}
        disabled={saving}
        className="px-4 py-2 text-xs font-mono uppercase tracking-wider border border-rule text-muted hover:text-ink hover:border-ink transition-colors disabled:opacity-50"
      >
        Save as Draft
      </button>
      <button
        onClick={() => handleSave(false)}
        disabled={saving}
        className="px-4 py-2 text-xs font-mono uppercase tracking-wider bg-ink text-white hover:bg-[#333] transition-colors disabled:opacity-50"
      >
        {saving ? 'Saving…' : invoice ? 'Save Changes' : 'Create Invoice'}
      </button>
    </>
  )

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={invoice ? `Edit Invoice · ${invoice.ref}` : 'New Invoice'}
      size="2xl"
      footer={footer}
    >
      <div className="divide-y divide-rule">

        {/* ── Section 1: Details ─────────────────────────────────────── */}
        <div className="px-5 py-5 grid grid-cols-2 gap-4">
          <div className="col-span-2">
            <p className="tbl-lbl mb-3">Invoice Details</p>
          </div>

          {/* Party */}
          <div className="col-span-2">
            <label className="field-label">
              {form.type === 'payable' ? 'Payee / Supplier' : 'Client / Bill to'}
            </label>
            <input
              type="text"
              value={form.party}
              onChange={e => set('party', e.target.value)}
              className="w-full border border-rule bg-paper px-3 py-2 text-sm text-ink focus:outline-none focus:border-ink"
              placeholder="Company or person name"
            />
          </div>

          {/* Ref */}
          <div>
            <label className="field-label">Reference / Invoice #</label>
            <div className="flex gap-1">
              <input
                type="text"
                value={form.ref}
                onChange={e => set('ref', e.target.value)}
                className="flex-1 border border-rule bg-paper px-3 py-2 text-sm font-mono text-ink focus:outline-none focus:border-ink"
                placeholder="AC-0001"
              />
              <button
                type="button"
                onClick={autoRef}
                title="Auto-generate"
                className="px-2 border border-rule text-muted hover:text-ink hover:border-ink transition-colors"
              >
                <RefreshCw size={12} />
              </button>
            </div>
          </div>

          {/* Type */}
          <div>
            <label className="field-label">Type</label>
            <select
              value={form.type}
              onChange={e => set('type', e.target.value as 'payable' | 'receivable')}
              className="w-full border border-rule bg-paper px-3 py-2 text-sm text-ink focus:outline-none focus:border-ink font-mono"
            >
              <option value="payable">Payable (outgoing)</option>
              <option value="receivable">Receivable (incoming)</option>
            </select>
          </div>

          {/* Entity */}
          <div>
            <label className="field-label">Entity</label>
            <select
              value={form.entity}
              onChange={e => set('entity', e.target.value as Entity)}
              className="w-full border border-rule bg-paper px-3 py-2 text-sm text-ink focus:outline-none focus:border-ink"
            >
              {ENTITIES.map(e => <option key={e} value={e}>{e}</option>)}
            </select>
          </div>

          {/* Status */}
          <div>
            <label className="field-label">Status</label>
            <select
              value={form.status}
              onChange={e => set('status', e.target.value as InvoiceStatus)}
              className="w-full border border-rule bg-paper px-3 py-2 text-sm text-ink focus:outline-none focus:border-ink font-mono uppercase"
            >
              {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>

          {/* Part-paid amount — shown when status is part-paid */}
          {form.status === 'part-paid' && (
            <div className="col-span-2 bg-amber-50 border border-amber-200 px-4 py-3 flex items-center gap-4">
              <div className="flex-1">
                <label className="field-label text-amber-800">Amount Paid So Far</label>
                <div className="flex items-center gap-2 mt-1">
                  <span className="font-mono text-sm text-muted">{form.currency}</span>
                  <input
                    type="number"
                    value={partPaidAmount || ''}
                    onChange={e => setPartPaidAmount(parseFloat(e.target.value) || 0)}
                    min="0"
                    step="0.01"
                    placeholder="0.00"
                    className="w-36 border border-amber-300 bg-white px-3 py-1.5 text-sm font-mono text-ink focus:outline-none focus:border-amber-600"
                  />
                </div>
              </div>
              {partPaidAmount > 0 && (
                <div className="text-right">
                  <p className="font-mono text-xs text-muted uppercase tracking-wider">Remaining</p>
                  <p className="font-mono text-sm font-semibold text-amber-800">
                    {fmt(Math.max(0, grandTotal - partPaidAmount), form.currency)}
                  </p>
                </div>
              )}
            </div>
          )}

          {/* Currency */}
          <div>
            <label className="field-label">Currency</label>
            <select
              value={form.currency}
              onChange={e => set('currency', e.target.value)}
              className="w-full border border-rule bg-paper px-3 py-2 text-sm text-ink focus:outline-none focus:border-ink font-mono"
            >
              {CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>

          {/* Payment Method */}
          <div>
            <label className="field-label">Payment Method</label>
            <select
              value={paymentMethod}
              onChange={e => setPaymentMethod(e.target.value)}
              className="w-full border border-rule bg-paper px-3 py-2 text-sm text-ink focus:outline-none focus:border-ink font-mono"
            >
              <option value="">— Not specified —</option>
              {PAYMENT_METHODS.map(m => <option key={m} value={m}>{m}</option>)}
            </select>
          </div>

          {/* Due date */}
          <div>
            <label className="field-label">Due Date</label>
            <input
              type="date"
              value={form.due ?? ''}
              onChange={e => set('due', e.target.value || null)}
              className="w-full border border-rule bg-paper px-3 py-2 text-sm text-ink focus:outline-none focus:border-ink"
            />
            {/* Quick presets */}
            <div className="flex gap-1 mt-1.5">
              {[7, 14, 30, 60].map(days => (
                <button
                  key={days}
                  type="button"
                  onClick={() => setDueDatePreset(days)}
                  className="px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider border border-rule text-muted hover:text-ink hover:border-ink transition-colors"
                >
                  +{days}d
                </button>
              ))}
              {form.due && (
                <button
                  type="button"
                  onClick={() => set('due', null)}
                  className="px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-muted hover:text-red-500 transition-colors"
                >
                  Clear
                </button>
              )}
            </div>
          </div>

          {/* Project code */}
          <div>
            <label className="field-label">Project Code</label>
            <input
              type="text"
              value={form.project_code ?? ''}
              onChange={e => set('project_code', e.target.value || null)}
              className="w-full border border-rule bg-paper px-3 py-2 text-sm font-mono text-ink focus:outline-none focus:border-ink"
              placeholder="AC-24-001"
            />
          </div>

          {/* Project name */}
          <div>
            <label className="field-label">Project Name</label>
            <input
              type="text"
              value={form.project_name ?? ''}
              onChange={e => set('project_name', e.target.value || null)}
              className="w-full border border-rule bg-paper px-3 py-2 text-sm text-ink focus:outline-none focus:border-ink"
              placeholder="Project name"
            />
          </div>

          {/* Recurring */}
          <div className="col-span-2 flex items-center gap-2">
            <input
              type="checkbox"
              id="recurring"
              checked={form.recurring}
              onChange={e => set('recurring', e.target.checked)}
              className="w-3.5 h-3.5 accent-ink"
            />
            <label htmlFor="recurring" className="font-mono text-xs uppercase tracking-wider text-muted cursor-pointer">
              Recurring invoice
            </label>
          </div>
        </div>

        {/* ── Section 2: Line Items ──────────────────────────────────── */}
        <div className="px-5 py-5">
          <div className="flex items-center justify-between mb-3">
            <p className="tbl-lbl">Line Items</p>
            <button
              onClick={addLine}
              className="flex items-center gap-1 font-mono text-xs text-muted hover:text-ink transition-colors"
            >
              <Plus size={11} /> Add line
            </button>
          </div>

          <div className="border border-rule overflow-hidden">
            <table className="w-full">
              <thead>
                <tr className="bg-cream border-b border-rule">
                  <th className="tbl-lbl text-left px-3 py-2">Description</th>
                  <th className="tbl-lbl text-right px-3 py-2 w-16">Qty</th>
                  <th className="tbl-lbl text-right px-3 py-2 w-24">Unit Price</th>
                  <th className="tbl-lbl text-right px-3 py-2 w-24">Total</th>
                  <th className="w-8 px-2 py-2" />
                </tr>
              </thead>
              <tbody>
                {(form.line_items ?? []).map((line, idx) => (
                  <tr key={idx} className="border-b border-rule last:border-0">
                    <td className="px-3 py-1.5">
                      <input
                        type="text"
                        value={line.description}
                        onChange={e => updateLine(idx, 'description', e.target.value)}
                        placeholder="Description"
                        className="w-full border-0 bg-transparent text-sm text-ink focus:outline-none placeholder:text-muted"
                      />
                    </td>
                    <td className="px-3 py-1.5">
                      <input
                        type="number"
                        value={line.qty}
                        onChange={e => updateLine(idx, 'qty', e.target.value)}
                        min="0"
                        className="w-full border-0 bg-transparent text-sm text-right text-ink focus:outline-none"
                      />
                    </td>
                    <td className="px-3 py-1.5">
                      <input
                        type="number"
                        value={line.unit}
                        onChange={e => updateLine(idx, 'unit', e.target.value)}
                        min="0"
                        step="0.01"
                        className="w-full border-0 bg-transparent text-sm text-right font-mono text-ink focus:outline-none"
                      />
                    </td>
                    <td className="px-3 py-1.5 text-right font-mono text-sm text-ink">
                      {fmt(line.total, form.currency)}
                    </td>
                    <td className="px-2 py-1.5">
                      {(form.line_items ?? []).length > 1 && (
                        <button
                          onClick={() => removeLine(idx)}
                          className="text-muted hover:text-red-500 transition-colors"
                        >
                          <Trash2 size={12} />
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* VAT toggle — prominent band */}
          <div className={cn(
            'mt-3 border px-4 py-3 flex items-center gap-4 transition-colors',
            vatEnabled ? 'border-ink bg-ink/5' : 'border-rule bg-cream'
          )}>
            <button
              type="button"
              onClick={() => setVatEnabled(v => !v)}
              className="flex items-center gap-3 group"
            >
              {/* Toggle switch */}
              <div className={cn(
                'relative w-9 h-5 transition-colors flex-shrink-0',
                vatEnabled ? 'bg-ink' : 'bg-[#ccc]'
              )}>
                <div className={cn(
                  'absolute top-0.5 w-4 h-4 bg-white shadow transition-transform',
                  vatEnabled ? 'left-[18px]' : 'left-0.5'
                )} />
              </div>
              <span className={cn(
                'font-mono text-xs font-semibold uppercase tracking-wider',
                vatEnabled ? 'text-ink' : 'text-muted'
              )}>
                VAT
              </span>
            </button>

            {vatEnabled ? (
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  value={vatRate}
                  onChange={e => setVatRate(parseFloat(e.target.value) || 0)}
                  min="0"
                  max="100"
                  step="0.1"
                  className="w-16 border border-ink bg-white px-2 py-1 text-sm font-mono text-ink focus:outline-none text-right"
                />
                <span className="font-mono text-xs text-muted">%</span>
                <span className="font-mono text-xs text-muted ml-2">= {fmt(vatAmt, form.currency)}</span>
              </div>
            ) : (
              <span className="font-mono text-xs text-muted">No VAT — toggle on to add</span>
            )}
          </div>

          {/* Totals */}
          <div className="mt-3 flex justify-end">
            <div className="text-right space-y-1">
              {lineTotal > 0 && (
                <div className="flex items-center gap-6">
                  <span className="font-mono text-xs text-muted uppercase tracking-wider">Subtotal</span>
                  <span className="font-mono text-sm text-ink w-24 text-right">{fmt(lineTotal, form.currency)}</span>
                </div>
              )}
              {vatEnabled && vatAmt > 0 && (
                <div className="flex items-center gap-6">
                  <span className="font-mono text-xs text-muted uppercase tracking-wider">VAT ({vatRate}%)</span>
                  <span className="font-mono text-sm text-muted w-24 text-right">{fmt(vatAmt, form.currency)}</span>
                </div>
              )}
              <div className="flex items-center gap-6 border-t border-rule pt-1">
                <span className="font-mono text-xs font-semibold uppercase tracking-wider">Total</span>
                <span className="font-mono text-sm font-semibold text-ink w-24 text-right">{fmt(grandTotal, form.currency)}</span>
              </div>
            </div>
          </div>

          {/* Manual override if line items are empty */}
          {(form.line_items ?? []).length <= 1 && (form.line_items?.[0]?.total ?? 0) === 0 && (
            <div className="mt-3">
              <label className="field-label">Or enter amount directly</label>
              <div className="flex gap-2 items-center">
                <span className="font-mono text-sm text-muted">{form.currency}</span>
                <input
                  type="number"
                  value={form.amount || ''}
                  onChange={e => set('amount', parseFloat(e.target.value) || 0)}
                  min="0"
                  step="0.01"
                  placeholder="0.00"
                  className="w-40 border border-rule bg-paper px-3 py-2 text-sm font-mono text-ink focus:outline-none focus:border-ink"
                />
              </div>
            </div>
          )}
        </div>

        {/* ── Section 3: Notes ───────────────────────────────────────── */}
        <div className="px-5 py-5 grid grid-cols-2 gap-4">
          <p className="tbl-lbl col-span-2 mb-0">Notes</p>
          <div>
            <label className="field-label">Customer Notes <span className="normal-case">(shown on invoice)</span></label>
            <textarea
              value={form.notes ?? ''}
              onChange={e => set('notes', e.target.value || null)}
              rows={3}
              placeholder="Payment terms, thank you note, etc."
              className="w-full border border-rule bg-paper px-3 py-2 text-sm text-ink focus:outline-none focus:border-ink resize-none"
            />
          </div>
          <div>
            <label className="field-label">Internal Notes <span className="normal-case">(not shown on invoice)</span></label>
            <textarea
              value={internalNotes}
              onChange={e => setInternalNotes(e.target.value)}
              rows={3}
              placeholder="Internal reminders, context, etc."
              className="w-full border border-rule bg-paper px-3 py-2 text-sm text-ink focus:outline-none focus:border-ink resize-none"
            />
          </div>
        </div>

        {/* ── Section 4: Payment Schedule ────────────────────────────── */}
        <div className="px-5 py-5">
          <div className="flex items-center gap-3 mb-3">
            <p className="tbl-lbl">Payment Schedule</p>
            <input
              type="checkbox"
              id="schedule-toggle"
              checked={scheduleEnabled}
              onChange={e => {
                setScheduleEnabled(e.target.checked)
                if (e.target.checked && !form.payment_schedule?.length) addInstalment()
              }}
              className="w-3.5 h-3.5 accent-ink"
            />
            <label htmlFor="schedule-toggle" className="font-mono text-xs text-muted cursor-pointer">
              Enable instalment schedule
            </label>
          </div>

          {scheduleEnabled && (
            <div>
              <div className="border border-rule overflow-hidden mb-2">
                <table className="w-full">
                  <thead>
                    <tr className="bg-cream border-b border-rule">
                      <th className="tbl-lbl text-left px-3 py-2">Label</th>
                      <th className="tbl-lbl text-right px-3 py-2 w-20">%</th>
                      <th className="tbl-lbl text-left px-3 py-2 w-36">Due Date</th>
                      <th className="tbl-lbl text-center px-3 py-2 w-16">Paid</th>
                      <th className="w-8 px-2 py-2" />
                    </tr>
                  </thead>
                  <tbody>
                    {(form.payment_schedule ?? []).map((inst, idx) => (
                      <tr key={idx} className="border-b border-rule last:border-0">
                        <td className="px-3 py-1.5">
                          <input
                            type="text"
                            value={inst.label}
                            onChange={e => updateInstalment(idx, 'label', e.target.value)}
                            className="w-full border-0 bg-transparent text-sm text-ink focus:outline-none"
                          />
                        </td>
                        <td className="px-3 py-1.5">
                          <input
                            type="number"
                            value={inst.pct}
                            onChange={e => updateInstalment(idx, 'pct', parseFloat(e.target.value) || 0)}
                            min="0" max="100"
                            className="w-full border-0 bg-transparent text-sm text-right font-mono text-ink focus:outline-none"
                          />
                        </td>
                        <td className="px-3 py-1.5">
                          <input
                            type="date"
                            value={inst.dueDate}
                            onChange={e => updateInstalment(idx, 'dueDate', e.target.value)}
                            className="border-0 bg-transparent text-sm font-mono text-ink focus:outline-none"
                          />
                        </td>
                        <td className="px-3 py-1.5 text-center">
                          <input
                            type="checkbox"
                            checked={inst.paid}
                            onChange={e => updateInstalment(idx, 'paid', e.target.checked)}
                            className="accent-ink"
                          />
                        </td>
                        <td className="px-2 py-1.5">
                          <button
                            onClick={() => removeInstalment(idx)}
                            className="text-muted hover:text-red-500 transition-colors"
                          >
                            <Trash2 size={12} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <button
                onClick={addInstalment}
                className="flex items-center gap-1 font-mono text-xs text-muted hover:text-ink transition-colors"
              >
                <Plus size={11} /> Add instalment
              </button>
              {(() => {
                const total = (form.payment_schedule ?? []).reduce((t, i) => t + i.pct, 0)
                return total !== 100 && total > 0 ? (
                  <p className="font-mono text-xs text-ac-amber mt-2">
                    Instalments sum to {total}% (should be 100%)
                  </p>
                ) : null
              })()}
            </div>
          )}
        </div>

      </div>
    </Modal>
  )
}
