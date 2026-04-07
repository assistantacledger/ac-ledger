'use client'

import { useState } from 'react'
import { Header } from '@/components/layout/Header'
import { InvoiceTable } from '@/components/invoices/InvoiceTable'
import { InvoiceModal } from '@/components/invoices/InvoiceModal'
import { InvoicePreviewModal } from '@/components/invoices/InvoicePreviewModal'
import { useInvoices } from '@/hooks/useInvoices'
import type { Invoice, InvoiceInsert } from '@/types'

export default function PayablePage() {
  const { invoices, loading, error, createInvoice, updateInvoice, markPaid, deleteInvoice } = useInvoices()
  const [editing, setEditing] = useState<Invoice | null>(null)
  const [creating, setCreating] = useState(false)
  const [previewing, setPreviewing] = useState<Invoice | null>(null)

  async function handleSave(data: InvoiceInsert) {
    if (editing) {
      await updateInvoice(editing.id, data)
    } else {
      await createInvoice(data)
    }
  }

  return (
    <>
      <Header title="To Pay" subtitle="Payable" />
      <main className="flex-1 overflow-y-auto px-6 py-6">
        {error && (
          <div className="mb-5 border border-red-200 bg-red-50 px-4 py-3 font-mono text-xs text-red-700">
            {error}
          </div>
        )}
        <InvoiceTable
          invoices={invoices}
          loading={loading}
          type="payable"
          onEdit={inv => { setEditing(inv); setCreating(false) }}
          onMarkPaid={inv => markPaid(inv.id)}
          onDelete={deleteInvoice}
          onNew={() => { setEditing(null); setCreating(true) }}
          onPreview={setPreviewing}
        />
      </main>

      <InvoiceModal
        isOpen={creating || !!editing}
        onClose={() => { setCreating(false); setEditing(null) }}
        invoice={editing}
        existingInvoices={invoices}
        defaultType="payable"
        onSave={handleSave}
      />

      <InvoicePreviewModal invoice={previewing} onClose={() => setPreviewing(null)} />
    </>
  )
}
