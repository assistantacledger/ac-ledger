'use client'

import { useState, useEffect } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { Modal } from '@/components/ui/Modal'
import { cn, fmt, todayISO } from '@/lib/format'
import type { Expense, ExpenseInsert, ExpenseStatus, Entity, ExpenseLineItem, BankDetails } from '@/types'
import { ENTITIES } from '@/types'

const CATEGORIES: ExpenseLineItem['category'][] = ['Meals', 'Travel', 'Accommodation', 'Equipment', 'Other']
const STATUSES: ExpenseStatus[] = ['submitted', 'approved', 'paid']

const blankLine = (): ExpenseLineItem => ({ description: '', category: 'Other', amount: 0 })
const blankBank = (): BankDetails => ({ accName: '', sortCode: '', accNum: '', bankName: '', iban: '', swift: '', invCompany: '', invAddr: '' })

function emptyForm(): ExpenseInsert {
  return {
    employee: '',
    date: todayISO(),
    entity: 'Actually Creative',
    status: 'submitted',
    project_code: null,
    project_name: null,
    notes: null,
    line_items: [blankLine()],
    receipt_urls: null,
    bank_details: blankBank(),
    total: 0,
  }
}

function fromExpense(exp: Expense): ExpenseInsert {
  return {
    employee: exp.employee,
    date: exp.date,
    entity: exp.entity,
    status: exp.status,
    project_code: exp.project_code,
    project_name: exp.project_name,
    notes: exp.notes,
    line_items: exp.line_items?.length ? exp.line_items : [blankLine()],
    receipt_urls: exp.receipt_urls,
    bank_details: exp.bank_details ?? blankBank(),
    total: exp.total,
  }
}

interface ExpenseModalProps {
  isOpen: boolean
  onClose: () => void
  expense?: Expense | null
  onSave: (data: ExpenseInsert) => Promise<void>
}

export function ExpenseModal({ isOpen, onClose, expense, onSave }: ExpenseModalProps) {
  const [form, setForm] = useState<ExpenseInsert>(emptyForm)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (isOpen) {
      setForm(expense ? fromExpense(expense) : emptyForm())
      setError(null)
      setSaving(false)
    }
  }, [isOpen, expense])

  const lineTotal = (form.line_items ?? []).reduce((t, l) => t + Number(l.amount), 0)

  function set<K extends keyof ExpenseInsert>(key: K, val: ExpenseInsert[K]) {
    setForm(f => ({ ...f, [key]: val }))
  }

  function setBank<K extends keyof BankDetails>(key: K, val: string) {
    setForm(f => ({ ...f, bank_details: { ...(f.bank_details ?? blankBank()), [key]: val } }))
  }

  function updateLine(idx: number, key: keyof ExpenseLineItem, val: string) {
    const lines = [...(form.line_items ?? [])]
    if (key === 'amount') {
      lines[idx] = { ...lines[idx], amount: parseFloat(val) || 0 }
    } else {
      lines[idx] = { ...lines[idx], [key]: val }
    }
    set('line_items', lines)
    set('total', parseFloat(lines.reduce((t, l) => t + Number(l.amount), 0).toFixed(2)))
  }

  function addLine() { set('line_items', [...(form.line_items ?? []), blankLine()]) }
  function removeLine(idx: number) {
    const lines = (form.line_items ?? []).filter((_, i) => i !== idx)
    set('line_items', lines)
    set('total', parseFloat(lines.reduce((t, l) => t + Number(l.amount), 0).toFixed(2)))
  }

  async function handleSave() {
    if (!form.employee.trim()) { setError('Employee name is required'); return }
    setError(null)
    setSaving(true)
    try {
      await onSave({ ...form, total: lineTotal || form.total })
      onClose()
    } catch (e) {
      setError(String(e))
    } finally {
      setSaving(false)
    }
  }

  const footer = (
    <>
      {error && <p className="text-xs font-mono text-red-600 mr-auto">{error}</p>}
      <button onClick={onClose} className="px-4 py-2 text-xs font-mono uppercase tracking-wider border border-rule text-muted hover:text-ink hover:border-ink transition-colors">
        Cancel
      </button>
      <button
        onClick={handleSave}
        disabled={saving}
        className="px-4 py-2 text-xs font-mono uppercase tracking-wider bg-ink text-white hover:bg-[#333] transition-colors disabled:opacity-50"
      >
        {saving ? 'Saving…' : expense ? 'Save Changes' : 'Submit Expense'}
      </button>
    </>
  )

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={expense ? `Edit Expense · ${expense.employee}` : 'New Expense'} size="2xl" footer={footer}>
      <div className="divide-y divide-rule">

        {/* Details */}
        <div className="px-5 py-5 grid grid-cols-2 gap-4">
          <p className="tbl-lbl col-span-2">Expense Details</p>
          <div className="col-span-2">
            <label className="field-label">Employee / Claimant</label>
            <input type="text" value={form.employee} onChange={e => set('employee', e.target.value)}
              placeholder="Full name"
              className="w-full border border-rule bg-paper px-3 py-2 text-sm text-ink focus:outline-none focus:border-ink" />
          </div>
          <div>
            <label className="field-label">Date</label>
            <input type="date" value={form.date} onChange={e => set('date', e.target.value)}
              className="w-full border border-rule bg-paper px-3 py-2 text-sm text-ink focus:outline-none focus:border-ink" />
          </div>
          <div>
            <label className="field-label">Entity</label>
            <select value={form.entity} onChange={e => set('entity', e.target.value as Entity)}
              className="w-full border border-rule bg-paper px-3 py-2 text-sm text-ink focus:outline-none focus:border-ink">
              {ENTITIES.map(e => <option key={e} value={e}>{e}</option>)}
            </select>
          </div>
          <div>
            <label className="field-label">Status</label>
            <select value={form.status} onChange={e => set('status', e.target.value as ExpenseStatus)}
              className="w-full border border-rule bg-paper px-3 py-2 text-sm text-ink focus:outline-none focus:border-ink font-mono uppercase">
              {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div>
            <label className="field-label">Project Code</label>
            <input type="text" value={form.project_code ?? ''} onChange={e => set('project_code', e.target.value || null)}
              placeholder="AC-24-001"
              className="w-full border border-rule bg-paper px-3 py-2 text-sm font-mono text-ink focus:outline-none focus:border-ink" />
          </div>
          <div className="col-span-2">
            <label className="field-label">Project Name</label>
            <input type="text" value={form.project_name ?? ''} onChange={e => set('project_name', e.target.value || null)}
              className="w-full border border-rule bg-paper px-3 py-2 text-sm text-ink focus:outline-none focus:border-ink" />
          </div>
          <div className="col-span-2">
            <label className="field-label">Notes</label>
            <textarea value={form.notes ?? ''} onChange={e => set('notes', e.target.value || null)}
              rows={2} className="w-full border border-rule bg-paper px-3 py-2 text-sm text-ink focus:outline-none focus:border-ink resize-none" />
          </div>
        </div>

        {/* Line items */}
        <div className="px-5 py-5">
          <div className="flex items-center justify-between mb-3">
            <p className="tbl-lbl">Expense Items</p>
            <button onClick={addLine} className="flex items-center gap-1 font-mono text-xs text-muted hover:text-ink transition-colors">
              <Plus size={11} /> Add item
            </button>
          </div>
          <div className="border border-rule overflow-hidden">
            <table className="w-full">
              <thead>
                <tr className="bg-cream border-b border-rule">
                  <th className="tbl-lbl text-left px-3 py-2">Description</th>
                  <th className="tbl-lbl text-left px-3 py-2 w-36">Category</th>
                  <th className="tbl-lbl text-right px-3 py-2 w-24">Amount</th>
                  <th className="w-8 px-2 py-2" />
                </tr>
              </thead>
              <tbody>
                {(form.line_items ?? []).map((line, idx) => (
                  <tr key={idx} className="border-b border-rule last:border-0">
                    <td className="px-3 py-1.5">
                      <input type="text" value={line.description} onChange={e => updateLine(idx, 'description', e.target.value)}
                        placeholder="What was purchased?"
                        className="w-full border-0 bg-transparent text-sm text-ink focus:outline-none placeholder:text-muted" />
                    </td>
                    <td className="px-3 py-1.5">
                      <select value={line.category} onChange={e => updateLine(idx, 'category', e.target.value)}
                        className="w-full border-0 bg-transparent text-xs font-mono text-ink focus:outline-none">
                        {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                      </select>
                    </td>
                    <td className="px-3 py-1.5">
                      <input type="number" value={line.amount} onChange={e => updateLine(idx, 'amount', e.target.value)}
                        min="0" step="0.01"
                        className="w-full border-0 bg-transparent text-sm text-right font-mono text-ink focus:outline-none" />
                    </td>
                    <td className="px-2 py-1.5">
                      {(form.line_items ?? []).length > 1 && (
                        <button onClick={() => removeLine(idx)} className="text-muted hover:text-red-500 transition-colors">
                          <Trash2 size={12} />
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-3 flex justify-end gap-4 items-center">
            <span className="font-mono text-xs text-muted uppercase tracking-wider">Total</span>
            <span className="font-mono text-sm font-semibold text-ink">{fmt(lineTotal)}</span>
          </div>
        </div>

        {/* Bank details */}
        <div className="px-5 py-5">
          <p className="tbl-lbl mb-4">Payment / Bank Details</p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="field-label">Account Name</label>
              <input type="text" value={form.bank_details?.accName ?? ''} onChange={e => setBank('accName', e.target.value)}
                className="w-full border border-rule bg-paper px-3 py-2 text-sm text-ink focus:outline-none focus:border-ink" />
            </div>
            <div>
              <label className="field-label">Bank Name</label>
              <input type="text" value={form.bank_details?.bankName ?? ''} onChange={e => setBank('bankName', e.target.value)}
                className="w-full border border-rule bg-paper px-3 py-2 text-sm text-ink focus:outline-none focus:border-ink" />
            </div>
            <div>
              <label className="field-label">Sort Code</label>
              <input type="text" value={form.bank_details?.sortCode ?? ''} onChange={e => setBank('sortCode', e.target.value)}
                placeholder="00-00-00"
                className="w-full border border-rule bg-paper px-3 py-2 text-sm font-mono text-ink focus:outline-none focus:border-ink" />
            </div>
            <div>
              <label className="field-label">Account Number</label>
              <input type="text" value={form.bank_details?.accNum ?? ''} onChange={e => setBank('accNum', e.target.value)}
                placeholder="12345678"
                className="w-full border border-rule bg-paper px-3 py-2 text-sm font-mono text-ink focus:outline-none focus:border-ink" />
            </div>
            <div>
              <label className="field-label">IBAN</label>
              <input type="text" value={form.bank_details?.iban ?? ''} onChange={e => setBank('iban', e.target.value)}
                className="w-full border border-rule bg-paper px-3 py-2 text-sm font-mono text-ink focus:outline-none focus:border-ink" />
            </div>
            <div>
              <label className="field-label">SWIFT / BIC</label>
              <input type="text" value={form.bank_details?.swift ?? ''} onChange={e => setBank('swift', e.target.value)}
                className="w-full border border-rule bg-paper px-3 py-2 text-sm font-mono text-ink focus:outline-none focus:border-ink" />
            </div>
            <div>
              <label className="field-label">Invoice Company (if different)</label>
              <input type="text" value={form.bank_details?.invCompany ?? ''} onChange={e => setBank('invCompany', e.target.value)}
                className="w-full border border-rule bg-paper px-3 py-2 text-sm text-ink focus:outline-none focus:border-ink" />
            </div>
            <div>
              <label className="field-label">Invoice Address</label>
              <input type="text" value={form.bank_details?.invAddr ?? ''} onChange={e => setBank('invAddr', e.target.value)}
                className="w-full border border-rule bg-paper px-3 py-2 text-sm text-ink focus:outline-none focus:border-ink" />
            </div>
          </div>
        </div>

      </div>
    </Modal>
  )
}
