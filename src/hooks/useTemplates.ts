'use client'

import { useState, useCallback } from 'react'
import type { InvoiceTemplate } from '@/types'

const KEY = 'ledger_templates'

function load(): InvoiceTemplate[] {
  try {
    const raw = localStorage.getItem(KEY)
    return raw ? JSON.parse(raw) : []
  } catch { return [] }
}

function persist(templates: InvoiceTemplate[]) {
  localStorage.setItem(KEY, JSON.stringify(templates))
}

export function useTemplates() {
  const [templates, setTemplates] = useState<InvoiceTemplate[]>(() => {
    if (typeof window === 'undefined') return []
    return load()
  })

  const saveTemplate = useCallback((data: Omit<InvoiceTemplate, 'id' | 'createdAt'>): InvoiceTemplate => {
    const t: InvoiceTemplate = { ...data, id: Date.now().toString(), createdAt: new Date().toISOString() }
    const updated = [t, ...load()]
    persist(updated)
    setTemplates(updated)
    return t
  }, [])

  const updateTemplate = useCallback((id: string, data: Partial<Omit<InvoiceTemplate, 'id' | 'createdAt'>>) => {
    const updated = load().map(t => t.id === id ? { ...t, ...data } : t)
    persist(updated)
    setTemplates(updated)
  }, [])

  const deleteTemplate = useCallback((id: string) => {
    const updated = load().filter(t => t.id !== id)
    persist(updated)
    setTemplates(updated)
  }, [])

  // Store a template as the "pending draft" for the generate page
  const applyTemplate = useCallback((id: string) => {
    const t = load().find(t => t.id === id)
    if (t) localStorage.setItem('ledger_draft_invoice', JSON.stringify(t))
  }, [])

  return { templates, saveTemplate, updateTemplate, deleteTemplate, applyTemplate }
}
