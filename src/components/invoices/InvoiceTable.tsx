'use client'

import { useState, useMemo, useRef, useEffect } from 'react'
import { CheckCircle, Pencil, Trash2, Plus, Search, Eye, CopyPlus, CheckSquare, Square, ChevronUp, ChevronDown, ChevronsUpDown, StickyNote, FolderPlus } from 'lucide-react'
import { cn, fmt, fmtDate, daysOverdue } from '@/lib/format'
import type { Invoice, InvoiceType, InvoiceStatus, Entity } from '@/types'
import { ENTITIES } from '@/types'

type SortKey = 'ref' | 'party' | 'due' | 'amount' | 'status'
type SortDir = 'asc' | 'desc'

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
  onDuplicate?: (invoice: Invoice) => void
  onBulkMarkPaid?: (ids: string[]) => Promise<void>
  onProjectClick?: (code: string) => void
  projectCodes?: { code: string; name: string }[]
  onAssignProject?: (id: string, code: string, name: string) => Promise<void>
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
  invoices, loading, type, onEdit, onMarkPaid, onDelete, onNew,
  onPreview, onDuplicate, onBulkMarkPaid, onProjectClick,
  projectCodes, onAssignProject,
}: InvoiceTableProps) {
  const [search, setSearch] = useState('')
  const [entityFilter, setEntityFilter] = useState<Entity | 'all'>('all')
  const [statusFilter, setStatusFilter] = useState<InvoiceStatus | 'all'>('all')
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [bulkPaying, setBulkPaying] = useState(false)
  const [sortKey, setSortKey] = useState<SortKey | null>(null)
  const [sortDir, setSortDir] = useState<SortDir>('asc')
  const [assigningProject, setAssigningProject] = useState<string | null>(null)  // invoice id
  const assignRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function close(e: MouseEvent) {
      if (assignRef.current && !assignRef.current.contains(e.target as Node)) setAssigningProject(null)
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [])

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortKey(key); setSortDir('asc') }
  }

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
    if (sortKey) {
      rows = [...rows].sort((a, b) => {
        let av: string | number = '', bv: string | number = ''
        if (sortKey === 'ref') { av = a.ref ?? ''; bv = b.ref ?? '' }
        else if (sortKey === 'party') { av = a.party ?? ''; bv = b.party ?? '' }
        else if (sortKey === 'due') { av = a.due ?? ''; bv = b.due ?? '' }
        else if (sortKey === 'amount') { av = Number(a.amount); bv = Number(b.amount) }
        else if (sortKey === 'status') { av = a.status; bv = b.status }
        if (av < bv) return sortDir === 'asc' ? -1 : 1
        if (av > bv) return sortDir === 'asc' ? 1 : -1
        return 0
      })
    }
    return rows
  }, [invoices, type, entityFilter, statusFilter, search, sortKey, sortDir])

  const totalAmount = filtered.reduce((t, i) => t + Number(i.amount), 0)
  const label = type === 'payable' ? 'To Pay' : 'Incoming'

  // Selectable = unpaid rows
  const selectableIds = filtered.filter(i => i.status !== 'paid').map(i => i.id)
  const allSelected = selectableIds.length > 0 && selectableIds.every(id => selected.has(id))
  const someSelected = selected.size > 0

  function toggleAll() {
    if (allSelected) {
      setSelected(new Set())
    } else {
      setSelected(new Set(selectableIds))
    }
  }

  function toggleRow(id: string) {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function handleBulkPaid() {
    if (!onBulkMarkPaid || selected.size === 0) return
    setBulkPaying(true)
    try {
      await onBulkMarkPaid(Array.from(selected))
      setSelected(new Set())
    } finally {
      setBulkPaying(false)
    }
  }

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

      {/* Bulk action bar */}
      {someSelected && onBulkMarkPaid && (
        <div className="px-5 py-2.5 bg-ink flex items-center gap-3">
          <span className="font-mono text-xs text-white">
            {selected.size} selected
          </span>
          <button
            onClick={handleBulkPaid}
            disabled={bulkPaying}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-mono uppercase tracking-wider bg-ac-green text-white hover:opacity-90 transition-opacity disabled:opacity-50"
          >
            <CheckCircle size={11} /> {bulkPaying ? 'Marking…' : 'Mark All Paid'}
          </button>
          <button
            onClick={() => setSelected(new Set())}
            className="font-mono text-xs text-[#888] hover:text-white transition-colors ml-auto"
          >
            Clear
          </button>
        </div>
      )}

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
                {onBulkMarkPaid && (
                  <th className="w-10 px-3 py-2.5">
                    <button onClick={toggleAll} className="text-muted hover:text-ink transition-colors">
                      {allSelected ? <CheckSquare size={13} /> : <Square size={13} />}
                    </button>
                  </th>
                )}
                {(['ref', 'party'] as SortKey[]).map((k, i) => (
                  <th key={k} className={cn('tbl-lbl text-left py-2.5 cursor-pointer select-none hover:text-ink transition-colors', i === 0 ? 'px-5 w-28' : 'px-3')}
                    onClick={() => toggleSort(k)}>
                    <span className="flex items-center gap-1">
                      {k === 'ref' ? 'Ref' : 'Party'}
                      {sortKey === k ? (sortDir === 'asc' ? <ChevronUp size={10} /> : <ChevronDown size={10} />) : <ChevronsUpDown size={10} className="opacity-30" />}
                    </span>
                  </th>
                ))}
                <th className="tbl-lbl text-left px-3 py-2.5 hidden lg:table-cell">Entity</th>
                <th className="tbl-lbl text-left px-3 py-2.5 hidden md:table-cell">Project</th>
                <th className="tbl-lbl text-left px-3 py-2.5 cursor-pointer select-none hover:text-ink transition-colors" onClick={() => toggleSort('due')}>
                  <span className="flex items-center gap-1">
                    Due
                    {sortKey === 'due' ? (sortDir === 'asc' ? <ChevronUp size={10} /> : <ChevronDown size={10} />) : <ChevronsUpDown size={10} className="opacity-30" />}
                  </span>
                </th>
                <th className="tbl-lbl text-right px-3 py-2.5 cursor-pointer select-none hover:text-ink transition-colors" onClick={() => toggleSort('amount')}>
                  <span className="flex items-center justify-end gap-1">
                    Amount
                    {sortKey === 'amount' ? (sortDir === 'asc' ? <ChevronUp size={10} /> : <ChevronDown size={10} />) : <ChevronsUpDown size={10} className="opacity-30" />}
                  </span>
                </th>
                <th className="tbl-lbl text-left px-3 py-2.5 cursor-pointer select-none hover:text-ink transition-colors" onClick={() => toggleSort('status')}>
                  <span className="flex items-center gap-1">
                    Status
                    {sortKey === 'status' ? (sortDir === 'asc' ? <ChevronUp size={10} /> : <ChevronDown size={10} />) : <ChevronsUpDown size={10} className="opacity-30" />}
                  </span>
                </th>
                <th className="w-32 px-5 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {filtered.map((inv, idx) => {
                const isOverdue = inv.status === 'overdue'
                const od = isOverdue ? daysOverdue(inv.due) : 0
                const isSelectable = inv.status !== 'paid'
                return (
                  <tr
                    key={inv.id}
                    className={cn(
                      'border-b border-rule last:border-0 transition-colors group',
                      idx % 2 === 1 ? 'bg-paper/40' : '',
                      'hover:bg-cream/70',
                      selected.has(inv.id) && 'bg-blue-50/50'
                    )}
                  >
                    {onBulkMarkPaid && (
                      <td className="px-3 py-2.5">
                        {isSelectable && (
                          <button
                            onClick={() => toggleRow(inv.id)}
                            className="text-muted hover:text-ink transition-colors"
                          >
                            {selected.has(inv.id) ? <CheckSquare size={13} className="text-ink" /> : <Square size={13} />}
                          </button>
                        )}
                      </td>
                    )}
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
                      {inv.project_code ? (
                        onProjectClick
                          ? <button onClick={() => onProjectClick(inv.project_code!)} className="hover:text-ink hover:underline transition-colors">{inv.project_code}</button>
                          : <span>{inv.project_code}</span>
                      ) : '—'}
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
                      <div className="flex items-center gap-1.5">
                        <StatusBadge status={inv.status} />
                        {inv.internal && (
                          <div className="relative group/note">
                            <StickyNote size={11} className="text-muted cursor-help" />
                            <div className="absolute left-0 bottom-full mb-1.5 z-20 hidden group-hover/note:block w-56 bg-ink text-white text-[10px] font-mono p-2 shadow-lg whitespace-pre-wrap leading-relaxed">
                              {inv.internal}
                            </div>
                          </div>
                        )}
                      </div>
                    </td>
                    <td className="px-5 py-2.5">
                      <div className="row-actions justify-end">
                        {onPreview && (
                          <button onClick={() => onPreview(inv)} title="Preview PDF"
                            className="p-1 text-muted hover:text-ink transition-colors">
                            <Eye size={13} />
                          </button>
                        )}
                        {onDuplicate && (
                          <button onClick={() => onDuplicate(inv)} title="Duplicate"
                            className="p-1 text-muted hover:text-ink transition-colors">
                            <CopyPlus size={13} />
                          </button>
                        )}
                        {onAssignProject && !inv.project_code && projectCodes && projectCodes.length > 0 && (
                          <div className="relative" ref={assigningProject === inv.id ? assignRef : undefined}>
                            <button onClick={() => setAssigningProject(p => p === inv.id ? null : inv.id)}
                              title="Add to project"
                              className="p-1 text-muted hover:text-ink transition-colors">
                              <FolderPlus size={13} />
                            </button>
                            {assigningProject === inv.id && (
                              <div className="absolute right-0 bottom-full mb-1 z-30 bg-white border border-rule shadow-xl w-48 max-h-48 overflow-y-auto">
                                <p className="px-3 py-1.5 tbl-lbl border-b border-rule sticky top-0 bg-white">Add to project</p>
                                {projectCodes.map(p => (
                                  <button key={p.code} onClick={async () => {
                                    await onAssignProject(inv.id, p.code, p.name)
                                    setAssigningProject(null)
                                  }} className="w-full flex flex-col px-3 py-2 hover:bg-cream text-left border-b border-rule/50 last:border-0">
                                    <span className="font-mono text-[10px] text-muted">{p.code}</span>
                                    <span className="text-xs text-ink truncate">{p.name}</span>
                                  </button>
                                ))}
                              </div>
                            )}
                          </div>
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
