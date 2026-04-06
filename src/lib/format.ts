// ─── Currency ────────────────────────────────────────────────────────────────

export function fmt(amount: number, currency = '£'): string {
  return currency + amount.toLocaleString('en-GB', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}

// ─── Dates ───────────────────────────────────────────────────────────────────

export function fmtDate(dateStr: string | null | undefined): string {
  if (!dateStr) return '—'
  const [y, m, d] = dateStr.split('-')
  return `${d}/${m}/${y}`
}

export function fmtDateLong(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })
}

export function todayISO(): string {
  return new Date().toISOString().split('T')[0]
}

export function daysOverdue(dueDateStr: string | null): number {
  if (!dueDateStr) return 0
  const due = new Date(dueDateStr)
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  return Math.floor((today.getTime() - due.getTime()) / 86400000)
}

// ─── Refs ────────────────────────────────────────────────────────────────────

export function getNextRef(
  existingInvoices: { ref: string | null; entity: string }[],
  entity: string,
  prefix: string
): string {
  const matching = existingInvoices.filter(
    i => i.entity === entity && i.ref?.startsWith(prefix + '-')
  )
  let max = 0
  matching.forEach(i => {
    const n = parseInt((i.ref ?? '').replace(prefix + '-', '')) || 0
    if (n > max) max = n
  })
  return `${prefix}-${String(max + 1).padStart(4, '0')}`
}

// ─── CSV Export ──────────────────────────────────────────────────────────────

export function downloadCSV(rows: string[][], filename: string): void {
  const csv = rows
    .map(row => row.map(cell => {
      const s = String(cell ?? '')
      return s.includes(',') || s.includes('"') || s.includes('\n')
        ? `"${s.replace(/"/g, '""')}"`
        : s
    }).join(','))
    .join('\n')
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

// ─── cn utility ──────────────────────────────────────────────────────────────

import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
