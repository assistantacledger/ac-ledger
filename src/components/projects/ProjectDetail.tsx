'use client'

import { useState, useEffect, useRef } from 'react'
import { DragDropContext, Droppable, Draggable, DropResult } from '@hello-pangea/dnd'
import {
  ArrowLeft, Pencil, Plus, Trash2, Upload, FileText, X, Eye,
  ExternalLink, GripVertical, User, CheckCircle, ImageIcon, Download,
  Sparkles, AlertCircle, Link2, Link2Off, Printer,
  ChevronUp, ChevronDown, ChevronsUpDown, Table2,
} from 'lucide-react'
import { PaymentSheet } from './PaymentSheet'
import { sb } from '@/lib/supabase'
import { cn, fmt, fmtDate, todayISO } from '@/lib/format'
import { toast } from '@/lib/toast'
import { InvoiceModal } from '@/components/invoices/InvoiceModal'
import { InvoicePreviewModal } from '@/components/invoices/InvoicePreviewModal'
import { ExpenseModal } from '@/components/expenses/ExpenseModal'
import { ExpenseReimbursePDF } from '@/components/expenses/ExpenseReimbursePDF'
import type {
  Project, Invoice, Expense, ExpenseInsert, ExpenseUpdate, InvoiceInsert, InvoiceUpdate,
  ProjectNote, ProjectFile, ProjectCost, CostCategory, CostStatus,
} from '@/types'

// ─── Constants ───────────────────────────────────────────────────────────────

type Tab = 'overview' | 'invoices' | 'expenses' | 'costs' | 'payment-sheet' | 'files-notes'

const COST_CATEGORIES: CostCategory[] = ['Equipment', 'Travel', 'Crew', 'Talent', 'Venue', 'Software', 'Marketing', 'Other']
const COST_STATUSES: CostStatus[] = ['planned', 'confirmed', 'paid']

const COST_STATUS_CLS: Record<CostStatus, string> = {
  planned: 'badge-draft',
  confirmed: 'badge-submitted',
  paid: 'badge-paid',
}

type CostSortKey = 'description' | 'category' | 'estimated' | 'actual' | 'status' | 'dueDate' | 'hasInvoice'
type ReconLinks = { manual: { costId: string; invoiceId: string }[]; broken: { costId: string; invoiceId: string }[] }
const EMPTY_LINKS: ReconLinks = { manual: [], broken: [] }

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
  onDelete: () => void
  createExpense: (data: ExpenseInsert) => Promise<Expense>
  createInvoice?: (data: InvoiceInsert) => Promise<Invoice>
  updateInvoice?: (id: string, data: InvoiceUpdate) => Promise<Invoice>
  markInvoicePaid?: (id: string) => Promise<void>
  updateExpense?: (id: string, data: ExpenseUpdate) => Promise<Expense>
  anthropicKey?: string
}

export function ProjectDetail({ project, invoices, expenses, onBack, onEdit, onDelete, createExpense, createInvoice, updateInvoice, markInvoicePaid, updateExpense, anthropicKey }: Props) {
  const [tab, setTab] = useState<Tab>('overview')
  const [deleteConfirmProject, setDeleteConfirmProject] = useState(false)
  // Invoice editing from project tab
  const [editingInvoice, setEditingInvoice] = useState<Invoice | null>(null)
  // Expense print
  const [printingExpense, setPrintingExpense] = useState<Expense | null>(null)
  // Cost sorting (persisted per project)
  const [costSortKey, setCostSortKey] = useState<CostSortKey | null>(null)
  const [costSortDir, setCostSortDir] = useState<'asc' | 'desc'>('asc')
  // Reconciliation manual links
  const [reconLinks, setReconLinks] = useState<ReconLinks>(EMPTY_LINKS)
  const [linkingFrom, setLinkingFrom] = useState<{ side: 'cost' | 'invoice'; id: string } | null>(null)

  // Notes
  const [notes, setNotes] = useState<ProjectNote[]>([])
  const [noteText, setNoteText] = useState('')
  const [addingNote, setAddingNote] = useState(false)

  // Files
  const [files, setFiles] = useState<ProjectFile[]>([])
  const [uploading, setUploading] = useState(false)
  const [lightboxUrl, setLightboxUrl] = useState<{ url: string; name: string } | null>(null)
  const [deleteConfirmFile, setDeleteConfirmFile] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Costs
  const [costs, setCosts] = useState<ProjectCost[]>([])
  const [editingCost, setEditingCost] = useState<string | null>(null)
  const [newCost, setNewCost] = useState<Omit<ProjectCost, 'id'>>({
    description: '', category: 'Other', estimated: 0, actual: 0, status: 'planned', notes: '',
  })
  const [addingCost, setAddingCost] = useState(false)
  const [uploadingReceipt, setUploadingReceipt] = useState<string | null>(null)
  const [creatingExpense, setCreatingExpense] = useState<string | null>(null)

  // Quick-add modals
  const [invoiceModalOpen, setInvoiceModalOpen] = useState(false)
  const [expenseModalOpen, setExpenseModalOpen] = useState(false)

  // Invoice PDF preview
  const [previewInvoice, setPreviewInvoice] = useState<Invoice | null>(null)

  // Expense actions
  const [addingReceiptExpense, setAddingReceiptExpense] = useState<string | null>(null)
  const [approvingExpense, setApprovingExpense] = useState<string | null>(null)

  // Cost → invoice forms (keyed by cost.id)
  type ExtractedField = { value: unknown; confidence: number }
  type CostInvoiceForm = {
    open: boolean
    party: string; ref: string; due: string; currency: string; amount: number; notes: string
    bankName: string; sortCode: string; accNum: string; accName: string; iban: string; swift: string
    creating: boolean; extracting: boolean
    confidence: Record<string, number>  // field → 0-1, set after AI extraction
  }
  const BLANK_FORM: Omit<CostInvoiceForm, 'open'> = {
    party: '', ref: '', due: '', currency: '£', amount: 0, notes: '',
    bankName: '', sortCode: '', accNum: '', accName: '', iban: '', swift: '',
    creating: false, extracting: false, confidence: {},
  }
  const [invoiceForms, setInvoiceForms] = useState<Record<string, CostInvoiceForm>>({})

  function getCostForm(costId: string, cost: ProjectCost): CostInvoiceForm {
    return invoiceForms[costId] ?? {
      ...BLANK_FORM, open: false,
      party: cost.description, amount: cost.actual || cost.estimated,
      notes: `Cost item: ${cost.description}`,
    }
  }

  function getRawForm(costId: string): CostInvoiceForm {
    return invoiceForms[costId] ?? { ...BLANK_FORM, open: false }
  }

  function setCostForm(costId: string, patch: Partial<CostInvoiceForm>) {
    setInvoiceForms(prev => ({ ...prev, [costId]: { ...getRawForm(costId), ...patch } }))
  }

  async function createInvoiceFromCost(costId: string) {
    if (!createInvoice) return
    const cost = costs.find(c => c.id === costId)
    if (!cost) return
    const form = getCostForm(costId, cost)
    setCostForm(costId, { creating: true })
    try {
      const hasBankDetails = form.bankName || form.sortCode || form.accNum || form.accName || form.iban || form.swift
      const bankSummary = hasBankDetails
        ? `\nBank: ${form.bankName} | Sort: ${form.sortCode} | Acc: ${form.accNum} | Name: ${form.accName}${form.iban ? ` | IBAN: ${form.iban}` : ''}${form.swift ? ` | SWIFT: ${form.swift}` : ''}`
        : ''
      const bankDetails = hasBankDetails ? {
        accName: form.accName,
        bankName: form.bankName || undefined,
        sortCode: form.sortCode,
        accNum: form.accNum,
        iban: form.iban || undefined,
        swift: form.swift || undefined,
      } : null
      const data: InvoiceInsert = {
        type: 'payable',
        party: form.party || cost.description,
        ref: form.ref || '',
        amount: form.amount,
        currency: form.currency,
        due: form.due || null,
        status: 'pending',
        entity: project.entity,
        project_code: project.code,
        project_name: project.name,
        notes: (form.notes || `Cost: ${cost.description}`) + bankSummary,
        internal: null,
        line_items: null,
        recurring: false,
        pdf_url: cost.receiptUrl ?? null,
        payment_schedule: null,
        bank_details: bankDetails,
      }
      const created = await createInvoice(data)
      addManualLink(costId, created.id)
      setCostForm(costId, { open: false, creating: false })
      toast('Payable invoice created and linked')
    } catch (e) {
      toast(`Failed: ${String(e)}`, 'error')
      setCostForm(costId, { creating: false })
    }
  }

  async function extractCostPdf(costId: string) {
    if (!anthropicKey) { toast('Anthropic API key not set — add it in Settings', 'error'); return }
    const cost = costs.find(c => c.id === costId)
    if (!cost?.receiptUrl) return
    setCostForm(costId, { extracting: true, open: true })
    try {
      const response = await fetch(cost.receiptUrl)
      const blob = await response.blob()
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = e => resolve((e.target?.result as string).split(',')[1])
        reader.onerror = reject
        reader.readAsDataURL(blob)
      })
      const res = await fetch('/api/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ base64, mediaType: blob.type || 'application/pdf', apiKey: anthropicKey }),
      })
      const data = await res.json() as { extracted?: Record<string, ExtractedField>; error?: string }
      if (!res.ok || data.error) { toast(data.error ?? 'Extraction failed', 'error'); setCostForm(costId, { extracting: false }); return }
      const ext = data.extracted!
      const cur = getRawForm(costId)
      const conf: Record<string, number> = {}
      const pick = (key: string, fallback: string): string => {
        const f = ext[key]
        if (f && f.value !== null && String(f.value).trim()) {
          conf[key] = Number(f.confidence ?? 0)
          return String(f.value)
        }
        return fallback
      }
      setCostForm(costId, {
        extracting: false,
        party:    pick('party',    cur.party || cost.description),
        ref:      pick('ref',      cur.ref),
        amount:   ext.amount?.value ? Number(ext.amount.value) : (cur.amount || cost.actual || cost.estimated),
        currency: pick('currency', cur.currency || '£'),
        due:      pick('due',      cur.due),
        bankName: pick('bankName', cur.bankName),
        sortCode: pick('sortCode', cur.sortCode),
        accNum:   pick('accNum',   cur.accNum),
        accName:  pick('accName',  cur.accName),
        iban:     pick('iban',     cur.iban),
        swift:    pick('swift',    cur.swift),
        confidence: { ...conf, amount: Number(ext.amount?.confidence ?? 0) },
      })
      toast('Details extracted from PDF')
    } catch (e) {
      toast(`Extraction failed: ${String(e)}`, 'error')
      setCostForm(costId, { extracting: false })
    }
  }

  // PDF scan in Files tab
  const [scanFile, setScanFile] = useState<{ base64: string; mediaType: string; name: string } | null>(null)
  const [scanning, setScanning] = useState(false)
  const [scanExtracted, setScanExtracted] = useState<Partial<InvoiceInsert> | null>(null)
  const [scanError, setScanError] = useState('')
  const [savingScanned, setSavingScanned] = useState(false)
  const [dragOver, setDragOver] = useState(false)

  const code = project.code

  // Load from localStorage
  useEffect(() => {
    setNotes(lsGet<ProjectNote[]>(`project_notes_${code}`, []))
    setFiles(lsGet<ProjectFile[]>(`project_files_${code}`, []))
    setCosts(lsGet<ProjectCost[]>(`project_costs_${code}`, []))
    setReconLinks(lsGet<ReconLinks>(`project_cost_links_${code}`, EMPTY_LINKS))
    const savedSort = lsGet<{ key: CostSortKey | null; dir: 'asc' | 'desc' } | null>(`project_costs_sort_${code}`, null)
    if (savedSort) { setCostSortKey(savedSort.key); setCostSortDir(savedSort.dir) }
    else { setCostSortKey(null); setCostSortDir('asc') }
    setTab('overview')
    setNoteText('')
    setAddingNote(false)
    setAddingCost(false)
    setEditingCost(null)
    setDeleteConfirmProject(false)
    setLinkingFrom(null)
    setEditingInvoice(null)
  }, [code])

  // ── Filtered data ──
  const projInvoices = invoices.filter(i => i.project_code === code)
  const projExpenses = expenses.filter(e => e.project_code === code)

  // ── Financial summary ──
  const totalBillable = projInvoices.filter(i => i.type === 'receivable').reduce((t, i) => t + Number(i.amount), 0)
  const totalCollected = projInvoices.filter(i => i.type === 'receivable' && i.status === 'paid').reduce((t, i) => t + Number(i.amount), 0)
  const totalOutgoings = projInvoices.filter(i => i.type === 'payable').reduce((t, i) => t + Number(i.amount), 0)
  const totalExpenses = projExpenses.reduce((t, e) => t + Number(e.total), 0)
  // Exclude employee costs that have been promoted to Supabase expenses (avoid double-counting)
  const totalCosts = costs.filter(c => !c.expenseId).reduce((t, c) => t + Number(c.actual || c.estimated), 0)
  const netPosition = totalBillable - totalOutgoings - totalExpenses - totalCosts

  // ── Delete project ──
  function handleDeleteProject() {
    if (!deleteConfirmProject) {
      setDeleteConfirmProject(true)
      setTimeout(() => setDeleteConfirmProject(false), 4000)
      return
    }
    onDelete()
  }

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

  function updateCost(id: string, patch: Partial<ProjectCost>) {
    saveCosts(costs.map(c => c.id === id ? { ...c, ...patch } : c))
  }

  function deleteCost(id: string) {
    saveCosts(costs.filter(c => c.id !== id))
    if (editingCost === id) setEditingCost(null)
  }

  // Drag-and-drop reorder
  function handleDragEnd(result: DropResult) {
    if (!result.destination) return
    const reordered = Array.from(displayCosts)
    const [removed] = reordered.splice(result.source.index, 1)
    reordered.splice(result.destination.index, 0, removed)
    saveCosts(reordered)
  }

  // Receipt upload per cost
  async function handleCostReceiptUpload(costId: string, file: File) {
    if (!file.type.match(/^(image\/(jpeg|png|gif|webp)|application\/pdf)$/)) {
      alert('Only JPG, PNG, GIF, WebP, and PDF files are supported.')
      return
    }
    setUploadingReceipt(costId)
    try {
      const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_')
      const path = `projects/${code}/costs/${costId}-${Date.now()}-${safeName}`
      const { error } = await sb.storage.from('invoices').upload(path, file, { upsert: true })
      if (error) throw error
      const { data: urlData } = sb.storage.from('invoices').getPublicUrl(path)
      updateCost(costId, {
        receiptUrl: urlData.publicUrl,
        receiptPath: path,
        receiptType: file.type.startsWith('image/') ? 'image' : 'pdf',
      })
    } catch (e) {
      alert(`Upload failed: ${String(e)}`)
    } finally {
      setUploadingReceipt(null)
    }
  }

  function openCostReceiptPicker(costId: string) {
    const inp = document.createElement('input')
    inp.type = 'file'
    inp.accept = 'image/jpeg,image/png,image/gif,image/webp,application/pdf'
    inp.onchange = (e) => {
      const f = (e.target as HTMLInputElement).files?.[0]
      if (f) handleCostReceiptUpload(costId, f)
    }
    document.body.appendChild(inp)
    inp.click()
    setTimeout(() => document.body.removeChild(inp), 60000)
  }

  async function removeCostReceipt(costId: string) {
    const cost = costs.find(c => c.id === costId)
    if (!cost?.receiptPath) return
    try { await sb.storage.from('invoices').remove([cost.receiptPath]) } catch { /* ignore */ }
    updateCost(costId, { receiptUrl: undefined, receiptPath: undefined, receiptType: undefined })
  }

  // Create Supabase expense from cost
  async function handleCreateExpense(costId: string) {
    const cost = costs.find(c => c.id === costId)
    if (!cost?.employeeName?.trim()) return
    setCreatingExpense(costId)
    try {
      const amount = cost.actual || cost.estimated
      const data: ExpenseInsert = {
        employee: cost.employeeName,
        date: todayISO(),
        entity: project.entity,
        status: 'submitted',
        project_code: project.code,
        project_name: project.name,
        notes: cost.description,
        line_items: [{ description: cost.description, category: 'Other', amount }],
        receipt_urls: cost.receiptUrl ? [cost.receiptUrl] : null,
        bank_details: null,
        total: amount,
      }
      const created = await createExpense(data)
      updateCost(costId, { expenseId: created.id })
    } catch (e) {
      alert(`Failed to create expense: ${String(e)}`)
    } finally {
      setCreatingExpense(null)
    }
  }

  // ── CSV export ──
  function exportCostsCSV() {
    const header = 'Description,Category,Estimated,Actual,Status,Due Date,Employee,Receipt URL,Notes'
    const rows = costs.map(c => [
      `"${c.description.replace(/"/g, '""')}"`,
      c.category,
      c.estimated,
      c.actual,
      c.status,
      c.dueDate ?? '',
      c.employeeName ?? '',
      c.receiptUrl ?? '',
      `"${(c.notes ?? '').replace(/"/g, '""')}"`,
    ].join(','))
    const csv = [header, ...rows].join('\n')
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }))
    a.download = `${code}-costs.csv`
    a.click()
    toast('CSV exported')
  }

  // ── Cost sorting ──
  function toggleCostSort(key: CostSortKey) {
    const newDir = costSortKey === key ? (costSortDir === 'asc' ? 'desc' : 'asc') : 'asc'
    const newKey = costSortKey === key && costSortDir === 'desc' ? null : key
    const dir = newKey === null ? 'asc' : (costSortKey === key ? newDir : 'asc')
    setCostSortKey(newKey)
    setCostSortDir(dir)
    lsSet(`project_costs_sort_${code}`, { key: newKey, dir })
  }

  function SortIndicator({ k }: { k: CostSortKey }) {
    if (costSortKey !== k) return <ChevronsUpDown size={9} className="opacity-30 ml-0.5" />
    return costSortDir === 'asc' ? <ChevronUp size={9} className="ml-0.5" /> : <ChevronDown size={9} className="ml-0.5" />
  }

  const displayCosts = costSortKey === null ? costs : [...costs].sort((a, b) => {
    let av: string | number = '', bv: string | number = ''
    if (costSortKey === 'description') { av = a.description; bv = b.description }
    else if (costSortKey === 'category') { av = a.category; bv = b.category }
    else if (costSortKey === 'estimated') { av = a.estimated; bv = b.estimated }
    else if (costSortKey === 'actual') { av = a.actual; bv = b.actual }
    else if (costSortKey === 'status') { av = a.status; bv = b.status }
    else if (costSortKey === 'dueDate') { av = a.dueDate ?? ''; bv = b.dueDate ?? '' }
    else if (costSortKey === 'hasInvoice') { av = a.expenseId ? 1 : 0; bv = b.expenseId ? 1 : 0 }
    if (av < bv) return costSortDir === 'asc' ? -1 : 1
    if (av > bv) return costSortDir === 'asc' ? 1 : -1
    return 0
  })

  // ── Reconciliation links ──
  function saveReconLinks(next: ReconLinks) {
    setReconLinks(next)
    lsSet(`project_cost_links_${code}`, next)
  }

  function addManualLink(costId: string, invoiceId: string) {
    // Remove any broken entry for this pair
    const broken = reconLinks.broken.filter(b => !(b.costId === costId && b.invoiceId === invoiceId))
    // Remove from manual if already there (shouldn't happen, but safe)
    const manual = reconLinks.manual.filter(m => m.costId !== costId && m.invoiceId !== invoiceId)
    saveReconLinks({ manual: [...manual, { costId, invoiceId }], broken })
    setLinkingFrom(null)
    toast('Linked cost to invoice')
  }

  function removeLink(costId: string, invoiceId: string, wasManual: boolean) {
    if (wasManual) {
      saveReconLinks({ ...reconLinks, manual: reconLinks.manual.filter(m => !(m.costId === costId && m.invoiceId === invoiceId)) })
    } else {
      // Break the auto-match
      saveReconLinks({ ...reconLinks, broken: [...reconLinks.broken, { costId, invoiceId }] })
    }
    toast('Unlinked')
  }

  // ── Add invoice as cost ──
  function addCostFromInvoice(inv: Invoice) {
    const costStatus: CostStatus = inv.status === 'paid' ? 'paid' : 'confirmed'
    const entry: ProjectCost = {
      id: crypto.randomUUID(),
      description: [inv.party, inv.ref].filter(Boolean).join(' — '),
      category: 'Other',
      estimated: Number(inv.amount),
      actual: Number(inv.amount),
      status: costStatus,
      notes: `From invoice ${inv.ref ?? inv.id.slice(0, 8)}`,
    }
    saveCosts([...costs, entry])
    toast(`Added "${entry.description}" to costs`)
  }

  // ── Add receipt to expense ──
  async function addReceiptToExpense(expId: string, file: File) {
    if (!file.type.match(/^(image\/(jpeg|png|gif|webp)|application\/pdf)$/)) {
      alert('Only JPG, PNG, GIF, WebP, and PDF files are supported.')
      return
    }
    setAddingReceiptExpense(expId)
    try {
      const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_')
      const path = `receipts/${Date.now()}-${safeName}`
      const { error } = await sb.storage.from('invoices').upload(path, file, { upsert: false })
      if (error) throw error
      const { data: urlData } = sb.storage.from('invoices').getPublicUrl(path)
      const exp = projExpenses.find(e => e.id === expId)
      const existing = exp?.receipt_urls ?? []
      await sb.from('expenses').update({ receipt_urls: [...existing, urlData.publicUrl] }).eq('id', expId)
      toast('Receipt added')
    } catch (e) {
      alert(`Upload failed: ${String(e)}`)
    } finally {
      setAddingReceiptExpense(null)
    }
  }

  function openExpenseReceiptPicker(expId: string) {
    const inp = document.createElement('input')
    inp.type = 'file'
    inp.accept = 'image/jpeg,image/png,image/gif,image/webp,application/pdf'
    inp.onchange = (e) => {
      const f = (e.target as HTMLInputElement).files?.[0]
      if (f) addReceiptToExpense(expId, f)
    }
    document.body.appendChild(inp)
    inp.click()
    setTimeout(() => document.body.removeChild(inp), 60000)
  }

  // ── Approve expense ──
  async function approveExpense(expId: string) {
    setApprovingExpense(expId)
    try {
      const { error } = await sb.from('expenses').update({ status: 'approved' }).eq('id', expId)
      if (error) throw error
      toast('Expense approved')
    } catch (e) {
      toast(`Failed: ${String(e)}`, 'error')
    } finally {
      setApprovingExpense(null)
    }
  }

  // ── Print financial summary ──
  function printSummary() {
    const totalOutgoingsAll = totalOutgoings + totalExpenses + totalCosts
    const el = document.createElement('div')
    el.id = '__proj_summary__'
    el.innerHTML = `
      <style>
        @media print {
          body > *:not(#__proj_summary__) { display: none !important; }
          #__proj_summary__ { display: block !important; }
        }
        #__proj_summary__ {
          font-family: 'JetBrains Mono', monospace;
          padding: 40px;
          max-width: 794px;
          margin: 0 auto;
          color: #1a1a1a;
        }
        #__proj_summary__ h1 { font-size: 22px; font-weight: 700; margin: 0 0 4px 0; font-family: 'Outfit', sans-serif; }
        #__proj_summary__ h2 { font-size: 11px; text-transform: uppercase; letter-spacing: 0.1em; color: #666; margin: 0 0 24px 0; font-weight: 400; }
        #__proj_summary__ .summary-grid { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 16px; margin-bottom: 24px; }
        #__proj_summary__ .stat { border: 1px solid #e2e2e0; padding: 12px 14px; }
        #__proj_summary__ .stat-label { font-size: 9px; text-transform: uppercase; letter-spacing: 0.1em; color: #9a9a9a; }
        #__proj_summary__ .stat-val { font-size: 18px; font-weight: 700; margin-top: 4px; }
        #__proj_summary__ .net-positive { color: #3a7a5a; }
        #__proj_summary__ .net-negative { color: #c0392b; }
        #__proj_summary__ table { width: 100%; border-collapse: collapse; font-size: 11px; }
        #__proj_summary__ th { text-align: left; font-size: 9px; text-transform: uppercase; letter-spacing: 0.08em; color: #9a9a9a; border-bottom: 1px solid #1a1a1a; padding: 6px 8px; }
        #__proj_summary__ td { padding: 6px 8px; border-bottom: 1px solid #e2e2e0; }
        #__proj_summary__ .tr { text-align: right; }
        #__proj_summary__ hr { border: none; border-top: 2px solid #1a1a1a; margin: 20px 0 16px; }
        #__proj_summary__ .footer { font-size: 9px; color: #9a9a9a; margin-top: 32px; }
      </style>
      <h1>${project.name}</h1>
      <h2>${project.code} · ${project.entity} · ${fmtDate(project.date)}</h2>
      <div class="summary-grid">
        <div class="stat"><div class="stat-label">Budget</div><div class="stat-val">${project.budget > 0 ? fmt(project.budget) : '—'}</div></div>
        <div class="stat"><div class="stat-label">Total Billable</div><div class="stat-val">${fmt(totalBillable)}</div></div>
        <div class="stat"><div class="stat-label">Collected</div><div class="stat-val">${fmt(totalCollected)}</div></div>
        <div class="stat"><div class="stat-label">Payable Invoices</div><div class="stat-val">${fmt(totalOutgoings)}</div></div>
        <div class="stat"><div class="stat-label">Expenses</div><div class="stat-val">${fmt(totalExpenses)}</div></div>
        <div class="stat"><div class="stat-label">Direct Costs</div><div class="stat-val">${fmt(totalCosts)}</div></div>
      </div>
      <div class="stat" style="margin-bottom:24px">
        <div class="stat-label">Net Position (Billable − All Outgoings)</div>
        <div class="stat-val ${netPosition >= 0 ? 'net-positive' : 'net-negative'}">${fmt(netPosition)}</div>
      </div>
      <hr/>
      <table>
        <thead><tr><th>Description</th><th>Category</th><th>Status</th><th class="tr">Estimated</th><th class="tr">Actual</th></tr></thead>
        <tbody>
          ${costs.map(c => `<tr>
            <td>${c.description}${c.employeeName ? ` (${c.employeeName})` : ''}</td>
            <td>${c.category}</td>
            <td>${c.status}</td>
            <td class="tr">${fmt(c.estimated)}</td>
            <td class="tr">${fmt(c.actual)}</td>
          </tr>`).join('')}
          ${costs.length === 0 ? '<tr><td colspan="5" style="color:#9a9a9a;text-align:center;padding:16px">No costs recorded</td></tr>' : ''}
        </tbody>
      </table>
      <p class="footer">Generated ${new Date().toLocaleString('en-GB')} · AC Ledger</p>
    `
    document.body.appendChild(el)
    window.print()
    setTimeout(() => document.body.removeChild(el), 1000)
  }

  // ── PDF scan in files tab ──
  function handlePdfDrop(file: File) {
    if (!file.type.includes('pdf') && !file.type.startsWith('image/')) return
    const reader = new FileReader()
    reader.onload = e => {
      const dataUrl = e.target?.result as string
      setScanFile({ base64: dataUrl.split(',')[1], mediaType: file.type, name: file.name })
      setScanExtracted(null)
      setScanError('')
    }
    reader.readAsDataURL(file)
  }

  async function handleScanPdf() {
    if (!scanFile || !anthropicKey) {
      setScanError('Anthropic API key not set — add it in Settings')
      return
    }
    setScanning(true)
    setScanError('')
    try {
      const res = await fetch('/api/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ base64: scanFile.base64, mediaType: scanFile.mediaType, apiKey: anthropicKey }),
      })
      const data = await res.json() as { extracted?: Record<string, { value: unknown }>; error?: string }
      if (!res.ok || data.error) { setScanError(data.error ?? 'Scan failed'); return }
      const ext = data.extracted!
      setScanExtracted({
        type: 'payable',
        party: String(ext.party?.value ?? ''),
        ref: String(ext.ref?.value ?? ''),
        amount: Number(ext.amount?.value ?? 0),
        currency: String(ext.currency?.value ?? '£'),
        due: ext.due?.value ? String(ext.due.value) : null,
        project_code: project.code,
        project_name: project.name,
        entity: project.entity,
        status: 'pending',
        notes: null,
        internal: null,
        line_items: null,
        recurring: false,
        pdf_url: null,
        payment_schedule: null,
      })
    } catch (e) {
      setScanError(String(e))
    } finally {
      setScanning(false)
    }
  }

  async function saveScannedInvoice() {
    if (!scanExtracted || !createInvoice) return
    setSavingScanned(true)
    try {
      await createInvoice(scanExtracted as InvoiceInsert)
      setScanFile(null)
      setScanExtracted(null)
      toast('Invoice created from PDF')
    } catch (e) {
      setScanError(String(e))
    } finally {
      setSavingScanned(false)
    }
  }

  // ─── Render ───────────────────────────────────────────────────────────────

  const payableCount = projInvoices.filter(i => i.type === 'payable').length
  const TABS: { key: Tab; label: string }[] = [
    { key: 'overview',       label: 'Overview' },
    { key: 'invoices',       label: `Invoices (${projInvoices.length})` },
    { key: 'expenses',       label: `Expenses (${projExpenses.length})` },
    { key: 'costs',          label: `Costs (${costs.length})` },
    { key: 'payment-sheet',  label: `Payment Sheet${payableCount > 0 ? ` (${payableCount})` : ''}` },
    { key: 'files-notes',    label: `Files & Notes (${files.length + notes.length})` },
  ]

  return (
    <div className="flex flex-col flex-1 min-h-0">
      {/* Header */}
      <div className="flex-shrink-0 px-6 py-4 border-b border-rule bg-white flex items-center gap-4 flex-wrap">
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
        {createInvoice && (
          <button onClick={() => setInvoiceModalOpen(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-mono uppercase tracking-wider border border-rule text-muted hover:text-ink hover:border-ink transition-colors">
            <Plus size={11} /> Invoice
          </button>
        )}
        <button onClick={() => setExpenseModalOpen(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-mono uppercase tracking-wider border border-rule text-muted hover:text-ink hover:border-ink transition-colors">
          <Plus size={11} /> Expense
        </button>
        <div className="w-px h-4 bg-rule" />
        <button
          onClick={handleDeleteProject}
          className={cn(
            'flex items-center gap-1.5 px-3 py-1.5 text-xs font-mono uppercase tracking-wider transition-colors',
            deleteConfirmProject
              ? 'bg-red-600 text-white'
              : 'border border-rule text-muted hover:text-red-500 hover:border-red-300'
          )}
        >
          <Trash2 size={11} /> {deleteConfirmProject ? 'Confirm Delete' : 'Delete'}
        </button>
        <button onClick={onEdit} className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-mono uppercase tracking-wider border border-rule text-muted hover:text-ink hover:border-ink transition-colors">
          <Pencil size={11} /> Edit
        </button>
      </div>

      {/* Tab bar */}
      <div className="flex-shrink-0 border-b border-rule bg-cream px-6 flex gap-0 overflow-x-auto">
        {TABS.map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={cn(
              'px-4 py-2.5 font-mono text-xs uppercase tracking-wider border-b-2 transition-colors -mb-px whitespace-nowrap',
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
            <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-3">
              {[
                { label: 'Billable', val: totalBillable, sub: `${fmt(totalCollected)} collected`, color: 'before:bg-ac-green' },
                { label: 'Outgoings', val: totalOutgoings, sub: 'payable invoices', color: 'before:bg-ac-amber' },
                { label: 'Expenses', val: totalExpenses, sub: `${projExpenses.length} claim${projExpenses.length !== 1 ? 's' : ''}`, color: 'before:bg-blue-500' },
                { label: 'Costs', val: totalCosts, sub: `${costs.filter(c => !c.expenseId).length} direct`, color: 'before:bg-purple-500' },
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

            {/* ── Reconciliation ── */}
            {(costs.length > 0 || projInvoices.length > 0) && (() => {
              const payableInvoices = projInvoices.filter(i => i.type === 'payable')
              const matchedCostIds = new Set<string>()
              const matchedInvIds = new Set<string>()
              type MatchRow = { costId: string; invoiceId: string; isManual: boolean }
              const matchRows: MatchRow[] = []

              // Manual links first
              for (const link of reconLinks.manual) {
                const cost = costs.find(c => c.id === link.costId)
                const inv = payableInvoices.find(i => i.id === link.invoiceId)
                if (cost && inv && !matchedCostIds.has(cost.id) && !matchedInvIds.has(inv.id)) {
                  matchRows.push({ ...link, isManual: true })
                  matchedCostIds.add(cost.id); matchedInvIds.add(inv.id)
                }
              }

              // Auto-match (skip broken, skip already matched, skip employee costs)
              for (const cost of costs.filter(c => !c.expenseId)) {
                if (matchedCostIds.has(cost.id)) continue
                const costAmt = cost.actual || cost.estimated
                for (const inv of payableInvoices) {
                  if (matchedInvIds.has(inv.id)) continue
                  if (reconLinks.broken.some(b => b.costId === cost.id && b.invoiceId === inv.id)) continue
                  const invAmt = Number(inv.amount)
                  const amtMatch = costAmt > 0 && Math.abs(costAmt - invAmt) / Math.max(costAmt, invAmt) <= 0.10
                  const descMatch = cost.description.toLowerCase().includes((inv.party ?? '').toLowerCase().slice(0, 4)) ||
                    (inv.party ?? '').toLowerCase().includes(cost.description.toLowerCase().slice(0, 4))
                  if (amtMatch || (descMatch && invAmt > 0)) {
                    matchRows.push({ costId: cost.id, invoiceId: inv.id, isManual: false })
                    matchedCostIds.add(cost.id); matchedInvIds.add(inv.id); break
                  }
                }
              }

              const unmatchedCosts = costs.filter(c => !c.expenseId && !matchedCostIds.has(c.id))
              const unmatchedInvoices = payableInvoices.filter(i => !matchedInvIds.has(i.id))

              if (matchRows.length === 0 && unmatchedCosts.length === 0 && unmatchedInvoices.length === 0) return null

              return (
                <div className="bg-white border border-rule" onClick={() => setLinkingFrom(null)}>
                  <div className="px-4 py-3 border-b border-rule flex items-center gap-3">
                    <p className="tbl-lbl">Cost Reconciliation</p>
                    <span className="font-mono text-[10px]"><span className="text-ac-green">{matchRows.length} matched</span> · <span className="text-ac-amber">{unmatchedCosts.length} unmatched</span> · <span className="text-blue-500">{unmatchedInvoices.length} unlinked</span></span>
                  </div>

                  {/* Column labels */}
                  <div className="grid grid-cols-[1fr_32px_1fr] border-b border-rule bg-paper/50">
                    <div className="px-4 py-1.5 tbl-lbl">Costs</div>
                    <div />
                    <div className="px-4 py-1.5 tbl-lbl">Payable Invoices</div>
                  </div>

                  {/* Matched pairs */}
                  {matchRows.map(({ costId, invoiceId, isManual }) => {
                    const cost = costs.find(c => c.id === costId)!
                    const inv = payableInvoices.find(i => i.id === invoiceId)!
                    return (
                      <div key={`${costId}-${invoiceId}`} className="grid grid-cols-[1fr_32px_1fr] border-b border-rule last:border-0 bg-green-50/30">
                        <div className="px-4 py-2.5 flex items-center gap-2 min-w-0">
                          <div className="w-2 h-2 rounded-full bg-ac-green flex-shrink-0" />
                          <div className="min-w-0">
                            <p className="text-xs text-ink truncate">{cost.description}</p>
                            <p className="font-mono text-[10px] text-muted">{fmt(cost.actual || cost.estimated)}</p>
                          </div>
                        </div>
                        <div className="flex items-center justify-center">
                          <button onClick={e => { e.stopPropagation(); removeLink(costId, invoiceId, isManual) }}
                            title="Unlink" className="text-ac-green hover:text-red-500 transition-colors">
                            <Link2 size={13} />
                          </button>
                        </div>
                        <div className="px-4 py-2.5 flex items-center gap-2 min-w-0">
                          <div className="min-w-0">
                            <p className="text-xs text-ink truncate">{inv.party}</p>
                            <p className="font-mono text-[10px] text-muted">{inv.ref ? `${inv.ref} · ` : ''}{fmt(inv.amount, inv.currency)}</p>
                          </div>
                          {isManual && <span className="font-mono text-[9px] text-ac-green flex-shrink-0">manual</span>}
                        </div>
                      </div>
                    )
                  })}

                  {/* Unmatched costs (left only) */}
                  {unmatchedCosts.map(cost => (
                    <div key={cost.id} className="grid grid-cols-[1fr_32px_1fr] border-b border-rule last:border-0">
                      <div className="px-4 py-2.5 flex items-center gap-2 min-w-0">
                        <div className="w-2 h-2 rounded-full bg-ac-amber flex-shrink-0" />
                        <div className="min-w-0">
                          <p className="text-xs text-ink truncate">{cost.description}</p>
                          <p className="font-mono text-[10px] text-muted">{fmt(cost.actual || cost.estimated)}</p>
                        </div>
                      </div>
                      <div className="flex items-center justify-center">
                        <button onClick={e => { e.stopPropagation(); setLinkingFrom(f => f?.id === cost.id ? null : { side: 'cost', id: cost.id }) }}
                          title="Link to invoice" className="text-muted hover:text-ink transition-colors">
                          <Link2Off size={13} />
                        </button>
                      </div>
                      <div className="px-4 py-2.5 relative">
                        {linkingFrom?.id === cost.id && linkingFrom.side === 'cost' && (
                          <div className="absolute left-2 top-0 z-10 bg-white border border-rule shadow-lg min-w-[200px]" onClick={e => e.stopPropagation()}>
                            <p className="px-3 py-1.5 tbl-lbl border-b border-rule">Link to invoice</p>
                            {unmatchedInvoices.length === 0
                              ? <p className="px-3 py-2 font-mono text-[10px] text-muted">No unlinked invoices</p>
                              : unmatchedInvoices.map(inv => (
                                <button key={inv.id} onClick={() => addManualLink(cost.id, inv.id)}
                                  className="w-full flex items-start gap-2 px-3 py-2 hover:bg-cream text-left border-b border-rule last:border-0">
                                  <div>
                                    <p className="text-xs text-ink">{inv.party}</p>
                                    <p className="font-mono text-[10px] text-muted">{inv.ref ? `${inv.ref} · ` : ''}{fmt(inv.amount)}</p>
                                  </div>
                                </button>
                              ))}
                          </div>
                        )}
                      </div>
                    </div>
                  ))}

                  {/* Unmatched invoices (right only) */}
                  {unmatchedInvoices.map(inv => (
                    <div key={inv.id} className="grid grid-cols-[1fr_32px_1fr] border-b border-rule last:border-0">
                      <div className="px-4 py-2.5 relative">
                        {linkingFrom?.id === inv.id && linkingFrom.side === 'invoice' && (
                          <div className="absolute right-2 top-0 z-10 bg-white border border-rule shadow-lg min-w-[200px]" onClick={e => e.stopPropagation()}>
                            <p className="px-3 py-1.5 tbl-lbl border-b border-rule">Link to cost</p>
                            {unmatchedCosts.length === 0
                              ? <p className="px-3 py-2 font-mono text-[10px] text-muted">No unmatched costs</p>
                              : unmatchedCosts.map(cost => (
                                <button key={cost.id} onClick={() => addManualLink(cost.id, inv.id)}
                                  className="w-full flex items-start gap-2 px-3 py-2 hover:bg-cream text-left border-b border-rule last:border-0">
                                  <div>
                                    <p className="text-xs text-ink">{cost.description}</p>
                                    <p className="font-mono text-[10px] text-muted">{fmt(cost.actual || cost.estimated)}</p>
                                  </div>
                                </button>
                              ))}
                          </div>
                        )}
                      </div>
                      <div className="flex items-center justify-center">
                        <button onClick={e => { e.stopPropagation(); setLinkingFrom(f => f?.id === inv.id ? null : { side: 'invoice', id: inv.id }) }}
                          title="Link to cost" className="text-muted hover:text-blue-500 transition-colors">
                          <Link2Off size={13} />
                        </button>
                      </div>
                      <div className="px-4 py-2.5 flex items-center gap-2 min-w-0">
                        <div className="w-2 h-2 rounded-full bg-blue-400 flex-shrink-0" />
                        <div className="min-w-0">
                          <p className="text-xs text-ink truncate">{inv.party}</p>
                          <p className="font-mono text-[10px] text-muted">{inv.ref ? `${inv.ref} · ` : ''}{fmt(inv.amount, inv.currency)}</p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )
            })()}

            {/* Export summary */}
            <div className="flex justify-end">
              <button onClick={printSummary}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-mono uppercase tracking-wider border border-rule text-muted hover:text-ink hover:border-ink transition-colors">
                <Download size={11} /> Export Summary PDF
              </button>
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
                      {['Ref', 'Party', 'Type', 'Due', 'Amount', 'Status', ''].map(h => (
                        <th key={h} className="tbl-lbl text-left px-4 py-2.5">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {projInvoices.map((inv, i) => (
                      <tr key={inv.id} className={cn('border-b border-rule last:border-0 group', i % 2 === 1 && 'bg-paper/40')}>
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
                        <td className="px-4 py-2">
                          <div className="row-actions justify-end gap-1">
                            {(() => {
                              // View Receipt — shows if cost linked to this invoice has a receipt
                              const link = reconLinks.manual.find(m => m.invoiceId === inv.id)
                              const linkedCost = link ? costs.find(c => c.id === link.costId) : null
                              if (!linkedCost?.receiptUrl) return null
                              return linkedCost.receiptType === 'image' ? (
                                <button onClick={() => setLightboxUrl({ url: linkedCost.receiptUrl!, name: linkedCost.description })}
                                  title="View cost receipt"
                                  className="flex items-center gap-1 font-mono text-[10px] px-1.5 py-0.5 text-muted hover:text-ink opacity-0 group-hover:opacity-100 transition-opacity border border-transparent hover:border-rule">
                                  <ImageIcon size={10} /> Receipt
                                </button>
                              ) : (
                                <a href={linkedCost.receiptUrl} target="_blank" rel="noopener noreferrer"
                                  title="View cost receipt PDF"
                                  className="flex items-center gap-1 font-mono text-[10px] px-1.5 py-0.5 text-muted hover:text-ink opacity-0 group-hover:opacity-100 transition-opacity border border-transparent hover:border-rule">
                                  <FileText size={10} /> Receipt
                                </a>
                              )
                            })()}
                            <button onClick={() => setPreviewInvoice(inv)} title="Preview PDF"
                              className="p-1 text-muted hover:text-ink transition-colors opacity-0 group-hover:opacity-100">
                              <Eye size={12} />
                            </button>
                            {updateInvoice && (
                              <button onClick={() => setEditingInvoice(inv)} title="Edit"
                                className="p-1 text-muted hover:text-ink transition-colors opacity-0 group-hover:opacity-100">
                                <Pencil size={12} />
                              </button>
                            )}
                            {markInvoicePaid && inv.status !== 'paid' && (
                              <button onClick={() => markInvoicePaid(inv.id)} title="Mark paid"
                                className="p-1 text-muted hover:text-ac-green transition-colors opacity-0 group-hover:opacity-100">
                                <CheckCircle size={12} />
                              </button>
                            )}
                            <button onClick={() => addCostFromInvoice(inv)} title="Add to costs"
                              className="font-mono text-[10px] px-1 text-muted hover:text-ink opacity-0 group-hover:opacity-100 whitespace-nowrap">
                              → Cost
                            </button>
                            {updateInvoice && (
                              <button onClick={async () => {
                                await updateInvoice(inv.id, { project_code: null, project_name: null })
                                toast('Unlinked from project')
                              }} title="Unlink from project"
                                className="p-1 text-muted hover:text-red-500 transition-colors opacity-0 group-hover:opacity-100">
                                <Link2Off size={12} />
                              </button>
                            )}
                          </div>
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
                <div className="divide-y divide-rule">
                  {projExpenses.map((exp, i) => {
                    const receipts = exp.receipt_urls ?? []
                    return (
                      <div key={exp.id} className={cn('px-4 py-3 group', i % 2 === 1 && 'bg-paper/30')}>
                        <div className="flex items-start gap-3 flex-wrap">
                          {/* Main info */}
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="text-sm font-semibold text-ink">{exp.employee}</span>
                              <span className="font-mono text-[10px] text-muted">{fmtDate(exp.date)}</span>
                              <span className={cn('badge', { submitted: 'badge-submitted', approved: 'badge-approved', paid: 'badge-paid' }[exp.status])}>{exp.status}</span>
                            </div>
                            {exp.notes && (
                              <p className="text-xs text-muted mt-0.5 truncate">{exp.notes}</p>
                            )}
                            {/* Line items summary */}
                            {exp.line_items && exp.line_items.length > 0 && (
                              <div className="flex flex-wrap gap-2 mt-1">
                                {exp.line_items.map((li, j) => (
                                  <span key={j} className="font-mono text-[10px] text-muted bg-cream px-1.5 py-0.5">
                                    {li.description} · {fmt(li.amount)}
                                  </span>
                                ))}
                              </div>
                            )}
                          </div>

                          {/* Amount */}
                          <span className="font-mono text-sm font-semibold text-ink whitespace-nowrap">{fmt(exp.total)}</span>

                          {/* Actions */}
                          <div className="flex items-center gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity flex-wrap">
                            {exp.status === 'submitted' && (
                              <button onClick={() => approveExpense(exp.id)} disabled={approvingExpense === exp.id}
                                className="flex items-center gap-1 font-mono text-[10px] px-2 py-1 bg-ac-green text-white hover:opacity-90 disabled:opacity-50 uppercase tracking-wider">
                                <CheckCircle size={10} /> {approvingExpense === exp.id ? '…' : 'Approve'}
                              </button>
                            )}
                            {updateExpense && (
                              <button onClick={() => { /* open edit modal */ }} title="Edit"
                                className="flex items-center gap-1 font-mono text-[10px] px-2 py-1 border border-rule text-muted hover:text-ink transition-colors">
                                <Pencil size={10} /> Edit
                              </button>
                            )}
                            <button onClick={() => { setPrintingExpense(exp); setTimeout(() => { window.print(); setPrintingExpense(null) }, 80) }}
                              title="Reimbursement PDF"
                              className="flex items-center gap-1 font-mono text-[10px] px-2 py-1 border border-rule text-muted hover:text-ink transition-colors">
                              <Printer size={10} /> PDF
                            </button>
                            <button onClick={() => openExpenseReceiptPicker(exp.id)} disabled={addingReceiptExpense === exp.id}
                              className="flex items-center gap-1 font-mono text-[10px] px-2 py-1 border border-rule text-muted hover:text-ink transition-colors disabled:opacity-50">
                              <Upload size={10} /> {addingReceiptExpense === exp.id ? '…' : 'Receipt'}
                            </button>
                          </div>
                        </div>

                        {/* Receipts row */}
                        {receipts.length > 0 && (
                          <div className="flex flex-wrap gap-2 mt-2">
                            {receipts.map((url, j) => {
                              const isPdf = url.includes('.pdf') || url.includes('pdf')
                              return (
                                <button
                                  key={j}
                                  onClick={() => isPdf ? window.open(url, '_blank') : setLightboxUrl({ url, name: `Receipt ${j + 1}` })}
                                  className="border border-rule overflow-hidden hover:opacity-80 transition-opacity"
                                  title={`Receipt ${j + 1}`}
                                >
                                  {isPdf ? (
                                    <div className="w-10 h-10 flex flex-col items-center justify-center bg-cream gap-0.5">
                                      <FileText size={12} className="text-muted" />
                                      <span className="font-mono text-[8px] text-muted">PDF</span>
                                    </div>
                                  ) : (
                                    // eslint-disable-next-line @next/next/no-img-element
                                    <img src={url} alt={`Receipt ${j + 1}`} className="w-10 h-10 object-cover" />
                                  )}
                                </button>
                              )
                            })}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
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
              <div className="px-4 py-3 bg-cream border-b border-rule flex items-center justify-between gap-3">
                <p className="tbl-lbl">Internal Costs</p>
                <div className="flex items-center gap-2 ml-auto">
                  {costs.length > 0 && (
                    <button onClick={exportCostsCSV}
                      className="flex items-center gap-1 font-mono text-xs text-muted hover:text-ink transition-colors">
                      <Download size={11} /> CSV
                    </button>
                  )}
                  <button
                    onClick={() => setAddingCost(true)}
                    className="flex items-center gap-1.5 font-mono text-xs text-muted hover:text-ink transition-colors"
                  >
                    <Plus size={11} /> Add Cost
                  </button>
                </div>
              </div>

              {costs.length === 0 && !addingCost ? (
                <p className="font-mono text-xs text-muted text-center py-12 uppercase tracking-wider">No costs yet</p>
              ) : (
                <DragDropContext onDragEnd={handleDragEnd}>
                  <Droppable droppableId="costs">
                    {(provided) => (
                      <div ref={provided.innerRef} {...provided.droppableProps}>
                        {/* Column headers */}
                        <div className="flex items-center border-b border-rule bg-paper/50 px-2 py-2">
                          <div className="w-6 flex-shrink-0" />
                          {([
                            { key: 'description' as CostSortKey, label: 'Description', cls: 'flex-1 min-w-0 px-2' },
                            { key: 'category' as CostSortKey, label: 'Category', cls: 'w-24 px-2 hidden sm:block' },
                            { key: 'estimated' as CostSortKey, label: 'Est.', cls: 'w-20 px-2 text-right hidden md:block' },
                            { key: 'actual' as CostSortKey, label: 'Actual', cls: 'w-20 px-2 text-right' },
                            { key: 'status' as CostSortKey, label: 'Status', cls: 'w-20 px-2 hidden sm:block' },
                          ]).map(col => (
                            <button key={col.key} onClick={() => toggleCostSort(col.key)}
                              className={cn('tbl-lbl cursor-pointer select-none hover:text-ink transition-colors flex items-center', col.cls, col.cls.includes('right') ? 'justify-end' : '')}>
                              {col.label}<SortIndicator k={col.key} />
                            </button>
                          ))}
                          <div className="w-8 flex-shrink-0" />
                          <div className="w-8 flex-shrink-0" />
                        </div>

                        {displayCosts.map((cost, index) => (
                          <Draggable key={cost.id} draggableId={cost.id} index={index}>
                            {(provided, snapshot) => (
                              <div
                                ref={provided.innerRef}
                                {...provided.draggableProps}
                                className={cn(
                                  'border-b border-rule last:border-0 group',
                                  snapshot.isDragging ? 'bg-cream shadow-lg'
                                    : cost.dueDate && cost.status !== 'paid' && cost.dueDate < todayISO() ? 'bg-red-50/60'
                                    : index % 2 === 1 ? 'bg-paper/30' : 'bg-white',
                                )}
                              >
                                {/* Main row */}
                                <div
                                  className="flex items-center px-2 py-2.5 cursor-pointer hover:bg-cream/50 transition-colors"
                                  onClick={() => setEditingCost(editingCost === cost.id ? null : cost.id)}
                                >
                                  {/* Drag handle — hidden when sorted */}
                                  <div
                                    {...(costSortKey === null ? provided.dragHandleProps : {})}
                                    className={cn('w-6 flex-shrink-0 flex items-center justify-center cursor-grab active:cursor-grabbing', costSortKey !== null ? 'opacity-0 pointer-events-none' : 'text-muted hover:text-ink')}
                                    onClick={e => e.stopPropagation()}
                                  >
                                    <GripVertical size={12} />
                                  </div>

                                  {/* Description + badges */}
                                  <div className="flex-1 min-w-0 px-2">
                                    <div className="flex items-center gap-2 flex-wrap">
                                      <span className="text-sm text-ink truncate">{cost.description}</span>
                                      {cost.expenseId && (
                                        <span className="badge badge-approved" style={{ fontSize: 9 }}>→ Expense</span>
                                      )}
                                      {cost.isEmployeeCost && !cost.expenseId && (
                                        <span className="badge badge-draft" style={{ fontSize: 9 }}>Employee</span>
                                      )}
                                      {(() => {
                                        const link = reconLinks.manual.find(m => m.costId === cost.id)
                                        const linkedInv = link ? projInvoices.find(i => i.id === link.invoiceId) : null
                                        if (!linkedInv) return null
                                        return (
                                          <button
                                            onClick={e => { e.stopPropagation(); setPreviewInvoice(linkedInv) }}
                                            className={cn('badge cursor-pointer hover:opacity-80 transition-opacity', {
                                              paid: 'badge-paid', pending: 'badge-pending', overdue: 'badge-overdue',
                                              draft: 'badge-draft', submitted: 'badge-submitted', approved: 'badge-approved',
                                              sent: 'badge-sent', 'part-paid': 'badge-part-paid',
                                            }[linkedInv.status] ?? 'badge-draft')}
                                            style={{ fontSize: 9 }}
                                            title="View linked invoice"
                                          >
                                            → {linkedInv.ref || linkedInv.id.slice(0, 8)} · {linkedInv.status}
                                          </button>
                                        )
                                      })()}
                                    </div>
                                    {cost.isEmployeeCost && cost.employeeName && (
                                      <p className="font-mono text-[10px] text-muted mt-0.5">{cost.employeeName}</p>
                                    )}
                                    {cost.dueDate && cost.status !== 'paid' && (
                                      <p className={cn('font-mono text-[10px] mt-0.5 flex items-center gap-1',
                                        cost.dueDate < todayISO() ? 'text-red-500' : 'text-muted')}>
                                        {cost.dueDate < todayISO() && <AlertCircle size={9} />}
                                        Due {fmtDate(cost.dueDate)}
                                      </p>
                                    )}
                                    {cost.notes && (
                                      <p className="font-mono text-[10px] text-muted/70 mt-0.5 truncate">{cost.notes}</p>
                                    )}
                                  </div>

                                  {/* Category */}
                                  <div className="w-24 px-2 hidden sm:block">
                                    <span className="font-mono text-[10px] text-muted uppercase tracking-wider">{cost.category}</span>
                                  </div>

                                  {/* Estimated */}
                                  <div className="w-20 px-2 text-right hidden md:block">
                                    <span className="font-mono text-xs text-muted">{fmt(cost.estimated)}</span>
                                  </div>

                                  {/* Actual */}
                                  <div className="w-20 px-2 text-right">
                                    <span className={cn('font-mono text-xs font-semibold', cost.expenseId ? 'text-muted line-through' : 'text-ink')}>
                                      {fmt(cost.actual)}
                                    </span>
                                  </div>

                                  {/* Status */}
                                  <div className="w-20 px-2 hidden sm:block">
                                    <span className={cn('badge', COST_STATUS_CLS[cost.status])}>{cost.status}</span>
                                  </div>

                                  {/* Receipt icon */}
                                  <div className="w-8 flex-shrink-0 flex items-center justify-center" onClick={e => e.stopPropagation()}>
                                    {uploadingReceipt === cost.id ? (
                                      <div className="w-3 h-3 border border-rule border-t-muted animate-spin" />
                                    ) : cost.receiptUrl ? (
                                      <button
                                        onClick={() => {
                                          if (cost.receiptType === 'image') {
                                            setLightboxUrl({ url: cost.receiptUrl!, name: cost.description })
                                          } else {
                                            window.open(cost.receiptUrl, '_blank')
                                          }
                                        }}
                                        title="View receipt"
                                        className="text-ac-green hover:text-[#2d6147] transition-colors"
                                      >
                                        {cost.receiptType === 'image' ? <ImageIcon size={12} /> : <FileText size={12} />}
                                      </button>
                                    ) : (
                                      <button
                                        onClick={() => openCostReceiptPicker(cost.id)}
                                        title="Upload receipt"
                                        className="text-muted hover:text-ink transition-colors opacity-0 group-hover:opacity-100"
                                      >
                                        <Upload size={12} />
                                      </button>
                                    )}
                                  </div>

                                  {/* Delete */}
                                  <div className="w-8 flex-shrink-0 flex items-center justify-center" onClick={e => e.stopPropagation()}>
                                    <button
                                      onClick={() => deleteCost(cost.id)}
                                      className="text-muted hover:text-red-500 transition-colors opacity-0 group-hover:opacity-100"
                                    >
                                      <Trash2 size={12} />
                                    </button>
                                  </div>
                                </div>

                                {/* Expanded edit panel */}
                                {editingCost === cost.id && (
                                  <div className="px-4 py-3 bg-cream/60 border-t border-rule space-y-3" onClick={e => e.stopPropagation()}>
                                    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
                                      <div className="col-span-2 sm:col-span-3 lg:col-span-2">
                                        <label className="field-label">Description</label>
                                        <input value={cost.description}
                                          onChange={e => updateCost(cost.id, { description: e.target.value })}
                                          className="w-full border border-rule bg-white px-2 py-1 text-xs text-ink focus:outline-none" />
                                      </div>
                                      <div>
                                        <label className="field-label">Category</label>
                                        <select value={cost.category}
                                          onChange={e => updateCost(cost.id, { category: e.target.value as CostCategory })}
                                          className="w-full border border-rule bg-white px-2 py-1 text-xs font-mono text-ink focus:outline-none">
                                          {COST_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                                        </select>
                                      </div>
                                      <div>
                                        <label className="field-label">Estimated</label>
                                        <input type="number" value={cost.estimated}
                                          onChange={e => updateCost(cost.id, { estimated: parseFloat(e.target.value) || 0 })}
                                          min="0" step="0.01"
                                          className="w-full border border-rule bg-white px-2 py-1 text-xs font-mono text-right text-ink focus:outline-none" />
                                      </div>
                                      <div>
                                        <label className="field-label">Actual</label>
                                        <input type="number" value={cost.actual}
                                          onChange={e => updateCost(cost.id, { actual: parseFloat(e.target.value) || 0 })}
                                          min="0" step="0.01"
                                          className="w-full border border-rule bg-white px-2 py-1 text-xs font-mono text-right text-ink focus:outline-none" />
                                      </div>
                                      <div>
                                        <label className="field-label">Status</label>
                                        <select value={cost.status}
                                          onChange={e => updateCost(cost.id, { status: e.target.value as CostStatus })}
                                          className="w-full border border-rule bg-white px-2 py-1 text-xs font-mono text-ink focus:outline-none">
                                          {COST_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                                        </select>
                                      </div>
                                    </div>
                                    <div className="grid grid-cols-2 gap-2">
                                      <div>
                                        <label className="field-label">Notes</label>
                                        <input value={cost.notes}
                                          onChange={e => updateCost(cost.id, { notes: e.target.value })}
                                          className="w-full border border-rule bg-white px-2 py-1 text-xs text-ink focus:outline-none" />
                                      </div>
                                      <div>
                                        <label className="field-label">Due Date</label>
                                        <input type="date" value={cost.dueDate ?? ''}
                                          onChange={e => updateCost(cost.id, { dueDate: e.target.value || undefined })}
                                          className="w-full border border-rule bg-white px-2 py-1 text-xs font-mono text-ink focus:outline-none" />
                                      </div>
                                    </div>

                                    {/* Receipt */}
                                    <div className="flex items-center gap-3 flex-wrap">
                                      <span className="field-label">Receipt</span>
                                      {cost.receiptUrl ? (
                                        <div className="flex items-center gap-2">
                                          {cost.receiptType === 'image' ? (
                                            // eslint-disable-next-line @next/next/no-img-element
                                            <img src={cost.receiptUrl} alt="receipt"
                                              className="h-8 w-8 object-cover border border-rule cursor-pointer hover:opacity-80 transition-opacity"
                                              onClick={() => setLightboxUrl({ url: cost.receiptUrl!, name: cost.description })} />
                                          ) : (
                                            <a href={cost.receiptUrl} target="_blank" rel="noopener noreferrer"
                                              className="flex items-center gap-1 text-muted hover:text-ink text-xs font-mono">
                                              <FileText size={12} /> PDF
                                            </a>
                                          )}
                                          <button onClick={() => removeCostReceipt(cost.id)}
                                            className="font-mono text-[10px] text-red-400 hover:text-red-600 transition-colors">
                                            Remove
                                          </button>
                                        </div>
                                      ) : (
                                        <button
                                          onClick={() => openCostReceiptPicker(cost.id)}
                                          disabled={uploadingReceipt === cost.id}
                                          className="flex items-center gap-1 font-mono text-xs text-muted hover:text-ink transition-colors disabled:opacity-50"
                                        >
                                          <Upload size={11} />
                                          {uploadingReceipt === cost.id ? 'Uploading…' : 'Upload receipt'}
                                        </button>
                                      )}
                                    </div>

                                    {/* Employee cost */}
                                    <div className="flex items-center gap-3 flex-wrap">
                                      <span className="field-label">Employee Cost</span>
                                      <button
                                        onClick={() => updateCost(cost.id, {
                                          isEmployeeCost: !cost.isEmployeeCost,
                                          employeeName: !cost.isEmployeeCost ? (cost.employeeName ?? '') : '',
                                        })}
                                        className={cn(
                                          'flex items-center gap-1.5 px-2 py-1 text-xs font-mono uppercase tracking-wider border transition-colors',
                                          cost.isEmployeeCost
                                            ? 'bg-ink text-white border-ink'
                                            : 'border-rule text-muted hover:text-ink hover:border-ink'
                                        )}
                                      >
                                        <User size={10} /> {cost.isEmployeeCost ? 'On' : 'Off'}
                                      </button>
                                      {cost.isEmployeeCost && (
                                        <>
                                          <input
                                            value={cost.employeeName ?? ''}
                                            onChange={e => updateCost(cost.id, { employeeName: e.target.value })}
                                            placeholder="Employee name"
                                            className="border border-rule bg-white px-2 py-1 text-xs text-ink focus:outline-none w-40"
                                          />
                                          {!cost.expenseId ? (
                                            <button
                                              onClick={() => handleCreateExpense(cost.id)}
                                              disabled={!cost.employeeName?.trim() || creatingExpense === cost.id}
                                              className="flex items-center gap-1.5 px-2 py-1 text-xs font-mono uppercase tracking-wider bg-ac-green text-white hover:opacity-90 transition-opacity disabled:opacity-50"
                                            >
                                              <CheckCircle size={10} />
                                              {creatingExpense === cost.id ? 'Creating…' : 'Create Expense'}
                                            </button>
                                          ) : (
                                            <span className="font-mono text-xs text-ac-green flex items-center gap-1">
                                              <CheckCircle size={10} /> Expense created
                                            </span>
                                          )}
                                        </>
                                      )}
                                    </div>

                                    {/* Mark as Invoice */}
                                    {createInvoice && (() => {
                                      const form = getCostForm(cost.id, cost)
                                      const existingLink = reconLinks.manual.find(m => m.costId === cost.id)
                                      const linkedInv = existingLink ? projInvoices.find(i => i.id === existingLink.invoiceId) : null
                                      const hasPdf = cost.receiptUrl && cost.receiptType === 'pdf'
                                      function conf(field: string) {
                                        const c = form.confidence[field] ?? 0
                                        if (c === 0) return null
                                        return c >= 0.8
                                          ? <span className="inline-block w-1.5 h-1.5 rounded-full bg-ac-green ml-1" title={`AI confidence: ${Math.round(c * 100)}%`} />
                                          : <span className="inline-block w-1.5 h-1.5 rounded-full bg-ac-amber ml-1" title={`AI confidence: ${Math.round(c * 100)}%`} />
                                      }
                                      return (
                                        <div className="border-t border-rule pt-3 space-y-2">
                                          {/* Header row */}
                                          <div className="flex items-center gap-3 flex-wrap">
                                            <span className="field-label">Mark as Invoice</span>
                                            {linkedInv ? (
                                              <span className="font-mono text-xs text-ac-green flex items-center gap-1">
                                                <CheckCircle size={10} /> Invoice created: {linkedInv.ref || linkedInv.id.slice(0, 8)} · {linkedInv.status}
                                              </span>
                                            ) : (
                                              <>
                                                <button
                                                  onClick={() => setCostForm(cost.id, { open: !form.open })}
                                                  className={cn(
                                                    'flex items-center gap-1.5 px-2 py-1 text-xs font-mono uppercase tracking-wider border transition-colors',
                                                    form.open ? 'bg-ink text-white border-ink' : 'border-rule text-muted hover:text-ink hover:border-ink'
                                                  )}
                                                >
                                                  <FileText size={10} /> {form.open ? 'Cancel' : 'Fill manually'}
                                                </button>
                                                {hasPdf && (
                                                  <button
                                                    onClick={() => extractCostPdf(cost.id)}
                                                    disabled={form.extracting}
                                                    className="flex items-center gap-1 font-mono text-[10px] px-2 py-1 border border-rule text-muted hover:text-ink hover:border-rule transition-colors disabled:opacity-50 bg-cream"
                                                  >
                                                    <Sparkles size={9} className="text-purple-500" />
                                                    {form.extracting ? 'Extracting…' : 'Extract from PDF with AI'}
                                                  </button>
                                                )}
                                              </>
                                            )}
                                          </div>

                                          {/* Invoice form */}
                                          {form.open && !linkedInv && (
                                            <div className="bg-white border border-rule p-3 space-y-3">
                                              {/* Row 1: core fields */}
                                              <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-2">
                                                <div className="col-span-2">
                                                  <label className="field-label flex items-center">Supplier / Party{conf('party')}</label>
                                                  <input value={form.party}
                                                    onChange={e => setCostForm(cost.id, { party: e.target.value })}
                                                    placeholder="Supplier name"
                                                    className="w-full border border-rule bg-paper px-2 py-1 text-xs text-ink focus:outline-none" />
                                                </div>
                                                <div>
                                                  <label className="field-label flex items-center">Invoice Ref{conf('ref')}</label>
                                                  <input value={form.ref}
                                                    onChange={e => setCostForm(cost.id, { ref: e.target.value })}
                                                    placeholder="INV-001"
                                                    className="w-full border border-rule bg-paper px-2 py-1 text-xs font-mono text-ink focus:outline-none" />
                                                </div>
                                                <div>
                                                  <label className="field-label flex items-center">Due Date{conf('due')}</label>
                                                  <input type="date" value={form.due}
                                                    onChange={e => setCostForm(cost.id, { due: e.target.value })}
                                                    className="w-full border border-rule bg-paper px-2 py-1 text-xs font-mono text-ink focus:outline-none" />
                                                </div>
                                                <div>
                                                  <label className="field-label flex items-center">Currency{conf('currency')}</label>
                                                  <select value={form.currency}
                                                    onChange={e => setCostForm(cost.id, { currency: e.target.value })}
                                                    className="w-full border border-rule bg-paper px-2 py-1 text-xs font-mono text-ink focus:outline-none">
                                                    {['£', '$', '€', 'AED', 'USD', 'EUR'].map(c => <option key={c} value={c}>{c}</option>)}
                                                  </select>
                                                </div>
                                                <div>
                                                  <label className="field-label flex items-center">Amount{conf('amount')}</label>
                                                  <input type="number" value={form.amount}
                                                    onChange={e => setCostForm(cost.id, { amount: parseFloat(e.target.value) || 0 })}
                                                    min="0" step="0.01"
                                                    className="w-full border border-rule bg-paper px-2 py-1 text-xs font-mono text-right text-ink focus:outline-none" />
                                                </div>
                                              </div>

                                              {/* Row 2: bank details */}
                                              <div>
                                                <p className="field-label mb-1.5 text-blue-600">Bank Details</p>
                                                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
                                                  {([
                                                    { key: 'bankName' as const, label: 'Bank Name',    placeholder: 'HSBC' },
                                                    { key: 'sortCode' as const, label: 'Sort Code',    placeholder: '12-34-56' },
                                                    { key: 'accNum'  as const, label: 'Account No',   placeholder: '12345678' },
                                                    { key: 'accName' as const, label: 'Account Name', placeholder: 'Supplier Ltd' },
                                                    { key: 'iban'    as const, label: 'IBAN',          placeholder: 'GB29NWBK…' },
                                                    { key: 'swift'   as const, label: 'SWIFT/BIC',     placeholder: 'NWBKGB2L' },
                                                  ] as { key: keyof CostInvoiceForm & string; label: string; placeholder: string }[]).map(({ key, label, placeholder }) => (
                                                    <div key={key}>
                                                      <label className="field-label flex items-center">{label}{conf(key)}</label>
                                                      <input
                                                        value={form[key] as string}
                                                        onChange={e => setCostForm(cost.id, { [key]: e.target.value })}
                                                        placeholder={placeholder}
                                                        className="w-full border border-rule bg-blue-50/30 px-2 py-1 text-xs font-mono text-ink focus:outline-none focus:border-blue-300"
                                                      />
                                                    </div>
                                                  ))}
                                                </div>
                                              </div>

                                              {/* Row 3: notes + save */}
                                              <div className="flex items-end gap-3 flex-wrap">
                                                <div className="flex-1 min-w-[180px]">
                                                  <label className="field-label">Notes</label>
                                                  <input value={form.notes}
                                                    onChange={e => setCostForm(cost.id, { notes: e.target.value })}
                                                    className="w-full border border-rule bg-paper px-2 py-1 text-xs text-ink focus:outline-none" />
                                                </div>
                                                <button
                                                  onClick={() => createInvoiceFromCost(cost.id)}
                                                  disabled={form.creating || !form.party.trim()}
                                                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-mono uppercase tracking-wider bg-ink text-white hover:bg-[#333] transition-colors disabled:opacity-50 whitespace-nowrap"
                                                >
                                                  <CheckCircle size={10} />
                                                  {form.creating ? 'Saving…' : 'Save as Invoice'}
                                                </button>
                                              </div>

                                              {Object.keys(form.confidence).length > 0 && (
                                                <p className="font-mono text-[9px] text-muted flex items-center gap-2">
                                                  <span className="inline-block w-1.5 h-1.5 rounded-full bg-ac-green" /> High confidence
                                                  <span className="inline-block w-1.5 h-1.5 rounded-full bg-ac-amber" /> Lower confidence — please verify
                                                </p>
                                              )}
                                            </div>
                                          )}
                                        </div>
                                      )
                                    })()}
                                  </div>
                                )}
                              </div>
                            )}
                          </Draggable>
                        ))}
                        {provided.placeholder}

                        {/* Add cost form */}
                        {addingCost && (
                          <div className="border-t border-rule bg-cream/50 px-4 py-3 space-y-3">
                            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
                              <div className="col-span-2 sm:col-span-3 lg:col-span-2">
                                <label className="field-label">Description</label>
                                <input value={newCost.description}
                                  onChange={e => setNewCost(c => ({ ...c, description: e.target.value }))}
                                  placeholder="e.g. Studio hire" autoFocus
                                  className="w-full border border-rule bg-white px-2 py-1 text-xs text-ink focus:outline-none" />
                              </div>
                              <div>
                                <label className="field-label">Category</label>
                                <select value={newCost.category}
                                  onChange={e => setNewCost(c => ({ ...c, category: e.target.value as CostCategory }))}
                                  className="w-full border border-rule bg-white px-2 py-1 text-xs font-mono text-ink focus:outline-none">
                                  {COST_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                                </select>
                              </div>
                              <div>
                                <label className="field-label">Estimated</label>
                                <input type="number" value={newCost.estimated || ''}
                                  onChange={e => setNewCost(c => ({ ...c, estimated: parseFloat(e.target.value) || 0 }))}
                                  min="0" step="0.01" placeholder="0.00"
                                  className="w-full border border-rule bg-white px-2 py-1 text-xs font-mono text-right text-ink focus:outline-none" />
                              </div>
                              <div>
                                <label className="field-label">Actual</label>
                                <input type="number" value={newCost.actual || ''}
                                  onChange={e => setNewCost(c => ({ ...c, actual: parseFloat(e.target.value) || 0 }))}
                                  min="0" step="0.01" placeholder="0.00"
                                  className="w-full border border-rule bg-white px-2 py-1 text-xs font-mono text-right text-ink focus:outline-none" />
                              </div>
                              <div>
                                <label className="field-label">Status</label>
                                <select value={newCost.status}
                                  onChange={e => setNewCost(c => ({ ...c, status: e.target.value as CostStatus }))}
                                  className="w-full border border-rule bg-white px-2 py-1 text-xs font-mono text-ink focus:outline-none">
                                  {COST_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                                </select>
                              </div>
                            </div>
                            <div className="grid grid-cols-2 gap-2">
                              <div>
                                <label className="field-label">Notes</label>
                                <input value={newCost.notes}
                                  onChange={e => setNewCost(c => ({ ...c, notes: e.target.value }))}
                                  placeholder="Optional notes"
                                  className="w-full border border-rule bg-white px-2 py-1 text-xs text-ink focus:outline-none"
                                  onKeyDown={e => { if (e.key === 'Enter') addCost() }} />
                              </div>
                              <div>
                                <label className="field-label">Due Date</label>
                                <input type="date" value={newCost.dueDate ?? ''}
                                  onChange={e => setNewCost(c => ({ ...c, dueDate: e.target.value || undefined }))}
                                  className="w-full border border-rule bg-white px-2 py-1 text-xs font-mono text-ink focus:outline-none" />
                              </div>
                            </div>
                            <div className="flex items-center gap-2">
                              <button onClick={addCost}
                                className="px-3 py-1.5 bg-ink text-white font-mono text-xs uppercase tracking-wider hover:bg-[#333] transition-colors">
                                Add
                              </button>
                              <button onClick={() => setAddingCost(false)}
                                className="font-mono text-xs text-muted hover:text-ink transition-colors">Cancel</button>
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </Droppable>
                </DragDropContext>
              )}

              {costs.length > 0 && (
                <div className="px-4 py-2.5 border-t border-rule bg-cream flex items-center justify-between">
                  <span className="font-mono text-xs text-muted">
                    {costs.length} line{costs.length !== 1 ? 's' : ''}
                    {costs.some(c => c.expenseId) && (
                      <span className="ml-1 opacity-60">· {costs.filter(c => c.expenseId).length} in expenses</span>
                    )}
                    {' · '}Est: {fmt(costs.reduce((t, c) => t + c.estimated, 0))}
                  </span>
                  <span className="font-mono text-xs font-semibold text-ink">Actual: {fmt(totalCosts)}</span>
                </div>
              )}
            </div>

            <p className="font-mono text-[10px] text-muted">Click a row to edit · Drag <GripVertical size={10} className="inline" /> to reorder · Changes save instantly</p>
          </div>
        )}

        {/* ── Payment Sheet ── */}
        {tab === 'payment-sheet' && (
          <div className="p-6">
            <PaymentSheet
              invoices={projInvoices}
              project={project}
              costs={costs}
              reconLinks={reconLinks}
              updateInvoice={updateInvoice}
            />
          </div>
        )}

        {/* ── Files & Notes ── */}
        {tab === 'files-notes' && (
          <div className="p-6 space-y-8">

            {/* ── PDF Invoice Extractor ── */}
            {createInvoice && (
              <div className="border border-rule">
                <div className="px-4 py-3 bg-cream border-b border-rule flex items-center gap-2">
                  <Sparkles size={12} className="text-muted" />
                  <p className="tbl-lbl">Extract Invoice from PDF</p>
                  <span className="font-mono text-[10px] text-muted ml-1">Drop a supplier PDF to auto-extract details</span>
                </div>
                <div
                  className={cn(
                    'p-4 transition-colors',
                    dragOver ? 'bg-blue-50 border-blue-300' : ''
                  )}
                  onDragOver={e => { e.preventDefault(); setDragOver(true) }}
                  onDragLeave={() => setDragOver(false)}
                  onDrop={e => {
                    e.preventDefault()
                    setDragOver(false)
                    const f = e.dataTransfer.files[0]
                    if (f) handlePdfDrop(f)
                  }}
                >
                  {!scanFile ? (
                    <div
                      className="border-2 border-dashed border-rule flex flex-col items-center justify-center py-8 gap-2 cursor-pointer hover:border-muted transition-colors"
                      onClick={() => {
                        const inp = document.createElement('input')
                        inp.type = 'file'; inp.accept = 'application/pdf,image/*'
                        inp.onchange = e => { const f = (e.target as HTMLInputElement).files?.[0]; if (f) handlePdfDrop(f) }
                        inp.click()
                      }}
                    >
                      <FileText size={20} className="text-muted" />
                      <p className="font-mono text-xs text-muted uppercase tracking-wider">Drop PDF or click to select</p>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <span className="font-mono text-xs text-ink flex items-center gap-2">
                          <FileText size={12} /> {scanFile.name}
                        </span>
                        <button onClick={() => { setScanFile(null); setScanExtracted(null) }} className="text-muted hover:text-ink">
                          <X size={13} />
                        </button>
                      </div>
                      {!scanExtracted ? (
                        <div className="flex items-center gap-3">
                          <button
                            onClick={handleScanPdf}
                            disabled={scanning || !anthropicKey}
                            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-mono uppercase tracking-wider bg-ink text-white hover:bg-[#333] transition-colors disabled:opacity-50"
                          >
                            <Sparkles size={11} /> {scanning ? 'Scanning…' : 'Extract with AI'}
                          </button>
                          {!anthropicKey && <span className="font-mono text-[10px] text-muted">Add Anthropic API key in Settings first</span>}
                        </div>
                      ) : (
                        <div className="space-y-2">
                          <p className="tbl-lbl">Extracted Fields — edit before saving</p>
                          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                            {([
                              { label: 'Party', key: 'party' as keyof InvoiceInsert },
                              { label: 'Ref', key: 'ref' as keyof InvoiceInsert },
                              { label: 'Amount', key: 'amount' as keyof InvoiceInsert },
                              { label: 'Currency', key: 'currency' as keyof InvoiceInsert },
                              { label: 'Due Date', key: 'due' as keyof InvoiceInsert },
                              { label: 'Status', key: 'status' as keyof InvoiceInsert },
                            ]).map(({ label, key }) => (
                              <div key={key}>
                                <label className="field-label">{label}</label>
                                <input
                                  value={String(scanExtracted[key] ?? '')}
                                  onChange={e => setScanExtracted(prev => prev ? { ...prev, [key]: e.target.value || null } : prev)}
                                  className="w-full border border-rule bg-white px-2 py-1 text-xs font-mono text-ink focus:outline-none"
                                />
                              </div>
                            ))}
                          </div>
                          <div className="flex items-center gap-2 pt-1">
                            <span className="font-mono text-[10px] text-muted">Project: {project.code} (locked)</span>
                            <div className="flex-1" />
                            <button onClick={() => { setScanFile(null); setScanExtracted(null) }}
                              className="font-mono text-xs text-muted hover:text-ink transition-colors">Cancel</button>
                            <button
                              onClick={saveScannedInvoice}
                              disabled={savingScanned}
                              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-mono uppercase tracking-wider bg-ac-green text-white hover:opacity-90 disabled:opacity-50"
                            >
                              <CheckCircle size={11} /> {savingScanned ? 'Saving…' : 'Save as Invoice'}
                            </button>
                          </div>
                        </div>
                      )}
                      {scanError && (
                        <p className="font-mono text-xs text-red-600">{scanError}</p>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )}

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
                      <button
                        className="w-full aspect-square flex items-center justify-center bg-cream hover:bg-cream/80 transition-colors"
                        onClick={() => f.type === 'image' ? setLightboxUrl({ url: f.url, name: f.name }) : window.open(f.url, '_blank')}
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
      {lightboxUrl && (
        <ImageOverlay url={lightboxUrl.url} name={lightboxUrl.name} onClose={() => setLightboxUrl(null)} />
      )}

      {/* Expense reimbursement print (off-screen) */}
      {printingExpense && (
        <div style={{ position: 'absolute', left: -9999, top: 0, pointerEvents: 'none' }} aria-hidden>
          <ExpenseReimbursePDF expense={printingExpense} forPrint={true} />
        </div>
      )}

      {/* Invoice PDF preview */}
      <InvoicePreviewModal invoice={previewInvoice} onClose={() => setPreviewInvoice(null)} />

      {/* Edit invoice modal (from Invoices tab) */}
      {updateInvoice && (
        <InvoiceModal
          isOpen={!!editingInvoice}
          onClose={() => setEditingInvoice(null)}
          invoice={editingInvoice}
          existingInvoices={invoices}
          onSave={async (data) => {
            if (editingInvoice) await updateInvoice(editingInvoice.id, data)
            setEditingInvoice(null)
            toast('Invoice updated')
          }}
        />
      )}

      {/* Quick-add Invoice modal */}
      {createInvoice && (
        <InvoiceModal
          isOpen={invoiceModalOpen}
          onClose={() => setInvoiceModalOpen(false)}
          existingInvoices={invoices}
          defaultType="receivable"
          defaultValues={{
            project_code: project.code,
            project_name: project.name,
            entity: project.entity,
          }}
          onSave={async (data) => {
            await createInvoice(data)
            setInvoiceModalOpen(false)
            toast('Invoice created')
          }}
        />
      )}

      {/* Quick-add Expense modal */}
      <ExpenseModal
        isOpen={expenseModalOpen}
        onClose={() => setExpenseModalOpen(false)}
        onSave={async (data) => {
          await createExpense(data)
          setExpenseModalOpen(false)
          toast('Expense created')
        }}
        prefillEmployee={undefined}
        prefillBank={undefined}
      />
    </div>
  )
}
