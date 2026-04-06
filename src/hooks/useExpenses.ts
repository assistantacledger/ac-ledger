'use client'

import { useState, useEffect, useCallback } from 'react'
import { sb } from '@/lib/supabase'
import type { Expense, ExpenseInsert, ExpenseUpdate, ExpenseStatus } from '@/types'

export function useExpenses() {
  const [expenses, setExpenses] = useState<Expense[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const { data, error } = await sb
        .from('expenses')
        .select('*')
        .order('created_at', { ascending: false })
      if (error) throw error
      setExpenses((data ?? []) as Expense[])
    } catch (e) {
      setError(String(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const createExpense = useCallback(async (data: ExpenseInsert): Promise<Expense> => {
    const { data: created, error } = await sb.from('expenses').insert(data).select().single()
    if (error) throw error
    setExpenses(prev => [created as Expense, ...prev])
    return created as Expense
  }, [])

  const updateExpense = useCallback(async (id: string, data: ExpenseUpdate): Promise<Expense> => {
    const { data: updated, error } = await sb.from('expenses').update(data).eq('id', id).select().single()
    if (error) throw error
    setExpenses(prev => prev.map(e => e.id === id ? updated as Expense : e))
    return updated as Expense
  }, [])

  const setStatus = useCallback(async (id: string, status: ExpenseStatus) => {
    await updateExpense(id, { status })
  }, [updateExpense])

  const deleteExpense = useCallback(async (id: string) => {
    const { error } = await sb.from('expenses').delete().eq('id', id)
    if (error) throw error
    setExpenses(prev => prev.filter(e => e.id !== id))
  }, [])

  return { expenses, loading, error, reload: load, createExpense, updateExpense, setStatus, deleteExpense }
}
