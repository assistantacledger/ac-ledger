'use client'

import { useState, useEffect, useRef, useMemo } from 'react'
import { Header } from '@/components/layout/Header'
import { InvoicePDF } from '@/components/invoices/InvoicePDF'
import { Modal } from '@/components/ui/Modal'
import { useInvoices } from '@/hooks/useInvoices'
import { useTemplates } from '@/hooks/useTemplates'
import { cn, fmt, getNextRef, todayISO } from '@/lib/format'
import { Plus, Trash2, RefreshCw, Printer, Save, LayoutTemplate, Link, Copy, Check, Receipt } from 'lucide-react'
import type { Invoice, InvoiceInsert, InvoiceStatus, Entity, LineItem, CompanySettings, Expense } from '@/types'
import { ENTITIES, ENTITY_STORAGE_KEYS } from '@/types'
import { useProjectCodes } from '@/hooks/useProjectCodes'
import { ProjectCodeSelect } from '@/components/ui/ProjectCodeSelect'
import { useExpenses } from '@/hooks/useExpenses'
import { ExpensePickerModal } from '@/components/expenses/ExpensePickerModal'

const STATUSES: InvoiceStatus[] = ['draft', 'pending', 'submitted', 'approved', 'sent', 'overdue', 'part-paid', 'paid']
const CURRENCIES = ['£', '$', '€']

const blankLine = (): LineItem => ({ description: '', qty: 1, unit: 0, total: 0 })

function emptyInvoice(): InvoiceInsert {
  return {
    type: 'receivable',
    party: '',
    ref: '',
    amount: 0,
    currency: '£',
    due: null,
    status: 'draft',
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

function getCompanySettings(entity: Entity): CompanySettings | null {
  try {
    const key = ENTITY_STORAGE_KEYS[entity]
    const raw = localStorage.getItem(key)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

export default function GeneratePage() {
  const { invoices, createInvoice, updateInvoice } = useInvoices()
  const { expenses, updateExpense: updateExpenseRecord } = useExpenses()
  const { saveTemplate } = useTemplates()
  const projectCodes = useProjectCodes(invoices)
  const [form, setForm] = useState<InvoiceInsert>(emptyInvoice)
  const [company, setCompany] = useState<CompanySettings | null>(null)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [savedInvoiceId, setSavedInvoiceId] = useState<string | null>(null)
  const [assignProject, setAssignProject] = useState<{ code: string; name: string } | null>(null)
  const [assigning, setAssigning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const previewRef = useRef<HTMLDivElement>(null)
  const [previewScale, setPreviewScale] = useState(0.5)
  const [templateModalOpen, setTemplateModalOpen] = useState(false)
  const [templateName, setTemplateName] = useState('')
  const [templateSaved, setTemplateSaved] = useState(false)
  const [expensePicker, setExpensePicker] = useState(false)
  const [pendingExpenseIds, setPendingExpenseIds] = useState<string[]>([])

  // Client submission link state
  const [linkEntity, setLinkEntity] = useState<Entity>('Actually Creative')
  const [linkProject, setLinkProject] = useState('')
  const [linkCopied, setLinkCopied] = useState(false)

  // Load company settings when entity changes
  useEffect(() => {
    setCompany(getCompanySettings(form.entity as Entity))
  }, [form.entity])

  // Load pending template draft on mount
  useEffect(() => {
    try {
      const raw = localStorage.getItem('ledger_draft_invoice')
      if (!raw) return
      localStorage.removeItem('ledger_draft_invoice')
      const t = JSON.parse(raw)
      setForm(f => ({
        ...f,
        entity: t.entity ?? f.entity,
        party: t.toName ?? f.party,
        notes: t.notes ?? f.notes,
        project_code: t.projectCode || null,
        project_name: t.projectName || null,
        line_items: t.items?.length ? t.items : f.line_items,
        amount: (t.items ?? []).reduce((s: number, l: { total: number }) => s + Number(l.total), 0) || f.amount,
      }))
    } catch { /* ignore */ }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Calculate preview scale to fit the container
  useEffect(() => {
    function calcScale() {
      if (!previewRef.current) return
      const containerWidth = previewRef.current.clientWidth - 32
      setPreviewScale(containerWidth / 794)
    }
    calcScale()
    window.addEventListener('resize', calcScale)
    return () => window.removeEventListener('resize', calcScale)
  }, [])


  const submissionLink = useMemo(() => {
    if (typeof window === 'undefined') return ''
    const base = window.location.origin
    const params = new URLSearchParams()
    if (linkProject) params.set('project', linkProject)
    params.set('entity', linkEntity)
    return `${base}/supplier?${params.toString()}`
  }, [linkProject, linkEntity])

  function copyLink() {
    navigator.clipboard.writeText(submissionLink).then(() => {
      setLinkCopied(true)
      setTimeout(() => setLinkCopied(false), 2000)
    })
  }

  function set<K extends keyof InvoiceInsert>(key: K, val: InvoiceInsert[K]) {
    setSaved(false)
    setForm(f => ({ ...f, [key]: val }))
  }

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

  function addLine() { set('line_items', [...(form.line_items ?? []), blankLine()]) }

  function addExpensesAsLines(selected: Expense[]) {
    const newLines: LineItem[] = selected.map(exp => {
      const desc = exp.notes?.trim()
        || (exp.line_items?.map(li => li.description).filter(Boolean).join(', '))
        || `Expenses — ${exp.employee}`
      const amount = Number(exp.total)
      return { description: desc, qty: 1, unit: amount, total: amount }
    })
    const existing = (form.line_items ?? []).filter(l => l.description || l.total)
    const merged = [...existing, ...newLines]
    set('line_items', merged)
    set('amount', parseFloat(merged.reduce((t, l) => t + Number(l.total), 0).toFixed(2)))
    setPendingExpenseIds(prev => [...prev, ...selected.map(e => e.id)])
  }

  function removeLine(idx: number) {
    const lines = (form.line_items ?? []).filter((_, i) => i !== idx)
    set('line_items', lines)
    set('amount', parseFloat(lines.reduce((t, l) => t + Number(l.total), 0).toFixed(2)))
  }

  function autoRef() {
    const prefix = form.entity === 'Actually Creative' ? 'AC'
      : form.entity === '419Studios' ? '419' : 'RTW'
    set('ref', getNextRef(invoices, form.entity, prefix))
  }

  async function handleSave() {
    if (!form.party.trim()) { setError('Party is required'); return }
    if (!form.ref.trim()) { setError('Ref is required'); return }
    setError(null)
    setSaving(true)
    try {
      const created = await createInvoice(form)
      setSaved(true)
      setSavedInvoiceId(created.id)
      // Link any picked expenses to this invoice
      if (pendingExpenseIds.length > 0) {
        await Promise.all(pendingExpenseIds.map(id => updateExpenseRecord(id, { invoice_id: created.id })))
        setPendingExpenseIds([])
      }
    } catch (e) {
      setError(String(e))
    } finally {
      setSaving(false)
    }
  }

  function handlePrint() {
    window.print()
  }

  function handleReset() {
    setForm(emptyInvoice())
    setSaved(false)
    setError(null)
  }

  function handleSaveTemplate() {
    if (!templateName.trim()) return
    saveTemplate({
      name: templateName.trim(),
      entity: form.entity as Entity,
      toName: form.party,
      toAddr: '',
      notes: form.notes ?? '',
      vat: '20',
      projectCode: form.project_code ?? '',
      projectName: form.project_name ?? '',
      items: form.line_items ?? [],
    })
    setTemplateSaved(true)
    setTimeout(() => {
      setTemplateModalOpen(false)
      setTemplateSaved(false)
      setTemplateName('')
    }, 1000)
  }

  // Preview invoice object — no forPrint id (separate hidden element handles printing)
  const previewInvoice: Invoice = {
    id: 'preview',
    ...form,
    created_at: new Date().toISOString(),
    party: form.party || 'Client Name',
    ref: form.ref || 'AC-0000',
    amount: form.amount,
  }

  const lineTotal = (form.line_items ?? []).reduce((t, l) => t + Number(l.total), 0)

  return (
    <>
      <Header title="Generate Invoice" />

      {/* Hidden full-size invoice for window.print() — never shown on screen */}
      <div style={{ position: 'absolute', left: -9999, top: 0, pointerEvents: 'none' }} aria-hidden>
        <InvoicePDF invoice={previewInvoice} company={company} forPrint={true} />
      </div>

      <div className="flex-1 overflow-hidden flex">
        {/* ── Left: Form ────────────────────────────────────────────── */}
        <div className="w-[420px] flex-shrink-0 overflow-y-auto border-r border-rule bg-paper">
          <div className="divide-y divide-rule">

            {/* Action bar */}
            <div className="px-5 py-3 bg-cream flex items-center gap-2 flex-wrap">
              <button
                onClick={handleSave}
                disabled={saving || saved}
                className={cn(
                  'flex items-center gap-1.5 px-3 py-1.5 text-xs font-mono uppercase tracking-wider transition-colors',
                  saved ? 'bg-ac-green text-white' : 'bg-ink text-white hover:bg-[#333]',
                  'disabled:opacity-60'
                )}
              >
                <Save size={11} />
                {saving ? 'Saving…' : saved ? 'Saved!' : 'Save Invoice'}
              </button>
              <button
                onClick={handlePrint}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-mono uppercase tracking-wider border border-rule text-muted hover:text-ink hover:border-ink transition-colors"
              >
                <Printer size={11} /> Print PDF
              </button>
              <button
                onClick={() => { setTemplateName(''); setTemplateSaved(false); setTemplateModalOpen(true) }}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-mono uppercase tracking-wider border border-rule text-muted hover:text-ink hover:border-ink transition-colors"
              >
                <LayoutTemplate size={11} /> Save Template
              </button>
              <button
                onClick={handleReset}
                className="ml-auto font-mono text-xs text-muted hover:text-ink transition-colors"
              >
                Reset
              </button>
            </div>

            {error && (
              <div className="px-5 py-2 bg-red-50 border-b border-red-200">
                <p className="font-mono text-xs text-red-600">{error}</p>
              </div>
            )}

            {/* Save to project — shown after saving */}
            {saved && savedInvoiceId && !form.project_code && (
              <div className="px-5 py-3 border-b border-rule bg-cream flex items-center gap-3 flex-wrap">
                <span className="font-mono text-xs text-muted">Assign to project:</span>
                <ProjectCodeSelect
                  value={assignProject?.code ?? null}
                  onChange={(code, name) => setAssignProject(code && name ? { code, name } : null)}
                  options={projectCodes}
                  placeholder="Select project…"
                  className="flex-1 min-w-[200px] max-w-xs"
                />
                <button
                  onClick={async () => {
                    if (!assignProject || !savedInvoiceId) return
                    setAssigning(true)
                    try {
                      await updateInvoice(savedInvoiceId, { project_code: assignProject.code, project_name: assignProject.name })
                      setAssignProject(null)
                      setSavedInvoiceId(null)
                    } finally {
                      setAssigning(false)
                    }
                  }}
                  disabled={!assignProject || assigning}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-mono uppercase tracking-wider bg-ink text-white hover:bg-[#333] disabled:opacity-50 transition-colors"
                >
                  {assigning ? 'Saving…' : 'Save to Project'}
                </button>
              </div>
            )}

            {/* Details */}
            <div className="px-5 py-5 space-y-4">
              <p className="tbl-lbl">Invoice Details</p>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="field-label">Type</label>
                  <select
                    value={form.type}
                    onChange={e => set('type', e.target.value as 'payable' | 'receivable')}
                    className="w-full border border-rule bg-white px-3 py-2 text-sm text-ink focus:outline-none focus:border-ink font-mono"
                  >
                    <option value="receivable">Invoice (Receivable)</option>
                    <option value="payable">Bill (Payable)</option>
                  </select>
                </div>
                <div>
                  <label className="field-label">Entity</label>
                  <select
                    value={form.entity}
                    onChange={e => set('entity', e.target.value as Entity)}
                    className="w-full border border-rule bg-white px-3 py-2 text-sm text-ink focus:outline-none focus:border-ink"
                  >
                    {ENTITIES.map(e => <option key={e} value={e}>{e}</option>)}
                  </select>
                </div>
              </div>

              <div>
                <label className="field-label">
                  {form.type === 'receivable' ? 'Bill To (Client)' : 'Bill From (Supplier)'}
                </label>
                <input
                  type="text"
                  value={form.party}
                  onChange={e => set('party', e.target.value)}
                  placeholder="Company or person name"
                  className="w-full border border-rule bg-white px-3 py-2 text-sm text-ink focus:outline-none focus:border-ink"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="field-label">Invoice Reference</label>
                  <div className="flex gap-1">
                    <input
                      type="text"
                      value={form.ref}
                      onChange={e => set('ref', e.target.value)}
                      placeholder="AC-0001"
                      className="flex-1 min-w-0 border border-rule bg-white px-3 py-2 text-sm font-mono text-ink focus:outline-none focus:border-ink"
                    />
                    <button
                      onClick={autoRef}
                      title="Auto-generate ref"
                      className="px-2 border border-rule text-muted hover:text-ink hover:border-ink transition-colors bg-white"
                    >
                      <RefreshCw size={11} />
                    </button>
                  </div>
                </div>
                <div>
                  <label className="field-label">Currency</label>
                  <select
                    value={form.currency}
                    onChange={e => set('currency', e.target.value)}
                    className="w-full border border-rule bg-white px-3 py-2 text-sm text-ink focus:outline-none focus:border-ink font-mono"
                  >
                    {CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="field-label">Due Date</label>
                  <input
                    type="date"
                    value={form.due ?? ''}
                    onChange={e => set('due', e.target.value || null)}
                    className="w-full border border-rule bg-white px-3 py-2 text-sm text-ink focus:outline-none focus:border-ink"
                  />
                </div>
                <div>
                  <label className="field-label">Status</label>
                  <select
                    value={form.status}
                    onChange={e => set('status', e.target.value as InvoiceStatus)}
                    className="w-full border border-rule bg-white px-3 py-2 text-sm text-ink focus:outline-none focus:border-ink font-mono uppercase"
                  >
                    {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
              </div>

              <div>
                <label className="field-label">Project</label>
                <ProjectCodeSelect
                  value={form.project_code}
                  onChange={(code, name) => { set('project_code', code); set('project_name', name) }}
                  options={projectCodes}
                  placeholder="Select project…"
                />
              </div>
            </div>

            {/* Line Items */}
            <div className="px-5 py-5">
              <div className="flex items-center justify-between mb-3">
                <p className="tbl-lbl">Line Items</p>
                <div className="flex items-center gap-2">
                  <button onClick={() => setExpensePicker(true)}
                    className="flex items-center gap-1 font-mono text-xs text-muted hover:text-ink transition-colors border border-rule px-2 py-1">
                    <Receipt size={10} /> Add expenses
                  </button>
                  <button onClick={addLine} className="flex items-center gap-1 font-mono text-xs text-muted hover:text-ink transition-colors">
                    <Plus size={11} /> Add line
                  </button>
                </div>
              </div>
              {pendingExpenseIds.length > 0 && (
                <p className="font-mono text-[10px] text-ac-amber mb-2">
                  {pendingExpenseIds.length} expense{pendingExpenseIds.length !== 1 ? 's' : ''} will be linked on save
                </p>
              )}

              <div className="border border-rule overflow-hidden">
                <table className="w-full">
                  <thead>
                    <tr className="bg-cream border-b border-rule">
                      <th className="tbl-lbl text-left px-3 py-2">Description</th>
                      <th className="tbl-lbl text-right px-2 py-2 w-12">Qty</th>
                      <th className="tbl-lbl text-right px-2 py-2 w-20">Price</th>
                      <th className="tbl-lbl text-right px-3 py-2 w-20">Total</th>
                      <th className="w-6 px-1 py-2" />
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
                            placeholder="Service or product"
                            className="w-full border-0 bg-transparent text-xs text-ink focus:outline-none placeholder:text-muted"
                          />
                        </td>
                        <td className="px-2 py-1.5">
                          <input
                            type="number"
                            value={line.qty}
                            onChange={e => updateLine(idx, 'qty', e.target.value)}
                            min="0"
                            className="w-full border-0 bg-transparent text-xs text-right text-ink focus:outline-none"
                          />
                        </td>
                        <td className="px-2 py-1.5">
                          <input
                            type="number"
                            value={line.unit}
                            onChange={e => updateLine(idx, 'unit', e.target.value)}
                            min="0" step="0.01"
                            className="w-full border-0 bg-transparent text-xs text-right font-mono text-ink focus:outline-none"
                          />
                        </td>
                        <td className="px-3 py-1.5 text-right font-mono text-xs text-ink whitespace-nowrap">
                          {fmt(line.total, form.currency)}
                        </td>
                        <td className="px-1 py-1.5">
                          {(form.line_items ?? []).length > 1 && (
                            <button onClick={() => removeLine(idx)} className="text-muted hover:text-red-500 transition-colors">
                              <Trash2 size={11} />
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
                <span className="font-mono text-sm font-semibold text-ink">{fmt(lineTotal || form.amount, form.currency)}</span>
              </div>
            </div>

            {/* Notes */}
            <div className="px-5 py-5 space-y-3">
              <p className="tbl-lbl">Notes &amp; Terms</p>
              <div>
                <label className="field-label">Customer Notes</label>
                <textarea
                  value={form.notes ?? ''}
                  onChange={e => set('notes', e.target.value || null)}
                  rows={3}
                  placeholder="Payment terms, thank you note…"
                  className="w-full border border-rule bg-white px-3 py-2 text-xs text-ink focus:outline-none focus:border-ink resize-none"
                />
              </div>
            </div>

            {/* Client Submission Link */}
            <div className="px-5 py-5 space-y-3">
              <div className="flex items-center gap-2">
                <Link size={11} className="text-muted" />
                <p className="tbl-lbl">Client Submission Link</p>
              </div>
              <p className="font-mono text-[10px] text-muted -mt-1">
                Share this link so a supplier or client can submit an invoice directly.
              </p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="field-label">Entity</label>
                  <select
                    value={linkEntity}
                    onChange={e => { setLinkEntity(e.target.value as Entity); setLinkProject('') }}
                    className="w-full border border-rule bg-white px-3 py-2 text-sm text-ink focus:outline-none focus:border-ink"
                  >
                    {ENTITIES.map(e => <option key={e} value={e}>{e}</option>)}
                  </select>
                </div>
                <div>
                  <label className="field-label">Project (optional)</label>
                  <select
                    value={linkProject}
                    onChange={e => setLinkProject(e.target.value)}
                    className="w-full border border-rule bg-white px-3 py-2 text-sm font-mono text-ink focus:outline-none focus:border-ink"
                  >
                    <option value="">No project</option>
                    {projectCodes.map(p => (
                      <option key={p.code} value={p.code}>{p.code}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="flex gap-1">
                <input
                  type="text"
                  readOnly
                  value={submissionLink}
                  className="flex-1 min-w-0 border border-rule bg-cream px-3 py-2 text-xs font-mono text-muted focus:outline-none select-all"
                  onClick={e => (e.target as HTMLInputElement).select()}
                />
                <button
                  onClick={copyLink}
                  className={cn(
                    'flex items-center gap-1.5 px-3 border text-xs font-mono uppercase tracking-wider transition-colors flex-shrink-0',
                    linkCopied
                      ? 'border-ac-green bg-ac-green-pale text-ac-green'
                      : 'border-rule text-muted hover:text-ink hover:border-ink'
                  )}
                >
                  {linkCopied ? <><Check size={11} /> Copied</> : <><Copy size={11} /> Copy</>}
                </button>
              </div>
            </div>

          </div>
        </div>

        {/* ── Right: A4 Preview ─────────────────────────────────────── */}
        <div className="flex-1 overflow-y-auto bg-[#e8e8e6] flex flex-col">
          <div className="px-4 py-3 bg-[#d8d8d6] border-b border-[#c8c8c6] flex items-center justify-between">
            <p className="font-mono text-[10px] uppercase tracking-widest text-[#6a6a6a]">
              A4 Preview · {Math.round(previewScale * 100)}%
            </p>
            <button
              onClick={handlePrint}
              className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-[#6a6a6a] hover:text-ink transition-colors"
            >
              <Printer size={10} /> Print
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-4 flex justify-center">
            <div
              ref={previewRef}
              className="relative w-full max-w-[calc(794px+32px)]"
              style={{ height: Math.round(1123 * previewScale) + 'px' }}
            >
              <div
                style={{
                  transform: `scale(${previewScale})`,
                  transformOrigin: 'top left',
                  boxShadow: '0 4px 32px rgba(0,0,0,0.15)',
                  position: 'absolute',
                  top: 0,
                  left: 0,
                }}
              >
                {/* forPrint={false} — print is handled by the hidden element above */}
                <InvoicePDF
                  invoice={previewInvoice}
                  company={company}
                  forPrint={false}
                />
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Save as Template modal */}
      <Modal
        isOpen={templateModalOpen}
        onClose={() => setTemplateModalOpen(false)}
        title="Save as Template"
        size="md"
        footer={
          <>
            <button onClick={() => setTemplateModalOpen(false)} className="px-4 py-2 text-xs font-mono uppercase tracking-wider border border-rule text-muted hover:text-ink transition-colors">Cancel</button>
            <button
              onClick={handleSaveTemplate}
              disabled={!templateName.trim()}
              className={cn('px-4 py-2 text-xs font-mono uppercase tracking-wider transition-colors disabled:opacity-40',
                templateSaved ? 'bg-ac-green text-white' : 'bg-ink text-white hover:bg-[#333]')}
            >
              {templateSaved ? 'Saved!' : 'Save Template'}
            </button>
          </>
        }
      >
        <div className="px-5 py-5">
          <label className="field-label">Template Name</label>
          <input
            type="text"
            value={templateName}
            onChange={e => setTemplateName(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleSaveTemplate()}
            placeholder="e.g., Monthly Retainer"
            autoFocus
            className="w-full border border-rule bg-paper px-3 py-2 text-sm text-ink focus:outline-none focus:border-ink mt-1"
          />
          <p className="font-mono text-[10px] text-muted mt-2">
            Saves current entity, client, line items, and project code as a reusable template.
          </p>
        </div>
      </Modal>

      {expensePicker && (
        <ExpensePickerModal
          expenses={expenses}
          onConfirm={addExpensesAsLines}
          onClose={() => setExpensePicker(false)}
        />
      )}
    </>
  )
}
