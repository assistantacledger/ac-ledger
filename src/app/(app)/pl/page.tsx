'use client'

import { useMemo, useState } from 'react'
import { Download } from 'lucide-react'
import { Header } from '@/components/layout/Header'
import { useInvoices } from '@/hooks/useInvoices'
import { useExpenses } from '@/hooks/useExpenses'
import { cn, fmt, downloadCSV } from '@/lib/format'
import type { Entity } from '@/types'
import { ENTITIES } from '@/types'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

interface MonthRow {
  label: string
  year: number
  month: number
  revenue: number
  costs: number
  expenses: number
  gross: number
  net: number
}

export default function PLPage() {
  const { invoices, loading: invLoading } = useInvoices()
  const { expenses, loading: expLoading } = useExpenses()
  const loading = invLoading || expLoading

  const currentYear = new Date().getFullYear()
  const [year, setYear] = useState(currentYear)
  const [entity, setEntity] = useState<Entity | 'all'>('all')

  const rows = useMemo<MonthRow[]>(() => {
    const inv = entity === 'all' ? invoices : invoices.filter(i => i.entity === entity)
    const exp = entity === 'all' ? expenses : expenses.filter(e => e.entity === entity)

    return Array.from({ length: 12 }, (_, m) => {
      const monthInv = inv.filter(i => {
        const d = new Date(i.created_at)
        return d.getFullYear() === year && d.getMonth() === m
      })
      const monthExp = exp.filter(e => {
        const d = new Date(e.date)
        return d.getFullYear() === year && d.getMonth() === m
      })

      // Revenue: receivable invoices (sent/paid/part-paid = recognised)
      const revenue = monthInv
        .filter(i => i.type === 'receivable' && ['sent', 'paid', 'part-paid', 'approved'].includes(i.status))
        .reduce((t, i) => t + Number(i.amount), 0)

      // Costs: payable invoices (approved/paid = recognised)
      const costs = monthInv
        .filter(i => i.type === 'payable' && ['approved', 'paid', 'sent'].includes(i.status))
        .reduce((t, i) => t + Number(i.amount), 0)

      // Staff expenses (approved/paid)
      const expTotal = monthExp
        .filter(e => ['approved', 'paid'].includes(e.status))
        .reduce((t, e) => t + Number(e.total), 0)

      const gross = revenue - costs
      const net = gross - expTotal

      return { label: MONTHS[m], year, month: m, revenue, costs, expenses: expTotal, gross, net }
    })
  }, [invoices, expenses, year, entity])

  const totals = useMemo(() => ({
    revenue: rows.reduce((t, r) => t + r.revenue, 0),
    costs: rows.reduce((t, r) => t + r.costs, 0),
    expenses: rows.reduce((t, r) => t + r.expenses, 0),
    gross: rows.reduce((t, r) => t + r.gross, 0),
    net: rows.reduce((t, r) => t + r.net, 0),
  }), [rows])

  const maxVal = Math.max(...rows.map(r => Math.max(r.revenue, r.costs + r.expenses)), 1)

  return (
    <>
      <Header title="P&L" subtitle="Profit & Loss" />
      <main className="flex-1 overflow-y-auto px-6 py-6">

        {/* Filters + Export */}
        <div className="flex items-center gap-3 mb-6 flex-wrap">
          <select value={year} onChange={e => setYear(parseInt(e.target.value))}
            className="text-xs border border-rule bg-white px-2 py-1.5 font-mono text-ink focus:outline-none">
            {[currentYear - 1, currentYear, currentYear + 1].map(y => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>
          <select value={entity} onChange={e => setEntity(e.target.value as Entity | 'all')}
            className="text-xs border border-rule bg-white px-2 py-1.5 font-mono text-ink focus:outline-none">
            <option value="all">All entities</option>
            {ENTITIES.map(e => <option key={e} value={e}>{e}</option>)}
          </select>
          <button
            onClick={() => {
              const csvRows = [
                ['Month', 'Revenue', 'Direct Costs', 'Staff Expenses', 'Gross Profit', 'Net Profit'],
                ...rows.map(r => [r.label + ' ' + year, r.revenue.toFixed(2), r.costs.toFixed(2), r.expenses.toFixed(2), r.gross.toFixed(2), r.net.toFixed(2)]),
                ['TOTAL', totals.revenue.toFixed(2), totals.costs.toFixed(2), totals.expenses.toFixed(2), totals.gross.toFixed(2), totals.net.toFixed(2)],
              ]
              downloadCSV(csvRows, `pl-${year}-${entity}.csv`)
            }}
            className="ml-auto flex items-center gap-1.5 px-3 py-1.5 text-xs font-mono uppercase tracking-wider border border-rule text-muted hover:text-ink hover:border-ink transition-colors"
          >
            <Download size={11} /> Export CSV
          </button>
        </div>

        {/* KPI cards */}
        <div className="grid grid-cols-2 xl:grid-cols-4 gap-4 mb-6">
          {[
            { label: 'Revenue', value: totals.revenue, accent: '#3a7a5a' },
            { label: 'Direct Costs', value: totals.costs, accent: '#7a6a3a' },
            { label: 'Staff Expenses', value: totals.expenses, accent: '#7a6a3a' },
            { label: 'Net Profit', value: totals.net, accent: totals.net >= 0 ? '#3a7a5a' : '#dc2626' },
          ].map(({ label, value, accent }) => (
            <div key={label} className="stat-card" style={{ borderTopColor: accent } as React.CSSProperties}>
              <p className="font-mono text-[10px] uppercase tracking-widest text-muted mb-2">{label}</p>
              <p className={cn('font-sans font-semibold text-2xl tracking-tight', value < 0 ? 'text-red-600' : 'text-ink')}>
                {loading ? '—' : `${value < 0 ? '-' : ''}${fmt(Math.abs(value))}`}
              </p>
            </div>
          ))}
        </div>

        {/* Monthly bar chart (CSS-only) */}
        <div className="tbl-card mb-5">
          <div className="tbl-hd">
            <p className="tbl-lbl">Monthly Overview · {year}</p>
          </div>
          <div className="px-5 py-4">
            <div className="flex items-end gap-1.5 h-32">
              {rows.map(row => {
                const revH = maxVal > 0 ? (row.revenue / maxVal) * 100 : 0
                const costH = maxVal > 0 ? ((row.costs + row.expenses) / maxVal) * 100 : 0
                return (
                  <div key={row.label} className="flex-1 flex flex-col items-center gap-0.5">
                    <div className="flex items-end gap-0.5 w-full h-28">
                      <div className="flex-1 bg-ac-green/30 transition-all" style={{ height: `${revH}%` }} title={`Revenue: ${fmt(row.revenue)}`} />
                      <div className="flex-1 bg-ac-amber/30 transition-all" style={{ height: `${costH}%` }} title={`Costs: ${fmt(row.costs + row.expenses)}`} />
                    </div>
                    <span className="font-mono text-[9px] text-muted uppercase">{row.label}</span>
                  </div>
                )
              })}
            </div>
            <div className="flex gap-4 mt-3">
              <div className="flex items-center gap-1.5"><div className="w-3 h-3 bg-ac-green/30" /><span className="font-mono text-[10px] text-muted">Revenue</span></div>
              <div className="flex items-center gap-1.5"><div className="w-3 h-3 bg-ac-amber/30" /><span className="font-mono text-[10px] text-muted">Costs</span></div>
            </div>
          </div>
        </div>

        {/* Monthly table */}
        <div className="tbl-card">
          <div className="tbl-hd"><p className="tbl-lbl">Monthly Breakdown</p></div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-rule bg-paper/50">
                  <th className="tbl-lbl text-left px-5 py-2.5">Month</th>
                  <th className="tbl-lbl text-right px-3 py-2.5">Revenue</th>
                  <th className="tbl-lbl text-right px-3 py-2.5">Direct Costs</th>
                  <th className="tbl-lbl text-right px-3 py-2.5 hidden md:table-cell">Expenses</th>
                  <th className="tbl-lbl text-right px-3 py-2.5">Gross</th>
                  <th className="tbl-lbl text-right px-5 py-2.5">Net</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, idx) => {
                  const isEmpty = row.revenue === 0 && row.costs === 0 && row.expenses === 0
                  return (
                    <tr key={row.label} className={cn('border-b border-rule last:border-0',
                      isEmpty ? 'opacity-40' : 'hover:bg-cream/70',
                      idx % 2 === 1 && 'bg-paper/40')}>
                      <td className="px-5 py-2.5 font-mono text-xs text-ink font-medium">{row.label} {year}</td>
                      <td className="px-3 py-2.5 text-right font-mono text-sm text-ac-green">{row.revenue > 0 ? fmt(row.revenue) : '—'}</td>
                      <td className="px-3 py-2.5 text-right font-mono text-sm text-ac-amber">{row.costs > 0 ? fmt(row.costs) : '—'}</td>
                      <td className="px-3 py-2.5 text-right font-mono text-sm text-ac-amber hidden md:table-cell">{row.expenses > 0 ? fmt(row.expenses) : '—'}</td>
                      <td className={cn('px-3 py-2.5 text-right font-mono text-sm', row.gross < 0 ? 'text-red-600' : row.gross > 0 ? 'text-ink' : 'text-muted')}>
                        {isEmpty ? '—' : fmt(row.gross)}
                      </td>
                      <td className={cn('px-5 py-2.5 text-right font-mono text-sm font-semibold', row.net < 0 ? 'text-red-600' : row.net > 0 ? 'text-ink' : 'text-muted')}>
                        {isEmpty ? '—' : `${row.net >= 0 ? '+' : ''}${fmt(row.net)}`}
                      </td>
                    </tr>
                  )
                })}
                {/* Totals row */}
                <tr className="border-t-2 border-ink bg-cream">
                  <td className="px-5 py-3 font-mono text-xs font-semibold uppercase tracking-wider text-ink">Full Year</td>
                  <td className="px-3 py-3 text-right font-mono text-sm font-semibold text-ac-green">{fmt(totals.revenue)}</td>
                  <td className="px-3 py-3 text-right font-mono text-sm font-semibold text-ac-amber">{fmt(totals.costs)}</td>
                  <td className="px-3 py-3 text-right font-mono text-sm font-semibold text-ac-amber hidden md:table-cell">{fmt(totals.expenses)}</td>
                  <td className={cn('px-3 py-3 text-right font-mono text-sm font-semibold', totals.gross < 0 ? 'text-red-600' : 'text-ink')}>{fmt(totals.gross)}</td>
                  <td className={cn('px-5 py-3 text-right font-mono text-sm font-semibold', totals.net < 0 ? 'text-red-600' : 'text-ink')}>
                    {totals.net >= 0 ? '+' : ''}{fmt(totals.net)}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </main>
    </>
  )
}
