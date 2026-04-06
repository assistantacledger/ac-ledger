'use client'

import { useState, useEffect, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import { sb } from '@/lib/supabase'
import { cn, fmt, todayISO } from '@/lib/format'
import { Plus, Trash2, CheckCircle, Printer } from 'lucide-react'
import type { Entity, InvoiceInsert, ExpenseInsert, ExpenseLineItem, LineItem, BankDetails } from '@/types'
import { ENTITIES } from '@/types'

const EXPENSE_CATEGORIES: ExpenseLineItem['category'][] = ['Meals', 'Travel', 'Accommodation', 'Equipment', 'Other']
const blankInvLine = (): LineItem => ({ description: '', qty: 1, unit: 0, total: 0 })
const blankExpLine = (): ExpenseLineItem => ({ description: '', category: 'Other', amount: 0 })
const blankBank = (): BankDetails => ({ accName: '', sortCode: '', accNum: '', bankName: '', iban: '', swift: '', invCompany: '', invAddr: '' })

function SupplierFormInner() {
  const params = useSearchParams()
  const projectParam = params.get('project') ?? ''
  const entityParam = params.get('entity') ?? ''

  // Map entity param to Entity type
  const defaultEntity: Entity = ENTITIES.find(
    e => e.toLowerCase().replace(/\s/g, '') === entityParam.toLowerCase().replace(/\s/g, '')
  ) ?? 'Actually Creative'

  const locked = !!projectParam && !!entityParam

  type Mode = 'invoice' | 'expense'
  const [mode, setMode] = useState<Mode>('invoice')
  const [submitted, setSubmitted] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [submittedRef, setSubmittedRef] = useState('')
  const [submittedTotal, setSubmittedTotal] = useState(0)
  const [submittedCurrency, setSubmittedCurrency] = useState('£')

  // Invoice form
  const [invForm, setInvForm] = useState<{
    party: string; ref: string; entity: Entity; currency: string; due: string; notes: string; lines: LineItem[]
  }>({
    party: '', ref: '', entity: defaultEntity, currency: '£', due: '', notes: '', lines: [blankInvLine()],
  })

  // Expense form
  const [expForm, setExpForm] = useState<{
    employee: string; entity: Entity; date: string; notes: string; lines: ExpenseLineItem[]; bank: BankDetails
  }>({
    employee: '', entity: defaultEntity, date: todayISO(), notes: '', lines: [blankExpLine()], bank: blankBank(),
  })

  function setInv<K extends keyof typeof invForm>(key: K, val: typeof invForm[K]) {
    setInvForm(f => ({ ...f, [key]: val }))
  }
  function setExp<K extends keyof typeof expForm>(key: K, val: typeof expForm[K]) {
    setExpForm(f => ({ ...f, [key]: val }))
  }

  // Invoice line helpers
  function updateInvLine(idx: number, key: keyof LineItem, raw: string) {
    const lines = [...invForm.lines]
    if (key === 'description') { lines[idx] = { ...lines[idx], description: raw } }
    else {
      const num = parseFloat(raw) || 0
      lines[idx] = { ...lines[idx], [key]: num }
      if (key === 'qty' || key === 'unit') lines[idx].total = parseFloat((lines[idx].qty * lines[idx].unit).toFixed(2))
    }
    setInv('lines', lines)
  }

  // Expense line helpers
  function updateExpLine(idx: number, key: keyof ExpenseLineItem, val: string) {
    const lines = [...expForm.lines]
    if (key === 'amount') lines[idx] = { ...lines[idx], amount: parseFloat(val) || 0 }
    else lines[idx] = { ...lines[idx], [key]: val }
    setExp('lines', lines)
  }

  function setBank<K extends keyof BankDetails>(key: K, val: string) {
    setExp('bank', { ...expForm.bank, [key]: val })
  }

  const invTotal = invForm.lines.reduce((t, l) => t + l.total, 0)
  const expTotal = expForm.lines.reduce((t, l) => t + Number(l.amount), 0)

  async function handleSubmitInvoice(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    if (!invForm.party.trim()) { setError('Your company / name is required'); return }
    if (!invForm.ref.trim()) { setError('Invoice reference is required'); return }
    if (invTotal <= 0) { setError('At least one line item with an amount is required'); return }

    setSubmitting(true)
    try {
      const data: InvoiceInsert = {
        type: 'payable',
        party: invForm.party,
        ref: invForm.ref,
        entity: locked ? defaultEntity : invForm.entity,
        currency: invForm.currency,
        amount: invTotal,
        due: invForm.due || null,
        status: 'draft',
        notes: invForm.notes || null,
        internal: null,
        line_items: invForm.lines,
        project_code: projectParam || null,
        project_name: null,
        recurring: false,
        pdf_url: null,
        payment_schedule: null,
      }
      const { error } = await sb.from('invoices').insert(data)
      if (error) throw error
      setSubmittedRef(invForm.ref)
      setSubmittedTotal(invTotal)
      setSubmittedCurrency(invForm.currency)
      setSubmitted(true)
    } catch (e) {
      setError(String(e))
    } finally {
      setSubmitting(false)
    }
  }

  async function handleSubmitExpense(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    if (!expForm.employee.trim()) { setError('Your name is required'); return }
    if (expTotal <= 0) { setError('At least one expense item is required'); return }

    setSubmitting(true)
    try {
      const data: ExpenseInsert = {
        employee: expForm.employee,
        entity: locked ? defaultEntity : expForm.entity,
        date: expForm.date,
        status: 'submitted',
        project_code: projectParam || null,
        project_name: null,
        notes: expForm.notes || null,
        line_items: expForm.lines,
        receipt_urls: null,
        bank_details: expForm.bank,
        total: expTotal,
      }
      const { error } = await sb.from('expenses').insert(data)
      if (error) throw error
      setSubmittedRef(`EXP · ${expForm.employee}`)
      setSubmittedTotal(expTotal)
      setSubmittedCurrency('£')
      setSubmitted(true)
    } catch (e) {
      setError(String(e))
    } finally {
      setSubmitting(false)
    }
  }

  if (submitted) {
    const receiptDate = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
    return (
      <div className="min-h-screen bg-paper flex items-center justify-center p-6">
        <div className="max-w-sm w-full">
          {/* Receipt card */}
          <div id="supplier-receipt" className="bg-white border border-rule p-8 mb-4" style={{ borderTopWidth: 2, borderTopColor: '#1a1a1a' }}>
            <div className="flex items-center gap-3 mb-6">
              <div className="w-10 h-10 bg-ac-green-pale flex items-center justify-center">
                <CheckCircle size={20} className="text-ac-green" />
              </div>
              <div>
                <p className="font-sans font-semibold text-sm text-ink">Submitted</p>
                <p className="font-mono text-[10px] text-muted uppercase tracking-wider">{receiptDate}</p>
              </div>
            </div>
            <div className="space-y-2 border-t border-rule pt-4">
              <div className="flex justify-between">
                <span className="font-mono text-xs text-muted uppercase tracking-wider">Type</span>
                <span className="font-mono text-xs text-ink uppercase">{mode === 'invoice' ? 'Invoice' : 'Expense Claim'}</span>
              </div>
              <div className="flex justify-between">
                <span className="font-mono text-xs text-muted uppercase tracking-wider">Ref</span>
                <span className="font-mono text-xs text-ink">{submittedRef}</span>
              </div>
              {projectParam && (
                <div className="flex justify-between">
                  <span className="font-mono text-xs text-muted uppercase tracking-wider">Project</span>
                  <span className="font-mono text-xs text-ink">{projectParam}</span>
                </div>
              )}
              <div className="flex justify-between border-t border-rule pt-2 mt-2">
                <span className="font-mono text-xs font-semibold text-muted uppercase tracking-wider">Total</span>
                <span className="font-mono text-sm font-semibold text-ink">{fmt(submittedTotal, submittedCurrency)}</span>
              </div>
            </div>
            <p className="mt-6 font-mono text-[10px] text-muted text-center uppercase tracking-wider">
              AC Ledger · Your submission is under review
            </p>
          </div>
          <div className="flex gap-3">
            <button
              onClick={() => window.print()}
              className="flex-1 flex items-center justify-center gap-2 py-2.5 border border-rule font-mono text-xs uppercase tracking-wider text-muted hover:text-ink hover:border-ink transition-colors"
            >
              <Printer size={12} /> Print Receipt
            </button>
            <button
              onClick={() => {
                setSubmitted(false)
                setInvForm({ party: '', ref: '', entity: defaultEntity, currency: '£', due: '', notes: '', lines: [blankInvLine()] })
                setExpForm({ employee: '', entity: defaultEntity, date: todayISO(), notes: '', lines: [blankExpLine()], bank: blankBank() })
              }}
              className="flex-1 py-2.5 font-mono text-xs uppercase tracking-wider bg-ink text-white hover:bg-[#333] transition-colors"
            >
              Submit another
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-paper">
      {/* Header */}
      <header className="bg-sidebar border-b border-[#2a2a2a]">
        <div className="max-w-2xl mx-auto px-6 py-4 flex items-center justify-between">
          <div>
            <h1 className="font-sans font-semibold text-white text-sm tracking-tight">AC Ledger</h1>
            <p className="font-mono text-[10px] uppercase tracking-widest text-[#666] mt-0.5">Supplier Portal</p>
          </div>
          {(projectParam || entityParam) && (
            <div className="text-right">
              {projectParam && <p className="font-mono text-[10px] text-[#888] uppercase tracking-wider">Project: {projectParam}</p>}
              {entityParam && <p className="font-mono text-[10px] text-[#888] uppercase tracking-wider">{defaultEntity}</p>}
            </div>
          )}
        </div>
      </header>

      <div className="max-w-2xl mx-auto px-6 py-8">
        {/* Mode toggle */}
        <div className="flex border border-rule mb-6 overflow-hidden" style={{ borderTopWidth: 2, borderTopColor: '#1a1a1a' }}>
          {(['invoice', 'expense'] as Mode[]).map(m => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={cn(
                'flex-1 py-2.5 font-mono text-xs uppercase tracking-wider transition-colors',
                mode === m ? 'bg-ink text-white' : 'bg-cream text-muted hover:text-ink'
              )}
            >
              Submit {m === 'invoice' ? 'Invoice' : 'Expense Claim'}
            </button>
          ))}
        </div>

        {/* ── Invoice form ─────────────────────────────────────────── */}
        {mode === 'invoice' && (
          <form onSubmit={handleSubmitInvoice} className="space-y-5">
            <div className="s-section">
              <p className="tbl-lbl mb-4">Your Details</p>
              <div className="grid grid-cols-2 gap-4">
                <div className="col-span-2">
                  <label className="field-label">Your Company / Name *</label>
                  <input type="text" value={invForm.party} onChange={e => setInv('party', e.target.value)} required
                    placeholder="Supplier company or your name"
                    className="w-full border border-rule bg-white px-3 py-2 text-sm text-ink focus:outline-none focus:border-ink" />
                </div>
                <div>
                  <label className="field-label">Invoice Reference *</label>
                  <input type="text" value={invForm.ref} onChange={e => setInv('ref', e.target.value)} required
                    placeholder="Your invoice number"
                    className="w-full border border-rule bg-white px-3 py-2 text-sm font-mono text-ink focus:outline-none focus:border-ink" />
                </div>
                <div>
                  <label className="field-label">Currency</label>
                  <select value={invForm.currency} onChange={e => setInv('currency', e.target.value)}
                    className="w-full border border-rule bg-white px-3 py-2 text-sm text-ink focus:outline-none font-mono">
                    {['£', '$', '€'].map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
                {!locked && (
                  <div>
                    <label className="field-label">Invoice For</label>
                    <select value={invForm.entity} onChange={e => setInv('entity', e.target.value as Entity)}
                      className="w-full border border-rule bg-white px-3 py-2 text-sm text-ink focus:outline-none">
                      {ENTITIES.map(e => <option key={e} value={e}>{e}</option>)}
                    </select>
                  </div>
                )}
                <div>
                  <label className="field-label">Payment Due Date</label>
                  <input type="date" value={invForm.due} onChange={e => setInv('due', e.target.value)}
                    className="w-full border border-rule bg-white px-3 py-2 text-sm text-ink focus:outline-none focus:border-ink" />
                </div>
              </div>
            </div>

            <div className="s-section">
              <div className="flex items-center justify-between mb-3">
                <p className="tbl-lbl">Line Items *</p>
                <button type="button" onClick={() => setInv('lines', [...invForm.lines, blankInvLine()])}
                  className="flex items-center gap-1 font-mono text-xs text-muted hover:text-ink transition-colors">
                  <Plus size={11} /> Add line
                </button>
              </div>
              <div className="border border-rule overflow-hidden">
                <table className="w-full">
                  <thead>
                    <tr className="bg-cream border-b border-rule">
                      <th className="tbl-lbl text-left px-3 py-2">Description</th>
                      <th className="tbl-lbl text-right px-3 py-2 w-14">Qty</th>
                      <th className="tbl-lbl text-right px-3 py-2 w-24">Unit Price</th>
                      <th className="tbl-lbl text-right px-3 py-2 w-24">Total</th>
                      <th className="w-8 px-2 py-2" />
                    </tr>
                  </thead>
                  <tbody>
                    {invForm.lines.map((line, idx) => (
                      <tr key={idx} className="border-b border-rule last:border-0">
                        <td className="px-3 py-2">
                          <input type="text" value={line.description} onChange={e => updateInvLine(idx, 'description', e.target.value)}
                            placeholder="Service or product" className="w-full border-0 bg-transparent text-sm text-ink focus:outline-none placeholder:text-muted" />
                        </td>
                        <td className="px-3 py-2">
                          <input type="number" value={line.qty} onChange={e => updateInvLine(idx, 'qty', e.target.value)} min="0"
                            className="w-full border-0 bg-transparent text-sm text-right text-ink focus:outline-none" />
                        </td>
                        <td className="px-3 py-2">
                          <input type="number" value={line.unit} onChange={e => updateInvLine(idx, 'unit', e.target.value)} min="0" step="0.01"
                            className="w-full border-0 bg-transparent text-sm text-right font-mono text-ink focus:outline-none" />
                        </td>
                        <td className="px-3 py-2 text-right font-mono text-sm">{fmt(line.total, invForm.currency)}</td>
                        <td className="px-2 py-2">
                          {invForm.lines.length > 1 && (
                            <button type="button" onClick={() => setInv('lines', invForm.lines.filter((_, i) => i !== idx))}
                              className="text-muted hover:text-red-500 transition-colors"><Trash2 size={12} /></button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="mt-3 flex justify-end gap-4">
                <span className="font-mono text-xs text-muted uppercase tracking-wider">Total</span>
                <span className="font-mono text-sm font-semibold text-ink">{fmt(invTotal, invForm.currency)}</span>
              </div>
            </div>

            <div className="s-section">
              <label className="field-label">Notes / Payment Terms</label>
              <textarea value={invForm.notes} onChange={e => setInv('notes', e.target.value)} rows={3}
                placeholder="Payment details, bank info, any notes…"
                className="w-full border border-rule bg-white px-3 py-2 text-sm text-ink focus:outline-none focus:border-ink resize-none" />
            </div>

            {error && <p className="font-mono text-xs text-red-600">{error}</p>}
            <button type="submit" disabled={submitting}
              className="w-full py-3 bg-ink text-white font-mono text-sm uppercase tracking-wider hover:bg-[#333] transition-colors disabled:opacity-60">
              {submitting ? 'Submitting…' : 'Submit Invoice'}
            </button>
          </form>
        )}

        {/* ── Expense form ─────────────────────────────────────────── */}
        {mode === 'expense' && (
          <form onSubmit={handleSubmitExpense} className="space-y-5">
            <div className="s-section">
              <p className="tbl-lbl mb-4">Your Details</p>
              <div className="grid grid-cols-2 gap-4">
                <div className="col-span-2">
                  <label className="field-label">Your Full Name *</label>
                  <input type="text" value={expForm.employee} onChange={e => setExp('employee', e.target.value)} required
                    className="w-full border border-rule bg-white px-3 py-2 text-sm text-ink focus:outline-none focus:border-ink" />
                </div>
                <div>
                  <label className="field-label">Date of Expenses</label>
                  <input type="date" value={expForm.date} onChange={e => setExp('date', e.target.value)}
                    className="w-full border border-rule bg-white px-3 py-2 text-sm text-ink focus:outline-none focus:border-ink" />
                </div>
                {!locked && (
                  <div>
                    <label className="field-label">For Entity</label>
                    <select value={expForm.entity} onChange={e => setExp('entity', e.target.value as Entity)}
                      className="w-full border border-rule bg-white px-3 py-2 text-sm text-ink focus:outline-none">
                      {ENTITIES.map(e => <option key={e} value={e}>{e}</option>)}
                    </select>
                  </div>
                )}
              </div>
            </div>

            <div className="s-section">
              <div className="flex items-center justify-between mb-3">
                <p className="tbl-lbl">Expense Items *</p>
                <button type="button" onClick={() => setExp('lines', [...expForm.lines, blankExpLine()])}
                  className="flex items-center gap-1 font-mono text-xs text-muted hover:text-ink transition-colors">
                  <Plus size={11} /> Add item
                </button>
              </div>
              <div className="border border-rule overflow-hidden">
                <table className="w-full">
                  <thead>
                    <tr className="bg-cream border-b border-rule">
                      <th className="tbl-lbl text-left px-3 py-2">Description</th>
                      <th className="tbl-lbl text-left px-3 py-2 w-32">Category</th>
                      <th className="tbl-lbl text-right px-3 py-2 w-24">Amount</th>
                      <th className="w-8 px-2 py-2" />
                    </tr>
                  </thead>
                  <tbody>
                    {expForm.lines.map((line, idx) => (
                      <tr key={idx} className="border-b border-rule last:border-0">
                        <td className="px-3 py-2">
                          <input type="text" value={line.description} onChange={e => updateExpLine(idx, 'description', e.target.value)}
                            placeholder="What was purchased?" className="w-full border-0 bg-transparent text-sm text-ink focus:outline-none placeholder:text-muted" />
                        </td>
                        <td className="px-3 py-2">
                          <select value={line.category} onChange={e => updateExpLine(idx, 'category', e.target.value)}
                            className="w-full border-0 bg-transparent text-xs font-mono text-ink focus:outline-none">
                            {EXPENSE_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                          </select>
                        </td>
                        <td className="px-3 py-2">
                          <input type="number" value={line.amount} onChange={e => updateExpLine(idx, 'amount', e.target.value)} min="0" step="0.01"
                            className="w-full border-0 bg-transparent text-sm text-right font-mono text-ink focus:outline-none" />
                        </td>
                        <td className="px-2 py-2">
                          {expForm.lines.length > 1 && (
                            <button type="button" onClick={() => setExp('lines', expForm.lines.filter((_, i) => i !== idx))}
                              className="text-muted hover:text-red-500 transition-colors"><Trash2 size={12} /></button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="mt-3 flex justify-end gap-4">
                <span className="font-mono text-xs text-muted uppercase tracking-wider">Total</span>
                <span className="font-mono text-sm font-semibold text-ink">{fmt(expTotal)}</span>
              </div>
            </div>

            <div className="s-section">
              <p className="tbl-lbl mb-4">Bank Details for Reimbursement</p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="field-label">Account Name</label>
                  <input type="text" value={expForm.bank.accName} onChange={e => setBank('accName', e.target.value)}
                    className="w-full border border-rule bg-white px-3 py-2 text-sm text-ink focus:outline-none focus:border-ink" />
                </div>
                <div>
                  <label className="field-label">Bank Name</label>
                  <input type="text" value={expForm.bank.bankName ?? ''} onChange={e => setBank('bankName', e.target.value)}
                    className="w-full border border-rule bg-white px-3 py-2 text-sm text-ink focus:outline-none focus:border-ink" />
                </div>
                <div>
                  <label className="field-label">Sort Code</label>
                  <input type="text" value={expForm.bank.sortCode} onChange={e => setBank('sortCode', e.target.value)}
                    placeholder="00-00-00"
                    className="w-full border border-rule bg-white px-3 py-2 text-sm font-mono text-ink focus:outline-none focus:border-ink" />
                </div>
                <div>
                  <label className="field-label">Account Number</label>
                  <input type="text" value={expForm.bank.accNum} onChange={e => setBank('accNum', e.target.value)}
                    placeholder="12345678"
                    className="w-full border border-rule bg-white px-3 py-2 text-sm font-mono text-ink focus:outline-none focus:border-ink" />
                </div>
                <div>
                  <label className="field-label">IBAN <span className="normal-case">(optional)</span></label>
                  <input type="text" value={expForm.bank.iban ?? ''} onChange={e => setBank('iban', e.target.value)}
                    className="w-full border border-rule bg-white px-3 py-2 text-sm font-mono text-ink focus:outline-none focus:border-ink" />
                </div>
                <div>
                  <label className="field-label">Notes</label>
                  <textarea value={expForm.notes} onChange={e => setExp('notes', e.target.value)} rows={2}
                    className="w-full border border-rule bg-white px-3 py-2 text-sm text-ink focus:outline-none focus:border-ink resize-none" />
                </div>
              </div>
            </div>

            {error && <p className="font-mono text-xs text-red-600">{error}</p>}
            <button type="submit" disabled={submitting}
              className="w-full py-3 bg-ink text-white font-mono text-sm uppercase tracking-wider hover:bg-[#333] transition-colors disabled:opacity-60">
              {submitting ? 'Submitting…' : 'Submit Expense Claim'}
            </button>
          </form>
        )}

        <p className="mt-8 text-center font-mono text-[10px] text-muted uppercase tracking-wider">
          AC Ledger · Supplier Portal · Powered by Actually Creative
        </p>
      </div>
    </div>
  )
}

export default function SupplierPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-paper flex items-center justify-center">
        <div className="w-5 h-5 border-2 border-ink border-t-transparent animate-spin" />
      </div>
    }>
      <SupplierFormInner />
    </Suspense>
  )
}
