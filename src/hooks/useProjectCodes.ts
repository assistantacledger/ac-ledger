'use client'

import { useMemo } from 'react'
import type { Invoice, Expense, Project } from '@/types'

/**
 * Returns a sorted, deduplicated list of project {code, name} pairs
 * combining the projects array (from Supabase via useProjects) with
 * unique project_codes found in Supabase invoices and expenses.
 */
export function useProjectCodes(
  invoices: Invoice[],
  expenses?: Expense[],
  projects?: Project[],
): { code: string; name: string }[] {
  return useMemo(() => {
    const map = new Map<string, string>()

    // From Supabase projects (passed in from useProjects hook)
    projects?.forEach(p => {
      if (p.code) map.set(p.code, p.name || p.code)
    })

    // From Supabase invoices (for any project codes not in projects table)
    invoices.forEach(i => {
      if (i.project_code && !map.has(i.project_code)) {
        map.set(i.project_code, i.project_name || i.project_code)
      }
    })

    // From Supabase expenses
    expenses?.forEach(e => {
      if (e.project_code && !map.has(e.project_code)) {
        map.set(e.project_code, e.project_name || e.project_code)
      }
    })

    return Array.from(map.entries())
      .map(([code, name]) => ({ code, name }))
      .sort((a, b) => a.code.localeCompare(b.code))
  }, [invoices, expenses, projects])
}
