'use client'

import { useMemo, useState } from 'react'
import { Header } from '@/components/layout/Header'
import { useInvoices } from '@/hooks/useInvoices'
import { cn, fmt, fmtDate, daysOverdue } from '@/lib/format'
import type { Entity } from '@/types'
import { ENTITIES } from '@/types'

const BUCKETS = [
  { label: '1–30 days', min: 1, max: 30, accent: '#7a6a3a' },
  { label: '31–60 days', min: 31, max: 60, accent: '#d97706' },
  { label: '61–90 days', min: 61, max: 90, accent: '#dc5a26' },
  { label: '90+ days', min: 91, max: Infinity, accent: '#dc2626' },
]

export default function AgeingPage() {
  const { invoices, loading } = useInvoices()
  const [entity, setEntity] = useState<Entity | 'all'>('all')
  const [typeFilter, setTypeFilter] = useState<'all' | 'payable' | 'receivable'>('all')

  const overdue = useMemo(() => {
    let rows = invoices.filter(i => i.status === 'overdue' || (i.due && i.due < new Date().toISOString().split('T')[0] && !['paid', 'draft'].includes(i.status)))
    if (entity !== 'all') rows = rows.filter(i => i.entity === entity)
    if (typeFilter !== 'all') rows = rows.filter(i => i.type === typeFilter)
    return rows
  }, [invoices, entity, typeFilter])

  const buckets = useMemo(() => BUCKETS.map(b => {
    const rows = overdue.filter(i => {
      const d = daysOverdue(i.due)
      return d >= b.min && d <= b.max
    })
    return { ...b, rows, total: rows.reduce((t, i) => t + Number(i.amount), 0) }
  }), [overdue])

  const grandTotal = overdue.reduce((t, i) => t + Number(i.amount), 0)

  return (
    <>
      <Header title="Ageing" subtitle="Overdue Analysis" />
      <main className="flex-1 overflow-y-auto px-6 py-6">

        {/* Filters */}
        <div className="flex items-center gap-3 mb-6">
          <select value={entity} onChange={e => setEntity(e.target.value as Entity | 'all')}
            className="text-xs border border-rule bg-white px-2 py-1.5 font-mono text-ink focus:outline-none">
            <option value="all">All entities</option>
            {ENTITIES.map(e => <option key={e} value={e}>{e}</option>)}
          </select>
          <select value={typeFilter} onChange={e => setTypeFilter(e.target.value as typeof typeFilter)}
            className="text-xs border border-rule bg-white px-2 py-1.5 font-mono text-ink focus:outline-none uppercase">
            <option value="all">All types</option>
            <option value="receivable">Receivable</option>
            <option value="payable">Payable</option>
          </select>
        </div>

        {/* Summary cards */}
        <div className="grid grid-cols-2 xl:grid-cols-4 gap-4 mb-6">
          {buckets.map(b => (
            <div key={b.label} className="stat-card" style={{ borderTopColor: b.accent } as React.CSSProperties}>
              <p className="font-mono text-[10px] uppercase tracking-widest text-muted mb-2">{b.label}</p>
              <p className="font-sans font-semibold text-2xl text-ink">{loading ? '—' : fmt(b.total)}</p>
              <p className="font-mono text-xs text-muted mt-1">{b.rows.length} invoice{b.rows.length !== 1 ? 's' : ''}</p>
            </div>
          ))}
        </div>

        {/* Grand total banner */}
        {!loading && overdue.length > 0 && (
          <div className="mb-5 border-2 border-red-200 bg-red-50 px-5 py-3 flex items-center justify-between">
            <span className="font-mono text-xs uppercase tracking-wider text-red-700">
              Total overdue · {overdue.length} invoice{overdue.length !== 1 ? 's' : ''}
            </span>
            <span className="font-mono text-lg font-semibold text-red-700">{fmt(grandTotal)}</span>
          </div>
        )}

        {/* Per-bucket tables */}
        {loading ? (
          <div className="flex items-center justify-center py-16"><div className="w-5 h-5 border-2 border-rule border-t-ink animate-spin" /></div>
        ) : overdue.length === 0 ? (
          <div className="tbl-card py-16 text-center">
            <p className="font-mono text-xs text-muted uppercase tracking-wider">No overdue invoices</p>
          </div>
        ) : (
          <div className="space-y-5">
            {buckets.filter(b => b.rows.length > 0).map(b => (
              <div key={b.label} className="tbl-card" style={{ borderTopColor: b.accent }}>
                <div className="tbl-hd">
                  <p className="tbl-lbl">{b.label}</p>
                  <span className="font-mono text-xs font-semibold text-ink">{fmt(b.total)}</span>
                </div>
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-rule bg-paper/50">
                      <th className="tbl-lbl text-left px-5 py-2.5">Ref</th>
                      <th className="tbl-lbl text-left px-3 py-2.5">Party</th>
                      <th className="tbl-lbl text-left px-3 py-2.5 hidden lg:table-cell">Entity</th>
                      <th className="tbl-lbl text-left px-3 py-2.5">Due</th>
                      <th className="tbl-lbl text-center px-3 py-2.5">Days</th>
                      <th className="tbl-lbl text-left px-3 py-2.5 hidden md:table-cell">Type</th>
                      <th className="tbl-lbl text-right px-5 py-2.5">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {b.rows.sort((a, c) => daysOverdue(c.due) - daysOverdue(a.due)).map(inv => {
                      const od = daysOverdue(inv.due)
                      return (
                        <tr key={inv.id} className="border-b border-rule last:border-0 hover:bg-cream/70 transition-colors">
                          <td className="px-5 py-2.5 font-mono text-xs text-ink">{inv.ref || '—'}</td>
                          <td className="px-3 py-2.5 text-sm text-ink max-w-[180px] truncate">{inv.party}</td>
                          <td className="px-3 py-2.5 hidden lg:table-cell font-mono text-[10px] text-muted uppercase tracking-wider">
                            {inv.entity === 'Actually Creative' ? 'AC' : inv.entity === '419Studios' ? '419' : 'RTW'}
                          </td>
                          <td className="px-3 py-2.5 font-mono text-xs text-red-600">{fmtDate(inv.due)}</td>
                          <td className="px-3 py-2.5 text-center">
                            <span className="font-mono text-xs font-semibold text-red-600">+{od}d</span>
                          </td>
                          <td className="px-3 py-2.5 hidden md:table-cell">
                            <span className={cn('font-mono text-[10px] uppercase tracking-wider', inv.type === 'receivable' ? 'text-ac-green' : 'text-ac-amber')}>
                              {inv.type === 'receivable' ? 'IN' : 'OUT'}
                            </span>
                          </td>
                          <td className="px-5 py-2.5 text-right font-mono text-sm font-semibold text-red-600">
                            {fmt(inv.amount, inv.currency)}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            ))}
          </div>
        )}
      </main>
    </>
  )
}
