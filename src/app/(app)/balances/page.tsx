'use client'

import { useMemo } from 'react'
import { Header } from '@/components/layout/Header'
import { useInvoices } from '@/hooks/useInvoices'
import { fmt } from '@/lib/format'
import { cn } from '@/lib/format'
import type { Entity, InvoiceStatus } from '@/types'
import { ENTITIES } from '@/types'

const OPEN_STATUSES: InvoiceStatus[] = ['pending', 'submitted', 'approved', 'sent', 'overdue', 'part-paid']

function NetBar({ receivable, payable }: { receivable: number; payable: number }) {
  const total = receivable + payable
  if (total === 0) return null
  const recPct = (receivable / total) * 100
  return (
    <div className="h-2 w-full bg-rule overflow-hidden">
      <div className="h-full bg-ac-green transition-all" style={{ width: `${recPct}%` }} />
    </div>
  )
}

export default function BalancesPage() {
  const { invoices, loading, error } = useInvoices()

  const stats = useMemo(() => {
    const open = invoices.filter(i => OPEN_STATUSES.includes(i.status))
    const paid = invoices.filter(i => i.status === 'paid')
    const overdue = invoices.filter(i => i.status === 'overdue')

    const sum = (arr: typeof invoices) => arr.reduce((t, i) => t + Number(i.amount), 0)

    // Per-entity breakdown
    const byEntity = ENTITIES.map(entity => {
      const entityInv = open.filter(i => i.entity === entity)
      const rec = entityInv.filter(i => i.type === 'receivable')
      const pay = entityInv.filter(i => i.type === 'payable')
      return {
        entity,
        receivable: sum(rec),
        payable: sum(pay),
        net: sum(rec) - sum(pay),
        recCount: rec.length,
        payCount: pay.length,
      }
    })

    // Aging buckets for overdue
    const today = new Date()
    function ageBucket(dueStr: string | null) {
      if (!dueStr) return '90+'
      const days = Math.floor((today.getTime() - new Date(dueStr).getTime()) / 86400000)
      if (days <= 30) return '0–30'
      if (days <= 60) return '31–60'
      if (days <= 90) return '61–90'
      return '90+'
    }

    const aging: Record<string, { count: number; amount: number }> = {
      '0–30': { count: 0, amount: 0 },
      '31–60': { count: 0, amount: 0 },
      '61–90': { count: 0, amount: 0 },
      '90+': { count: 0, amount: 0 },
    }
    overdue.forEach(inv => {
      const bucket = ageBucket(inv.due)
      aging[bucket].count++
      aging[bucket].amount += Number(inv.amount)
    })

    // Status breakdown
    const statusGroups: { status: InvoiceStatus; label: string }[] = [
      { status: 'draft', label: 'Draft' },
      { status: 'pending', label: 'Pending' },
      { status: 'submitted', label: 'Submitted' },
      { status: 'approved', label: 'Approved' },
      { status: 'sent', label: 'Sent' },
      { status: 'overdue', label: 'Overdue' },
      { status: 'part-paid', label: 'Part Paid' },
      { status: 'paid', label: 'Paid' },
    ]
    const byStatus = statusGroups.map(({ status, label }) => {
      const group = invoices.filter(i => i.status === status)
      return {
        status,
        label,
        count: group.length,
        amount: sum(group),
      }
    }).filter(g => g.count > 0)

    const totalRec = sum(open.filter(i => i.type === 'receivable'))
    const totalPay = sum(open.filter(i => i.type === 'payable'))

    return {
      totalRec, totalPay,
      net: totalRec - totalPay,
      overdueAmt: sum(overdue),
      overdueCount: overdue.length,
      paidThisYear: sum(paid.filter(i => i.created_at?.startsWith(new Date().getFullYear().toString()))),
      byEntity,
      aging,
      byStatus,
      total: invoices.length,
    }
  }, [invoices])

  return (
    <>
      <Header title="Balances" />
      <main className="flex-1 overflow-y-auto px-6 py-6">
        {error && (
          <div className="mb-5 border border-red-200 bg-red-50 px-4 py-3 font-mono text-xs text-red-700">
            {error}
          </div>
        )}

        {/* ── Top KPIs ─────────────────────────────────────────────── */}
        <div className="grid grid-cols-2 xl:grid-cols-4 gap-4 mb-6">
          {[
            { label: 'To Receive', value: stats.totalRec, accent: '#3a7a5a', sub: 'open receivables' },
            { label: 'To Pay', value: stats.totalPay, accent: '#7a6a3a', sub: 'open payables' },
            { label: 'Net Position', value: stats.net, accent: stats.net >= 0 ? '#3a7a5a' : '#dc2626', sub: stats.net >= 0 ? 'favourable' : 'deficit' },
            { label: 'Overdue', value: stats.overdueAmt, accent: stats.overdueCount > 0 ? '#dc2626' : '#2a2a2a', sub: `${stats.overdueCount} invoice${stats.overdueCount !== 1 ? 's' : ''}` },
          ].map(({ label, value, accent, sub }) => (
            <div
              key={label}
              className="stat-card"
              style={{ borderTopColor: accent } as React.CSSProperties}
            >
              <p className="font-mono text-[10px] uppercase tracking-widest text-muted mb-2">{label}</p>
              <p className="font-sans font-semibold text-2xl text-ink tracking-tight">
                {loading ? '—' : `${value >= 0 ? '' : '-'}${fmt(Math.abs(value))}`}
              </p>
              <p className="font-mono text-xs text-muted mt-1">{sub}</p>
            </div>
          ))}
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
          {/* ── Entity Breakdown ───────────────────────────────────── */}
          <div className="tbl-card">
            <div className="tbl-hd">
              <p className="tbl-lbl">By Entity</p>
            </div>
            {loading ? (
              <div className="flex items-center justify-center py-10">
                <div className="w-5 h-5 border-2 border-rule border-t-ink animate-spin" />
              </div>
            ) : (
              <div className="divide-y divide-rule">
                {stats.byEntity.map(({ entity, receivable, payable, net, recCount, payCount }) => (
                  <div key={entity} className="px-5 py-4">
                    <div className="flex items-center justify-between mb-2">
                      <p className="text-sm font-semibold text-ink">{entity}</p>
                      <p className={cn(
                        'font-mono text-sm font-semibold',
                        net > 0 ? 'text-ac-green' : net < 0 ? 'text-red-600' : 'text-muted'
                      )}>
                        {net >= 0 ? '+' : ''}{fmt(net)}
                      </p>
                    </div>
                    <NetBar receivable={receivable} payable={payable} />
                    <div className="flex justify-between mt-2">
                      <div>
                        <span className="font-mono text-[10px] uppercase tracking-wider text-ac-green">In</span>
                        <span className="font-mono text-xs text-ink ml-1.5">{fmt(receivable)}</span>
                        <span className="font-mono text-[10px] text-muted ml-1">({recCount})</span>
                      </div>
                      <div>
                        <span className="font-mono text-[10px] uppercase tracking-wider text-ac-amber">Out</span>
                        <span className="font-mono text-xs text-ink ml-1.5">{fmt(payable)}</span>
                        <span className="font-mono text-[10px] text-muted ml-1">({payCount})</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Right column */}
          <div className="flex flex-col gap-6">
            {/* ── Aging ────────────────────────────────────────────── */}
            <div className="tbl-card">
              <div className="tbl-hd">
                <p className="tbl-lbl">Overdue Aging</p>
              </div>
              {loading ? (
                <div className="flex items-center justify-center py-10">
                  <div className="w-4 h-4 border-2 border-rule border-t-ink animate-spin" />
                </div>
              ) : stats.overdueCount === 0 ? (
                <div className="px-5 py-8 text-center">
                  <p className="font-mono text-xs text-muted">No overdue invoices</p>
                </div>
              ) : (
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-rule bg-paper/50">
                      <th className="tbl-lbl text-left px-5 py-2.5">Days Overdue</th>
                      <th className="tbl-lbl text-center px-3 py-2.5">Count</th>
                      <th className="tbl-lbl text-right px-5 py-2.5">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(stats.aging).map(([bucket, { count, amount }]) => (
                      count > 0 && (
                        <tr key={bucket} className="border-b border-rule last:border-0">
                          <td className="px-5 py-2.5 font-mono text-xs text-ink">{bucket} days</td>
                          <td className="px-3 py-2.5 text-center font-mono text-xs text-muted">{count}</td>
                          <td className={cn(
                            'px-5 py-2.5 text-right font-mono text-sm font-semibold',
                            bucket === '90+' ? 'text-red-600' : bucket === '61–90' ? 'text-ac-amber' : 'text-ink'
                          )}>
                            {fmt(amount)}
                          </td>
                        </tr>
                      )
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            {/* ── Status Breakdown ─────────────────────────────────── */}
            <div className="tbl-card">
              <div className="tbl-hd">
                <p className="tbl-lbl">By Status</p>
                <span className="font-mono text-xs text-muted">{stats.total} total</span>
              </div>
              {loading ? (
                <div className="flex items-center justify-center py-10">
                  <div className="w-4 h-4 border-2 border-rule border-t-ink animate-spin" />
                </div>
              ) : (
                <table className="w-full">
                  <tbody>
                    {stats.byStatus.map(({ status, label, count, amount }) => (
                      <tr key={status} className="border-b border-rule last:border-0 hover:bg-cream/60 transition-colors">
                        <td className="px-5 py-2.5">
                          <span className={cn('badge', {
                            'badge-paid': status === 'paid',
                            'badge-pending': status === 'pending',
                            'badge-overdue': status === 'overdue',
                            'badge-draft': status === 'draft',
                            'badge-submitted': status === 'submitted',
                            'badge-approved': status === 'approved',
                            'badge-sent': status === 'sent',
                            'badge-part-paid': status === 'part-paid',
                          })}>
                            {label}
                          </span>
                        </td>
                        <td className="px-3 py-2.5 font-mono text-xs text-muted">{count} invoice{count !== 1 ? 's' : ''}</td>
                        <td className="px-5 py-2.5 text-right font-mono text-sm font-semibold text-ink">{fmt(amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      </main>
    </>
  )
}
