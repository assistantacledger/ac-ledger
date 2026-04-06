'use client'

import { useState, useMemo } from 'react'
import { Header } from '@/components/layout/Header'
import { ExpenseModal } from '@/components/expenses/ExpenseModal'
import { useExpenses } from '@/hooks/useExpenses'
import { cn, fmt, fmtDate } from '@/lib/format'
import { Plus, Search, CheckCircle, DollarSign, Pencil, Trash2 } from 'lucide-react'
import type { Expense, ExpenseInsert, ExpenseStatus, Entity } from '@/types'
import { ENTITIES } from '@/types'

const STATUS_BADGE: Record<ExpenseStatus, string> = {
  submitted: 'badge-submitted',
  approved: 'badge-approved',
  paid: 'badge-paid',
}

export default function ExpensesPage() {
  const { expenses, loading, error, createExpense, updateExpense, setStatus, deleteExpense } = useExpenses()
  const [editing, setEditing] = useState<Expense | null>(null)
  const [creating, setCreating] = useState(false)
  const [search, setSearch] = useState('')
  const [entityFilter, setEntityFilter] = useState<Entity | 'all'>('all')
  const [statusFilter, setStatusFilter] = useState<ExpenseStatus | 'all'>('all')
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null)

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

  const totalFiltered = filtered.reduce((t, e) => t + Number(e.total), 0)

  async function handleSave(data: ExpenseInsert) {
    if (editing) await updateExpense(editing.id, data)
    else await createExpense(data)
  }

  function handleDelete(id: string) {
    if (deleteConfirm === id) { deleteExpense(id); setDeleteConfirm(null) }
    else { setDeleteConfirm(id); setTimeout(() => setDeleteConfirm(null), 3000) }
  }

  return (
    <>
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
            <div className="flex-1" />
            {filtered.length > 0 && (
              <span className="font-mono text-xs text-muted hidden sm:block">
                {filtered.length} expense{filtered.length !== 1 ? 's' : ''} · {fmt(totalFiltered)}
              </span>
            )}
            <button
              onClick={() => { setEditing(null); setCreating(true) }}
              className="flex items-center gap-1.5 bg-ink text-white px-3 py-1.5 text-xs font-mono uppercase tracking-wider hover:bg-[#333] transition-colors"
            >
              <Plus size={11} /> New
            </button>
          </div>

          {/* Table */}
          {loading ? (
            <div className="flex items-center justify-center py-16">
              <div className="w-5 h-5 border-2 border-rule border-t-ink animate-spin" />
            </div>
          ) : filtered.length === 0 ? (
            <div className="py-16 text-center">
              <p className="font-mono text-xs text-muted uppercase tracking-wider">No expenses found</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-rule bg-paper/50">
                    <th className="tbl-lbl text-left px-5 py-2.5">Employee</th>
                    <th className="tbl-lbl text-left px-3 py-2.5">Date</th>
                    <th className="tbl-lbl text-left px-3 py-2.5 hidden lg:table-cell">Entity</th>
                    <th className="tbl-lbl text-left px-3 py-2.5 hidden md:table-cell">Project</th>
                    <th className="tbl-lbl text-right px-3 py-2.5">Total</th>
                    <th className="tbl-lbl text-left px-3 py-2.5">Status</th>
                    <th className="w-28 px-5 py-2.5" />
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((exp, idx) => (
                    <tr key={exp.id} className={cn('border-b border-rule last:border-0 group transition-colors hover:bg-cream/70', idx % 2 === 1 && 'bg-paper/40')}>
                      <td className="px-5 py-2.5 text-sm font-medium text-ink">{exp.employee}</td>
                      <td className="px-3 py-2.5 font-mono text-xs text-muted whitespace-nowrap">{fmtDate(exp.date)}</td>
                      <td className="px-3 py-2.5 hidden lg:table-cell">
                        <span className="font-mono text-[10px] uppercase tracking-wider text-muted">
                          {exp.entity === 'Actually Creative' ? 'AC' : exp.entity === '419Studios' ? '419' : 'RTW'}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 hidden md:table-cell font-mono text-xs text-muted">
                        {exp.project_code ?? '—'}
                      </td>
                      <td className="px-3 py-2.5 text-sm font-semibold text-right">{fmt(exp.total)}</td>
                      <td className="px-3 py-2.5">
                        <span className={cn('badge', STATUS_BADGE[exp.status])}>{exp.status}</span>
                      </td>
                      <td className="px-5 py-2.5">
                        <div className="row-actions justify-end">
                          {exp.status === 'submitted' && (
                            <button onClick={() => setStatus(exp.id, 'approved')} title="Approve"
                              className="p-1 text-muted hover:text-ac-green transition-colors">
                              <CheckCircle size={13} />
                            </button>
                          )}
                          {exp.status === 'approved' && (
                            <button onClick={() => setStatus(exp.id, 'paid')} title="Mark paid"
                              className="p-1 text-muted hover:text-ac-green transition-colors">
                              <DollarSign size={13} />
                            </button>
                          )}
                          <button onClick={() => { setEditing(exp); setCreating(false) }} title="Edit"
                            className="p-1 text-muted hover:text-ink transition-colors">
                            <Pencil size={13} />
                          </button>
                          <button onClick={() => handleDelete(exp.id)} title={deleteConfirm === exp.id ? 'Click again to confirm' : 'Delete'}
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
        onClose={() => { setCreating(false); setEditing(null) }}
        expense={editing}
        onSave={handleSave}
      />
    </>
  )
}
