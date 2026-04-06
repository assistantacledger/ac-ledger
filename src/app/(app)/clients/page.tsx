'use client'

import { useMemo, useState } from 'react'
import { Header } from '@/components/layout/Header'
import { useInvoices } from '@/hooks/useInvoices'
import { cn, fmt, fmtDate } from '@/lib/format'
import { Search, Users } from 'lucide-react'

interface ClientSummary {
  name: string
  invoiceCount: number
  totalBilled: number
  totalPaid: number
  outstanding: number
  lastInvoice: string | null
  entities: Set<string>
}

export default function ClientsPage() {
  const { invoices, loading } = useInvoices()
  const [search, setSearch] = useState('')

  const clients = useMemo<ClientSummary[]>(() => {
    const map = new Map<string, ClientSummary>()
    invoices
      .filter(i => i.type === 'receivable')
      .forEach(inv => {
        const key = inv.party.trim().toLowerCase()
        if (!map.has(key)) {
          map.set(key, {
            name: inv.party,
            invoiceCount: 0,
            totalBilled: 0,
            totalPaid: 0,
            outstanding: 0,
            lastInvoice: null,
            entities: new Set(),
          })
        }
        const c = map.get(key)!
        c.invoiceCount++
        c.totalBilled += Number(inv.amount)
        if (inv.status === 'paid') c.totalPaid += Number(inv.amount)
        if (!['paid', 'draft'].includes(inv.status)) c.outstanding += Number(inv.amount)
        if (!c.lastInvoice || inv.created_at > c.lastInvoice) c.lastInvoice = inv.created_at
        c.entities.add(inv.entity)
      })
    return Array.from(map.values()).sort((a, b) => b.totalBilled - a.totalBilled)
  }, [invoices])

  const filtered = useMemo(() => {
    if (!search.trim()) return clients
    const q = search.toLowerCase()
    return clients.filter(c => c.name.toLowerCase().includes(q))
  }, [clients, search])

  const totals = useMemo(() => ({
    clients: filtered.length,
    billed: filtered.reduce((t, c) => t + c.totalBilled, 0),
    outstanding: filtered.reduce((t, c) => t + c.outstanding, 0),
  }), [filtered])

  return (
    <>
      <Header title="Clients" />
      <main className="flex-1 overflow-y-auto px-6 py-6">

        {/* KPI bar */}
        <div className="grid grid-cols-3 gap-4 mb-6">
          {[
            { label: 'Total Clients', value: String(totals.clients), sub: 'unique' },
            { label: 'Total Billed', value: fmt(totals.billed), sub: 'across all time' },
            { label: 'Outstanding', value: fmt(totals.outstanding), sub: 'currently open' },
          ].map(({ label, value, sub }) => (
            <div key={label} className="stat-card" style={{ borderTopColor: '#2a2a2a' } as React.CSSProperties}>
              <p className="font-mono text-[10px] uppercase tracking-widest text-muted mb-2">{label}</p>
              <p className="font-sans font-semibold text-2xl text-ink">{loading ? '—' : value}</p>
              <p className="font-mono text-xs text-muted mt-1">{sub}</p>
            </div>
          ))}
        </div>

        <div className="tbl-card">
          <div className="tbl-hd">
            <p className="tbl-lbl">All Clients</p>
            <div className="relative">
              <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" />
              <input
                type="text" value={search} onChange={e => setSearch(e.target.value)}
                placeholder="Search clients…"
                className="pl-7 pr-3 py-1.5 text-xs border border-rule bg-white text-ink placeholder:text-muted focus:outline-none focus:border-ink w-48"
              />
            </div>
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-16"><div className="w-5 h-5 border-2 border-rule border-t-ink animate-spin" /></div>
          ) : filtered.length === 0 ? (
            <div className="py-16 text-center">
              <Users size={24} className="text-muted mx-auto mb-3" />
              <p className="font-mono text-xs text-muted uppercase tracking-wider">No clients found</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-rule bg-paper/50">
                    <th className="tbl-lbl text-left px-5 py-2.5">Client</th>
                    <th className="tbl-lbl text-right px-3 py-2.5">Invoices</th>
                    <th className="tbl-lbl text-right px-3 py-2.5">Total Billed</th>
                    <th className="tbl-lbl text-right px-3 py-2.5">Paid</th>
                    <th className="tbl-lbl text-right px-3 py-2.5">Outstanding</th>
                    <th className="tbl-lbl text-left px-5 py-2.5 hidden md:table-cell">Last Invoice</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((client, idx) => (
                    <tr key={client.name} className={cn('border-b border-rule last:border-0 hover:bg-cream/70 transition-colors', idx % 2 === 1 && 'bg-paper/40')}>
                      <td className="px-5 py-3">
                        <p className="text-sm font-medium text-ink">{client.name}</p>
                        <p className="font-mono text-[10px] text-muted mt-0.5">
                          {Array.from(client.entities).map(e => e === 'Actually Creative' ? 'AC' : e === '419Studios' ? '419' : 'RTW').join(' · ')}
                        </p>
                      </td>
                      <td className="px-3 py-3 text-right font-mono text-xs text-muted">{client.invoiceCount}</td>
                      <td className="px-3 py-3 text-right font-mono text-sm font-semibold text-ink">{fmt(client.totalBilled)}</td>
                      <td className="px-3 py-3 text-right font-mono text-sm text-ac-green">{fmt(client.totalPaid)}</td>
                      <td className={cn('px-3 py-3 text-right font-mono text-sm font-semibold',
                        client.outstanding > 0 ? 'text-ac-amber' : 'text-muted')}>
                        {client.outstanding > 0 ? fmt(client.outstanding) : '—'}
                      </td>
                      <td className="px-5 py-3 font-mono text-xs text-muted hidden md:table-cell">
                        {client.lastInvoice ? fmtDate(client.lastInvoice.split('T')[0]) : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {!loading && filtered.length > 0 && (
            <div className="px-5 py-3 border-t border-rule bg-cream flex justify-between">
              <span className="font-mono text-xs text-muted">{filtered.length} client{filtered.length !== 1 ? 's' : ''}</span>
              <span className="font-mono text-xs font-semibold text-ink">Total billed: {fmt(totals.billed)}</span>
            </div>
          )}
        </div>
      </main>
    </>
  )
}
