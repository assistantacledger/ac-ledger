'use client'

import { useState, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { Header } from '@/components/layout/Header'
import { ExpenseModal } from '@/components/expenses/ExpenseModal'
import { ExpenseReimbursePDF } from '@/components/expenses/ExpenseReimbursePDF'
import { useExpenses } from '@/hooks/useExpenses'
import { useEmployeeProfiles } from '@/hooks/useEmployeeProfiles'
import { cn, fmt, fmtDate } from '@/lib/format'
import { toast } from '@/lib/toast'
import {
  Plus, Search, CheckCircle, DollarSign, Pencil, Trash2,
  FileText, ChevronDown, ChevronRight, User, ArrowUpDown, ArrowUp, ArrowDown,
  Eye, X,
} from 'lucide-react'
import type { Expense, ExpenseInsert, ExpenseStatus, Entity, BankDetails } from '@/types'
import { ENTITIES } from '@/types'

const STATUS_BADGE: Record<ExpenseStatus, string> = {
  submitted: 'badge-submitted',
  approved: 'badge-approved',
  paid: 'badge-paid',
}

type SortKey = 'date' | 'total' | 'status'
type SortDir = 'asc' | 'desc'

export default function ExpensesPage() {
  const router = useRouter()
  const { expenses, loading, error, createExpense, updateExpense, setStatus, deleteExpense } = useExpenses()
  const { profiles } = useEmployeeProfiles()

  const [editing, setEditing] = useState<Expense | null>(null)
  const [creating, setCreating] = useState(false)
  const [prefillEmployee, setPrefillEmployee] = useState<string | undefined>()
  const [prefillBank, setPrefillBank] = useState<BankDetails | undefined>()
  const [search, setSearch] = useState('')
  const [entityFilter, setEntityFilter] = useState<Entity | 'all'>('all')
  const [statusFilter, setStatusFilter] = useState<ExpenseStatus | 'all'>('all')
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null)
  const [printing, setPrinting] = useState<Expense | null>(null)
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null)
  const [expandedProfiles, setExpandedProfiles] = useState<Set<string>>(new Set())
  const [viewMode, setViewMode] = useState<'profile' | 'list'>('profile')
  const [sortKey, setSortKey] = useState<SortKey>('date')
  const [sortDir, setSortDir] = useState<SortDir>('desc')

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortKey(key); setSortDir('desc') }
  }

  function SortIcon({ k }: { k: SortKey }) {
    if (sortKey !== k) return <ArrowUpDown size={10} className="text-muted/50" />
    return sortDir === 'asc' ? <ArrowUp size={10} className="text-ink" /> : <ArrowDown size={10} className="text-ink" />
  }

  const filtered = useMemo(() => {
    let rows = expenses
    if (entityFilter !== 'all') rows = rows.filter(e => e.entity === entityFilter)
    if (statusFilter !== 'all') rows = rows.filter(e => e.status === statusFilter)
    if (search.trim()) {
      const q = search.toLowerCase()
      rows = rows.filter(e =>
        e.employee?.toLowerCase().includes(q) ||
        e.project_code?.toLowerCase().includes(q) ||
        e.project_name?.toLowerCase().includes(q) ||
        e.notes?.toLowerCase().includes(q)
      )
    }
    return rows
  }, [expenses, entityFilter, statusFilter, search])

  const sorted = useMemo(() => {
    return [...filtered].sort((a, b) => {
      let cmp = 0
      if (sortKey === 'date') cmp = a.date.localeCompare(b.date)
      else if (sortKey === 'total') cmp = Number(a.total) - Number(b.total)
      else if (sortKey === 'status') cmp = a.status.localeCompare(b.status)
      return sortDir === 'asc' ? cmp : -cmp
    })
  }, [filtered, sortKey, sortDir])

  // Group by employee for profile view
  const profileGroups = useMemo(() => {
    const map = new Map<string, Expense[]>()
    for (const exp of sorted) {
      const name = exp.employee || 'Unknown'
      if (!map.has(name)) map.set(name, [])
      map.get(name)!.push(exp)
    }
    return Array.from(map.entries()).map(([name, exps]) => {
      const total = exps.reduce((t, e) => t + Number(e.total), 0)
      const paid = exps.filter(e => e.status === 'paid').reduce((t, e) => t + Number(e.total), 0)
      const outstanding = exps.filter(e => e.status !== 'paid').reduce((t, e) => t + Number(e.total), 0)
      // Group by project
      const byProject = new Map<string, Expense[]>()
      for (const exp of exps) {
        const key = exp.project_code || '—'
        if (!byProject.has(key)) byProject.set(key, [])
        byProject.get(key)!.push(exp)
      }
      return { name, exps, total, paid, outstanding, byProject }
    })
  }, [sorted])

  const totalFiltered = filtered.reduce((t, e) => t + Number(e.total), 0)

  async function handleSave(data: ExpenseInsert) {
    if (editing) {
      await updateExpense(editing.id, data)
      toast('Expense updated')
    } else {
      await createExpense(data)
      toast('Expense saved')
    }
  }

  function handleDelete(id: string) {
    if (deleteConfirm === id) {
      deleteExpense(id)
      setDeleteConfirm(null)
      toast('Expense deleted', 'error')
    } else {
      setDeleteConfirm(id)
      setTimeout(() => setDeleteConfirm(null), 3000)
    }
  }

  async function handleSetStatus(id: string, status: ExpenseStatus) {
    await setStatus(id, status)
    toast(`Marked ${status}`)
  }

  function handlePrint(exp: Expense) {
    setPrinting(exp)
    setTimeout(() => { window.print(); setPrinting(null) }, 80)
  }

  function openNewForProfile(name: string) {
    const profile = profiles.find(p => p.name.toLowerCase() === name.toLowerCase())
    setPrefillEmployee(name)
    setPrefillBank(profile ? {
      accName: profile.accName, bankName: profile.bankName, sortCode: profile.sortCode,
      accNum: profile.accNum, iban: profile.iban, swift: profile.swift,
      invCompany: profile.invCompany, invAddr: profile.invAddr,
    } : undefined)
    setEditing(null)
    setCreating(true)
  }

  function toggleProfile(name: string) {
    setExpandedProfiles(prev => {
      const next = new Set(prev)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      return next
    })
  }

  const thCls = 'tbl-lbl text-left px-3 py-2.5 cursor-pointer select-none hover:text-ink transition-colors'

  return (
    <>
      {printing && (
        <div style={{ position: 'absolute', left: -9999, top: 0, pointerEvents: 'none' }} aria-hidden>
          <ExpenseReimbursePDF expense={printing} forPrint={true} />
        </div>
      )}
      {lightboxUrl && (
        <div className="fixed inset-0 z-[60] flex flex-col bg-black/90" onClick={() => setLightboxUrl(null)}>
          <div className="flex items-center justify-end px-6 py-3">
            <button onClick={() => setLightboxUrl(null)} className="text-white/60 hover:text-white"><X size={18} /></button>
          </div>
          <div className="flex-1 flex items-center justify-center p-6" onClick={e => e.stopPropagation()}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={lightboxUrl} alt="Receipt" className="max-w-full max-h-full object-contain" />
          </div>
        </div>
      )}
      <Header title="Expenses" />
      <main className="flex-1 overflow-y-auto px-6 py-6">
        {error && (
          <div className="mb-5 border border-red-200 bg-red-50 px-4 py-3 font-mono text-xs text-red-700">{error}</div>
        )}

        <div className="tbl-card">
          {/* Toolbar */}
          <div className="px-5 py-3 bg-cream border-b border-rule flex flex-wrap items-center gap-3">
            <div className="relative flex-1 min-w-[180px] max-w-xs">
              <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" />
              <input
                type="text" value={search} onChange={e => setSearch(e.target.value)}
                placeholder="Search employee, project…"
                className="w-full pl-7 pr-3 py-1.5 text-xs border border-rule bg-white text-ink placeholder:text-muted focus:outline-none focus:border-ink"
              />
            </div>
            <select value={entityFilter} onChange={e => setEntityFilter(e.target.value as Entity | 'all')}
              className="text-xs border border-rule bg-white px-2 py-1.5 text-ink focus:outline-none font-mono">
              <option value="all">All entities</option>
              {ENTITIES.map(e => <option key={e} value={e}>{e}</option>)}
            </select>
            <select value={statusFilter} onChange={e => setStatusFilter(e.target.value as ExpenseStatus | 'all')}
              className="text-xs border border-rule bg-white px-2 py-1.5 text-ink focus:outline-none font-mono uppercase">
              <option value="all">All statuses</option>
              <option value="submitted">Submitted</option>
              <option value="approved">Approved</option>
              <option value="paid">Paid</option>
            </select>
            {/* View toggle */}
            <div className="flex border border-rule">
              <button onClick={() => setViewMode('profile')}
                className={cn('px-2.5 py-1.5 text-xs font-mono uppercase transition-colors', viewMode === 'profile' ? 'bg-ink text-white' : 'text-muted hover:text-ink')}>
                By Person
              </button>
              <button onClick={() => setViewMode('list')}
                className={cn('px-2.5 py-1.5 text-xs font-mono uppercase transition-colors border-l border-rule', viewMode === 'list' ? 'bg-ink text-white' : 'text-muted hover:text-ink')}>
                List
              </button>
            </div>
            <div className="flex-1" />
            {filtered.length > 0 && (
              <span className="font-mono text-xs text-muted hidden sm:block">
                {filtered.length} expense{filtered.length !== 1 ? 's' : ''} · {fmt(totalFiltered)}
              </span>
            )}
            <button
              onClick={() => { setPrefillEmployee(undefined); setPrefillBank(undefined); setEditing(null); setCreating(true) }}
              className="flex items-center gap-1.5 bg-ink text-white px-3 py-1.5 text-xs font-mono uppercase tracking-wider hover:bg-[#333] transition-colors"
            >
              <Plus size={11} /> New
            </button>
          </div>

          {/* Content */}
          {loading ? (
            <div className="flex items-center justify-center py-16">
              <div className="w-5 h-5 border-2 border-rule border-t-ink animate-spin" />
            </div>
          ) : filtered.length === 0 ? (
            <div className="py-16 text-center">
              <p className="font-mono text-xs text-muted uppercase tracking-wider">No expenses found</p>
            </div>
          ) : viewMode === 'profile' ? (
            /* ── Profile view ── */
            <div>
              {profileGroups.map(group => {
                const expanded = expandedProfiles.has(group.name)
                return (
                  <div key={group.name} className="border-b border-rule last:border-0">
                    {/* Profile header row */}
                    <div
                      className="flex items-center gap-3 px-5 py-3 cursor-pointer hover:bg-cream/60 transition-colors group"
                      onClick={() => toggleProfile(group.name)}
                    >
                      <div className="w-5 flex-shrink-0 text-muted">
                        {expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                      </div>
                      <div className="w-7 h-7 rounded-full bg-rule flex items-center justify-center flex-shrink-0">
                        <User size={13} className="text-muted" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-ink">{group.name}</p>
                        <p className="font-mono text-[10px] text-muted">
                          {group.exps.length} claim{group.exps.length !== 1 ? 's' : ''}
                        </p>
                      </div>
                      {/* Totals */}
                      <div className="hidden sm:flex gap-6 mr-4">
                        <div className="text-right">
                          <p className="font-mono text-[10px] text-muted uppercase tracking-wider">Total</p>
                          <p className="font-mono text-sm font-semibold text-ink">{fmt(group.total)}</p>
                        </div>
                        <div className="text-right">
                          <p className="font-mono text-[10px] text-muted uppercase tracking-wider">Outstanding</p>
                          <p className={cn('font-mono text-sm font-semibold', group.outstanding > 0 ? 'text-ac-amber' : 'text-muted')}>{fmt(group.outstanding)}</p>
                        </div>
                        <div className="text-right">
                          <p className="font-mono text-[10px] text-muted uppercase tracking-wider">Paid</p>
                          <p className="font-mono text-sm font-semibold text-ac-green">{fmt(group.paid)}</p>
                        </div>
                      </div>
                      {/* New expense for this profile */}
                      <button
                        onClick={e => { e.stopPropagation(); openNewForProfile(group.name) }}
                        className="opacity-0 group-hover:opacity-100 flex items-center gap-1 px-2 py-1 text-xs font-mono border border-rule text-muted hover:text-ink hover:border-ink transition-all"
                      >
                        <Plus size={10} /> New
                      </button>
                    </div>

                    {/* Expanded: expenses grouped by project */}
                    {expanded && (
                      <div className="bg-paper/30 border-t border-rule">
                        {Array.from(group.byProject.entries()).map(([projectKey, projExps]) => (
                          <div key={projectKey} className="border-b border-rule/50 last:border-0">
                            {/* Project sub-header */}
                            <div className="px-12 py-1.5 flex items-center gap-2">
                              <span className="font-mono text-[10px] uppercase tracking-wider text-muted">{projectKey}</span>
                              {projectKey !== '—' && (
                                <button
                                  onClick={() => router.push(`/projects?open=${projectKey}`)}
                                  className="font-mono text-[9px] text-blue-500 hover:underline"
                                >
                                  View project
                                </button>
                              )}
                              <span className="font-mono text-[10px] text-muted ml-auto">
                                {fmt(projExps.reduce((t, e) => t + Number(e.total), 0))}
                              </span>
                            </div>
                            {/* Expense rows */}
                            {projExps.map(exp => (
                              <div key={exp.id}
                                className="flex items-center gap-3 px-12 py-2 hover:bg-cream/50 transition-colors group/row border-t border-rule/30">
                                <span className="font-mono text-xs text-muted w-20 flex-shrink-0">{fmtDate(exp.date)}</span>
                                <span className="flex-1 text-xs text-ink truncate">{exp.notes || '—'}</span>
                                <span className="font-mono text-xs font-semibold text-ink w-20 text-right">{fmt(exp.total)}</span>
                                <span className={cn('badge', STATUS_BADGE[exp.status])}>{exp.status}</span>
                                {/* Row actions */}
                                <div className="row-actions opacity-0 group-hover/row:opacity-100">
                                  <button onClick={() => handlePrint(exp)} title="Print PDF"
                                    className="p-1 text-muted hover:text-ink transition-colors"><FileText size={12} /></button>
                                  {exp.status === 'submitted' && (
                                    <button onClick={() => handleSetStatus(exp.id, 'approved')} title="Approve"
                                      className="p-1 text-muted hover:text-ac-green transition-colors"><CheckCircle size={12} /></button>
                                  )}
                                  {exp.status === 'approved' && (
                                    <button onClick={() => handleSetStatus(exp.id, 'paid')} title="Mark paid"
                                      className="p-1 text-muted hover:text-ac-green transition-colors"><DollarSign size={12} /></button>
                                  )}
                                  <button onClick={() => { setEditing(exp); setCreating(false) }} title="Edit"
                                    className="p-1 text-muted hover:text-ink transition-colors"><Pencil size={12} /></button>
                                  <button onClick={() => handleDelete(exp.id)}
                                    className={cn('p-1 transition-colors', deleteConfirm === exp.id ? 'text-red-600' : 'text-muted hover:text-red-500')}>
                                    <Trash2 size={12} />
                                  </button>
                                </div>
                              </div>
                            ))}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          ) : (
            /* ── List view ── */
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-rule bg-paper/50">
                    <th className="tbl-lbl text-left px-5 py-2.5">Employee</th>
                    <th className={thCls} onClick={() => toggleSort('date')}>
                      <span className="flex items-center gap-1">Date <SortIcon k="date" /></span>
                    </th>
                    <th className="tbl-lbl text-left px-3 py-2.5 hidden lg:table-cell">Entity</th>
                    <th className="tbl-lbl text-left px-3 py-2.5 hidden md:table-cell">Project</th>
                    <th className={cn(thCls, 'text-right')} onClick={() => toggleSort('total')}>
                      <span className="flex items-center gap-1 justify-end">Total <SortIcon k="total" /></span>
                    </th>
                    <th className={thCls} onClick={() => toggleSort('status')}>
                      <span className="flex items-center gap-1">Status <SortIcon k="status" /></span>
                    </th>
                    <th className="w-28 px-5 py-2.5" />
                  </tr>
                </thead>
                <tbody>
                  {sorted.map((exp, idx) => (
                    <tr key={exp.id} className={cn('border-b border-rule last:border-0 group transition-colors hover:bg-cream/70', idx % 2 === 1 && 'bg-paper/40')}>
                      <td className="px-5 py-2.5">
                        <button onClick={() => { setViewMode('profile'); setExpandedProfiles(new Set([exp.employee])) }}
                          className="text-sm font-medium text-ink hover:underline text-left">
                          {exp.employee}
                        </button>
                      </td>
                      <td className="px-3 py-2.5 font-mono text-xs text-muted whitespace-nowrap">{fmtDate(exp.date)}</td>
                      <td className="px-3 py-2.5 hidden lg:table-cell">
                        <span className="font-mono text-[10px] uppercase tracking-wider text-muted">
                          {exp.entity === 'Actually Creative' ? 'AC' : exp.entity === '419Studios' ? '419' : 'RTW'}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 hidden md:table-cell font-mono text-xs text-muted">
                        {exp.project_code
                          ? <button onClick={() => router.push(`/projects?open=${exp.project_code}`)} className="hover:text-ink hover:underline transition-colors">{exp.project_code}</button>
                          : '—'}
                      </td>
                      <td className="px-3 py-2.5 text-sm font-semibold text-right">{fmt(exp.total)}</td>
                      <td className="px-3 py-2.5">
                        <span className={cn('badge', STATUS_BADGE[exp.status])}>{exp.status}</span>
                      </td>
                      <td className="px-5 py-2.5">
                        <div className="row-actions justify-end">
                          {(exp.receipt_urls ?? []).length > 0 && (
                            <button onClick={() => {
                              const url = exp.receipt_urls![0]
                              if (url.includes('.pdf')) window.open(url, '_blank')
                              else setLightboxUrl(url)
                            }} title="View receipt" className="p-1 text-muted hover:text-ink transition-colors">
                              <Eye size={13} />
                            </button>
                          )}
                          <button onClick={() => handlePrint(exp)} title="Reimbursement PDF"
                            className="p-1 text-muted hover:text-ink transition-colors"><FileText size={13} /></button>
                          {exp.status === 'submitted' && (
                            <button onClick={() => handleSetStatus(exp.id, 'approved')} title="Approve"
                              className="p-1 text-muted hover:text-ac-green transition-colors"><CheckCircle size={13} /></button>
                          )}
                          {exp.status === 'approved' && (
                            <button onClick={() => handleSetStatus(exp.id, 'paid')} title="Mark paid"
                              className="p-1 text-muted hover:text-ac-green transition-colors"><DollarSign size={13} /></button>
                          )}
                          <button onClick={() => { setEditing(exp); setCreating(false) }} title="Edit"
                            className="p-1 text-muted hover:text-ink transition-colors"><Pencil size={13} /></button>
                          <button onClick={() => handleDelete(exp.id)}
                            className={cn('p-1 transition-colors', deleteConfirm === exp.id ? 'text-red-600' : 'text-muted hover:text-red-500')}>
                            <Trash2 size={13} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {!loading && filtered.length > 0 && (
            <div className="px-5 py-3 border-t border-rule bg-cream flex items-center justify-between">
              <span className="font-mono text-xs text-muted">{filtered.length} expense{filtered.length !== 1 ? 's' : ''}</span>
              <span className="font-mono text-xs font-semibold text-ink">Total: {fmt(totalFiltered)}</span>
            </div>
          )}
        </div>
      </main>

      <ExpenseModal
        isOpen={creating || !!editing}
        onClose={() => { setCreating(false); setEditing(null); setPrefillEmployee(undefined); setPrefillBank(undefined) }}
        expense={editing}
        prefillEmployee={prefillEmployee}
        prefillBank={prefillBank}
        onSave={handleSave}
      />
    </>
  )
}
