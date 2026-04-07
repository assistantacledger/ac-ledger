'use client'

import { useEffect, useRef, useState } from 'react'
import { X, Printer } from 'lucide-react'
import { InvoicePDF } from './InvoicePDF'
import { fmtDate } from '@/lib/format'
import type { Invoice, CompanySettings, Entity } from '@/types'
import { ENTITY_STORAGE_KEYS } from '@/types'

interface Props {
  invoice: Invoice | null
  onClose: () => void
}

function loadCompany(entity: Entity): CompanySettings | null {
  try {
    const raw = localStorage.getItem(ENTITY_STORAGE_KEYS[entity])
    return raw ? JSON.parse(raw) : null
  } catch { return null }
}

export function InvoicePreviewModal({ invoice, onClose }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [scale, setScale] = useState(0.75)
  const [company, setCompany] = useState<CompanySettings | null>(null)

  useEffect(() => {
    if (!invoice) return
    setCompany(loadCompany(invoice.entity as Entity))
  }, [invoice])

  // Calculate scale to fit the content area
  useEffect(() => {
    if (!invoice) return
    function calc() {
      if (!containerRef.current) return
      const w = containerRef.current.clientWidth - 48  // horizontal padding
      const h = containerRef.current.clientHeight - 48 // vertical padding
      const scaleW = w / 794
      const scaleH = h / 1123
      setScale(Math.min(scaleW, scaleH, 1))
    }
    calc()
    window.addEventListener('resize', calc)
    return () => window.removeEventListener('resize', calc)
  }, [invoice])

  // Close on Escape
  useEffect(() => {
    if (!invoice) return
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [invoice, onClose])

  if (!invoice) return null

  const label = invoice.type === 'receivable' ? 'Invoice' : 'Bill'

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col"
      style={{ background: 'rgba(10,10,10,0.85)' }}
    >
      {/* ── Hidden off-screen invoice for window.print() ─────────────────
          Must be OUTSIDE the scaled preview div (transforms trap fixed children).
          position: absolute here, print CSS overrides to position: fixed.      */}
      <div
        aria-hidden
        style={{ position: 'absolute', left: -9999, top: 0, width: 794, pointerEvents: 'none', overflow: 'hidden' }}
      >
        <InvoicePDF invoice={invoice} company={company} forPrint={true} />
      </div>

      {/* ── Toolbar ────────────────────────────────────────────────────── */}
      <div className="flex-shrink-0 flex items-center justify-between px-6 py-3 bg-sidebar border-b border-[#2a2a2a]">
        <div className="flex items-center gap-3">
          <span className="font-mono text-xs uppercase tracking-widest text-[#888]">{label}</span>
          <span className="font-mono text-xs text-white font-semibold">{invoice.ref || '—'}</span>
          {invoice.party && (
            <span className="font-mono text-xs text-[#666]">· {invoice.party}</span>
          )}
          {invoice.due && (
            <span className="font-mono text-xs text-[#666]">· Due {fmtDate(invoice.due)}</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => window.print()}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-mono uppercase tracking-wider bg-white text-ink hover:bg-cream transition-colors"
          >
            <Printer size={11} /> Print / Download PDF
          </button>
          <button
            onClick={onClose}
            className="p-1.5 text-[#666] hover:text-white transition-colors ml-1"
            aria-label="Close preview"
          >
            <X size={16} />
          </button>
        </div>
      </div>

      {/* ── Scrollable preview area ────────────────────────────────────── */}
      <div
        ref={containerRef}
        className="flex-1 overflow-auto flex items-start justify-center p-6"
        style={{ background: '#2a2a2a' }}
        onClick={e => { if (e.target === e.currentTarget) onClose() }}
      >
        <div
          style={{
            width: 794 * scale,
            height: 1123 * scale,
            flexShrink: 0,
            position: 'relative',
          }}
        >
          <div
            style={{
              transform: `scale(${scale})`,
              transformOrigin: 'top left',
              boxShadow: '0 8px 48px rgba(0,0,0,0.5)',
              position: 'absolute',
              top: 0,
              left: 0,
            }}
          >
            {/* forPrint={false} — screen preview only, no #invoice-doc id */}
            <InvoicePDF invoice={invoice} company={company} forPrint={false} />
          </div>
        </div>
      </div>
    </div>
  )
}
