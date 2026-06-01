'use client'

import { useState, useEffect, useRef } from 'react'
import { Plus, X, FileText, Receipt, Layers } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { InvoiceModal } from '@/components/invoices/InvoiceModal'
import { ExpenseModal } from '@/components/expenses/ExpenseModal'
import { sb } from '@/lib/supabase'
import { toast } from '@/lib/toast'
import { cn } from '@/lib/format'
import type { Invoice, InvoiceInsert, ExpenseInsert, Project } from '@/types'

function loadProjects(): Project[] {
  try {
    const raw = localStorage.getItem('ledger_projects')
    return raw ? (JSON.parse(raw) as Project[]) : []
  } catch { return [] }
}

export function FloatingActionButton() {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [modal, setModal] = useState<null | 'invoice' | 'expense' | 'cost-pick'>(null)
  const [invoices, setInvoices] = useState<Invoice[]>([])
  const [projects, setProjects] = useState<Project[]>([])
  const [projectSearch, setProjectSearch] = useState('')
  const menuRef = useRef<HTMLDivElement>(null)

  // Close menu on outside click
  useEffect(() => {
    if (!open) return
    function handler(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  async function handleOpenInvoice() {
    setOpen(false)
    // Lazy-load invoices for ref auto-generation
    if (invoices.length === 0) {
      const { data } = await sb
        .from('invoices')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(200)
      setInvoices((data as Invoice[]) ?? [])
    }
    setModal('invoice')
  }

  function handleOpenExpense() {
    setOpen(false)
    setModal('expense')
  }

  function handleOpenCostPick() {
    setOpen(false)
    setProjects(loadProjects())
    setProjectSearch('')
    setModal('cost-pick')
  }

  async function handleSaveInvoice(data: InvoiceInsert) {
    const { error } = await sb.from('invoices').insert(data)
    if (error) throw new Error(error.message)
    toast('Invoice created')
    // Refresh invoice list for next open
    setInvoices([])
  }

  async function handleSaveExpense(data: ExpenseInsert) {
    const lineTotal = (data.line_items ?? []).reduce((t, l) => t + Number(l.amount), 0)
    const { error } = await sb.from('expenses').insert({ ...data, total: lineTotal })
    if (error) throw new Error(error.message)
    toast('Expense created')
  }

  function handleSelectProject(code: string) {
    setModal(null)
    router.push(`/projects?open=${code}&tab=costs`)
  }

  const filteredProjects = projects.filter(p =>
    p.code.toLowerCase().includes(projectSearch.toLowerCase()) ||
    p.name.toLowerCase().includes(projectSearch.toLowerCase())
  )

  return (
    <>
      {/* Invoice modal */}
      <InvoiceModal
        isOpen={modal === 'invoice'}
        onClose={() => setModal(null)}
        existingInvoices={invoices}
        defaultType="receivable"
        onSave={handleSaveInvoice}
      />

      {/* Expense modal */}
      <ExpenseModal
        isOpen={modal === 'expense'}
        onClose={() => setModal(null)}
        onSave={handleSaveExpense}
      />

      {/* Project picker for Cost */}
      {modal === 'cost-pick' && (
        <div className="fixed inset-0 z-50 flex items-end justify-end p-6 pb-24">
          <div className="bg-white border border-rule shadow-xl w-72">
            <div className="flex items-center justify-between px-4 py-3 border-b border-rule">
              <p className="font-mono text-xs uppercase tracking-wider text-ink">Select Project for Cost</p>
              <button onClick={() => setModal(null)} className="text-muted hover:text-ink">
                <X size={14} />
              </button>
            </div>
            <div className="px-3 py-2 border-b border-rule">
              <input
                autoFocus
                value={projectSearch}
                onChange={e => setProjectSearch(e.target.value)}
                placeholder="Search projects…"
                className="w-full border border-rule bg-paper px-2 py-1.5 text-xs text-ink focus:outline-none focus:border-ink"
              />
            </div>
            <div className="max-h-64 overflow-y-auto divide-y divide-rule">
              {filteredProjects.length === 0 ? (
                <p className="px-4 py-6 text-center font-mono text-xs text-muted">No projects found</p>
              ) : filteredProjects.map(p => (
                <button
                  key={p.code}
                  onClick={() => handleSelectProject(p.code)}
                  className="w-full text-left px-4 py-2.5 hover:bg-cream transition-colors"
                >
                  <p className="font-mono text-[10px] text-muted uppercase tracking-wider">{p.code}</p>
                  <p className="text-sm text-ink mt-0.5">{p.name}</p>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* FAB */}
      <div ref={menuRef} className="fixed bottom-6 right-6 z-40 flex flex-col items-end gap-2">
        {/* Mini menu — appears above FAB */}
        {open && (
          <div className="flex flex-col gap-1.5 mb-1">
            {([
              { label: '+ Invoice', icon: <FileText size={12} />, action: handleOpenInvoice },
              { label: '+ Expense', icon: <Receipt size={12} />, action: handleOpenExpense },
              { label: '+ Cost', icon: <Layers size={12} />, action: handleOpenCostPick },
            ] as const).map(item => (
              <button
                key={item.label}
                onClick={item.action}
                className="flex items-center gap-2 px-4 py-2.5 bg-ink text-white font-mono text-xs uppercase tracking-wider hover:bg-[#333] transition-colors shadow-lg whitespace-nowrap"
              >
                {item.icon}
                {item.label}
              </button>
            ))}
          </div>
        )}

        {/* Main button */}
        <button
          onClick={() => setOpen(v => !v)}
          className={cn(
            'w-12 h-12 flex items-center justify-center shadow-lg transition-all',
            open ? 'bg-[#444]' : 'bg-ink hover:bg-[#333]'
          )}
          title="Quick add"
          aria-label="Quick add"
        >
          <Plus
            size={22}
            className={cn('text-white transition-transform duration-200', open && 'rotate-45')}
          />
        </button>
      </div>
    </>
  )
}
