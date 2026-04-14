'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { ArrowLeft, Pencil, Plus, Trash2, Upload, FileText, X, ExternalLink, ImageIcon } from 'lucide-react'
import { sb } from '@/lib/supabase'
import { cn, fmt, fmtDate } from '@/lib/format'
import type {
  Project, Invoice, Expense,
  ProjectNote, ProjectFile, ProjectCost, CostCategory, CostStatus,
} from '@/types'

// ─── Constants ───────────────────────────────────────────────────────────────

type Tab = 'overview' | 'invoices' | 'expenses' | 'costs' | 'files-notes'

const COST_CATEGORIES: CostCategory[] = ['Equipment', 'Travel', 'Crew', 'Talent', 'Venue', 'Software', 'Marketing', 'Other']
const COST_STATUSES: CostStatus[] = ['planned', 'confirmed', 'paid']

const COST_STATUS_CLS: Record<CostStatus, string> = {
  planned: 'badge-draft',
  confirmed: 'badge-submitted',
  paid: 'badge-paid',
}

// ─── LocalStorage helpers ─────────────────────────────────────────────────────

function lsGet<T>(key: string, fallback: T): T {
  try { const r = localStorage.getItem(key); return r ? JSON.parse(r) : fallback } catch { return fallback }
}
function lsSet(key: string, val: unknown) {
  try { localStorage.setItem(key, JSON.stringify(val)) } catch { /* ignore */ }
}

// ─── URL auto-linker ──────────────────────────────────────────────────────────

function LinkifiedText({ text }: { text: string }) {
  const urlRe = /https?:\/\/[^\s]+/g
  const parts: { type: 'text' | 'url'; val: string }[] = []
  let last = 0
  let m: RegExpExecArray | null
  while ((m = urlRe.exec(text)) !== null) {
    if (m.index > last) parts.push({ type: 'text', val: text.slice(last, m.index) })
    parts.push({ type: 'url', val: m[0] })
    last = m.index + m[0].length
  }
  if (last < text.length) parts.push({ type: 'text', val: text.slice(last) })
  return (
    <span className="whitespace-pre-wrap break-words">
      {parts.map((p, i) =>
        p.type === 'url'
          ? <a key={i} href={p.val} target="_blank" rel="noopener noreferrer" className="text-blue-600 underline hover:no-underline">{p.val}</a>
          : <span key={i}>{p.val}</span>
      )}
    </span>
  )
}

// ─── Image overlay ────────────────────────────────────────────────────────────

function ImageOverlay({ url, name, onClose }: { url: string; name: string; onClose: () => void }) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [onClose])
  return (
    <div className="fixed inset-0 z-[60] flex flex-col" style={{ background: 'rgba(0,0,0,0.9)' }} onClick={onClose}>
      <div className="flex items-center justify-between px-6 py-3 flex-shrink-0" onClick={e => e.stopPropagation()}>
        <span className="font-mono text-xs text-white/60">{name}</span>
        <div className="flex gap-3">
          <a href={url} target="_blank" rel="noopener noreferrer" className="text-white/60 hover:text-white transition-colors">
            <ExternalLink size={14} />
          </a>
          <button onClick={onClose} className="text-white/60 hover:text-white transition-colors"><X size={16} /></button>
        </div>
      </div>
      <div className="flex-1 flex items-center justify-center p-6" onClick={e => e.stopPropagation()}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={url} alt={name} className="max-w-full max-h-full object-contain" />
      </div>
    </div>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

interface Props {
  project: Project
  invoices: Invoice[]
  expenses: Expense[]
  onBack: () => void
  onEdit: () => void
}

export function ProjectDetail({ project, invoices, expenses, onBack, onEdit }: Props) {
  const [tab, setTab] = useState<Tab>('overview')

  // Notes
  const [notes, setNotes] = useState<ProjectNote[]>([])
  const [noteText, setNoteText] = useState('')
  const [addingNote, setAddingNote] = useState(false)

  // Files
  const [files, setFiles] = useState<ProjectFile[]>([])
  const [uploading, setUploading] = useState(false)
  const [lightboxFile, setLightboxFile] = useState<ProjectFile | null>(null)
  const [deleteConfirmFile, setDeleteConfirmFile] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Costs
  const [costs, setCosts] = useState<ProjectCost[]>([])
  const [editingCost, setEditingCost] = useState<string | null>(null)
  const [newCost, setNewCost] = useState<Omit<ProjectCost, 'id'>>({
    description: '', category: 'Other', estimated: 0, actual: 0, status: 'planned', notes: '',
  })
  const [addingCost, setAddingCost] = useState(false)

  const code = project.code

  // Load from localStorage
  useEffect(() => {
    setNotes(lsGet<ProjectNote[]>(`project_notes_${code}`, []))
    setFiles(lsGet<ProjectFile[]>(`project_files_${code}`, []))
    setCosts(lsGet<ProjectCost[]>(`project_costs_${code}`, []))
    setTab('overview')
    setNoteText('')
    setAddingNote(false)
    setAddingCost(false)
    setEditingCost(null)
  }, [code])

  // ── Filtered data ──
  const projInvoices = invoices.filter(i => i.project_code === code)
  const projExpenses = expenses.filter(e => e.project_code === code)

  // ── Financial summary ──
  const totalBillable = projInvoices.filter(i => i.type === 'receivable').reduce((t, i) => t + Number(i.amount), 0)
  const totalCollected = projInvoices.filter(i => i.type === 'receivable' && i.status === 'paid').reduce((t, i) => t + Number(i.amount), 0)
  const totalOutgoings = projInvoices.filter(i => i.type === 'payable').reduce((t, i) => t + Number(i.amount), 0)
  const totalExpenses = projExpenses.reduce((t, e) => t + Number(e.total), 0)
  const totalCosts = costs.reduce((t, c) => t + Number(c.actual || c.estimated), 0)
  const netPosition = totalBillable - totalOutgoings - totalExpenses - totalCosts

  // ── Notes ──
  function saveNote() {
    if (!noteText.trim()) return
    const entry: ProjectNote = { id: crypto.randomUUID(), text: noteText.trim(), createdAt: new Date().toISOString() }
    const updated = [entry, ...notes]
    setNotes(updated)
    lsSet(`project_notes_${code}`, updated)
    setNoteText('')
    setAddingNote(false)
  }

  function deleteNote(id: string) {
    const updated = notes.filter(n => n.id !== id)
    setNotes(updated)
    lsSet(`project_notes_${code}`, updated)
  }

  // ── Files ──
  async function handleFileUpload(file: File) {
    if (!file.type.match(/^(image\/(jpeg|png|gif|webp)|application\/pdf)$/)) {
      alert('Only JPG, PNG, GIF, WebP, and PDF files are supported.')
      return
    }
    setUploading(true)
    try {
      const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_')
      const path = `projects/${code}/${Date.now()}-${safeName}`
      const { error } = await sb.storage.from('invoices').upload(path, file, { upsert: false })
      if (error) throw error
      const { data: urlData } = sb.storage.from('invoices').getPublicUrl(path)
      const entry: ProjectFile = {
        id: crypto.randomUUID(),
        name: file.name,
        url: urlData.publicUrl,
        type: file.type.startsWith('image/') ? 'image' : 'pdf',
        uploadedAt: new Date().toISOString(),
        path,
      }
      const updated = [entry, ...files]
      setFiles(updated)
      lsSet(`project_files_${code}`, updated)
    } catch (e) {
      alert(`Upload failed: ${String(e)}`)
    } finally {
      setUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  async function deleteFile(f: ProjectFile) {
    if (deleteConfirmFile !== f.id) {
      setDeleteConfirmFile(f.id)
      setTimeout(() => setDeleteConfirmFile(null), 3000)
      return
    }
    try {
      await sb.storage.from('invoices').remove([f.path])
    } catch { /* ignore storage errors — remove from list anyway */ }
    const updated = files.filter(x => x.id !== f.id)
    setFiles(updated)
    lsSet(`project_files_${code}`, updated)
    setDeleteConfirmFile(null)
  }

  // ── Costs ──
  function saveCosts(updated: ProjectCost[]) {
    setCosts(updated)
    lsSet(`project_costs_${code}`, updated)
  }

  function addCost() {
    if (!newCost.description.trim()) return
    const entry: ProjectCost = { id: crypto.randomUUID(), ...newCost }
    saveCosts([...costs, entry])
    setNewCost({ description: '', category: 'Other', estimated: 0, actual: 0, status: 'planned', notes: '' })
    setAddingCost(false)
  }

  function updateCostField(id: string, key: keyof ProjectCost, val: string | number) {
    saveCosts(costs.map(c => c.id === id ? { ...c, [key]: val } : c))
  }

  function deleteCost(id: string) {
    saveCosts(costs.filter(c => c.id !== id))
    if (editingCost === id) setEditingCost(null)
  }

  // ─── Render ───────────────────────────────────────────────────────────────

  const TABS: { key: Tab; label: string }[] = [
    { key: 'overview', label: 'Overview' },
    { key: 'invoices', label: `Invoices (${projInvoices.length})` },
    { key: 'expenses', label: `Expenses (${projExpenses.length})` },
    { key: 'costs', label: `Costs (${costs.length})` },
    { key: 'files-notes', label: `Files & Notes (${files.length + notes.length})` },
  ]

  return (
    <div className="flex flex-col flex-1 min-h-0">
      {/* Header */}
      <div className="flex-shrink-0 px-6 py-4 border-b border-rule bg-white flex items-center gap-4">
        <button onClick={onBack} className="flex items-center gap-1.5 font-mono text-xs text-muted hover:text-ink transition-colors">
          <ArrowLeft size={12} /> Projects
        </button>
        <div className="h-4 w-px bg-rule" />
        <span className="font-mono text-xs text-muted uppercase tracking-widest">{project.code}</span>
        <h2 className="font-semibold text-sm text-ink">{project.name}</h2>
        <span className={cn('badge', {
          active: 'badge-approved', completed: 'badge-paid', 'on-hold': 'badge-pending',
        }[project.status])}>{project.status}</span>
        <span className="font-mono text-[10px] text-muted uppercase tracking-wider ml-1">
          {project.entity === 'Actually Creative' ? 'AC' : project.entity}
        </span>
        <div className="flex-1" />
        <button onClick={onEdit} className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-mono uppercase tracking-wider border border-rule text-muted hover:text-ink hover:border-ink transition-colors">
          <Pencil size={11} /> Edit
        </button>
      </div>

      {/* Tab bar */}
      <div className="flex-shrink-0 border-b border-rule bg-cream px-6 flex gap-0">
        {TABS.map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={cn(
              'px-4 py-2.5 font-mono text-xs uppercase tracking-wider border-b-2 transition-colors -mb-px',
              tab === t.key
                ? 'border-ink text-ink'
                : 'border-transparent text-muted hover:text-ink'
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-y-auto">

        {/* ── Overview ── */}
        {tab === 'overview' && (
          <div className="px-6 py-6 space-y-6">
            {/* Financial summary */}
            <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-3">
              {[
                { label: 'Billable', val: totalBillable, sub: `${fmt(totalCollected)} collected`, color: 'before:bg-ac-green' },
                { label: 'Outgoings', val: totalOutgoings, sub: 'payable invoices', color: 'before:bg-ac-amber' },
                { label: 'Expenses', val: totalExpenses, sub: `${projExpenses.length} claim${projExpenses.length !== 1 ? 's' : ''}`, color: 'before:bg-blue-500' },
                { label: 'Costs', val: totalCosts, sub: `${costs.length} line${costs.length !== 1 ? 's' : ''}`, color: 'before:bg-purple-500' },
                {
                  label: 'Net Position', val: netPosition,
                  sub: netPosition >= 0 ? 'surplus' : 'deficit',
                  color: netPosition >= 0 ? 'before:bg-ac-green' : 'before:bg-red-500',
                },
              ].map(({ label, val, sub, color }) => (
                <div key={label} className={cn('stat-card', color)}>
                  <p className="tbl-lbl mb-1">{label}</p>
                  <p className={cn('font-mono text-lg font-semibold', val < 0 ? 'text-red-600' : 'text-ink')}>{fmt(val)}</p>
                  <p className="font-mono text-[10px] text-muted mt-0.5">{sub}</p>
                </div>
              ))}
            </div>

            {/* Budget bar */}
            {project.budget > 0 && (
              <div className="bg-white border border-rule p-4">
                <div className="flex justify-between items-center mb-2">
                  <span className="tbl-lbl">Budget</span>
                  <span className="font-mono text-xs">
                    <span className={totalBillable > project.budget ? 'text-red-600 font-semibold' : 'text-ink'}>{fmt(totalBillable)}</span>
                    <span className="text-muted"> / {fmt(project.budget)}</span>
                  </span>
                </div>
                <div className="h-2 bg-rule overflow-hidden">
                  <div
                    className={cn('h-full transition-all', totalBillable > project.budget ? 'bg-red-500' : 'bg-ac-green')}
                    style={{ width: `${Math.min((totalBillable / project.budget) * 100, 100)}%` }}
                  />
                </div>
              </div>
            )}

            {/* Metadata */}
            <div className="bg-white border border-rule p-4">
              <p className="tbl-lbl mb-3">Project Details</p>
              <dl className="grid grid-cols-2 gap-x-8 gap-y-2">
                {[
                  { label: 'Code', val: project.code },
                  { label: 'Entity', val: project.entity },
                  { label: 'Start Date', val: fmtDate(project.date) },
                  { label: 'Budget', val: project.budget > 0 ? fmt(project.budget) : '—' },
                ].map(({ label, val }) => (
                  <div key={label} className="flex flex-col">
                    <dt className="font-mono text-[10px] uppercase tracking-wider text-muted">{label}</dt>
                    <dd className="font-mono text-xs text-ink mt-0.5">{val}</dd>
                  </div>
                ))}
              </dl>
              {project.notes && (
                <div className="mt-3 pt-3 border-t border-rule">
                  <dt className="font-mono text-[10px] uppercase tracking-wider text-muted mb-1">Notes</dt>
                  <p className="text-sm text-ink">{project.notes}</p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── Invoices ── */}
        {tab === 'invoices' && (
          <div className="p-6">
            {projInvoices.length === 0 ? (
              <p className="font-mono text-xs text-muted text-center py-16 uppercase tracking-wider">No invoices for this project</p>
            ) : (
              <div className="tbl-card">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-rule bg-paper/50">
                      {['Ref', 'Party', 'Type', 'Due', 'Amount', 'Status'].map(h => (
                        <th key={h} className="tbl-lbl text-left px-4 py-2.5">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {projInvoices.map((inv, i) => (
                      <tr key={inv.id} className={cn('border-b border-rule last:border-0', i % 2 === 1 && 'bg-paper/40')}>
                        <td className="px-4 py-2.5 font-mono text-xs">{inv.ref || '—'}</td>
                        <td className="px-4 py-2.5 text-sm">{inv.party}</td>
                        <td className="px-4 py-2.5 font-mono text-[10px] uppercase tracking-wider text-muted">{inv.type}</td>
                        <td className="px-4 py-2.5 font-mono text-xs text-muted">{inv.due ? fmtDate(inv.due) : '—'}</td>
                        <td className="px-4 py-2.5 font-mono text-sm font-semibold">{fmt(inv.amount, inv.currency)}</td>
                        <td className="px-4 py-2.5">
                          <span className={cn('badge', {
                            paid: 'badge-paid', pending: 'badge-pending', overdue: 'badge-overdue',
                            draft: 'badge-draft', submitted: 'badge-submitted', approved: 'badge-approved',
                            sent: 'badge-sent', 'part-paid': 'badge-part-paid',
                          }[inv.status] ?? 'badge-draft')}>{inv.status}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div className="px-4 py-2.5 border-t border-rule bg-cream flex justify-between">
                  <span className="font-mono text-xs text-muted">Receivable: {fmt(totalBillable)}</span>
                  <span className="font-mono text-xs text-muted">Payable: {fmt(totalOutgoings)}</span>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── Expenses ── */}
        {tab === 'expenses' && (
          <div className="p-6">
            {projExpenses.length === 0 ? (
              <p className="font-mono text-xs text-muted text-center py-16 uppercase tracking-wider">No expenses for this project</p>
            ) : (
              <div className="tbl-card">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-rule bg-paper/50">
                      {['Employee', 'Date', 'Total', 'Status'].map(h => (
                        <th key={h} className="tbl-lbl text-left px-4 py-2.5">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {projExpenses.map((exp, i) => (
                      <tr key={exp.id} className={cn('border-b border-rule last:border-0', i % 2 === 1 && 'bg-paper/40')}>
                        <td className="px-4 py-2.5 text-sm font-medium">{exp.employee}</td>
                        <td className="px-4 py-2.5 font-mono text-xs text-muted">{fmtDate(exp.date)}</td>
                        <td className="px-4 py-2.5 font-mono text-sm font-semibold">{fmt(exp.total)}</td>
                        <td className="px-4 py-2.5">
                          <span className={cn('badge', { submitted: 'badge-submitted', approved: 'badge-approved', paid: 'badge-paid' }[exp.status])}>{exp.status}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div className="px-4 py-2.5 border-t border-rule bg-cream">
                  <span className="font-mono text-xs text-muted">Total: </span>
                  <span className="font-mono text-xs font-semibold text-ink">{fmt(totalExpenses)}</span>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── Costs ── */}
        {tab === 'costs' && (
          <div className="p-6 space-y-4">
            <div className="tbl-card">
              <div className="px-4 py-3 bg-cream border-b border-rule flex items-center justify-between">
                <p className="tbl-lbl">Internal Costs</p>
                <button
                  onClick={() => setAddingCost(true)}
                  className="flex items-center gap-1.5 font-mono text-xs text-muted hover:text-ink transition-colors"
                >
                  <Plus size={11} /> Add Cost
                </button>
              </div>

              {costs.length === 0 && !addingCost ? (
                <p className="font-mono text-xs text-muted text-center py-12 uppercase tracking-wider">No costs yet</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b border-rule bg-paper/50">
                        <th className="tbl-lbl text-left px-4 py-2.5">Description</th>
                        <th className="tbl-lbl text-left px-3 py-2.5 w-28">Category</th>
                        <th className="tbl-lbl text-right px-3 py-2.5 w-24">Estimated</th>
                        <th className="tbl-lbl text-right px-3 py-2.5 w-24">Actual</th>
                        <th className="tbl-lbl text-left px-3 py-2.5 w-24">Status</th>
                        <th className="tbl-lbl text-left px-3 py-2.5">Notes</th>
                        <th className="w-16 px-3 py-2.5" />
                      </tr>
                    </thead>
                    <tbody>
                      {costs.map((cost) => (
                        <tr
                          key={cost.id}
                          className="border-b border-rule last:border-0 hover:bg-cream/50 transition-colors group"
                          onClick={() => setEditingCost(editingCost === cost.id ? null : cost.id)}
                        >
                          {editingCost === cost.id ? (
                            <>
                              <td className="px-4 py-2" onClick={e => e.stopPropagation()}>
                                <input value={cost.description} onChange={e => updateCostField(cost.id, 'description', e.target.value)}
                                  className="w-full border border-rule bg-white px-2 py-1 text-xs text-ink focus:outline-none" />
                              </td>
                              <td className="px-3 py-2" onClick={e => e.stopPropagation()}>
                                <select value={cost.category} onChange={e => updateCostField(cost.id, 'category', e.target.value)}
                                  className="w-full border border-rule bg-white px-2 py-1 text-xs font-mono text-ink focus:outline-none">
                                  {COST_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                                </select>
                              </td>
                              <td className="px-3 py-2" onClick={e => e.stopPropagation()}>
                                <input type="number" value={cost.estimated} onChange={e => updateCostField(cost.id, 'estimated', parseFloat(e.target.value) || 0)}
                                  min="0" step="0.01" className="w-full border border-rule bg-white px-2 py-1 text-xs font-mono text-right text-ink focus:outline-none" />
                              </td>
                              <td className="px-3 py-2" onClick={e => e.stopPropagation()}>
                                <input type="number" value={cost.actual} onChange={e => updateCostField(cost.id, 'actual', parseFloat(e.target.value) || 0)}
                                  min="0" step="0.01" className="w-full border border-rule bg-white px-2 py-1 text-xs font-mono text-right text-ink focus:outline-none" />
                              </td>
                              <td className="px-3 py-2" onClick={e => e.stopPropagation()}>
                                <select value={cost.status} onChange={e => updateCostField(cost.id, 'status', e.target.value)}
                                  className="w-full border border-rule bg-white px-2 py-1 text-xs font-mono text-ink focus:outline-none">
                                  {COST_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                                </select>
                              </td>
                              <td className="px-3 py-2" onClick={e => e.stopPropagation()}>
                                <input value={cost.notes} onChange={e => updateCostField(cost.id, 'notes', e.target.value)}
                                  className="w-full border border-rule bg-white px-2 py-1 text-xs text-ink focus:outline-none" />
                              </td>
                            </>
                          ) : (
                            <>
                              <td className="px-4 py-2.5 text-sm text-ink">{cost.description}</td>
                              <td className="px-3 py-2.5 font-mono text-[10px] text-muted uppercase tracking-wider">{cost.category}</td>
                              <td className="px-3 py-2.5 font-mono text-xs text-muted text-right">{fmt(cost.estimated)}</td>
                              <td className="px-3 py-2.5 font-mono text-xs font-semibold text-ink text-right">{fmt(cost.actual)}</td>
                              <td className="px-3 py-2.5">
                                <span className={cn('badge', COST_STATUS_CLS[cost.status])}>{cost.status}</span>
                              </td>
                              <td className="px-3 py-2.5 text-xs text-muted truncate max-w-[120px]">{cost.notes}</td>
                            </>
                          )}
                          <td className="px-3 py-2.5" onClick={e => e.stopPropagation()}>
                            <button onClick={() => deleteCost(cost.id)}
                              className="text-muted hover:text-red-500 transition-colors opacity-0 group-hover:opacity-100">
                              <Trash2 size={12} />
                            </button>
                          </td>
                        </tr>
                      ))}

                      {/* Add row */}
                      {addingCost && (
                        <tr className="border-b border-rule bg-cream/50">
                          <td className="px-4 py-2">
                            <input value={newCost.description} onChange={e => setNewCost(c => ({ ...c, description: e.target.value }))}
                              placeholder="Description" autoFocus
                              className="w-full border border-rule bg-white px-2 py-1 text-xs text-ink focus:outline-none" />
                          </td>
                          <td className="px-3 py-2">
                            <select value={newCost.category} onChange={e => setNewCost(c => ({ ...c, category: e.target.value as CostCategory }))}
                              className="w-full border border-rule bg-white px-2 py-1 text-xs font-mono text-ink focus:outline-none">
                              {COST_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                            </select>
                          </td>
                          <td className="px-3 py-2">
                            <input type="number" value={newCost.estimated || ''} onChange={e => setNewCost(c => ({ ...c, estimated: parseFloat(e.target.value) || 0 }))}
                              min="0" step="0.01" placeholder="0.00"
                              className="w-full border border-rule bg-white px-2 py-1 text-xs font-mono text-right text-ink focus:outline-none" />
                          </td>
                          <td className="px-3 py-2">
                            <input type="number" value={newCost.actual || ''} onChange={e => setNewCost(c => ({ ...c, actual: parseFloat(e.target.value) || 0 }))}
                              min="0" step="0.01" placeholder="0.00"
                              className="w-full border border-rule bg-white px-2 py-1 text-xs font-mono text-right text-ink focus:outline-none" />
                          </td>
                          <td className="px-3 py-2">
                            <select value={newCost.status} onChange={e => setNewCost(c => ({ ...c, status: e.target.value as CostStatus }))}
                              className="w-full border border-rule bg-white px-2 py-1 text-xs font-mono text-ink focus:outline-none">
                              {COST_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                            </select>
                          </td>
                          <td className="px-3 py-2">
                            <input value={newCost.notes} onChange={e => setNewCost(c => ({ ...c, notes: e.target.value }))}
                              placeholder="Notes"
                              className="w-full border border-rule bg-white px-2 py-1 text-xs text-ink focus:outline-none" />
                          </td>
                          <td className="px-3 py-2 flex items-center gap-1">
                            <button onClick={addCost} className="text-ac-green hover:text-[#2d6147] transition-colors font-mono text-[10px] uppercase">Save</button>
                            <button onClick={() => setAddingCost(false)} className="text-muted hover:text-ink ml-1"><X size={12} /></button>
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              )}

              {costs.length > 0 && (
                <div className="px-4 py-2.5 border-t border-rule bg-cream flex items-center justify-between">
                  <span className="font-mono text-xs text-muted">
                    {costs.length} line{costs.length !== 1 ? 's' : ''}
                    {' · '}Est: {fmt(costs.reduce((t, c) => t + c.estimated, 0))}
                  </span>
                  <span className="font-mono text-xs font-semibold text-ink">
                    Actual: {fmt(totalCosts)}
                  </span>
                </div>
              )}
            </div>

            <p className="font-mono text-[10px] text-muted">Click a row to edit · Changes save instantly</p>
          </div>
        )}

        {/* ── Files & Notes ── */}
        {tab === 'files-notes' && (
          <div className="p-6 space-y-8">

            {/* ── Files ── */}
            <div>
              <div className="flex items-center justify-between mb-4">
                <p className="tbl-lbl">Files</p>
                <div className="flex items-center gap-3">
                  {uploading && <span className="font-mono text-xs text-muted">Uploading…</span>}
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    disabled={uploading}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-mono uppercase tracking-wider border border-rule text-muted hover:text-ink hover:border-ink transition-colors disabled:opacity-50"
                  >
                    <Upload size={11} /> Upload File
                  </button>
                </div>
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/jpeg,image/png,image/gif,image/webp,application/pdf"
                className="hidden"
                onChange={e => { const f = e.target.files?.[0]; if (f) handleFileUpload(f) }}
              />

              {files.length === 0 ? (
                <div
                  className="border-2 border-dashed border-rule flex flex-col items-center justify-center py-12 gap-2 cursor-pointer hover:border-muted transition-colors"
                  onClick={() => fileInputRef.current?.click()}
                >
                  <Upload size={20} className="text-muted" />
                  <p className="font-mono text-xs text-muted uppercase tracking-wider">Drop files or click to upload</p>
                  <p className="font-mono text-[10px] text-muted">JPG, PNG, PDF supported</p>
                </div>
              ) : (
                <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-3">
                  {files.map(f => (
                    <div key={f.id} className="group relative border border-rule bg-white overflow-hidden">
                      {/* Thumbnail or PDF icon */}
                      <button
                        className="w-full aspect-square flex items-center justify-center bg-cream hover:bg-cream/80 transition-colors"
                        onClick={() => f.type === 'image' ? setLightboxFile(f) : window.open(f.url, '_blank')}
                        title={f.name}
                      >
                        {f.type === 'image' ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={f.url} alt={f.name} className="w-full h-full object-cover" />
                        ) : (
                          <div className="flex flex-col items-center gap-1">
                            <FileText size={24} className="text-muted" />
                            <span className="font-mono text-[9px] text-muted uppercase">PDF</span>
                          </div>
                        )}
                      </button>
                      {/* Delete button */}
                      <button
                        onClick={() => deleteFile(f)}
                        className={cn(
                          'absolute top-1 right-1 w-5 h-5 flex items-center justify-center transition-all',
                          deleteConfirmFile === f.id
                            ? 'bg-red-600 text-white opacity-100'
                            : 'bg-black/60 text-white opacity-0 group-hover:opacity-100'
                        )}
                        title={deleteConfirmFile === f.id ? 'Click again to delete' : 'Delete'}
                      >
                        <Trash2 size={9} />
                      </button>
                      {/* Name */}
                      <div className="px-2 py-1.5 border-t border-rule">
                        <p className="font-mono text-[9px] text-muted truncate">{f.name}</p>
                        <p className="font-mono text-[9px] text-muted/60">{fmtDate(f.uploadedAt)}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* ── Notes ── */}
            <div>
              <div className="flex items-center justify-between mb-4">
                <p className="tbl-lbl">Notes</p>
                {!addingNote && (
                  <button
                    onClick={() => setAddingNote(true)}
                    className="flex items-center gap-1.5 font-mono text-xs text-muted hover:text-ink transition-colors"
                  >
                    <Plus size={11} /> Add Note
                  </button>
                )}
              </div>

              {addingNote && (
                <div className="mb-4 border border-rule bg-white">
                  <textarea
                    value={noteText}
                    onChange={e => setNoteText(e.target.value)}
                    placeholder="Write a note… URLs will be auto-linked."
                    autoFocus
                    rows={4}
                    className="w-full px-4 py-3 text-sm text-ink focus:outline-none resize-none bg-transparent"
                    onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) saveNote() }}
                  />
                  <div className="flex items-center justify-between px-4 py-2 border-t border-rule bg-cream">
                    <span className="font-mono text-[10px] text-muted">⌘ + Enter to save</span>
                    <div className="flex gap-2">
                      <button onClick={() => { setAddingNote(false); setNoteText('') }}
                        className="font-mono text-xs text-muted hover:text-ink transition-colors">Cancel</button>
                      <button onClick={saveNote}
                        className="px-3 py-1 bg-ink text-white font-mono text-xs uppercase tracking-wider hover:bg-[#333] transition-colors">
                        Save Note
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {notes.length === 0 && !addingNote ? (
                <div className="border-2 border-dashed border-rule flex flex-col items-center justify-center py-12 gap-2">
                  <p className="font-mono text-xs text-muted uppercase tracking-wider">No notes yet</p>
                  <button onClick={() => setAddingNote(true)} className="font-mono text-xs text-ink underline underline-offset-2">Add the first note</button>
                </div>
              ) : (
                <div className="space-y-3">
                  {notes.map(note => (
                    <div key={note.id} className="group border border-rule bg-white p-4 relative">
                      <div className="flex items-start justify-between gap-4">
                        <div className="text-sm text-ink flex-1">
                          <LinkifiedText text={note.text} />
                        </div>
                        <button
                          onClick={() => deleteNote(note.id)}
                          className="text-muted hover:text-red-500 transition-colors opacity-0 group-hover:opacity-100 flex-shrink-0"
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                      <p className="font-mono text-[10px] text-muted mt-2">
                        {new Date(note.createdAt).toLocaleString('en-GB', {
                          day: '2-digit', month: 'short', year: 'numeric',
                          hour: '2-digit', minute: '2-digit',
                        })}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Image lightbox */}
      {lightboxFile && (
        <ImageOverlay url={lightboxFile.url} name={lightboxFile.name} onClose={() => setLightboxFile(null)} />
      )}
    </div>
  )
}
