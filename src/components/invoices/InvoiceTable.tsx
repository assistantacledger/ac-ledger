'use client'

import { useState, useMemo } from 'react'
import { CheckCircle, Pencil, Trash2, Plus, Search, Eye } from 'lucide-react'
import { cn, fmt, fmtDate, daysOverdue } from '@/lib/format'
import type { Invoice, InvoiceType, InvoiceStatus, Entity } from '@/types'
import { ENTITIES } from '@/types'

const ALL_STATUSES: InvoiceStatus[] = [
  'draft', 'pending', 'submitted', 'approved', 'sent', 'overdue', 'part-paid', 'paid',
]

interface InvoiceTableProps {
  invoices: Invoice[]
  loading: boolean
  type: InvoiceType
  onEdit: (invoice: Invoice) => void
  onMarkPaid: (invoice: Invoice) => void
  onDelete: (id: string) => void
  onNew: () => void
  onPreview?: (invoice: Invoice) => void
}

function StatusBadge({ status }: { status: string }) {
  const cls: Record<string, string> = {
    paid: 'badge-paid', pending: 'badge-pending', overdue: 'badge-overdue',
    draft: 'badge-draft', submitted: 'badge-submitted', approved: 'badge-approved',
    sent: 'badge-sent', 'part-paid': 'badge-part-paid',
  }
  return <span className={cn('badge', cls[status] ?? 'badge-draft')}>{status}</span>
}

export function InvoiceTable({
  invoices, loading, type, onEdit, onMarkPaid, onDelete, onNew, onPreview,
}: InvoiceTableProps) {
  const [search, setSearch] = useState('')
  const [entityFilter, setEntityFilter] = useState<Entity | 'all'>('all')
  const [statusFilter, setStatusFilter] = useState<InvoiceStatus | 'all'>('all')
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null)

  const filtered = useMemo(() => {
    let rows = invoices.filter(i => i.type === type)
    if (entityFilter !== 'all') rows = rows.filter(i => i.entity === entityFilter)
    if (statusFilter !== 'all') rows = rows.filter(i => i.status === statusFilter)
    if (search.trim()) {
      const q = search.toLowerCase()
      rows = rows.filter(i =>
        i.party?.toLowerCase().includes(q) ||
        i.ref?.toLowerCase().includes(q) ||
        i.project_code?.toLowerCase().includes(q) ||
        i.project_name?.toLowerCase().includes(q) ||
        i.notes?.toLowerCase().includes(q)
      )
    }
    return rows
  }, [invoices, type, entityFilter, statusFilter, search])

  const totalAmount = filtered.reduce((t, i) => t + Number(i.amount), 0)
  const label = type === 'payable' ? 'To Pay' : 'Incoming'

  function handleDelete(id: string) {
    if (deleteConfirm === id) {
      onDelete(id)
      setDeleteConfirm(null)
    } else {
      setDeleteConfirm(id)
      setTimeout(() => setDeleteConfirm(null), 3000)
    }
  }

  return (
    <div className="tbl-card">
      {/* Toolbar */}
      <div className="px-5 py-3 bg-cream border-b border-rule flex flex-wrap items-center gap-3">
        {/* Search */}
        <div className="relative flex-1 min-w-[180px] max-w-xs">
          <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search party, ref, project…"
            className="w-full pl-7 pr-3 py-1.5 text-xs border border-rule bg-white text-ink placeholder:text-muted focus:outline-none focus:border-ink"
          />
        </div>

        {/* Entity filter */}
        <select
          value={entityFilter}
          onChange={e => setEntityFilter(e.target.value as Entity | 'all')}
          className="text-xs border border-rule bg-white px-2 py-1.5 text-ink focus:outline-none focus:border-ink font-mono"
        >
          <option value="all">All entities</option>
          {ENTITIES.map(e => <option key={e} value={e}>{e}</option>)}
        </select>

        {/* Status filter */}
        <select
          value={statusFilter}
          onChange={e => setStatusFilter(e.target.value as InvoiceStatus | 'all')}
          className="text-xs border border-rule bg-white px-2 py-1.5 text-ink focus:outline-none focus:border-ink font-mono uppercase"
        >
          <option value="all">All statuses</option>
          {ALL_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
        </select>

        <div className="flex-1" />

        {/* Summary */}
        {filtered.length > 0 && (
          <span className="font-mono text-xs text-muted hidden sm:block">
            {filtered.length} invoice{filtered.length !== 1 ? 's' : ''} · {fmt(totalAmount)}
          </span>
        )}

        {/* New invoice */}
        <button
          onClick={onNew}
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
          <p className="font-mono text-xs text-muted uppercase tracking-wider">No {label.toLowerCase()} invoices</p>
          {!search && statusFilter === 'all' && entityFilter === 'all' && (
            <button
              onClick={onNew}
              className="mt-3 font-mono text-xs text-ink underline underline-offset-2 hover:text-muted transition-colors"
            >
              Create your first invoice
            </button>
          )}
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-rule bg-paper/50">
                <th className="tbl-lbl text-left px-5 py-2.5 w-28">Ref</th>
                <th className="tbl-lbl text-left px-3 py-2.5">Party</th>
                <th className="tbl-lbl text-left px-3 py-2.5 hidden lg:table-cell">Entity</th>
                <th className="tbl-lbl text-left px-3 py-2.5 hidden md:table-cell">Project</th>
                <th className="tbl-lbl text-left px-3 py-2.5">Due</th>
                <th className="tbl-lbl text-right px-3 py-2.5">Amount</th>
                <th className="tbl-lbl text-left px-3 py-2.5">Status</th>
                <th className="w-24 px-5 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {filtered.map((inv, idx) => {
                const isOverdue = inv.status === 'overdue'
                const od = isOverdue ? daysOverdue(inv.due) : 0
                return (
                  <tr
                    key={inv.id}
                    className={cn(
                      'border-b border-rule last:border-0 transition-colors group',
                      idx % 2 === 1 ? 'bg-paper/40' : '',
                      'hover:bg-cream/70'
                    )}
                  >
                    <td className="px-5 py-2.5 font-mono text-xs text-ink whitespace-nowrap">
                      {inv.ref || <span className="text-muted">—</span>}
                    </td>
                    <td className="px-3 py-2.5 text-sm text-ink max-w-[200px]">
                      <span className="truncate block">{inv.party}</span>
                    </td>
                    <td className="px-3 py-2.5 hidden lg:table-cell">
                      <span className="font-mono text-[10px] uppercase tracking-wider text-muted">
                        {inv.entity === 'Actually Creative' ? 'AC' : inv.entity === '419Studios' ? '419' : 'RTW'}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 hidden md:table-cell font-mono text-xs text-muted">
                      {inv.project_code || '—'}
                    </td>
                    <td className="px-3 py-2.5 font-mono text-xs whitespace-nowrap">
                      {inv.due ? (
                        <span className={isOverdue ? 'text-red-600' : 'text-ink'}>
                          {fmtDate(inv.due)}
                          {isOverdue && od > 0 && (
                            <span className="ml-1 text-red-400 text-[10px]">+{od}d</span>
                          )}
                        </span>
                      ) : <span className="text-muted">—</span>}
                    </td>
                    <td className="px-3 py-2.5 text-sm font-semibold text-right whitespace-nowrap">
                      {fmt(inv.amount, inv.currency)}
                    </td>
                    <td className="px-3 py-2.5">
                      <StatusBadge status={inv.status} />
                    </td>
                    <td className="px-5 py-2.5">
                      <div className="row-actions justify-end">
                        {onPreview && (
                          <button
                            onClick={() => onPreview(inv)}
                            title="Preview PDF"
                            className="p-1 text-muted hover:text-ink transition-colors"
                          >
                            <Eye size={13} />
                          </button>
                        )}
                        {inv.status !== 'paid' && (
                          <button
                            onClick={() => onMarkPaid(inv)}
                            title="Mark paid"
                            className="p-1 text-muted hover:text-ac-green transition-colors"
                          >
                            <CheckCircle size={13} />
                          </button>
                        )}
                        <button
                          onClick={() => onEdit(inv)}
                          title="Edit"
                          className="p-1 text-muted hover:text-ink transition-colors"
                        >
                          <Pencil size={13} />
                        </button>
                        <button
                          onClick={() => handleDelete(inv.id)}
                          title={deleteConfirm === inv.id ? 'Click again to confirm' : 'Delete'}
                          className={cn(
                            'p-1 transition-colors',
                            deleteConfirm === inv.id
                              ? 'text-red-600'
                              : 'text-muted hover:text-red-500'
                          )}
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Footer totals */}
      {!loading && filtered.length > 0 && (
        <div className="px-5 py-3 border-t border-rule bg-cream flex items-center justify-between">
          <span className="font-mono text-xs text-muted">
            {filtered.length} invoice{filtered.length !== 1 ? 's' : ''}
          </span>
          <span className="font-mono text-xs font-semibold text-ink">
            Total: {fmt(totalAmount)}
          </span>
        </div>
      )}
    </div>
  )
}
