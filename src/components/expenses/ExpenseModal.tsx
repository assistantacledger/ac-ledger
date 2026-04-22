'use client'

import { useState, useEffect, useRef } from 'react'
import { Plus, Trash2, Upload, X, FileText, ImageIcon } from 'lucide-react'
import { sb } from '@/lib/supabase'
import { Modal } from '@/components/ui/Modal'
import { cn, fmt, todayISO } from '@/lib/format'
import type { Expense, ExpenseInsert, ExpenseStatus, Entity, ExpenseLineItem, BankDetails } from '@/types'
import { ENTITIES } from '@/types'
import { useEmployeeProfiles } from '@/hooks/useEmployeeProfiles'

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
  prefillEmployee?: string
  prefillBank?: BankDetails
  defaultValues?: Partial<ExpenseInsert>
  onSave: (data: ExpenseInsert) => Promise<void>
}

export function ExpenseModal({ isOpen, onClose, expense, prefillEmployee, prefillBank, defaultValues, onSave }: ExpenseModalProps) {
  const [form, setForm] = useState<ExpenseInsert>(emptyForm)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [bankAutoFilled, setBankAutoFilled] = useState(false)
  const [receiptUploading, setReceiptUploading] = useState(false)
  const [receiptUrls, setReceiptUrls] = useState<string[]>([])
  const receiptInputRef = useRef<HTMLInputElement>(null)
  const { profiles, saveProfile, getProfile } = useEmployeeProfiles()

  useEffect(() => {
    if (isOpen) {
      if (expense) {
        setForm(fromExpense(expense))
        setReceiptUrls(expense.receipt_urls ?? [])
      } else {
        const base = emptyForm()
        if (prefillEmployee) base.employee = prefillEmployee
        if (prefillBank) base.bank_details = prefillBank
        if (defaultValues) Object.assign(base, defaultValues)
        setForm(base)
        setReceiptUrls([])
      }
      setError(null)
      setSaving(false)
      setBankAutoFilled(!!prefillBank)
    }
  }, [isOpen, expense, prefillEmployee, prefillBank])

  function handleEmployeeBlur(name: string) {
    if (expense) return // don't auto-fill when editing existing
    const profile = getProfile(name)
    if (profile) {
      setForm(f => ({
        ...f,
        bank_details: {
          accName: profile.accName,
          bankName: profile.bankName,
          sortCode: profile.sortCode,
          accNum: profile.accNum,
          iban: profile.iban,
          swift: profile.swift,
          invCompany: profile.invCompany,
          invAddr: profile.invAddr,
        },
      }))
      setBankAutoFilled(true)
    } else {
      setBankAutoFilled(false)
    }
  }

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

  async function handleReceiptUpload(file: File) {
    if (!file.type.match(/^(image\/(jpeg|png|gif|webp)|application\/pdf)$/)) return
    setReceiptUploading(true)
    try {
      const safe = file.name.replace(/[^a-zA-Z0-9._-]/g, '_')
      const path = `receipts/${Date.now()}-${safe}`
      const { error: uploadError } = await sb.storage.from('invoices').upload(path, file, { upsert: false })
      if (uploadError) throw uploadError
      const { data } = sb.storage.from('invoices').getPublicUrl(path)
      setReceiptUrls(prev => [...prev, data.publicUrl])
    } catch (e) {
      setError(`Receipt upload failed: ${String(e)}`)
    } finally {
      setReceiptUploading(false)
      if (receiptInputRef.current) receiptInputRef.current.value = ''
    }
  }

  function removeReceipt(url: string) {
    setReceiptUrls(prev => prev.filter(u => u !== url))
  }

  async function handleSave() {
    if (!form.employee.trim()) { setError('Employee name is required'); return }
    setError(null)
    setSaving(true)
    try {
      const data = { ...form, total: lineTotal || form.total, receipt_urls: receiptUrls.length ? receiptUrls : null }
      await onSave(data)
      // Save/update employee profile with current bank details
      if (form.employee.trim() && form.bank_details) {
        saveProfile(form.employee.trim(), form.bank_details)
      }
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
            <input
              type="text"
              list="employee-profiles"
              value={form.employee}
              onChange={e => set('employee', e.target.value)}
              onBlur={e => handleEmployeeBlur(e.target.value)}
              placeholder="Full name"
              className="w-full border border-rule bg-paper px-3 py-2 text-sm text-ink focus:outline-none focus:border-ink"
            />
            <datalist id="employee-profiles">
              {profiles.map(p => <option key={p.id} value={p.name} />)}
            </datalist>
            {bankAutoFilled && (
              <p className="font-mono text-[10px] text-ac-green mt-1">
                Bank details auto-filled from saved profile
              </p>
            )}
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

        {/* Receipts */}
        <div className="px-5 py-5">
          <div className="flex items-center justify-between mb-3">
            <p className="tbl-lbl">Receipts</p>
            <div className="flex items-center gap-2">
              {receiptUploading && <span className="font-mono text-[10px] text-muted">Uploading…</span>}
              <button
                type="button"
                onClick={() => receiptInputRef.current?.click()}
                disabled={receiptUploading}
                className="flex items-center gap-1.5 font-mono text-xs text-muted hover:text-ink transition-colors disabled:opacity-50"
              >
                <Upload size={11} /> Upload
              </button>
            </div>
          </div>
          <input
            ref={receiptInputRef}
            type="file"
            accept="image/jpeg,image/png,image/gif,image/webp,application/pdf"
            className="hidden"
            onChange={e => { const f = e.target.files?.[0]; if (f) handleReceiptUpload(f) }}
          />
          {receiptUrls.length === 0 ? (
            <div
              className="border border-dashed border-rule flex items-center justify-center py-6 gap-2 cursor-pointer hover:border-muted transition-colors"
              onClick={() => receiptInputRef.current?.click()}
            >
              <Upload size={14} className="text-muted" />
              <span className="font-mono text-xs text-muted">Upload receipts (JPG, PNG, PDF)</span>
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              {receiptUrls.map((url, i) => {
                const isPdf = url.includes('.pdf') || url.toLowerCase().includes('pdf')
                return (
                  <div key={i} className="relative group border border-rule bg-cream w-20 h-20 flex items-center justify-center overflow-hidden">
                    {isPdf ? (
                      <a href={url} target="_blank" rel="noopener noreferrer" className="flex flex-col items-center gap-1">
                        <FileText size={20} className="text-muted" />
                        <span className="font-mono text-[9px] text-muted">PDF</span>
                      </a>
                    ) : (
                      // eslint-disable-next-line @next/next/no-img-element
                      <a href={url} target="_blank" rel="noopener noreferrer">
                        <img src={url} alt={`Receipt ${i + 1}`} className="w-full h-full object-cover" />
                      </a>
                    )}
                    <button
                      onClick={() => removeReceipt(url)}
                      className="absolute top-0.5 right-0.5 w-4 h-4 bg-black/60 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      <X size={8} />
                    </button>
                  </div>
                )
              })}
              <button
                onClick={() => receiptInputRef.current?.click()}
                className="border border-dashed border-rule w-20 h-20 flex items-center justify-center text-muted hover:text-ink hover:border-muted transition-colors"
              >
                <Plus size={16} />
              </button>
            </div>
          )}
        </div>

        {/* Bank details */}
        <div className="px-5 py-5">
          <div className="flex items-center gap-3 mb-4">
            <p className="tbl-lbl">Payment / Bank Details</p>
            {bankAutoFilled && (
              <span className="font-mono text-[10px] text-ac-green uppercase tracking-wider">Auto-filled</span>
            )}
          </div>
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
