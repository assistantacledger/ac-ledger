'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Header } from '@/components/layout/Header'
import { InvoiceTable } from '@/components/invoices/InvoiceTable'
import { InvoiceModal } from '@/components/invoices/InvoiceModal'
import { InvoicePreviewModal } from '@/components/invoices/InvoicePreviewModal'
import { useInvoices } from '@/hooks/useInvoices'
import { useProjectCodes } from '@/hooks/useProjectCodes'
import type { Invoice, InvoiceInsert } from '@/types'

export default function PayablePage() {
  const router = useRouter()
  const { invoices, loading, error, createInvoice, updateInvoice, markPaid, bulkMarkPaid, deleteInvoice } = useInvoices()
  const projectCodes = useProjectCodes(invoices)
  const [editing, setEditing] = useState<Invoice | null>(null)
  const [creating, setCreating] = useState(false)
  const [previewing, setPreviewing] = useState<Invoice | null>(null)
  const [duplicateValues, setDuplicateValues] = useState<Partial<InvoiceInsert> | undefined>()

  async function handleSave(data: InvoiceInsert) {
    if (editing) {
      await updateInvoice(editing.id, data)
    } else {
      await createInvoice(data)
    }
  }

  function handleDuplicate(inv: Invoice) {
    setEditing(null)
    setDuplicateValues({
      type: inv.type,
      party: inv.party,
      currency: inv.currency,
      entity: inv.entity,
      project_code: inv.project_code,
      project_name: inv.project_name,
      notes: inv.notes,
      line_items: inv.line_items,
      amount: inv.amount,
      status: 'draft',
      ref: '',  // clear ref — user should set a new one
      due: null,
      internal: null,
      recurring: false,
      pdf_url: null,
      payment_schedule: null,
    })
    setCreating(true)
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
          onNew={() => { setEditing(null); setDuplicateValues(undefined); setCreating(true) }}
          onPreview={setPreviewing}
          onDuplicate={handleDuplicate}
          onBulkMarkPaid={bulkMarkPaid}
          onProjectClick={code => router.push(`/projects?open=${code}`)}
          projectCodes={projectCodes}
          onAssignProject={async (id, code, name) => { await updateInvoice(id, { project_code: code, project_name: name }) }}
        />
      </main>

      <InvoiceModal
        isOpen={creating || !!editing}
        onClose={() => { setCreating(false); setEditing(null); setDuplicateValues(undefined) }}
        invoice={editing}
        existingInvoices={invoices}
        defaultType="payable"
        defaultValues={duplicateValues}
        onSave={handleSave}
      />

      <InvoicePreviewModal invoice={previewing} onClose={() => setPreviewing(null)} />
    </>
  )
}
