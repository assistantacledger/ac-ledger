import { createClient } from '@supabase/supabase-js'
import type { Invoice, Expense } from '@/types'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

export const sb = createClient(supabaseUrl, supabaseAnonKey)

// ─── Typed helpers ────────────────────────────────────────────────────────────

export async function fetchInvoices(): Promise<Invoice[]> {
  const { data, error } = await sb
    .from('invoices')
    .select('*')
    .order('created_at', { ascending: false })
  if (error) throw error
  return data ?? []
}

export async function fetchExpenses(): Promise<Expense[]> {
  const { data, error } = await sb
    .from('expenses')
    .select('*')
    .order('created_at', { ascending: false })
  if (error) throw error
  return data ?? []
}

export async function autoMarkOverdue(invoices: Invoice[]): Promise<void> {
  const today = new Date().toISOString().split('T')[0]
  const ids = invoices
    .filter(i => i.status === 'pending' && i.due && i.due < today)
    .map(i => i.id)
  if (!ids.length) return
  await sb.from('invoices').update({ status: 'overdue' }).in('id', ids)
}
