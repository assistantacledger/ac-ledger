'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Header } from '@/components/layout/Header'
import { Modal } from '@/components/ui/Modal'
import { useTemplates } from '@/hooks/useTemplates'
import { cn, fmt } from '@/lib/format'
import { Plus, Pencil, Trash2, Play, LayoutTemplate } from 'lucide-react'
import type { InvoiceTemplate, Entity, LineItem } from '@/types'
import { ENTITIES } from '@/types'

const blankLine = (): LineItem => ({ description: '', qty: 1, unit: 0, total: 0 })

const blankForm = (): Omit<InvoiceTemplate, 'id' | 'createdAt'> => ({
  name: '',
  entity: 'Actually Creative',
  toName: '',
  toAddr: '',
  notes: '',
  vat: '20',
  projectCode: '',
  projectName: '',
  items: [blankLine()],
})

export default function TemplatesPage() {
  const router = useRouter()
  const { templates, saveTemplate, updateTemplate, deleteTemplate, applyTemplate } = useTemplates()
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<InvoiceTemplate | null>(null)
  const [form, setForm] = useState(blankForm())
  const [error, setError] = useState('')
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null)

  function openCreate() { setEditing(null); setForm(blankForm()); setError(''); setModalOpen(true) }
  function openEdit(t: InvoiceTemplate) {
    setEditing(t)
    setForm({ name: t.name, entity: t.entity, toName: t.toName, toAddr: t.toAddr, notes: t.notes, vat: t.vat, projectCode: t.projectCode, projectName: t.projectName, items: t.items.length ? t.items : [blankLine()] })
    setError('')
    setModalOpen(true)
  }

  function set<K extends keyof typeof form>(key: K, val: typeof form[K]) {
    setForm(f => ({ ...f, [key]: val }))
  }

  function updateLine(idx: number, key: keyof LineItem, raw: string) {
    const lines = [...form.items]
    if (key === 'description') { lines[idx] = { ...lines[idx], description: raw } }
    else {
      const num = parseFloat(raw) || 0
      lines[idx] = { ...lines[idx], [key]: num }
      if (key === 'qty' || key === 'unit') lines[idx].total = parseFloat((lines[idx].qty * lines[idx].unit).toFixed(2))
    }
    set('items', lines)
  }

  function handleSave() {
    if (!form.name.trim()) { setError('Template name is required'); return }
    setError('')
    if (editing) updateTemplate(editing.id, form)
    else saveTemplate(form)
    setModalOpen(false)
  }

  function handleDelete(id: string) {
    if (deleteConfirm === id) { deleteTemplate(id); setDeleteConfirm(null) }
    else { setDeleteConfirm(id); setTimeout(() => setDeleteConfirm(null), 3000) }
  }

  function handleApply(id: string) {
    applyTemplate(id)
    router.push('/generate')
  }

  const lineTotal = form.items.reduce((t, l) => t + l.total, 0)

  const footer = (
    <>
      {error && <p className="text-xs font-mono text-red-600 mr-auto">{error}</p>}
      <button onClick={() => setModalOpen(false)} className="px-4 py-2 text-xs font-mono uppercase tracking-wider border border-rule text-muted hover:text-ink hover:border-ink transition-colors">Cancel</button>
      <button onClick={handleSave} className="px-4 py-2 text-xs font-mono uppercase tracking-wider bg-ink text-white hover:bg-[#333] transition-colors">
        {editing ? 'Save Changes' : 'Create Template'}
      </button>
    </>
  )

  return (
    <>
      <Header title="Templates" subtitle="Invoice Templates" />
      <main className="flex-1 overflow-y-auto px-6 py-6">

        <div className="flex items-center justify-between mb-5">
          <p className="font-mono text-xs text-muted">Save recurring invoice structures as templates to reuse on the Generate page.</p>
          <button onClick={openCreate}
            className="flex items-center gap-1.5 bg-ink text-white px-3 py-1.5 text-xs font-mono uppercase tracking-wider hover:bg-[#333] transition-colors">
            <Plus size={11} /> New Template
          </button>
        </div>

        {templates.length === 0 ? (
          <div className="tbl-card py-16 text-center">
            <LayoutTemplate size={24} className="text-muted mx-auto mb-3" />
            <p className="font-mono text-xs text-muted uppercase tracking-wider">No templates yet</p>
            <button onClick={openCreate} className="mt-3 font-mono text-xs text-ink underline underline-offset-2">Create your first template</button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {templates.map(t => {
              const total = t.items.reduce((s, l) => s + l.total, 0)
              return (
                <div key={t.id} className="tbl-card group">
                  <div className="px-5 py-4 border-b border-rule">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-ink truncate">{t.name}</p>
                        <div className="flex items-center gap-2 mt-0.5">
                          <span className="font-mono text-[10px] uppercase tracking-wider text-muted">
                            {t.entity === 'Actually Creative' ? 'AC' : t.entity}
                          </span>
                          {t.projectCode && <span className="font-mono text-[10px] text-muted">· {t.projectCode}</span>}
                        </div>
                      </div>
                      <div className="row-actions flex-shrink-0">
                        <button onClick={() => openEdit(t)} className="p-1 text-muted hover:text-ink transition-colors"><Pencil size={13} /></button>
                        <button onClick={() => handleDelete(t.id)}
                          className={cn('p-1 transition-colors', deleteConfirm === t.id ? 'text-red-600' : 'text-muted hover:text-red-500')}>
                          <Trash2 size={13} />
                        </button>
                      </div>
                    </div>
                  </div>
                  <div className="px-5 py-3">
                    {t.toName && <p className="text-xs text-muted mb-1">To: <span className="text-ink">{t.toName}</span></p>}
                    <p className="font-mono text-xs text-muted">{t.items.length} line item{t.items.length !== 1 ? 's' : ''}</p>
                    {total > 0 && <p className="font-mono text-sm font-semibold text-ink mt-1">{fmt(total)}</p>}
                  </div>
                  <div className="px-5 py-3 border-t border-rule">
                    <button
                      onClick={() => handleApply(t.id)}
                      className="flex items-center gap-1.5 font-mono text-xs text-ink hover:text-muted transition-colors"
                    >
                      <Play size={11} /> Use Template
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </main>

      <Modal isOpen={modalOpen} onClose={() => setModalOpen(false)} title={editing ? `Edit · ${editing.name}` : 'New Template'} size="2xl" footer={footer}>
        <div className="px-5 py-5 space-y-4 divide-y divide-rule">
          <div className="grid grid-cols-2 gap-4 pb-4">
            <div className="col-span-2">
              <label className="field-label">Template Name</label>
              <input type="text" value={form.name} onChange={e => set('name', e.target.value)}
                placeholder="e.g., Monthly Retainer Invoice"
                className="w-full border border-rule bg-paper px-3 py-2 text-sm text-ink focus:outline-none focus:border-ink" />
            </div>
            <div>
              <label className="field-label">Entity</label>
              <select value={form.entity} onChange={e => set('entity', e.target.value as Entity)}
                className="w-full border border-rule bg-paper px-3 py-2 text-sm text-ink focus:outline-none">
                {ENTITIES.map(e => <option key={e} value={e}>{e}</option>)}
              </select>
            </div>
            <div>
              <label className="field-label">VAT Rate (%)</label>
              <input type="text" value={form.vat} onChange={e => set('vat', e.target.value)}
                className="w-full border border-rule bg-paper px-3 py-2 text-sm font-mono text-ink focus:outline-none focus:border-ink" />
            </div>
            <div>
              <label className="field-label">Bill To (Name)</label>
              <input type="text" value={form.toName} onChange={e => set('toName', e.target.value)}
                className="w-full border border-rule bg-paper px-3 py-2 text-sm text-ink focus:outline-none focus:border-ink" />
            </div>
            <div>
              <label className="field-label">Bill To (Address)</label>
              <input type="text" value={form.toAddr} onChange={e => set('toAddr', e.target.value)}
                className="w-full border border-rule bg-paper px-3 py-2 text-sm text-ink focus:outline-none focus:border-ink" />
            </div>
            <div>
              <label className="field-label">Project Code</label>
              <input type="text" value={form.projectCode} onChange={e => set('projectCode', e.target.value)}
                className="w-full border border-rule bg-paper px-3 py-2 text-sm font-mono text-ink focus:outline-none focus:border-ink" />
            </div>
            <div>
              <label className="field-label">Project Name</label>
              <input type="text" value={form.projectName} onChange={e => set('projectName', e.target.value)}
                className="w-full border border-rule bg-paper px-3 py-2 text-sm text-ink focus:outline-none focus:border-ink" />
            </div>
            <div className="col-span-2">
              <label className="field-label">Default Notes</label>
              <textarea value={form.notes} onChange={e => set('notes', e.target.value)} rows={2}
                className="w-full border border-rule bg-paper px-3 py-2 text-sm text-ink focus:outline-none focus:border-ink resize-none" />
            </div>
          </div>

          <div className="pt-4">
            <div className="flex items-center justify-between mb-3">
              <p className="tbl-lbl">Line Items</p>
              <button onClick={() => set('items', [...form.items, blankLine()])}
                className="flex items-center gap-1 font-mono text-xs text-muted hover:text-ink transition-colors">
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
                  {form.items.map((line, idx) => (
                    <tr key={idx} className="border-b border-rule last:border-0">
                      <td className="px-3 py-1.5">
                        <input type="text" value={line.description} onChange={e => updateLine(idx, 'description', e.target.value)}
                          placeholder="Description" className="w-full border-0 bg-transparent text-sm text-ink focus:outline-none placeholder:text-muted" />
                      </td>
                      <td className="px-3 py-1.5">
                        <input type="number" value={line.qty} onChange={e => updateLine(idx, 'qty', e.target.value)} min="0"
                          className="w-full border-0 bg-transparent text-sm text-right text-ink focus:outline-none" />
                      </td>
                      <td className="px-3 py-1.5">
                        <input type="number" value={line.unit} onChange={e => updateLine(idx, 'unit', e.target.value)} min="0" step="0.01"
                          className="w-full border-0 bg-transparent text-sm text-right font-mono text-ink focus:outline-none" />
                      </td>
                      <td className="px-3 py-1.5 text-right font-mono text-sm text-ink">{fmt(line.total)}</td>
                      <td className="px-2 py-1.5">
                        {form.items.length > 1 && (
                          <button onClick={() => set('items', form.items.filter((_, i) => i !== idx))} className="text-muted hover:text-red-500 transition-colors">
                            <Trash2 size={12} />
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mt-3 flex justify-end gap-4">
              <span className="font-mono text-xs text-muted uppercase tracking-wider">Total</span>
              <span className="font-mono text-sm font-semibold text-ink">{fmt(lineTotal)}</span>
            </div>
          </div>
        </div>
      </Modal>
    </>
  )
}
