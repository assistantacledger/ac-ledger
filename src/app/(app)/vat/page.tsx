'use client'

import { useMemo, useState } from 'react'
import { Download } from 'lucide-react'
import { Header } from '@/components/layout/Header'
import { useInvoices } from '@/hooks/useInvoices'
import { cn, fmt, downloadCSV } from '@/lib/format'
import type { Entity } from '@/types'
import { ENTITIES } from '@/types'

const QUARTERS = [
  { label: 'Q1', months: [0, 1, 2] },
  { label: 'Q2', months: [3, 4, 5] },
  { label: 'Q3', months: [6, 7, 8] },
  { label: 'Q4', months: [9, 10, 11] },
]

interface VATRow {
  quarter: string
  vatCollected: number   // on receivable invoices
  vatPaid: number        // on payable invoices
  net: number
  recCount: number
  payCount: number
}

function vatAmount(amount: number, vatRate: number): number {
  // amount is assumed inclusive of VAT; extract VAT portion
  return parseFloat((amount - amount / (1 + vatRate / 100)).toFixed(2))
}

export default function VATPage() {
  const { invoices, loading } = useInvoices()
  const currentYear = new Date().getFullYear()
  const [year, setYear] = useState(currentYear)
  const [entity, setEntity] = useState<Entity | 'all'>('all')
  const [vatRate, setVatRate] = useState(20)

  const rows = useMemo<VATRow[]>(() => {
    const inv = entity === 'all' ? invoices : invoices.filter(i => i.entity === entity)
    const yearInv = inv.filter(i => new Date(i.created_at).getFullYear() === year)

    return QUARTERS.map(q => {
      const qInv = yearInv.filter(i => q.months.includes(new Date(i.created_at).getMonth()))

      const receivable = qInv.filter(i => i.type === 'receivable' && ['sent', 'paid', 'part-paid'].includes(i.status))
      const payable = qInv.filter(i => i.type === 'payable' && ['paid'].includes(i.status))

      const vatCollected = receivable.reduce((t, i) => t + vatAmount(Number(i.amount), vatRate), 0)
      const vatPaid = payable.reduce((t, i) => t + vatAmount(Number(i.amount), vatRate), 0)

      return {
        quarter: `${q.label} ${year}`,
        vatCollected: parseFloat(vatCollected.toFixed(2)),
        vatPaid: parseFloat(vatPaid.toFixed(2)),
        net: parseFloat((vatCollected - vatPaid).toFixed(2)),
        recCount: receivable.length,
        payCount: payable.length,
      }
    })
  }, [invoices, year, entity, vatRate])

  const totals = useMemo(() => ({
    vatCollected: rows.reduce((t, r) => t + r.vatCollected, 0),
    vatPaid: rows.reduce((t, r) => t + r.vatPaid, 0),
    net: rows.reduce((t, r) => t + r.net, 0),
  }), [rows])

  // Detail: individual invoices with VAT breakdown
  const details = useMemo(() => {
    const inv = entity === 'all' ? invoices : invoices.filter(i => i.entity === entity)
    return inv
      .filter(i => {
        const yr = new Date(i.created_at).getFullYear()
        return yr === year && ['sent', 'paid', 'part-paid', 'approved'].includes(i.status)
      })
      .map(i => ({
        ...i,
        vatAmt: vatAmount(Number(i.amount), vatRate),
        net: parseFloat((Number(i.amount) / (1 + vatRate / 100)).toFixed(2)),
      }))
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
  }, [invoices, year, entity, vatRate])

  return (
    <>
      <Header title="VAT Report" />
      <main className="flex-1 overflow-y-auto px-6 py-6">

        {/* Controls */}
        <div className="flex flex-wrap items-center gap-3 mb-6">
          <select value={year} onChange={e => setYear(parseInt(e.target.value))}
            className="text-xs border border-rule bg-white px-2 py-1.5 font-mono text-ink focus:outline-none">
            {[currentYear - 1, currentYear].map(y => <option key={y} value={y}>{y}</option>)}
          </select>
          <select value={entity} onChange={e => setEntity(e.target.value as Entity | 'all')}
            className="text-xs border border-rule bg-white px-2 py-1.5 font-mono text-ink focus:outline-none">
            <option value="all">All entities</option>
            {ENTITIES.map(e => <option key={e} value={e}>{e}</option>)}
          </select>
          <div className="flex items-center gap-2">
            <label className="font-mono text-xs text-muted uppercase tracking-wider">VAT Rate</label>
            <input type="number" value={vatRate} onChange={e => setVatRate(parseFloat(e.target.value) || 20)}
              className="w-16 border border-rule bg-white px-2 py-1.5 text-xs font-mono text-ink focus:outline-none"
              min="0" max="100" />
            <span className="font-mono text-xs text-muted">%</span>
          </div>
          <button
            onClick={() => {
              const csvRows = [
                ['Quarter', 'VAT Collected', 'VAT Paid', 'Net Liability'],
                ...rows.map(r => [r.quarter, r.vatCollected.toFixed(2), r.vatPaid.toFixed(2), r.net.toFixed(2)]),
                ['TOTAL', totals.vatCollected.toFixed(2), totals.vatPaid.toFixed(2), totals.net.toFixed(2)],
              ]
              downloadCSV(csvRows, `vat-${year}-${entity}.csv`)
            }}
            className="ml-auto flex items-center gap-1.5 px-3 py-1.5 text-xs font-mono uppercase tracking-wider border border-rule text-muted hover:text-ink hover:border-ink transition-colors"
          >
            <Download size={11} /> Export CSV
          </button>
        </div>

        {/* KPI cards */}
        <div className="grid grid-cols-3 gap-4 mb-6">
          {[
            { label: 'VAT Collected', value: totals.vatCollected, accent: '#3a7a5a', sub: 'on sales' },
            { label: 'VAT Paid', value: totals.vatPaid, accent: '#7a6a3a', sub: 'on purchases' },
            { label: 'VAT Liability', value: totals.net, accent: totals.net > 0 ? '#dc2626' : '#3a7a5a', sub: totals.net > 0 ? 'owed to HMRC' : 'reclaimable' },
          ].map(({ label, value, accent, sub }) => (
            <div key={label} className="stat-card" style={{ borderTopColor: accent } as React.CSSProperties}>
              <p className="font-mono text-[10px] uppercase tracking-widest text-muted mb-2">{label}</p>
              <p className={cn('font-sans font-semibold text-2xl tracking-tight', value > 0 && label === 'VAT Liability' ? 'text-red-600' : 'text-ink')}>
                {loading ? '—' : fmt(Math.abs(value))}
              </p>
              <p className="font-mono text-xs text-muted mt-1">{sub}</p>
            </div>
          ))}
        </div>

        {/* Quarterly summary */}
        <div className="tbl-card mb-5">
          <div className="tbl-hd"><p className="tbl-lbl">Quarterly Summary · {year}</p></div>
          <table className="w-full">
            <thead>
              <tr className="border-b border-rule bg-paper/50">
                <th className="tbl-lbl text-left px-5 py-2.5">Quarter</th>
                <th className="tbl-lbl text-right px-3 py-2.5">VAT Collected</th>
                <th className="tbl-lbl text-right px-3 py-2.5">VAT Paid</th>
                <th className="tbl-lbl text-right px-5 py-2.5">Net Liability</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(row => {
                const empty = row.vatCollected === 0 && row.vatPaid === 0
                return (
                  <tr key={row.quarter} className={cn('border-b border-rule last:border-0 hover:bg-cream/70', empty && 'opacity-50')}>
                    <td className="px-5 py-2.5 font-mono text-xs font-medium text-ink">{row.quarter}</td>
                    <td className="px-3 py-2.5 text-right font-mono text-sm text-ac-green">{row.vatCollected > 0 ? fmt(row.vatCollected) : '—'}</td>
                    <td className="px-3 py-2.5 text-right font-mono text-sm text-ac-amber">{row.vatPaid > 0 ? fmt(row.vatPaid) : '—'}</td>
                    <td className={cn('px-5 py-2.5 text-right font-mono text-sm font-semibold', row.net > 0 ? 'text-red-600' : row.net < 0 ? 'text-ac-green' : 'text-muted')}>
                      {empty ? '—' : `${row.net > 0 ? '+' : ''}${fmt(row.net)}`}
                    </td>
                  </tr>
                )
              })}
              <tr className="border-t-2 border-ink bg-cream">
                <td className="px-5 py-3 font-mono text-xs font-semibold uppercase">Year Total</td>
                <td className="px-3 py-3 text-right font-mono text-sm font-semibold text-ac-green">{fmt(totals.vatCollected)}</td>
                <td className="px-3 py-3 text-right font-mono text-sm font-semibold text-ac-amber">{fmt(totals.vatPaid)}</td>
                <td className={cn('px-5 py-3 text-right font-mono text-sm font-semibold', totals.net > 0 ? 'text-red-600' : 'text-ac-green')}>
                  {totals.net >= 0 ? '+' : ''}{fmt(totals.net)}
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        {/* Invoice detail */}
        {details.length > 0 && (
          <div className="tbl-card">
            <div className="tbl-hd"><p className="tbl-lbl">Invoice Detail</p></div>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-rule bg-paper/50">
                    <th className="tbl-lbl text-left px-5 py-2.5">Ref</th>
                    <th className="tbl-lbl text-left px-3 py-2.5">Party</th>
                    <th className="tbl-lbl text-left px-3 py-2.5 hidden md:table-cell">Type</th>
                    <th className="tbl-lbl text-right px-3 py-2.5">Gross</th>
                    <th className="tbl-lbl text-right px-3 py-2.5">Net</th>
                    <th className="tbl-lbl text-right px-5 py-2.5">VAT</th>
                  </tr>
                </thead>
                <tbody>
                  {details.map((inv, idx) => (
                    <tr key={inv.id} className={cn('border-b border-rule last:border-0 hover:bg-cream/70', idx % 2 === 1 && 'bg-paper/40')}>
                      <td className="px-5 py-2.5 font-mono text-xs text-ink">{inv.ref || '—'}</td>
                      <td className="px-3 py-2.5 text-sm text-ink max-w-[160px] truncate">{inv.party}</td>
                      <td className="px-3 py-2.5 hidden md:table-cell">
                        <span className={cn('font-mono text-[10px] uppercase tracking-wider', inv.type === 'receivable' ? 'text-ac-green' : 'text-ac-amber')}>
                          {inv.type === 'receivable' ? 'Sale' : 'Purchase'}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono text-sm">{fmt(inv.amount, inv.currency)}</td>
                      <td className="px-3 py-2.5 text-right font-mono text-sm text-muted">{fmt(inv.net, inv.currency)}</td>
                      <td className={cn('px-5 py-2.5 text-right font-mono text-sm font-semibold',
                        inv.type === 'receivable' ? 'text-ac-green' : 'text-ac-amber')}>
                        {fmt(inv.vatAmt, inv.currency)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </main>
    </>
  )
}
