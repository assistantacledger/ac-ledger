'use client'

import { useState, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { Header } from '@/components/layout/Header'
import { useInvoices } from '@/hooks/useInvoices'
import { useAuth } from '@/contexts/AuthContext'
import { sb } from '@/lib/supabase'
import { cn, todayISO, getNextRef } from '@/lib/format'
import { Upload, X, FileText, ArrowRight, Sparkles, CheckCircle } from 'lucide-react'
import type { InvoiceInsert, Entity } from '@/types'
import { ENTITIES } from '@/types'

interface ConfidenceField<T> {
  value: T
  confidence: number
}

interface Extracted {
  party: ConfidenceField<string>
  ref: ConfidenceField<string>
  amount: ConfidenceField<number>
  currency: ConfidenceField<string>
  due: ConfidenceField<string | null>
  project_code: ConfidenceField<string | null>
  type: ConfidenceField<string>
}

function confidenceClass(c: number): string {
  if (c >= 0.75) return 'border-ac-green bg-[#f0f8f4]'
  if (c >= 0.45) return 'border-ac-amber bg-[#fdf8f0]'
  return 'border-red-400 bg-red-50'
}

function confidenceDot(c: number) {
  const cls = c >= 0.75 ? 'bg-ac-green' : c >= 0.45 ? 'bg-ac-amber' : 'bg-red-500'
  const label = c >= 0.75 ? 'High confidence' : c >= 0.45 ? 'Medium confidence' : 'Low confidence'
  return (
    <span className={cn('inline-block w-2 h-2 rounded-full flex-shrink-0', cls)} title={label} />
  )
}

export default function ScanPage() {
  const router = useRouter()
  const { invoices, createInvoice } = useInvoices()
  const { config } = useAuth()
  const fileRef = useRef<HTMLInputElement>(null)

  const [pdfUrl, setPdfUrl] = useState<string | null>(null)
  const [fileName, setFileName] = useState('')
  const [fileBase64, setFileBase64] = useState('')
  const [fileMediaType, setFileMediaType] = useState('')
  const [fileObj, setFileObj] = useState<File | null>(null)
  const [scanning, setScanning] = useState(false)
  const [extracted, setExtracted] = useState<Extracted | null>(null)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')

  const [form, setForm] = useState<Partial<InvoiceInsert>>({
    type: 'payable',
    entity: 'Actually Creative',
    status: 'pending',
    currency: '£',
    due: null,
    notes: null,
    party: '',
    ref: '',
    amount: 0,
    project_code: null,
    line_items: null,
    payment_schedule: null,
    recurring: false,
    pdf_url: null,
    internal: null,
    project_name: null,
  })

  function set<K extends keyof InvoiceInsert>(key: K, val: InvoiceInsert[K]) {
    setSaved(false)
    setForm(f => ({ ...f, [key]: val }))
  }

  function handleFile(file: File) {
    if (!file.type.includes('pdf') && !file.type.includes('image')) {
      setError('Please upload a PDF or image file')
      return
    }
    const url = URL.createObjectURL(file)
    setPdfUrl(url)
    setFileName(file.name)
    setFileObj(file)
    setError('')
    setExtracted(null)

    // Convert to base64
    const reader = new FileReader()
    reader.onload = e => {
      const dataUrl = e.target?.result as string
      // dataUrl = "data:application/pdf;base64,XXXX"
      const base64 = dataUrl.split(',')[1]
      setFileBase64(base64)
      setFileMediaType(file.type)
    }
    reader.readAsDataURL(file)

    // Auto-suggest ref from filename
    const nameMatch = file.name.match(/([A-Z]+-\d+)/i)
    if (nameMatch) set('ref', nameMatch[1].toUpperCase())
  }

  function autoRef() {
    const prefix = (form.entity as Entity) === 'Actually Creative' ? 'AC'
      : (form.entity as Entity) === '419Studios' ? '419' : 'RTW'
    set('ref', getNextRef(invoices, form.entity as Entity, prefix))
  }

  async function handleScan() {
    if (!fileBase64) { setError('Upload a file first'); return }
    if (!config?.anthropicKey) {
      setError('Anthropic API key not set — add it in Settings')
      return
    }
    setScanning(true)
    setError('')
    try {
      const res = await fetch('/api/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          base64: fileBase64,
          mediaType: fileMediaType,
          apiKey: config.anthropicKey,
        }),
      })
      const data = await res.json() as { extracted?: Extracted; error?: string }
      if (!res.ok || data.error) { setError(data.error ?? 'Scan failed'); return }
      const ext = data.extracted!
      setExtracted(ext)
      // Pre-fill form from extracted data
      if (ext.party?.value) set('party', ext.party.value)
      if (ext.ref?.value) set('ref', ext.ref.value)
      if (ext.amount?.value) set('amount', Number(ext.amount.value))
      if (ext.currency?.value) set('currency', ext.currency.value)
      if (ext.due?.value) set('due', ext.due.value)
      if (ext.project_code?.value) set('project_code', ext.project_code.value)
      if (ext.type?.value === 'receivable') set('type', 'receivable')
      else set('type', 'payable')
    } catch (e) {
      setError(String(e))
    } finally {
      setScanning(false)
    }
  }

  function approveAll() {
    if (!extracted) return
    // Apply all high-confidence fields
    if (extracted.party.confidence >= 0.75) set('party', extracted.party.value)
    if (extracted.ref.confidence >= 0.75) set('ref', extracted.ref.value)
    if (extracted.amount.confidence >= 0.75) set('amount', Number(extracted.amount.value))
    if (extracted.currency.confidence >= 0.75) set('currency', extracted.currency.value)
    if (extracted.due.confidence >= 0.75) set('due', extracted.due.value)
    if (extracted.project_code.confidence >= 0.75) set('project_code', extracted.project_code.value)
  }

  async function handleSave() {
    if (!form.party?.trim()) { setError('Party is required'); return }
    if (!form.ref?.trim()) { setError('Ref is required'); return }
    if (!form.amount || form.amount <= 0) { setError('Amount is required'); return }
    setError('')
    setSaving(true)
    try {
      let pdf_url: string | null = null
      if (fileObj) {
        const path = `pdfs/${Date.now()}-${fileObj.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`
        const { error: uploadError } = await sb.storage.from('invoices').upload(path, fileObj, { upsert: false })
        if (!uploadError) {
          const { data } = sb.storage.from('invoices').getPublicUrl(path)
          pdf_url = data.publicUrl
        }
      }
      await createInvoice({ ...(form as InvoiceInsert), pdf_url })
      setSaved(true)
      setTimeout(() => router.push('/payable'), 1200)
    } catch (e) {
      setError(String(e))
    } finally {
      setSaving(false)
    }
  }

  function clearFile() {
    if (pdfUrl) URL.revokeObjectURL(pdfUrl)
    setPdfUrl(null)
    setFileName('')
    setFileBase64('')
    setFileObj(null)
    setExtracted(null)
    if (fileRef.current) fileRef.current.value = ''
  }

  const hasHighConf = extracted ? Object.values(extracted).some((f: ConfidenceField<unknown>) => f.confidence >= 0.75) : false

  return (
    <>
      <Header title="Scan Invoice" subtitle="AI Extraction" />
      <main className="flex-1 overflow-hidden flex">

        {/* ── Left: Upload + Form ───────────────────────────────────────── */}
        <div className="w-[400px] flex-shrink-0 overflow-y-auto border-r border-rule bg-paper">
          <div className="divide-y divide-rule">

            {/* Upload */}
            <div className="px-5 py-5">
              <p className="tbl-lbl mb-3">Upload Invoice</p>
              <input ref={fileRef} type="file" accept=".pdf,image/*" className="hidden"
                onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f) }} />

              {!pdfUrl ? (
                <div
                  className="border-2 border-dashed border-rule hover:border-muted transition-colors cursor-pointer flex flex-col items-center justify-center py-10 gap-3"
                  onClick={() => fileRef.current?.click()}
                  onDragOver={e => e.preventDefault()}
                  onDrop={e => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) handleFile(f) }}
                >
                  <Upload size={20} className="text-muted" />
                  <p className="font-mono text-xs text-muted uppercase tracking-wider">Drop PDF or click to upload</p>
                  <p className="font-mono text-[10px] text-muted">PDF, JPG, PNG supported</p>
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="flex items-center justify-between border border-rule bg-cream px-3 py-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <FileText size={14} className="text-muted flex-shrink-0" />
                      <span className="font-mono text-xs text-ink truncate">{fileName}</span>
                    </div>
                    <button onClick={clearFile} className="text-muted hover:text-red-500 transition-colors ml-2 flex-shrink-0">
                      <X size={13} />
                    </button>
                  </div>
                  <button
                    onClick={handleScan}
                    disabled={scanning || !config?.anthropicKey}
                    className={cn(
                      'w-full flex items-center justify-center gap-2 py-2 text-xs font-mono uppercase tracking-wider transition-colors',
                      'bg-ink text-white hover:bg-[#333] disabled:opacity-50'
                    )}
                  >
                    <Sparkles size={11} />
                    {scanning ? 'Scanning…' : 'Extract with AI'}
                  </button>
                  {!config?.anthropicKey && (
                    <p className="font-mono text-[10px] text-muted">Add your Anthropic API key in Settings to use AI extraction.</p>
                  )}
                </div>
              )}
            </div>

            {/* Confidence legend */}
            {extracted && (
              <div className="px-5 py-3 flex items-center gap-4">
                <p className="font-mono text-[10px] text-muted uppercase tracking-wider">Confidence:</p>
                {[
                  { cls: 'bg-ac-green', label: 'High' },
                  { cls: 'bg-ac-amber', label: 'Medium' },
                  { cls: 'bg-red-500', label: 'Low' },
                ].map(({ cls, label }) => (
                  <div key={label} className="flex items-center gap-1.5">
                    <span className={cn('inline-block w-2 h-2 rounded-full', cls)} />
                    <span className="font-mono text-[10px] text-muted">{label}</span>
                  </div>
                ))}
                {hasHighConf && (
                  <button
                    onClick={approveAll}
                    className="ml-auto flex items-center gap-1 font-mono text-[10px] uppercase tracking-wider text-ac-green hover:text-[#2d6147] transition-colors"
                  >
                    <CheckCircle size={11} /> Approve green
                  </button>
                )}
              </div>
            )}

            {/* Form */}
            <div className="px-5 py-5 space-y-4">
              <p className="tbl-lbl">Invoice Details</p>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="field-label">Type</label>
                  <select value={form.type} onChange={e => set('type', e.target.value as 'payable' | 'receivable')}
                    className={cn('w-full border px-3 py-2 text-sm text-ink focus:outline-none font-mono',
                      extracted ? confidenceClass(extracted.type.confidence) : 'border-rule bg-white')}>
                    <option value="payable">Payable (bill)</option>
                    <option value="receivable">Receivable</option>
                  </select>
                </div>
                <div>
                  <label className="field-label">Entity</label>
                  <select value={form.entity} onChange={e => set('entity', e.target.value as Entity)}
                    className="w-full border border-rule bg-white px-3 py-2 text-sm text-ink focus:outline-none">
                    {ENTITIES.map(e => <option key={e} value={e}>{e}</option>)}
                  </select>
                </div>
              </div>

              <div>
                <div className="flex items-center gap-1.5 mb-1">
                  <label className="field-label">{form.type === 'payable' ? 'Supplier / From' : 'Client / Bill To'}</label>
                  {extracted && confidenceDot(extracted.party.confidence)}
                </div>
                <input type="text" value={form.party ?? ''} onChange={e => set('party', e.target.value)}
                  placeholder="Company or person name"
                  className={cn('w-full border px-3 py-2 text-sm text-ink focus:outline-none',
                    extracted ? confidenceClass(extracted.party.confidence) : 'border-rule bg-white focus:border-ink')} />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <div className="flex items-center gap-1.5 mb-1">
                    <label className="field-label">Invoice Ref</label>
                    {extracted && confidenceDot(extracted.ref.confidence)}
                  </div>
                  <div className="flex gap-1">
                    <input type="text" value={form.ref ?? ''} onChange={e => set('ref', e.target.value)}
                      placeholder="INV-001"
                      className={cn('flex-1 min-w-0 border px-3 py-2 text-sm font-mono text-ink focus:outline-none',
                        extracted ? confidenceClass(extracted.ref.confidence) : 'border-rule bg-white focus:border-ink')} />
                    <button onClick={autoRef} title="Auto-generate"
                      className="px-2 border border-rule text-muted hover:text-ink bg-white transition-colors text-[10px] font-mono">AUTO</button>
                  </div>
                </div>
                <div>
                  <div className="flex items-center gap-1.5 mb-1">
                    <label className="field-label">Amount</label>
                    {extracted && confidenceDot(extracted.amount.confidence)}
                  </div>
                  <div className="flex gap-1 items-center">
                    <span className="font-mono text-sm text-muted">{form.currency}</span>
                    <input type="number" value={form.amount || ''} onChange={e => set('amount', parseFloat(e.target.value) || 0)}
                      min="0" step="0.01" placeholder="0.00"
                      className={cn('flex-1 min-w-0 border px-3 py-2 text-sm font-mono text-ink focus:outline-none',
                        extracted ? confidenceClass(extracted.amount.confidence) : 'border-rule bg-white focus:border-ink')} />
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <div className="flex items-center gap-1.5 mb-1">
                    <label className="field-label">Due Date</label>
                    {extracted && confidenceDot(extracted.due.confidence)}
                  </div>
                  <input type="date" value={form.due ?? ''} onChange={e => set('due', e.target.value || null)}
                    className={cn('w-full border px-3 py-2 text-sm text-ink focus:outline-none',
                      extracted ? confidenceClass(extracted.due.confidence) : 'border-rule bg-white focus:border-ink')} />
                </div>
                <div>
                  <div className="flex items-center gap-1.5 mb-1">
                    <label className="field-label">Currency</label>
                    {extracted && confidenceDot(extracted.currency.confidence)}
                  </div>
                  <select value={form.currency} onChange={e => set('currency', e.target.value)}
                    className={cn('w-full border px-3 py-2 text-sm text-ink focus:outline-none font-mono',
                      extracted ? confidenceClass(extracted.currency.confidence) : 'border-rule bg-white')}>
                    {['£', '$', '€'].map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
              </div>

              <div>
                <div className="flex items-center gap-1.5 mb-1">
                  <label className="field-label">Project Code</label>
                  {extracted && confidenceDot(extracted.project_code.confidence)}
                </div>
                <input type="text" value={form.project_code ?? ''} onChange={e => set('project_code', e.target.value || null)}
                  className={cn('w-full border px-3 py-2 text-sm font-mono text-ink focus:outline-none',
                    extracted ? confidenceClass(extracted.project_code.confidence) : 'border-rule bg-white focus:border-ink')} />
              </div>

              <div>
                <label className="field-label">Notes</label>
                <textarea value={form.notes ?? ''} onChange={e => set('notes', e.target.value || null)}
                  rows={2} className="w-full border border-rule bg-white px-3 py-2 text-sm text-ink focus:outline-none focus:border-ink resize-none" />
              </div>

              {error && <p className="font-mono text-xs text-red-600">{error}</p>}

              <button
                onClick={handleSave}
                disabled={saving || saved}
                className={cn(
                  'w-full flex items-center justify-center gap-2 py-2.5 text-xs font-mono uppercase tracking-wider transition-colors',
                  saved ? 'bg-ac-green text-white' : 'bg-ink text-white hover:bg-[#333]',
                  'disabled:opacity-60'
                )}
              >
                {saving ? 'Saving…' : saved ? (
                  <><span>Saved!</span><ArrowRight size={12} /></>
                ) : 'Save Invoice'}
              </button>
            </div>
          </div>
        </div>

        {/* ── Right: PDF Preview ────────────────────────────────────────── */}
        <div className="flex-1 overflow-hidden bg-[#e8e8e6] flex flex-col">
          <div className="px-4 py-3 bg-[#d8d8d6] border-b border-[#c8c8c6]">
            <p className="font-mono text-[10px] uppercase tracking-widest text-[#6a6a6a]">
              {pdfUrl ? fileName : 'Document Preview'}
            </p>
          </div>
          {pdfUrl ? (
            <iframe
              src={pdfUrl}
              className="flex-1 w-full border-0"
              title="Invoice preview"
            />
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center gap-4 text-muted">
              <FileText size={40} className="opacity-30" />
              <p className="font-mono text-xs uppercase tracking-widest opacity-50">Upload a document to preview</p>
            </div>
          )}
        </div>
      </main>
    </>
  )
}
