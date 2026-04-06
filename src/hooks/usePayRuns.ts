'use client'

import { useState, useCallback } from 'react'
import { sb } from '@/lib/supabase'
import type { PayRun, PayRunItem } from '@/types'

const STORAGE_KEY = 'ledger_pay_runs'

function loadRuns(): PayRun[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? JSON.parse(raw) : []
  } catch { return [] }
}

function saveRuns(runs: PayRun[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(runs))
}

export function usePayRuns() {
  const [runs, setRuns] = useState<PayRun[]>(() => {
    if (typeof window === 'undefined') return []
    return loadRuns()
  })

  const createRun = useCallback((name: string, date: string, items: PayRunItem[]): PayRun => {
    const run: PayRun = {
      id: Date.now().toString(),
      name,
      date,
      items,
      total: items.reduce((t, i) => t + Number(i.amount), 0),
    }
    const updated = [run, ...loadRuns()]
    saveRuns(updated)
    setRuns(updated)
    return run
  }, [])

  const deleteRun = useCallback((id: string) => {
    const updated = loadRuns().filter(r => r.id !== id)
    saveRuns(updated)
    setRuns(updated)
  }, [])

  const executeRun = useCallback(async (id: string): Promise<void> => {
    const run = loadRuns().find(r => r.id === id)
    if (!run) return
    const invoiceIds = run.items.filter(i => i.type === 'invoice').map(i => i.id)
    const expenseIds = run.items.filter(i => i.type === 'expense').map(i => i.id)
    if (invoiceIds.length) {
      const { error } = await sb.from('invoices').update({ status: 'paid' }).in('id', invoiceIds)
      if (error) throw error
    }
    if (expenseIds.length) {
      const { error } = await sb.from('expenses').update({ status: 'paid' }).in('id', expenseIds)
      if (error) throw error
    }
    // Mark run as executed (add executed flag)
    const updated = loadRuns().map(r => r.id === id ? { ...r, executed: true } as PayRun & { executed: boolean } : r)
    saveRuns(updated)
    setRuns(updated)
  }, [])

  const reload = useCallback(() => {
    setRuns(loadRuns())
  }, [])

  return { runs, createRun, deleteRun, executeRun, reload }
}
