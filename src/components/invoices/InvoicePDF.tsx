'use client'

import { fmt, fmtDate, fmtDateLong } from '@/lib/format'
import type { Invoice, CompanySettings } from '@/types'

interface InvoicePDFProps {
  invoice: Invoice
  company: CompanySettings | null
  forPrint?: boolean
}

export function InvoicePDF({ invoice, company, forPrint = false }: InvoicePDFProps) {
  const lines = invoice.line_items ?? []
  const subtotal = lines.reduce((t, l) => t + Number(l.total), 0)
  const vatRate = parseFloat(company?.vat ?? '0') || 0
  const vatAmt = vatRate ? parseFloat((subtotal * vatRate / 100).toFixed(2)) : 0
  const total = vatRate ? subtotal + vatAmt : invoice.amount

  const isReceivable = invoice.type === 'receivable'
  const docLabel = isReceivable ? 'INVOICE' : 'BILL'

  return (
    <div
      id={forPrint ? 'invoice-doc' : undefined}
      style={{
        width: 794,
        minHeight: 1123,
        background: 'white',
        color: '#1a1a1a',
        fontFamily: 'Outfit, sans-serif',
        fontSize: 12,
        padding: 48,
        boxSizing: 'border-box',
      }}
    >
      {/* ── Header ─────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 48 }}>
        {/* Company info */}
        <div style={{ maxWidth: 300 }}>
          <p style={{ fontWeight: 600, fontSize: 18, marginBottom: 8, letterSpacing: -0.3 }}>
            {company?.name ?? invoice.entity}
          </p>
          {company?.addr && (
            <p style={{ color: '#6a6a6a', lineHeight: 1.6, whiteSpace: 'pre-line', fontSize: 11 }}>
              {company.addr}
            </p>
          )}
          {company?.email && (
            <p style={{ color: '#6a6a6a', fontSize: 11, marginTop: 4 }}>{company.email}</p>
          )}
          {company?.phone && (
            <p style={{ color: '#6a6a6a', fontSize: 11 }}>{company.phone}</p>
          )}
          {company?.vatNum && (
            <p style={{ color: '#6a6a6a', fontSize: 11, marginTop: 4 }}>
              VAT No: {company.vatNum}
            </p>
          )}
        </div>

        {/* Invoice label + meta */}
        <div style={{ textAlign: 'right' }}>
          <p style={{ fontWeight: 600, fontSize: 28, letterSpacing: -0.5, marginBottom: 12 }}>
            {docLabel}
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: 'auto auto', gap: '4px 16px', justifyContent: 'end' }}>
            <span style={{ color: '#9a9a9a', fontFamily: 'monospace', fontSize: 10, textTransform: 'uppercase', letterSpacing: 1 }}>
              Number
            </span>
            <span style={{ fontFamily: 'monospace', fontWeight: 600, fontSize: 11 }}>{invoice.ref}</span>

            <span style={{ color: '#9a9a9a', fontFamily: 'monospace', fontSize: 10, textTransform: 'uppercase', letterSpacing: 1 }}>
              Date
            </span>
            <span style={{ fontFamily: 'monospace', fontSize: 11 }}>
              {fmtDate(invoice.created_at)}
            </span>

            {invoice.due && <>
              <span style={{ color: '#9a9a9a', fontFamily: 'monospace', fontSize: 10, textTransform: 'uppercase', letterSpacing: 1 }}>
                Due
              </span>
              <span style={{ fontFamily: 'monospace', fontSize: 11, fontWeight: invoice.status === 'overdue' ? 700 : 400, color: invoice.status === 'overdue' ? '#dc2626' : '#1a1a1a' }}>
                {fmtDate(invoice.due)}
              </span>
            </>}

            {invoice.project_code && <>
              <span style={{ color: '#9a9a9a', fontFamily: 'monospace', fontSize: 10, textTransform: 'uppercase', letterSpacing: 1 }}>
                Project
              </span>
              <span style={{ fontFamily: 'monospace', fontSize: 11 }}>{invoice.project_code}</span>
            </>}
          </div>
        </div>
      </div>

      {/* Divider */}
      <div style={{ borderTop: '2px solid #1a1a1a', marginBottom: 32 }} />

      {/* ── Bill To / From ─────────────────────────────────────────── */}
      <div style={{ marginBottom: 40 }}>
        <p style={{ fontFamily: 'monospace', fontSize: 10, textTransform: 'uppercase', letterSpacing: 1.5, color: '#9a9a9a', marginBottom: 6 }}>
          {isReceivable ? 'Bill To' : 'Invoice From'}
        </p>
        <p style={{ fontWeight: 600, fontSize: 14 }}>{invoice.party}</p>
        {invoice.project_name && (
          <p style={{ color: '#6a6a6a', fontSize: 11, marginTop: 2 }}>{invoice.project_name}</p>
        )}
      </div>

      {/* ── Line Items ─────────────────────────────────────────────── */}
      <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 24 }}>
        <thead>
          <tr style={{ borderBottom: '1.5px solid #1a1a1a' }}>
            <th style={{ textAlign: 'left', fontFamily: 'monospace', fontSize: 10, textTransform: 'uppercase', letterSpacing: 1, color: '#9a9a9a', paddingBottom: 6, fontWeight: 500 }}>
              Description
            </th>
            <th style={{ textAlign: 'right', fontFamily: 'monospace', fontSize: 10, textTransform: 'uppercase', letterSpacing: 1, color: '#9a9a9a', paddingBottom: 6, fontWeight: 500, width: 50 }}>
              Qty
            </th>
            <th style={{ textAlign: 'right', fontFamily: 'monospace', fontSize: 10, textTransform: 'uppercase', letterSpacing: 1, color: '#9a9a9a', paddingBottom: 6, fontWeight: 500, width: 90 }}>
              Unit
            </th>
            <th style={{ textAlign: 'right', fontFamily: 'monospace', fontSize: 10, textTransform: 'uppercase', letterSpacing: 1, color: '#9a9a9a', paddingBottom: 6, fontWeight: 500, width: 90 }}>
              Total
            </th>
          </tr>
        </thead>
        <tbody>
          {lines.length > 0 ? lines.map((line, i) => (
            <tr key={i} style={{ borderBottom: '1px solid #e2e2e0' }}>
              <td style={{ padding: '10px 0', fontSize: 12 }}>{line.description}</td>
              <td style={{ padding: '10px 0', textAlign: 'right', fontFamily: 'monospace', fontSize: 11 }}>{line.qty}</td>
              <td style={{ padding: '10px 0', textAlign: 'right', fontFamily: 'monospace', fontSize: 11 }}>
                {fmt(line.unit, invoice.currency)}
              </td>
              <td style={{ padding: '10px 0', textAlign: 'right', fontFamily: 'monospace', fontSize: 11, fontWeight: 600 }}>
                {fmt(line.total, invoice.currency)}
              </td>
            </tr>
          )) : (
            <tr style={{ borderBottom: '1px solid #e2e2e0' }}>
              <td colSpan={4} style={{ padding: '10px 0', fontSize: 12, color: '#9a9a9a' }}>
                {invoice.notes ?? 'Services rendered'}
              </td>
            </tr>
          )}
        </tbody>
      </table>

      {/* ── Totals ─────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 40 }}>
        <div style={{ width: 220 }}>
          {lines.length > 0 && (
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid #e2e2e0' }}>
              <span style={{ fontFamily: 'monospace', fontSize: 10, textTransform: 'uppercase', letterSpacing: 1, color: '#9a9a9a' }}>Subtotal</span>
              <span style={{ fontFamily: 'monospace', fontSize: 11 }}>{fmt(subtotal, invoice.currency)}</span>
            </div>
          )}
          {vatRate > 0 && (
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid #e2e2e0' }}>
              <span style={{ fontFamily: 'monospace', fontSize: 10, textTransform: 'uppercase', letterSpacing: 1, color: '#9a9a9a' }}>VAT ({vatRate}%)</span>
              <span style={{ fontFamily: 'monospace', fontSize: 11 }}>{fmt(vatAmt, invoice.currency)}</span>
            </div>
          )}
          <div style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 0', borderTop: '2px solid #1a1a1a' }}>
            <span style={{ fontFamily: 'monospace', fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, fontWeight: 700 }}>Total Due</span>
            <span style={{ fontFamily: 'monospace', fontSize: 14, fontWeight: 700 }}>{fmt(total, invoice.currency)}</span>
          </div>
        </div>
      </div>

      {/* ── Notes ──────────────────────────────────────────────────── */}
      {invoice.notes && (
        <div style={{ marginBottom: 32 }}>
          <p style={{ fontFamily: 'monospace', fontSize: 10, textTransform: 'uppercase', letterSpacing: 1.5, color: '#9a9a9a', marginBottom: 6 }}>
            Notes
          </p>
          <p style={{ fontSize: 11, lineHeight: 1.7, color: '#4a4a4a', whiteSpace: 'pre-line' }}>
            {invoice.notes}
          </p>
        </div>
      )}

      {/* ── Bank / Payment Details ──────────────────────────────────── */}
      {isReceivable && (company?.bankName || company?.sortCode) && (
        <div style={{ marginBottom: 32, background: '#f8f8f6', padding: 16, borderLeft: '3px solid #1a1a1a' }}>
          <p style={{ fontFamily: 'monospace', fontSize: 10, textTransform: 'uppercase', letterSpacing: 1.5, color: '#9a9a9a', marginBottom: 10 }}>
            Payment Details
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr', gap: '4px 0', fontSize: 11 }}>
            {company?.accName && <><span style={{ color: '#9a9a9a' }}>Account name</span><span style={{ fontWeight: 600 }}>{company.accName}</span></>}
            {company?.bankName && <><span style={{ color: '#9a9a9a' }}>Bank</span><span>{company.bankName}</span></>}
            {company?.sortCode && <><span style={{ color: '#9a9a9a' }}>Sort code</span><span style={{ fontFamily: 'monospace' }}>{company.sortCode}</span></>}
            {company?.accNum && <><span style={{ color: '#9a9a9a' }}>Account no.</span><span style={{ fontFamily: 'monospace' }}>{company.accNum}</span></>}
            {company?.iban && <><span style={{ color: '#9a9a9a' }}>IBAN</span><span style={{ fontFamily: 'monospace' }}>{company.iban}</span></>}
            {company?.swift && <><span style={{ color: '#9a9a9a' }}>SWIFT/BIC</span><span style={{ fontFamily: 'monospace' }}>{company.swift}</span></>}
          </div>
        </div>
      )}

      {/* ── Terms ──────────────────────────────────────────────────── */}
      {company?.terms && (
        <div style={{ borderTop: '1px solid #e2e2e0', paddingTop: 16 }}>
          <p style={{ fontFamily: 'monospace', fontSize: 10, textTransform: 'uppercase', letterSpacing: 1.5, color: '#9a9a9a', marginBottom: 4 }}>
            Terms &amp; Conditions
          </p>
          <p style={{ fontSize: 10, color: '#9a9a9a', lineHeight: 1.6 }}>{company.terms}</p>
        </div>
      )}
    </div>
  )
}
