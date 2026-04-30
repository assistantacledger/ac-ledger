'use client'

import { useState, useMemo } from 'react'
import { ChevronDown, ChevronRight, X, FileText } from 'lucide-react'
import { cn, fmt, fmtDate } from '@/lib/format'
import type { Expense, ExpenseStatus } from '@/types'

const STATUS_BADGE: Record<ExpenseStatus, string> = {
  submitted: 'badge-submitted',
  approved: 'badge-approved',
  paid: 'badge-paid',
}

type FilterMode = 'all' | 'unpaid'

interface Props {
  employeeName: string
  expenses: Expense[]
  onGenerate: (selected: Expense[]) => void
  onClose: () => void
}

export function ExpenseInvoiceSelector({ employeeName, expenses, onGenerate, onClose }: Props) {
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(expenses.filter(e => e.status !== 'paid').map(e => e.id))
  )
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [filter, setFilter] = useState<FilterMode>('unpaid')

  const visible = useMemo(() =>
    filter === 'unpaid' ? expenses.filter(e => e.status !== 'paid') : expenses
  , [expenses, filter])

  // Group by project
  const groups = useMemo(() => {
    const map = new Map<string, Expense[]>()
    for (const exp of visible) {
      const key = exp.project_code ? `${exp.project_code}${exp.project_name ? ' — ' + exp.project_name : ''}` : '— No Project'
      if (!map.has(key)) map.set(key, [])
      map.get(key)!.push(exp)
    }
    return Array.from(map.entries()).map(([label, exps]) => ({
      label,
      exps,
      subtotal: exps.reduce((s, e) => s + Number(e.total), 0),
      allSelected: exps.every(e => selected.has(e.id)),
      someSelected: exps.some(e => selected.has(e.id)),
    }))
  }, [visible, selected])

  const selectedExps = expenses.filter(e => selected.has(e.id))
  const selectedTotal = selectedExps.reduce((s, e) => s + Number(e.total), 0)

  function toggleOne(id: string) {
    setSelected(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  function toggleGroup(exps: Expense[], allSel: boolean) {
    setSelected(prev => {
      const next = new Set(prev)
      for (const e of exps) allSel ? next.delete(e.id) : next.add(e.id)
      return next
    })
  }

  function toggleAll() {
    if (selected.size === visible.length) {
      setSelected(new Set())
    } else {
      setSelected(new Set(visible.map(e => e.id)))
    }
  }

  function toggleCollapsed(label: string) {
    setCollapsed(prev => {
      const next = new Set(prev)
      next.has(label) ? next.delete(label) : next.add(label)
      return next
    })
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white max-w-2xl w-full max-h-[90vh] flex flex-col shadow-2xl" onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-rule flex-shrink-0">
          <div>
            <h2 className="font-display text-base font-semibold">Select Expenses for Invoice</h2>
            <p className="font-mono text-[10px] text-muted mt-0.5">{employeeName}</p>
          </div>
          <button onClick={onClose} className="p-1 text-muted hover:text-ink transition-colors"><X size={16} /></button>
        </div>

        {/* Filters */}
        <div className="px-6 py-3 border-b border-rule bg-cream flex-shrink-0 flex items-center gap-3">
          <div className="flex border border-rule">
            {(['all', 'unpaid'] as FilterMode[]).map(f => (
              <button key={f} onClick={() => setFilter(f)}
                className={cn('px-3 py-1.5 font-mono text-[10px] uppercase tracking-wider transition-colors',
                  filter === f ? 'bg-ink text-white' : 'text-muted hover:text-ink')}>
                {f === 'all' ? 'All' : 'Unpaid only'}
              </button>
            ))}
          </div>
          <button onClick={toggleAll}
            className="font-mono text-[10px] text-muted hover:text-ink transition-colors border border-rule px-2 py-1.5">
            {selected.size === visible.length ? 'Deselect all' : 'Select all'}
          </button>
          <span className="font-mono text-[10px] text-muted ml-auto">
            {visible.length} expense{visible.length !== 1 ? 's' : ''} shown
          </span>
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto">
          {visible.length === 0 ? (
            <p className="font-mono text-xs text-muted text-center py-12 uppercase tracking-wider">No expenses match</p>
          ) : (
            groups.map(group => {
              const isCollapsed = collapsed.has(group.label)
              return (
                <div key={group.label} className="border-b border-rule last:border-0">
                  {/* Group header */}
                  <div className="flex items-center gap-3 px-4 py-2.5 bg-paper/60 border-b border-rule/50">
                    <input
                      type="checkbox"
                      checked={group.allSelected}
                      ref={el => { if (el) el.indeterminate = group.someSelected && !group.allSelected }}
                      onChange={() => toggleGroup(group.exps, group.allSelected)}
                      className="w-3.5 h-3.5 cursor-pointer flex-shrink-0"
                    />
                    <button onClick={() => toggleCollapsed(group.label)}
                      className="flex items-center gap-1.5 flex-1 text-left">
                      {isCollapsed ? <ChevronRight size={12} className="text-muted flex-shrink-0" /> : <ChevronDown size={12} className="text-muted flex-shrink-0" />}
                      <span className="font-mono text-[10px] uppercase tracking-wider text-ink font-semibold">{group.label}</span>
                      <span className="font-mono text-[10px] text-muted">({group.exps.length})</span>
                    </button>
                    <span className="font-mono text-xs font-semibold text-ink flex-shrink-0">{fmt(group.subtotal)}</span>
                  </div>

                  {/* Expense rows */}
                  {!isCollapsed && group.exps.map(exp => (
                    <label key={exp.id}
                      className="flex items-start gap-3 px-6 py-2.5 hover:bg-cream/40 cursor-pointer border-b border-rule/30 last:border-0 transition-colors">
                      <input type="checkbox" checked={selected.has(exp.id)} onChange={() => toggleOne(exp.id)}
                        className="w-3.5 h-3.5 cursor-pointer flex-shrink-0 mt-0.5" />
                      <span className="font-mono text-xs text-muted w-20 flex-shrink-0">{fmtDate(exp.date)}</span>
                      <span className="flex-1 text-xs text-ink leading-relaxed">{exp.notes || '—'}</span>
                      <span className="font-mono text-xs font-semibold text-ink w-20 text-right flex-shrink-0">{fmt(exp.total)}</span>
                      <span className={cn('badge flex-shrink-0', STATUS_BADGE[exp.status])}>{exp.status}</span>
                    </label>
                  ))}
                </div>
              )
            })
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-rule flex-shrink-0 bg-cream flex items-center justify-between gap-4">
          <div className="font-mono text-xs text-ink">
            <span className="text-muted">{selected.size} expense{selected.size !== 1 ? 's' : ''} selected — </span>
            <span className="font-semibold">Total: {fmt(selectedTotal)}</span>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={onClose}
              className="font-mono text-xs px-3 py-1.5 border border-rule text-muted hover:text-ink hover:border-ink transition-colors">
              Cancel
            </button>
            <button
              onClick={() => { onGenerate(selectedExps); onClose() }}
              disabled={selected.size === 0}
              className="font-mono text-xs px-4 py-1.5 bg-ink text-white hover:bg-[#333] disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex items-center gap-1.5">
              <FileText size={12} /> Generate Invoice →
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
