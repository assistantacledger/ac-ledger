'use client'

import { useState, useMemo, useRef } from 'react'
import { Header } from '@/components/layout/Header'
import { useInvoices } from '@/hooks/useInvoices'
import { useExpenses } from '@/hooks/useExpenses'
import { usePayRuns } from '@/hooks/usePayRuns'
import { PaymentSheet } from '@/components/projects/PaymentSheet'
import { cn, fmt, fmtDate, todayISO } from '@/lib/format'
import { Plus, Trash2, Play, Upload, X, CheckCircle, AlertCircle, HelpCircle, ChevronDown, ChevronRight, Table2 } from 'lucide-react'
import type { PayRun, PayRunItem, Invoice, Expense, Project } from '@/types'

type Tab = 'runs' | 'reconcile'

// ─── Bank Reconciliation ──────────────────────────────────────────────────────

interface CsvRow { date: string; description: string; amount: number; raw: string }
type MatchStatus = 'matched' | 'possible' | 'unmatched'
interface MatchedRow extends CsvRow { status: MatchStatus; matchRef?: string; matchParty?: string }

function parseCSV(text: string): CsvRow[] {
  const lines = text.trim().split('\n').filter(Boolean)
  if (lines.length < 2) return []
  const rows: CsvRow[] = []
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(',').map(c => c.trim().replace(/^"|"$/g, ''))
    if (cols.length < 3) continue
    let amount = 0; let dateStr = ''; let desc = ''
    for (let j = 0; j < cols.length; j++) {
      const num = parseFloat(cols[j].replace(/[£$€,]/g, ''))
      if (!isNaN(num) && cols[j].match(/[\d.]+/)) { amount = Math.abs(num); continue }
      if (cols[j].match(/\d{4}[-\/]\d{2}[-\/]\d{2}|\d{2}[-\/]\d{2}[-\/]\d{4}/)) { dateStr = cols[j]; continue }
      if (cols[j].length > 3) desc = desc ? `${desc} ${cols[j]}` : cols[j]
    }
    if (amount > 0) rows.push({ date: dateStr, description: desc.trim(), amount, raw: lines[i] })
  }
  return rows
}

function matchRows(csvRows: CsvRow[], invoices: Invoice[]): MatchedRow[] {
  const open = invoices.filter(i => !['paid', 'draft'].includes(i.status))
  return csvRows.map(row => {
    const refMatch = open.find(i => i.ref && row.description.toLowerCase().includes(i.ref.toLowerCase()))
    if (refMatch) return { ...row, status: 'matched' as MatchStatus, matchRef: refMatch.ref, matchParty: refMatch.party }
    const amtMatch = open.find(i => Math.abs(Number(i.amount) - row.amount) < 0.50)
    if (amtMatch) return { ...row, status: 'possible' as MatchStatus, matchRef: amtMatch.ref, matchParty: amtMatch.party }
    return { ...row, status: 'unmatched' as MatchStatus }
  })
}

// ─── LS helpers ───────────────────────────────────────────────────────────────

function lsGet<T>(key: string, fallback: T): T {
  try { const r = localStorage.getItem(key); return r ? JSON.parse(r) : fallback } catch { return fallback }
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function AccountsPage() {
  const { invoices, markPaid, updateInvoice } = useInvoices()
  const { expenses } = useExpenses()
  const { runs, createRun, deleteRun, executeRun } = usePayRuns()

  const [tab, setTab] = useState<Tab>('runs')

  // ── Payment run builder ────────────────────────────────────────────────────
  const [building, setBuilding] = useState(false)
  const [runName, setRunName] = useState('')
  const [runDate, setRunDate] = useState(todayISO)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [executing, setExecuting] = useState<string | null>(null)
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null)
  const [expandedRuns, setExpandedRuns] = useState<Set<string>>(new Set())

  // ── Payment Sheet modal ────────────────────────────────────────────────────
  const [sheetOpen, setSheetOpen] = useState(false)
  const [sheetProject, setSheetProject] = useState<string>('')
  // Load projects from localStorage
  const allProjects = useMemo<Project[]>(() => lsGet<Project[]>('ledger_projects', []), [])
  const sheetProjectObj = useMemo(() => allProjects.find(p => p.code === sheetProject) ?? null, [allProjects, sheetProject])
  const sheetCosts = useMemo(() => sheetProject ? lsGet(`project_costs_${sheetProject}`, []) : [], [sheetProject])
  const sheetReconLinks = useMemo(() => sheetProject ? lsGet(`project_cost_links_${sheetProject}`, { manual: [], broken: [] }) : { manual: [], broken: [] }, [sheetProject])

  function toggleRun(id: string) {
    setExpandedRuns(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })
  }

  const payableItems = useMemo(() => [
    ...invoices
      .filter(i => i.type === 'payable' && !['paid', 'draft'].includes(i.status))
      .map(i => ({ id: i.id, type: 'invoice' as const, party: i.party, ref: i.ref, amount: Number(i.amount), currency: i.currency, projectLabel: i.project_code ?? i.project_name ?? '' })),
    ...expenses
      .filter(e => e.status === 'approved')
      .map(e => ({ id: e.id, type: 'expense' as const, party: e.employee, ref: `EXP-${e.id.slice(0, 6)}`, amount: Number(e.total), currency: '£', projectLabel: e.project_code ?? '' })),
  ], [invoices, expenses])

  const selectedItems = payableItems.filter(i => selected.has(i.id))
  const runTotal = selectedItems.reduce((t, i) => t + i.amount, 0)

  function toggleItem(id: string) {
    setSelected(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })
  }

  function handleCreateRun() {
    if (!runName.trim() || selectedItems.length === 0) return
    createRun(runName.trim(), runDate, selectedItems)
    setBuilding(false); setRunName(''); setSelected(new Set())
  }

  async function handleExecute(id: string) {
    setExecuting(id)
    try { await executeRun(id) } catch (e) { alert(String(e)) } finally { setExecuting(null) }
  }

  function handleDeleteRun(id: string) {
    if (deleteConfirm === id) { deleteRun(id); setDeleteConfirm(null) }
    else { setDeleteConfirm(id); setTimeout(() => setDeleteConfirm(null), 3000) }
  }

  // Add invoices from payment sheet to payment run builder
  function handleAddToRun(selInvoices: Invoice[]) {
    const items: PayRunItem[] = selInvoices.map(i => ({
      id: i.id, type: 'invoice', party: i.party, ref: i.ref ?? '',
      amount: Number(i.amount), currency: i.currency,
      projectLabel: i.project_code ?? i.project_name ?? '',
    }))
    setSelected(prev => {
      const n = new Set(prev)
      items.forEach(item => n.add(item.id))
      return n
    })
    setSheetOpen(false)
    setBuilding(true)
    if (!runName) setRunName(`${sheetProject} Payment`)
  }

  // ── Bank reconcile ─────────────────────────────────────────────────────────
  const fileRef = useRef<HTMLInputElement>(null)
  const [csvText, setCsvText] = useState('')
  const [matchedRows, setMatchedRows] = useState<MatchedRow[]>([])

  function handleFile(file: File) {
    const reader = new FileReader()
    reader.onload = e => {
      const text = e.target?.result as string
      setCsvText(text)
      setMatchedRows(matchRows(parseCSV(text), invoices))
    }
    reader.readAsText(file)
  }

  const matchCounts = useMemo(() => ({
    matched: matchedRows.filter(r => r.status === 'matched').length,
    possible: matchedRows.filter(r => r.status === 'possible').length,
    unmatched: matchedRows.filter(r => r.status === 'unmatched').length,
  }), [matchedRows])

  return (
    <>
      <Header title="AC Accounts" />
      <main className="flex-1 overflow-y-auto px-6 py-6">

        {/* Tabs */}
        <div className="flex border-b border-rule mb-6 gap-0">
          {(['runs', 'reconcile'] as Tab[]).map(t => (
            <button key={t} onClick={() => setTab(t)}
              className={cn('px-5 py-2.5 font-mono text-xs uppercase tracking-wider border-b-2 -mb-px transition-colors',
                tab === t ? 'border-ink text-ink' : 'border-transparent text-muted hover:text-ink')}>
              {t === 'runs' ? 'Payment Runs' : 'Bank Reconcile'}
            </button>
          ))}
          {/* Payment Sheet button — always visible */}
          <div className="flex-1" />
          <button
            onClick={() => setSheetOpen(true)}
            className="flex items-center gap-1.5 mb-1 px-3 py-1.5 text-xs font-mono uppercase tracking-wider border border-rule text-muted hover:text-ink hover:border-ink transition-colors">
            <Table2 size={11} /> Payment Sheet
          </button>
        </div>

        {/* ── Payment Runs ──────────────────────────────────────────────────── */}
        {tab === 'runs' && (
          <div className="space-y-5">
            {!building && (
              <button onClick={() => setBuilding(true)}
                className="flex items-center gap-1.5 bg-ink text-white px-4 py-2 text-xs font-mono uppercase tracking-wider hover:bg-[#333] transition-colors">
                <Plus size={11} /> New Payment Run
              </button>
            )}

            {building && (
              <div className="s-section">
                <div className="flex items-center justify-between mb-4">
                  <p className="tbl-lbl">New Payment Run</p>
                  <button onClick={() => setBuilding(false)} className="text-muted hover:text-ink transition-colors">
                    <X size={13} />
                  </button>
                </div>
                <div className="grid grid-cols-2 gap-4 mb-5">
                  <div>
                    <label className="field-label">Run Name</label>
                    <input type="text" value={runName} onChange={e => setRunName(e.target.value)}
                      placeholder="e.g., April Supplier Payments"
                      className="w-full border border-rule bg-paper px-3 py-2 text-sm text-ink focus:outline-none focus:border-ink" />
                  </div>
                  <div>
                    <label className="field-label">Payment Date</label>
                    <input type="date" value={runDate} onChange={e => setRunDate(e.target.value)}
                      className="w-full border border-rule bg-paper px-3 py-2 text-sm text-ink focus:outline-none focus:border-ink" />
                  </div>
                </div>

                {payableItems.length === 0 ? (
                  <p className="font-mono text-xs text-muted">No open payable invoices or approved expenses.</p>
                ) : (
                  <div className="border border-rule overflow-hidden mb-4">
                    <table className="w-full">
                      <thead>
                        <tr className="bg-cream border-b border-rule">
                          <th className="w-8 px-3 py-2" />
                          <th className="tbl-lbl text-left px-3 py-2">Type</th>
                          <th className="tbl-lbl text-left px-3 py-2">Party</th>
                          <th className="tbl-lbl text-left px-3 py-2">Ref</th>
                          <th className="tbl-lbl text-right px-3 py-2">Amount</th>
                        </tr>
                      </thead>
                      <tbody>
                        {payableItems.map(item => (
                          <tr key={item.id}
                            onClick={() => toggleItem(item.id)}
                            className={cn('border-b border-rule last:border-0 cursor-pointer transition-colors',
                              selected.has(item.id) ? 'bg-ac-green-pale' : 'hover:bg-cream/60')}>
                            <td className="px-3 py-2.5 text-center">
                              <input type="checkbox" readOnly checked={selected.has(item.id)} className="accent-ink"
                                onClick={e => e.stopPropagation()} onChange={() => toggleItem(item.id)} />
                            </td>
                            <td className="px-3 py-2.5">
                              <span className="font-mono text-[10px] uppercase tracking-wider text-muted">{item.type}</span>
                            </td>
                            <td className="px-3 py-2.5 text-sm text-ink">{item.party}</td>
                            <td className="px-3 py-2.5 font-mono text-xs text-muted">{item.ref}</td>
                            <td className="px-3 py-2.5 text-sm font-semibold text-right">{fmt(item.amount, item.currency)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                <div className="flex items-center justify-between">
                  <span className="font-mono text-xs text-muted">
                    {selectedItems.length} item{selectedItems.length !== 1 ? 's' : ''} · {fmt(runTotal)}
                  </span>
                  <div className="flex gap-2">
                    <button onClick={() => setBuilding(false)}
                      className="px-4 py-2 text-xs font-mono uppercase tracking-wider border border-rule text-muted hover:text-ink transition-colors">
                      Cancel
                    </button>
                    <button onClick={handleCreateRun}
                      disabled={!runName.trim() || selectedItems.length === 0}
                      className="px-4 py-2 text-xs font-mono uppercase tracking-wider bg-ink text-white hover:bg-[#333] transition-colors disabled:opacity-40">
                      Create Run
                    </button>
                  </div>
                </div>
              </div>
            )}

            {runs.length === 0 && !building ? (
              <div className="tbl-card py-12 text-center">
                <p className="font-mono text-xs text-muted uppercase tracking-wider">No payment runs yet</p>
              </div>
            ) : runs.length > 0 && (
              <div className="space-y-4">
                {runs.map(run => {
                  const isExecuted = (run as PayRun & { executed?: boolean }).executed
                  const isExpanded = expandedRuns.has(run.id)
                  return (
                    <div key={run.id} className="tbl-card">
                      <div className="tbl-hd cursor-pointer select-none" onClick={() => toggleRun(run.id)}>
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="text-muted flex-shrink-0">
                            {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                          </span>
                          <div className="min-w-0">
                            <p className="text-sm font-semibold text-ink">{run.name}</p>
                            <p className="font-mono text-xs text-muted mt-0.5">{fmtDate(run.date)} · {run.items.length} item{run.items.length !== 1 ? 's' : ''}</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2" onClick={e => e.stopPropagation()}>
                          <span className="font-mono text-sm font-semibold text-ink">{fmt(run.total)}</span>
                          {isExecuted ? (
                            <span className="badge badge-paid">Executed</span>
                          ) : (
                            <button onClick={() => handleExecute(run.id)} disabled={executing === run.id}
                              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-mono uppercase tracking-wider bg-ac-green text-white hover:bg-[#2d6147] transition-colors disabled:opacity-50">
                              <Play size={10} /> {executing === run.id ? 'Running…' : 'Execute'}
                            </button>
                          )}
                          <button onClick={() => handleDeleteRun(run.id)}
                            className={cn('p-1.5 transition-colors', deleteConfirm === run.id ? 'text-red-600' : 'text-muted hover:text-red-500')}>
                            <Trash2 size={13} />
                          </button>
                        </div>
                      </div>
                      {isExpanded && (
                        <table className="w-full">
                          <tbody>
                            {run.items.map(item => (
                              <tr key={item.id} className="border-b border-rule last:border-0">
                                <td className="px-5 py-2 font-mono text-[10px] uppercase tracking-wider text-muted w-20">{item.type}</td>
                                <td className="px-3 py-2 text-sm text-ink">{item.party}</td>
                                <td className="px-3 py-2 font-mono text-xs text-muted">{item.ref}</td>
                                <td className="px-5 py-2 text-right font-mono text-sm font-semibold">{fmt(item.amount, item.currency)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )}

        {/* ── Bank Reconcile ────────────────────────────────────────────────── */}
        {tab === 'reconcile' && (
          <div className="space-y-5">
            <div className="s-section">
              <p className="tbl-lbl mb-3">Upload Bank Statement CSV</p>
              <p className="font-mono text-xs text-muted mb-4">
                Export a CSV from your bank. AC Ledger will match transactions against open invoices by reference number or amount.
              </p>
              <input ref={fileRef} type="file" accept=".csv,.txt" className="hidden"
                onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f) }} />
              <div
                className="border-2 border-dashed border-rule hover:border-muted transition-colors cursor-pointer flex flex-col items-center justify-center py-10 gap-3"
                onClick={() => fileRef.current?.click()}
                onDragOver={e => e.preventDefault()}
                onDrop={e => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) handleFile(f) }}
              >
                <Upload size={20} className="text-muted" />
                <p className="font-mono text-xs text-muted uppercase tracking-wider">Drop CSV or click to upload</p>
              </div>
            </div>

            {matchedRows.length > 0 && (
              <>
                <div className="grid grid-cols-3 gap-4">
                  {[
                    { label: 'Matched',   count: matchCounts.matched,   accent: '#3a7a5a', icon: <CheckCircle size={14} /> },
                    { label: 'Possible',  count: matchCounts.possible,  accent: '#7a6a3a', icon: <AlertCircle size={14} /> },
                    { label: 'Unmatched', count: matchCounts.unmatched, accent: '#9a9a9a', icon: <HelpCircle size={14} /> },
                  ].map(({ label, count, accent, icon }) => (
                    <div key={label} className="stat-card" style={{ borderTopColor: accent } as React.CSSProperties}>
                      <div className="flex justify-between items-start mb-2">
                        <p className="font-mono text-[10px] uppercase tracking-widest text-muted">{label}</p>
                        <span className="text-muted">{icon}</span>
                      </div>
                      <p className="font-sans font-semibold text-2xl text-ink">{count}</p>
                      <p className="font-mono text-xs text-muted mt-1">transactions</p>
                    </div>
                  ))}
                </div>

                <div className="tbl-card">
                  <div className="tbl-hd">
                    <p className="tbl-lbl">Transaction Matches</p>
                    <button onClick={() => { setMatchedRows([]); setCsvText('') }}
                      className="font-mono text-xs text-muted hover:text-ink transition-colors">Clear</button>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full">
                      <thead>
                        <tr className="border-b border-rule bg-paper/50">
                          <th className="tbl-lbl text-left px-5 py-2.5 w-8" />
                          <th className="tbl-lbl text-left px-3 py-2.5">Description</th>
                          <th className="tbl-lbl text-left px-3 py-2.5 hidden md:table-cell">Date</th>
                          <th className="tbl-lbl text-right px-3 py-2.5">Amount</th>
                          <th className="tbl-lbl text-left px-5 py-2.5">Match</th>
                        </tr>
                      </thead>
                      <tbody>
                        {matchedRows.map((row, idx) => {
                          const colors = { matched: 'bg-ac-green-pale', possible: 'bg-ac-amber-pale', unmatched: 'bg-red-50' }
                          const icons = {
                            matched:   <CheckCircle size={13} className="text-ac-green" />,
                            possible:  <AlertCircle size={13} className="text-ac-amber" />,
                            unmatched: <HelpCircle size={13} className="text-muted" />,
                          }
                          return (
                            <tr key={idx} className={cn('border-b border-rule last:border-0', colors[row.status])}>
                              <td className="px-5 py-2.5">{icons[row.status]}</td>
                              <td className="px-3 py-2.5 text-sm text-ink max-w-[280px] truncate">{row.description}</td>
                              <td className="px-3 py-2.5 font-mono text-xs text-muted hidden md:table-cell">{row.date}</td>
                              <td className="px-3 py-2.5 font-mono text-sm font-semibold text-right">{fmt(row.amount)}</td>
                              <td className="px-5 py-2.5 font-mono text-xs">
                                {row.matchRef
                                  ? <span className="text-ink">{row.matchRef} · {row.matchParty}</span>
                                  : <span className="text-muted">No match</span>}
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              </>
            )}
          </div>
        )}
      </main>

      {/* ── Payment Sheet Modal ── */}
      {sheetOpen && (
        <div className="fixed inset-0 z-50 flex flex-col" style={{ background: 'rgba(0,0,0,0.5)' }}>
          <div className="flex-1 flex flex-col bg-paper m-4 md:m-8 border border-rule shadow-xl overflow-hidden">
            {/* Modal header */}
            <div className="flex items-center gap-4 px-6 py-4 border-b border-rule bg-white flex-shrink-0">
              <Table2 size={14} className="text-muted" />
              <p className="font-semibold text-sm text-ink">Payment Sheet</p>
              <div className="flex-1" />
              {/* Project selector */}
              <div className="flex items-center gap-2">
                <label className="font-mono text-xs text-muted uppercase tracking-wider">Project</label>
                <select
                  value={sheetProject}
                  onChange={e => setSheetProject(e.target.value)}
                  className="border border-rule bg-paper px-3 py-1.5 text-sm font-mono text-ink focus:outline-none focus:border-ink"
                >
                  <option value="">— Select project —</option>
                  {allProjects.map(p => (
                    <option key={p.code} value={p.code}>{p.code} — {p.name}</option>
                  ))}
                </select>
              </div>
              <button onClick={() => setSheetOpen(false)} className="text-muted hover:text-ink transition-colors">
                <X size={16} />
              </button>
            </div>

            {/* Modal body */}
            <div className="flex-1 overflow-y-auto p-6">
              {!sheetProject ? (
                <div className="flex flex-col items-center justify-center py-24 gap-3">
                  <Table2 size={28} className="text-muted" />
                  <p className="font-mono text-xs text-muted uppercase tracking-wider">Select a project to view its payment sheet</p>
                </div>
              ) : !sheetProjectObj ? (
                <p className="font-mono text-xs text-muted text-center py-12">Project not found</p>
              ) : (
                <PaymentSheet
                  invoices={invoices.filter(i => i.project_code === sheetProject)}
                  project={sheetProjectObj}
                  costs={sheetCosts}
                  reconLinks={sheetReconLinks}
                  updateInvoice={updateInvoice}
                  onAddToRun={handleAddToRun}
                />
              )}
            </div>
          </div>
        </div>
      )}
    </>
  )
}
