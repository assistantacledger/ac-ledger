'use client'

import { useMemo } from 'react'
import type { Invoice, Expense, Project } from '@/types'

// Loads projects from all known localStorage keys (supports both app versions)
function loadLocalProjects(): Project[] {
  const out: Project[] = []
  for (const key of ['ledger_projects', 'ledger_projects_v2']) {
    try {
      const raw = localStorage.getItem(key)
      if (raw) {
        const arr = JSON.parse(raw) as Project[]
        arr.forEach(p => {
          if (!out.find(x => x.code === p.code)) out.push(p)
        })
      }
    } catch { /* ignore */ }
  }
  return out
}

/**
 * Returns a sorted, deduplicated list of project {code, name} pairs
 * combining localStorage projects with unique project_codes from Supabase records.
 */
export function useProjectCodes(
  invoices: Invoice[],
  expenses?: Expense[],
): { code: string; name: string }[] {
  return useMemo(() => {
    const map = new Map<string, string>()

    // From localStorage
    if (typeof window !== 'undefined') {
      loadLocalProjects().forEach(p => {
        if (p.code) map.set(p.code, p.name || p.code)
      })
    }

    // From Supabase invoices
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
  }, [invoices, expenses])
}
