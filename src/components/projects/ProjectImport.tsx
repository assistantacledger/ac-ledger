'use client'

import { useState, useRef } from 'react'
import {
  Upload, FileText, X, CheckCircle, Plus, Trash2, AlertCircle, FolderOpen,
} from 'lucide-react'
import { Modal } from '@/components/ui/Modal'
import { cn, todayISO } from '@/lib/format'
import { ENTITIES } from '@/types'
import type {
  Entity, ProjectStatus, CostCategory, CostStatus,
  InvoiceType, InvoiceStatus, InvoiceInsert, Invoice, Project,
} from '@/types'

// ─── Constants ───────────────────────────────────────────────────────────────

const COST_CATS: CostCategory[] = ['Equipment', 'Travel', 'Crew', 'Talent', 'Venue', 'Software', 'Marketing', 'Other']
const COST_STATS: CostStatus[] = ['planned', 'confirmed', 'paid']
const INV_STATS: InvoiceStatus[] = ['draft', 'pending', 'submitted', 'approved', 'sent', 'paid', 'overdue', 'part-paid']
const PROJ_STATS: ProjectStatus[] = ['active', 'completed', 'on-hold']
const MAX_TEXT_CHARS = 25000

// ─── Types ───────────────────────────────────────────────────────────────────

type Step = 'drop' | 'extracting' | 'preview' | 'saving' | 'success'

interface ExtProject {
  name: string; code: string; budget: number; entity: Entity
  date: string; notes: string; status: ProjectStatus
}
interface ExtCost {
  id: string; description: string; category: CostCategory
  estimated: number; actual: number; status: CostStatus
  notes: string; dueDate: string; employeeName: string
}
interface ExtInvoice {
  id: string; party: string; ref: string; amount: number; currency: string
  due: string; type: InvoiceType; status: InvoiceStatus; notes: string
  bankName: string; sortCode: string; accNum: string; accName: string; iban: string; swift: string
  _expanded?: boolean
}

// ─── Props ───────────────────────────────────────────────────────────────────

interface Props {
  isOpen: boolean
  onClose: () => void
  projects: Project[]
  createProject: (data: Omit<Project, 'createdAt'>) => Project
  createInvoice?: (data: InvoiceInsert) => Promise<Invoice>
  anthropicKey?: string
  /** Pre-select an existing project and default to "add to existing" mode */
  defaultProjectCode?: string
  /** Called after a new project is created, so parent can navigate to it */
  onProjectCreated?: (code: string) => void
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function blankProject(): ExtProject {
  return { name: '', code: '', budget: 0, entity: 'Actually Creative', date: todayISO(), notes: '', status: 'active' }
}

function coerceEntity(v: unknown): Entity {
  return ENTITIES.includes(v as Entity) ? (v as Entity) : 'Actually Creative'
}
function coerceProjStatus(v: unknown): ProjectStatus {
  return PROJ_STATS.includes(v as ProjectStatus) ? (v as ProjectStatus) : 'active'
}
function coerceCostCat(v: unknown): CostCategory {
  return COST_CATS.includes(v as CostCategory) ? (v as CostCategory) : 'Other'
}
function coerceCostStatus(v: unknown): CostStatus {
  return COST_STATS.includes(v as CostStatus) ? (v as CostStatus) : 'planned'
}
function coerceInvType(v: unknown): InvoiceType {
  return v === 'receivable' ? 'receivable' : 'payable'
}
function coerceInvStatus(v: unknown): InvoiceStatus {
  return INV_STATS.includes(v as InvoiceStatus) ? (v as InvoiceStatus) : 'pending'
}

// ─── Component ───────────────────────────────────────────────────────────────

export function ProjectImport({
  isOpen, onClose, projects, createProject, createInvoice,
  anthropicKey, defaultProjectCode, onProjectCreated,
}: Props) {
  const [step, setStep] = useState<Step>('drop')
  const [dragOver, setDragOver] = useState(false)
  const [fileName, setFileName] = useState('')
  const [proj, setProj] = useState<ExtProject>(blankProject())
  const [costs, setCosts] = useState<ExtCost[]>([])
  const [invoices, setInvoices] = useState<ExtInvoice[]>([])
  const [uncertain, setUncertain] = useState<string[]>([])
  const [error, setError] = useState('')
  const [mode, setMode] = useState<'new' | 'existing'>(defaultProjectCode ? 'existing' : 'new')
  const [targetCode, setTargetCode] = useState(defaultProjectCode ?? '')
  const [successInfo, setSuccessInfo] = useState<{ projectCode: string; costs: number; invoices: number } | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // ── Reset on close ──
  function reset() {
    setStep('drop'); setDragOver(false); setFileName('')
    setProj(blankProject()); setCosts([]); setInvoices([]); setUncertain([])
    setError('')
    setMode(defaultProjectCode ? 'existing' : 'new')
    setTargetCode(defaultProjectCode ?? '')
    setSuccessInfo(null)
  }
  function handleClose() { reset(); onClose() }

  // ── File handling ──
  function processFile(file: File) {
    if (!file.name.match(/\.(xlsx|xls|csv|pdf)$/i)) {
      setError('Only .xlsx, .xls, .csv, and .pdf files are supported.')
      return
    }
    if (!anthropicKey) {
      setError('Anthropic API key not set. Add it in Settings → Anthropic API Key.')
      return
    }
    void runExtraction(file)
  }

  async function runExtraction(file: File) {
    setFileName(file.name)
    setError('')
    setStep('extracting')

    try {
      let body: Record<string, unknown>

      if (file.name.match(/\.(xlsx|xls|csv)$/i)) {
        // Parse spreadsheet with SheetJS
        const XLSX = await import('xlsx')
        const buf = await file.arrayBuffer()
        const wb = XLSX.read(buf, { type: 'array' })
        const parts: string[] = []
        for (const name of wb.SheetNames) {
          const ws = wb.Sheets[name]
          const csv = XLSX.utils.sheet_to_csv(ws)
          if (csv.trim()) parts.push(`=== Sheet: ${name} ===\n${csv}`)
        }
        let content = parts.join('\n\n')
        if (content.length > MAX_TEXT_CHARS) {
          content = content.slice(0, MAX_TEXT_CHARS) + '\n\n[Content truncated — file too large]'
        }
        body = { apiKey: anthropicKey, content }
      } else {
        // PDF — base64 encode
        const buf = await file.arrayBuffer()
        const bytes = new Uint8Array(buf)
        let binary = ''
        const chunk = 8192
        for (let i = 0; i < bytes.length; i += chunk) {
          binary += String.fromCharCode(...Array.from(bytes.slice(i, i + chunk)))
        }
        body = { apiKey: anthropicKey, base64: btoa(binary), mediaType: file.type || 'application/pdf' }
      }

      const res = await fetch('/api/import-project', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json() as { extracted?: Record<string, unknown>; error?: string }

      if (!res.ok || data.error) {
        setError(data.error ?? 'AI extraction failed. You can fill in the data manually below.')
      }

      // Apply whatever was extracted (even partial)
      applyExtracted(data.extracted ?? {})
      setStep('preview')
    } catch (e) {
      setError(`Import failed: ${String(e)}`)
      setStep('drop')
    }
  }

  function applyExtracted(ext: Record<string, unknown>) {
    const p = ext.project as Record<string, unknown> | undefined
    if (p) {
      setProj({
        name: String(p.name ?? ''),
        code: String(p.code ?? '').toUpperCase(),
        budget: Number(p.budget ?? 0),
        entity: coerceEntity(p.entity),
        date: String(p.date ?? todayISO()),
        notes: String(p.notes ?? ''),
        status: coerceProjStatus(p.status),
      })
    }

    const rawCosts = (ext.costs as Array<Record<string, unknown>> | undefined) ?? []
    setCosts(rawCosts.map((c, i) => ({
      id: `c-${i}`,
      description: String(c.description ?? ''),
      category: coerceCostCat(c.category),
      estimated: Number(c.estimated ?? 0),
      actual: Number(c.actual ?? 0),
      status: coerceCostStatus(c.status),
      notes: String(c.notes ?? ''),
      dueDate: c.dueDate ? String(c.dueDate) : '',
      employeeName: c.employeeName ? String(c.employeeName) : '',
    })))

    const rawInvs = (ext.invoices as Array<Record<string, unknown>> | undefined) ?? []
    setInvoices(rawInvs.map((inv, i) => ({
      id: `i-${i}`,
      party: String(inv.party ?? ''),
      ref: String(inv.ref ?? ''),
      amount: Number(inv.amount ?? 0),
      currency: String(inv.currency ?? '£'),
      due: inv.due ? String(inv.due) : '',
      type: coerceInvType(inv.type),
      status: coerceInvStatus(inv.status),
      notes: String(inv.notes ?? ''),
      bankName: String(inv.bankName ?? ''),
      sortCode: String(inv.sortCode ?? ''),
      accNum: String(inv.accNum ?? ''),
      accName: String(inv.accName ?? ''),
      iban: String(inv.iban ?? ''),
      swift: String(inv.swift ?? ''),
      _expanded: false,
    })))

    setUncertain((ext.uncertain as string[] | undefined) ?? [])
  }

  // ── Cost helpers ──
  function updCost(id: string, patch: Partial<ExtCost>) {
    setCosts(prev => prev.map(c => c.id === id ? { ...c, ...patch } : c))
  }
  function addCost() {
    setCosts(prev => [...prev, {
      id: `c-${Date.now()}`, description: '', category: 'Other',
      estimated: 0, actual: 0, status: 'planned', notes: '', dueDate: '', employeeName: '',
    }])
  }

  // ── Invoice helpers ──
  function updInv(id: string, patch: Partial<ExtInvoice>) {
    setInvoices(prev => prev.map(inv => inv.id === id ? { ...inv, ...patch } : inv))
  }
  function addInvoice() {
    setInvoices(prev => [...prev, {
      id: `i-${Date.now()}`, party: '', ref: '', amount: 0, currency: '£', due: '',
      type: 'payable', status: 'pending', notes: '',
      bankName: '', sortCode: '', accNum: '', accName: '', iban: '', swift: '', _expanded: false,
    }])
  }

  // ── Save ──
  async function handleSave() {
    let projectCode: string
    let projectName: string
    let projectEntity: Entity

    if (mode === 'new') {
      if (!proj.code.trim()) { setError('Project code is required'); return }
      if (!proj.name.trim()) { setError('Project name is required'); return }
      if (projects.find(p => p.code === proj.code)) { setError(`Code "${proj.code}" already exists — change it`); return }
    } else {
      if (!targetCode) { setError('Select a project first'); return }
    }

    setError('')
    setStep('saving')

    try {
      if (mode === 'new') {
        createProject({
          code: proj.code, name: proj.name, entity: proj.entity,
          date: proj.date, budget: proj.budget, status: proj.status, notes: proj.notes,
        })
        projectCode = proj.code
        projectName = proj.name
        projectEntity = proj.entity
      } else {
        const existing = projects.find(p => p.code === targetCode)
        projectCode = targetCode
        projectName = existing?.name ?? targetCode
        projectEntity = existing?.entity ?? 'Actually Creative'
      }

      // Save costs to localStorage (append to any existing)
      if (costs.length > 0) {
        let existing: unknown[] = []
        try { const r = localStorage.getItem(`project_costs_${projectCode}`); if (r) existing = JSON.parse(r) } catch { /* ignore */ }
        const newCosts = costs
          .filter(c => c.description.trim())
          .map(c => ({
            id: crypto.randomUUID(),
            description: c.description,
            category: c.category,
            estimated: c.estimated,
            actual: c.actual,
            status: c.status,
            notes: c.notes,
            dueDate: c.dueDate || undefined,
            employeeName: c.employeeName || undefined,
            isEmployeeCost: !!c.employeeName,
          }))
        localStorage.setItem(`project_costs_${projectCode}`, JSON.stringify([...existing, ...newCosts]))
      }

      // Save invoices to Supabase
      let savedCount = 0
      const validInvoices = invoices.filter(inv => inv.party.trim() || inv.amount > 0)
      if (validInvoices.length > 0 && createInvoice) {
        for (const inv of validInvoices) {
          const hasBankDetails = inv.bankName || inv.sortCode || inv.accNum || inv.accName
          const bankDetails = hasBankDetails ? {
            accName: inv.accName,
            bankName: inv.bankName || undefined,
            sortCode: inv.sortCode,
            accNum: inv.accNum,
            iban: inv.iban || undefined,
            swift: inv.swift || undefined,
          } : null
          try {
            await createInvoice({
              type: inv.type, party: inv.party, ref: inv.ref,
              amount: inv.amount, currency: inv.currency || '£',
              due: inv.due || null, status: inv.status,
              notes: inv.notes || null, internal: null, line_items: null,
              entity: projectEntity, project_code: projectCode, project_name: projectName,
              recurring: false, pdf_url: null, payment_schedule: null, bank_details: bankDetails,
            })
            savedCount++
          } catch { /* skip individual failures */ }
        }
      }

      setSuccessInfo({ projectCode, costs: costs.filter(c => c.description.trim()).length, invoices: savedCount })
      setStep('success')
    } catch (e) {
      setError(`Save failed: ${String(e)}`)
      setStep('preview')
    }
  }

  if (!isOpen) return null

  // ─── Footer ───────────────────────────────────────────────────────────────

  const footer = step === 'preview' ? (
    <>
      {error && <p className="text-xs font-mono text-red-600 mr-auto max-w-xs truncate">{error}</p>}
      <button
        onClick={() => { setStep('drop'); setError('') }}
        className="px-4 py-2 text-xs font-mono uppercase tracking-wider border border-rule text-muted hover:text-ink hover:border-ink transition-colors"
      >
        ← Try another file
      </button>
      <button
        onClick={handleSave}
        className="px-4 py-2 text-xs font-mono uppercase tracking-wider bg-ink text-white hover:bg-[#333] transition-colors"
      >
        {mode === 'new' ? 'Create Project & Import' : 'Add to Project'}
      </button>
    </>
  ) : step === 'success' ? (
    <button onClick={handleClose} className="px-4 py-2 text-xs font-mono uppercase tracking-wider border border-rule text-muted hover:text-ink transition-colors">Close</button>
  ) : undefined

  const title = step === 'drop' ? 'Import Project'
    : step === 'extracting' ? `Analysing ${fileName}…`
    : step === 'preview' ? 'Review Extracted Data'
    : step === 'saving' ? 'Saving…'
    : 'Import Complete'

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <Modal isOpen={isOpen} onClose={handleClose} title={title} size="3xl" footer={footer}>

      {/* ── Drop / extracting ── */}
      {(step === 'drop' || step === 'extracting') && (
        <div className="px-6 py-8">
          {!anthropicKey && (
            <div className="mb-4 px-4 py-3 bg-amber-50 border border-amber-200 flex items-center gap-2">
              <AlertCircle size={13} className="text-amber-600 flex-shrink-0" />
              <p className="font-mono text-xs text-amber-800">
                Anthropic API key not set — add it in <strong>Settings</strong> to enable AI extraction.
              </p>
            </div>
          )}
          <div
            className={cn(
              'border-2 border-dashed py-20 flex flex-col items-center justify-center gap-5 transition-colors',
              dragOver ? 'border-ink bg-cream' : 'border-rule',
              step === 'drop' ? 'cursor-pointer hover:border-muted' : 'pointer-events-none opacity-60',
            )}
            onDragOver={e => { e.preventDefault(); setDragOver(true) }}
            onDragLeave={() => setDragOver(false)}
            onDrop={e => { e.preventDefault(); setDragOver(false); const f = e.dataTransfer.files[0]; if (f) processFile(f) }}
            onClick={() => step === 'drop' && fileInputRef.current?.click()}
          >
            {step === 'extracting' ? (
              <>
                <div className="w-10 h-10 border-[3px] border-ink border-t-transparent rounded-full animate-spin" />
                <div className="text-center">
                  <p className="font-mono text-sm text-ink uppercase tracking-wider mb-1">Analysing with AI…</p>
                  <p className="font-mono text-xs text-muted">{fileName} · This may take 10–30 seconds</p>
                </div>
              </>
            ) : (
              <>
                <Upload size={32} className="text-muted" />
                <div className="text-center">
                  <p className="font-mono text-sm text-ink uppercase tracking-widest mb-2">Drop your Excel, CSV or PDF here</p>
                  <p className="font-mono text-[11px] text-muted tracking-wider">.xlsx · .xls · .csv · .pdf</p>
                </div>
                <button
                  className="font-mono text-xs px-5 py-2 border border-rule text-ink hover:bg-cream transition-colors"
                  onClick={e => { e.stopPropagation(); fileInputRef.current?.click() }}
                >
                  Browse file
                </button>
              </>
            )}
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx,.xls,.csv,.pdf"
            className="hidden"
            onChange={e => { const f = e.target.files?.[0]; if (f) processFile(f) }}
          />
          {error && (
            <p className="mt-3 font-mono text-xs text-red-600 flex items-center gap-1.5">
              <AlertCircle size={11} className="flex-shrink-0" /> {error}
            </p>
          )}
        </div>
      )}

      {/* ── Preview ── */}
      {step === 'preview' && (
        <div className="divide-y divide-rule">

          {/* ── Mode toggle ── */}
          <div className="px-5 py-4 bg-cream">
            <div className="flex items-center gap-2 flex-wrap">
              <button
                onClick={() => setMode('new')}
                className={cn('flex items-center gap-1.5 px-3 py-1.5 text-xs font-mono uppercase tracking-wider border transition-colors',
                  mode === 'new' ? 'border-ink bg-ink text-white' : 'border-rule text-muted hover:text-ink hover:border-ink')}
              >
                <Plus size={10} /> Create new project
              </button>
              <button
                onClick={() => setMode('existing')}
                className={cn('flex items-center gap-1.5 px-3 py-1.5 text-xs font-mono uppercase tracking-wider border transition-colors',
                  mode === 'existing' ? 'border-ink bg-ink text-white' : 'border-rule text-muted hover:text-ink hover:border-ink')}
              >
                <FolderOpen size={10} /> Add to existing project
              </button>
              {mode === 'existing' && (
                <select
                  value={targetCode}
                  onChange={e => setTargetCode(e.target.value)}
                  className="border border-rule bg-white px-2 py-1.5 text-xs font-mono text-ink focus:outline-none"
                >
                  <option value="">— select project —</option>
                  {projects.map(p => (
                    <option key={p.code} value={p.code}>{p.code} — {p.name}</option>
                  ))}
                </select>
              )}
            </div>
          </div>

          {/* ── Project details (new mode only) ── */}
          {mode === 'new' && (
            <div className="px-5 py-4">
              <p className="tbl-lbl mb-3">Project Details</p>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                <div className="col-span-2">
                  <label className="field-label">Project Name</label>
                  <input
                    value={proj.name}
                    onChange={e => setProj(p => ({ ...p, name: e.target.value }))}
                    placeholder="e.g. Brand Campaign 2025"
                    className="w-full border border-rule bg-white px-2 py-1.5 text-sm text-ink focus:outline-none"
                  />
                </div>
                <div>
                  <label className="field-label">Code</label>
                  <input
                    value={proj.code}
                    onChange={e => setProj(p => ({ ...p, code: e.target.value.toUpperCase() }))}
                    placeholder="AC-001"
                    className="w-full border border-rule bg-white px-2 py-1.5 text-sm font-mono text-ink focus:outline-none"
                  />
                </div>
                <div>
                  <label className="field-label">Entity</label>
                  <select
                    value={proj.entity}
                    onChange={e => setProj(p => ({ ...p, entity: e.target.value as Entity }))}
                    className="w-full border border-rule bg-white px-2 py-1.5 text-sm text-ink focus:outline-none"
                  >
                    {ENTITIES.map(e => <option key={e} value={e}>{e}</option>)}
                  </select>
                </div>
                <div>
                  <label className="field-label">Budget (£)</label>
                  <input
                    type="number" min="0" step="100"
                    value={proj.budget}
                    onChange={e => setProj(p => ({ ...p, budget: parseFloat(e.target.value) || 0 }))}
                    className="w-full border border-rule bg-white px-2 py-1.5 text-sm font-mono text-ink focus:outline-none"
                  />
                </div>
                <div>
                  <label className="field-label">Start Date</label>
                  <input
                    type="date" value={proj.date}
                    onChange={e => setProj(p => ({ ...p, date: e.target.value }))}
                    className="w-full border border-rule bg-white px-2 py-1.5 text-sm font-mono text-ink focus:outline-none"
                  />
                </div>
                <div>
                  <label className="field-label">Status</label>
                  <select
                    value={proj.status}
                    onChange={e => setProj(p => ({ ...p, status: e.target.value as ProjectStatus }))}
                    className="w-full border border-rule bg-white px-2 py-1.5 text-sm font-mono uppercase text-ink focus:outline-none"
                  >
                    {PROJ_STATS.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
                <div className="col-span-2 sm:col-span-3">
                  <label className="field-label">Notes</label>
                  <input
                    value={proj.notes}
                    onChange={e => setProj(p => ({ ...p, notes: e.target.value }))}
                    className="w-full border border-rule bg-white px-2 py-1.5 text-sm text-ink focus:outline-none"
                  />
                </div>
              </div>
            </div>
          )}

          {/* ── Costs ── */}
          <div className="px-5 py-4">
            <div className="flex items-center justify-between mb-3">
              <p className="tbl-lbl">Costs ({costs.length})</p>
              <button onClick={addCost} className="flex items-center gap-1 font-mono text-xs text-muted hover:text-ink transition-colors">
                <Plus size={10} /> Add row
              </button>
            </div>
            {costs.length === 0 ? (
              <p className="font-mono text-xs text-muted text-center py-4">No costs extracted — add rows manually if needed</p>
            ) : (
              <div className="overflow-x-auto -mx-1">
                <table className="w-full text-xs min-w-[640px]">
                  <thead>
                    <tr className="border-b border-rule">
                      {['Description', 'Category', 'Est.', 'Actual', 'Status', 'Due Date', ''].map(h => (
                        <th key={h} className="text-left font-mono text-[10px] uppercase tracking-wider text-muted pb-2 pr-2 last:pr-0 whitespace-nowrap">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-rule/50">
                    {costs.map(c => (
                      <tr key={c.id}>
                        <td className="py-1 pr-2">
                          <input
                            value={c.description}
                            onChange={e => updCost(c.id, { description: e.target.value })}
                            className="w-full border border-rule bg-white px-1.5 py-0.5 text-xs text-ink focus:outline-none min-w-[140px]"
                          />
                        </td>
                        <td className="py-1 pr-2">
                          <select
                            value={c.category}
                            onChange={e => updCost(c.id, { category: e.target.value as CostCategory })}
                            className="border border-rule bg-white px-1 py-0.5 text-xs font-mono text-ink focus:outline-none"
                          >
                            {COST_CATS.map(cat => <option key={cat} value={cat}>{cat}</option>)}
                          </select>
                        </td>
                        <td className="py-1 pr-2">
                          <input
                            type="number" value={c.estimated}
                            onChange={e => updCost(c.id, { estimated: parseFloat(e.target.value) || 0 })}
                            className="w-20 border border-rule bg-white px-1.5 py-0.5 text-xs font-mono text-right text-ink focus:outline-none"
                          />
                        </td>
                        <td className="py-1 pr-2">
                          <input
                            type="number" value={c.actual}
                            onChange={e => updCost(c.id, { actual: parseFloat(e.target.value) || 0 })}
                            className="w-20 border border-rule bg-white px-1.5 py-0.5 text-xs font-mono text-right text-ink focus:outline-none"
                          />
                        </td>
                        <td className="py-1 pr-2">
                          <select
                            value={c.status}
                            onChange={e => updCost(c.id, { status: e.target.value as CostStatus })}
                            className="border border-rule bg-white px-1 py-0.5 text-xs font-mono text-ink focus:outline-none"
                          >
                            {COST_STATS.map(s => <option key={s} value={s}>{s}</option>)}
                          </select>
                        </td>
                        <td className="py-1 pr-2">
                          <input
                            type="date" value={c.dueDate}
                            onChange={e => updCost(c.id, { dueDate: e.target.value })}
                            className="border border-rule bg-white px-1.5 py-0.5 text-xs font-mono text-ink focus:outline-none"
                          />
                        </td>
                        <td className="py-1">
                          <button onClick={() => setCosts(p => p.filter(x => x.id !== c.id))} className="text-muted hover:text-red-500 transition-colors">
                            <Trash2 size={11} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* ── Invoices ── */}
          <div className="px-5 py-4">
            <div className="flex items-center justify-between mb-3">
              <p className="tbl-lbl">Invoices ({invoices.length})</p>
              <button onClick={addInvoice} className="flex items-center gap-1 font-mono text-xs text-muted hover:text-ink transition-colors">
                <Plus size={10} /> Add row
              </button>
            </div>
            {invoices.length === 0 ? (
              <p className="font-mono text-xs text-muted text-center py-4">No invoices extracted — add rows manually if needed</p>
            ) : (
              <div className="space-y-1.5">
                {invoices.map(inv => (
                  <div key={inv.id} className="border border-rule bg-white">
                    {/* Main row */}
                    <div className="grid gap-1.5 p-2" style={{ gridTemplateColumns: '1fr 7rem 5.5rem 3rem 6.5rem 5.5rem 5.5rem auto' }}>
                      <div>
                        <label className="field-label">Party</label>
                        <input value={inv.party} onChange={e => updInv(inv.id, { party: e.target.value })}
                          placeholder="Supplier / client"
                          className="w-full border border-rule bg-paper px-1.5 py-0.5 text-xs text-ink focus:outline-none" />
                      </div>
                      <div>
                        <label className="field-label">Ref</label>
                        <input value={inv.ref} onChange={e => updInv(inv.id, { ref: e.target.value })}
                          placeholder="INV-001"
                          className="w-full border border-rule bg-paper px-1.5 py-0.5 text-xs font-mono text-ink focus:outline-none" />
                      </div>
                      <div>
                        <label className="field-label">Amount</label>
                        <input type="number" value={inv.amount} onChange={e => updInv(inv.id, { amount: parseFloat(e.target.value) || 0 })}
                          className="w-full border border-rule bg-paper px-1.5 py-0.5 text-xs font-mono text-right text-ink focus:outline-none" />
                      </div>
                      <div>
                        <label className="field-label">Cur</label>
                        <select value={inv.currency} onChange={e => updInv(inv.id, { currency: e.target.value })}
                          className="w-full border border-rule bg-paper px-1 py-0.5 text-xs font-mono text-ink focus:outline-none">
                          {['£', '$', '€', 'AED'].map(c => <option key={c}>{c}</option>)}
                        </select>
                      </div>
                      <div>
                        <label className="field-label">Due Date</label>
                        <input type="date" value={inv.due} onChange={e => updInv(inv.id, { due: e.target.value })}
                          className="w-full border border-rule bg-paper px-1.5 py-0.5 text-xs font-mono text-ink focus:outline-none" />
                      </div>
                      <div>
                        <label className="field-label">Type</label>
                        <select value={inv.type} onChange={e => updInv(inv.id, { type: e.target.value as InvoiceType })}
                          className="w-full border border-rule bg-paper px-1 py-0.5 text-xs font-mono text-ink focus:outline-none">
                          <option value="payable">Payable</option>
                          <option value="receivable">Receivable</option>
                        </select>
                      </div>
                      <div>
                        <label className="field-label">Status</label>
                        <select value={inv.status} onChange={e => updInv(inv.id, { status: e.target.value as InvoiceStatus })}
                          className="w-full border border-rule bg-paper px-1 py-0.5 text-xs font-mono text-ink focus:outline-none">
                          {INV_STATS.map(s => <option key={s} value={s}>{s}</option>)}
                        </select>
                      </div>
                      <div className="flex items-end gap-1 pb-0.5">
                        <button
                          onClick={() => updInv(inv.id, { _expanded: !inv._expanded })}
                          className="text-[9px] font-mono text-muted hover:text-ink transition-colors leading-none px-1 py-1 border border-rule"
                          title="Bank details"
                        >
                          £ bank
                        </button>
                        <button onClick={() => setInvoices(p => p.filter(x => x.id !== inv.id))} className="text-muted hover:text-red-500 transition-colors">
                          <X size={12} />
                        </button>
                      </div>
                    </div>
                    {/* Bank details (expanded) */}
                    {inv._expanded && (
                      <div className="border-t border-rule px-2 pb-2 pt-2 bg-blue-50/30">
                        <p className="field-label text-blue-600 mb-1.5">Bank Details</p>
                        <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
                          {([
                            { k: 'bankName' as const, label: 'Bank Name', placeholder: 'HSBC' },
                            { k: 'sortCode' as const, label: 'Sort Code', placeholder: '12-34-56' },
                            { k: 'accNum' as const, label: 'Account No', placeholder: '12345678' },
                            { k: 'accName' as const, label: 'Account Name', placeholder: 'Supplier Ltd' },
                            { k: 'iban' as const, label: 'IBAN', placeholder: 'GB29…' },
                            { k: 'swift' as const, label: 'SWIFT', placeholder: 'NWBK…' },
                          ]).map(({ k, label, placeholder }) => (
                            <div key={k}>
                              <label className="field-label">{label}</label>
                              <input
                                value={inv[k]}
                                onChange={e => updInv(inv.id, { [k]: e.target.value })}
                                placeholder={placeholder}
                                className="w-full border border-rule bg-white px-1.5 py-0.5 text-xs font-mono text-ink focus:outline-none"
                              />
                            </div>
                          ))}
                        </div>
                        <div className="mt-2">
                          <label className="field-label">Notes</label>
                          <input value={inv.notes} onChange={e => updInv(inv.id, { notes: e.target.value })}
                            className="w-full border border-rule bg-white px-1.5 py-0.5 text-xs text-ink focus:outline-none" />
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* ── Uncertain data ── */}
          {uncertain.length > 0 && (
            <div className="px-5 py-4 bg-amber-50/60">
              <div className="flex items-center gap-2 mb-2">
                <AlertCircle size={12} className="text-amber-600 flex-shrink-0" />
                <p className="tbl-lbl text-amber-800">Unrecognised / uncertain data — review manually</p>
              </div>
              <ul className="space-y-1">
                {uncertain.map((u, i) => (
                  <li key={i} className="font-mono text-xs text-amber-800 flex items-start gap-1.5">
                    <span className="mt-0.5 flex-shrink-0 text-amber-500">·</span>
                    <span>{u}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* ── Extraction error (still go to preview) ── */}
          {error && (
            <div className="px-5 py-3 bg-red-50">
              <p className="font-mono text-xs text-red-700 flex items-center gap-1.5">
                <AlertCircle size={11} className="flex-shrink-0" />
                {error}
              </p>
              <p className="font-mono text-[10px] text-red-600 mt-1 ml-4">
                Edit the data above manually, or go back to try a different file.
              </p>
            </div>
          )}
        </div>
      )}

      {/* ── Saving ── */}
      {step === 'saving' && (
        <div className="px-6 py-20 flex flex-col items-center gap-4">
          <div className="w-10 h-10 border-[3px] border-ink border-t-transparent rounded-full animate-spin" />
          <p className="font-mono text-sm text-ink uppercase tracking-wider">Saving…</p>
        </div>
      )}

      {/* ── Success ── */}
      {step === 'success' && successInfo && (
        <div className="px-6 py-14 flex flex-col items-center gap-6">
          <CheckCircle size={44} className="text-ac-green" />
          <div className="text-center space-y-1">
            <p className="font-semibold text-ink text-lg">
              {mode === 'new' ? 'Project created!' : 'Data imported!'}
            </p>
            <p className="font-mono text-xs text-muted">
              {successInfo.costs} cost{successInfo.costs !== 1 ? 's' : ''} and{' '}
              {successInfo.invoices} invoice{successInfo.invoices !== 1 ? 's' : ''} imported
              {mode === 'new' ? ` · Project code: ${successInfo.projectCode}` : ` to ${successInfo.projectCode}`}
            </p>
          </div>
          <div className="flex items-center gap-3">
            {onProjectCreated && (
              <button
                onClick={() => { onProjectCreated(successInfo.projectCode); handleClose() }}
                className="px-5 py-2 text-xs font-mono uppercase tracking-wider bg-ink text-white hover:bg-[#333] transition-colors"
              >
                Go to project →
              </button>
            )}
            <button
              onClick={handleClose}
              className="px-5 py-2 text-xs font-mono uppercase tracking-wider border border-rule text-muted hover:text-ink hover:border-ink transition-colors"
            >
              Close
            </button>
          </div>
        </div>
      )}
    </Modal>
  )
}
