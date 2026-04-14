'use client'

import { useState, useEffect, useCallback } from 'react'
import { sb, autoMarkOverdue } from '@/lib/supabase'
import type { Invoice, InvoiceInsert, InvoiceUpdate } from '@/types'

export function useInvoices() {
  const [invoices, setInvoices] = useState<Invoice[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const { data, error } = await sb
        .from('invoices')
        .select('*')
        .order('created_at', { ascending: false })
      if (error) throw error
      const inv = (data ?? []) as Invoice[]
      await autoMarkOverdue(inv)
      const today = new Date().toISOString().split('T')[0]
      const updated = inv.map(i =>
        i.status === 'pending' && i.due && i.due < today
          ? { ...i, status: 'overdue' as const }
          : i
      )
      setInvoices(updated)
    } catch (e) {
      setError(String(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const createInvoice = useCallback(async (data: InvoiceInsert): Promise<Invoice> => {
    const { data: created, error } = await sb
      .from('invoices')
      .insert(data)
      .select()
      .single()
    if (error) throw error
    setInvoices(prev => [created as Invoice, ...prev])
    return created as Invoice
  }, [])

  const updateInvoice = useCallback(async (id: string, data: InvoiceUpdate): Promise<Invoice> => {
    const { data: updated, error } = await sb
      .from('invoices')
      .update(data)
      .eq('id', id)
      .select()
      .single()
    if (error) throw error
    setInvoices(prev => prev.map(i => i.id === id ? updated as Invoice : i))
    return updated as Invoice
  }, [])

  const markPaid = useCallback(async (id: string) => {
    await updateInvoice(id, { status: 'paid' })
  }, [updateInvoice])

  const bulkMarkPaid = useCallback(async (ids: string[]) => {
    await Promise.all(ids.map(id => updateInvoice(id, { status: 'paid' })))
  }, [updateInvoice])

  const deleteInvoice = useCallback(async (id: string) => {
    const { error } = await sb.from('invoices').delete().eq('id', id)
    if (error) throw error
    setInvoices(prev => prev.filter(i => i.id !== id))
  }, [])

  return {
    invoices,
    loading,
    error,
    reload: load,
    createInvoice,
    updateInvoice,
    markPaid,
    bulkMarkPaid,
    deleteInvoice,
  }
}
