'use client'

import { fmt, fmtDate } from '@/lib/format'
import type { Expense } from '@/types'

interface Props {
  expense: Expense
  forPrint?: boolean
}

export function ExpenseReimbursePDF({ expense, forPrint = false }: Props) {
  const bank = expense.bank_details
  const lines = expense.line_items ?? []
  const total = lines.reduce((t, l) => t + Number(l.amount), 0) || expense.total
  const fromName = bank?.invCompany || expense.employee
  const fromAddr = bank?.invAddr || ''
  const ref = `EXP-${expense.date?.replace(/-/g, '')}-${expense.employee.slice(0, 3).toUpperCase()}`

  return (
    <div
      id={forPrint ? 'expense-doc' : undefined}
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
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 48 }}>
        <div style={{ maxWidth: 300 }}>
          <p style={{ fontWeight: 600, fontSize: 18, marginBottom: 6, letterSpacing: -0.3 }}>
            {fromName}
          </p>
          {fromAddr && (
            <p style={{ color: '#6a6a6a', lineHeight: 1.6, whiteSpace: 'pre-line', fontSize: 11 }}>
              {fromAddr}
            </p>
          )}
        </div>
        <div style={{ textAlign: 'right' }}>
          <p style={{ fontWeight: 600, fontSize: 28, letterSpacing: -0.5, marginBottom: 12 }}>
            EXPENSE CLAIM
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: 'auto auto', gap: '4px 16px', justifyContent: 'end' }}>
            <span style={{ color: '#9a9a9a', fontFamily: 'monospace', fontSize: 10, textTransform: 'uppercase', letterSpacing: 1 }}>
              Ref
            </span>
            <span style={{ fontFamily: 'monospace', fontWeight: 600, fontSize: 11 }}>{ref}</span>

            <span style={{ color: '#9a9a9a', fontFamily: 'monospace', fontSize: 10, textTransform: 'uppercase', letterSpacing: 1 }}>
              Date
            </span>
            <span style={{ fontFamily: 'monospace', fontSize: 11 }}>
              {fmtDate(expense.date)}
            </span>

            {expense.project_code && <>
              <span style={{ color: '#9a9a9a', fontFamily: 'monospace', fontSize: 10, textTransform: 'uppercase', letterSpacing: 1 }}>
                Project
              </span>
              <span style={{ fontFamily: 'monospace', fontSize: 11 }}>{expense.project_code}</span>
            </>}
          </div>
        </div>
      </div>

      {/* Divider */}
      <div style={{ borderTop: '2px solid #1a1a1a', marginBottom: 32 }} />

      {/* Bill To */}
      <div style={{ marginBottom: 40 }}>
        <p style={{ fontFamily: 'monospace', fontSize: 10, textTransform: 'uppercase', letterSpacing: 1.5, color: '#9a9a9a', marginBottom: 6 }}>
          Reimbursement Requested From
        </p>
        <p style={{ fontWeight: 600, fontSize: 14 }}>{expense.entity}</p>
        {expense.project_name && (
          <p style={{ color: '#6a6a6a', fontSize: 11, marginTop: 2 }}>{expense.project_name}</p>
        )}
      </div>

      {/* Line items */}
      <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 24 }}>
        <thead>
          <tr style={{ borderBottom: '1.5px solid #1a1a1a' }}>
            <th style={{ textAlign: 'left', fontFamily: 'monospace', fontSize: 10, textTransform: 'uppercase', letterSpacing: 1, color: '#9a9a9a', paddingBottom: 6, fontWeight: 500 }}>
              Description
            </th>
            <th style={{ textAlign: 'right', fontFamily: 'monospace', fontSize: 10, textTransform: 'uppercase', letterSpacing: 1, color: '#9a9a9a', paddingBottom: 6, fontWeight: 500, width: 110 }}>
              Category
            </th>
            <th style={{ textAlign: 'right', fontFamily: 'monospace', fontSize: 10, textTransform: 'uppercase', letterSpacing: 1, color: '#9a9a9a', paddingBottom: 6, fontWeight: 500, width: 90 }}>
              Amount
            </th>
          </tr>
        </thead>
        <tbody>
          {lines.length > 0 ? lines.map((line, i) => (
            <tr key={i} style={{ borderBottom: '1px solid #e2e2e0' }}>
              <td style={{ padding: '10px 0', fontSize: 12 }}>{line.description}</td>
              <td style={{ padding: '10px 0', textAlign: 'right', fontFamily: 'monospace', fontSize: 10, color: '#9a9a9a', textTransform: 'uppercase' }}>
                {line.category}
              </td>
              <td style={{ padding: '10px 0', textAlign: 'right', fontFamily: 'monospace', fontSize: 11, fontWeight: 600 }}>
                {fmt(line.amount)}
              </td>
            </tr>
          )) : (
            <tr style={{ borderBottom: '1px solid #e2e2e0' }}>
              <td colSpan={3} style={{ padding: '10px 0', fontSize: 12, color: '#9a9a9a' }}>
                {expense.notes ?? 'Expense reimbursement'}
              </td>
            </tr>
          )}
        </tbody>
      </table>

      {/* Total */}
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 40 }}>
        <div style={{ width: 220 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 0', borderTop: '2px solid #1a1a1a' }}>
            <span style={{ fontFamily: 'monospace', fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, fontWeight: 700 }}>
              Total Due
            </span>
            <span style={{ fontFamily: 'monospace', fontSize: 14, fontWeight: 700 }}>{fmt(total)}</span>
          </div>
        </div>
      </div>

      {/* Notes */}
      {expense.notes && (
        <div style={{ marginBottom: 32 }}>
          <p style={{ fontFamily: 'monospace', fontSize: 10, textTransform: 'uppercase', letterSpacing: 1.5, color: '#9a9a9a', marginBottom: 6 }}>
            Notes
          </p>
          <p style={{ fontSize: 11, lineHeight: 1.7, color: '#4a4a4a', whiteSpace: 'pre-line' }}>
            {expense.notes}
          </p>
        </div>
      )}

      {/* Bank / Payment Details */}
      {(bank?.sortCode || bank?.accNum || bank?.iban) && (
        <div style={{ marginBottom: 32, background: '#f8f8f6', padding: 16, borderLeft: '3px solid #1a1a1a' }}>
          <p style={{ fontFamily: 'monospace', fontSize: 10, textTransform: 'uppercase', letterSpacing: 1.5, color: '#9a9a9a', marginBottom: 10 }}>
            Please Pay To
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr', gap: '4px 0', fontSize: 11 }}>
            {bank.accName && <><span style={{ color: '#9a9a9a' }}>Account name</span><span style={{ fontWeight: 600 }}>{bank.accName}</span></>}
            {bank.bankName && <><span style={{ color: '#9a9a9a' }}>Bank</span><span>{bank.bankName}</span></>}
            {bank.sortCode && <><span style={{ color: '#9a9a9a' }}>Sort code</span><span style={{ fontFamily: 'monospace' }}>{bank.sortCode}</span></>}
            {bank.accNum && <><span style={{ color: '#9a9a9a' }}>Account no.</span><span style={{ fontFamily: 'monospace' }}>{bank.accNum}</span></>}
            {bank.iban && <><span style={{ color: '#9a9a9a' }}>IBAN</span><span style={{ fontFamily: 'monospace' }}>{bank.iban}</span></>}
            {bank.swift && <><span style={{ color: '#9a9a9a' }}>SWIFT/BIC</span><span style={{ fontFamily: 'monospace' }}>{bank.swift}</span></>}
          </div>
        </div>
      )}

      {/* Footer signature line */}
      <div style={{ borderTop: '1px solid #e2e2e0', paddingTop: 24, display: 'flex', justifyContent: 'space-between', marginTop: 40 }}>
        <div>
          <p style={{ fontFamily: 'monospace', fontSize: 10, textTransform: 'uppercase', letterSpacing: 1, color: '#9a9a9a', marginBottom: 24 }}>
            Claimant Signature
          </p>
          <div style={{ borderBottom: '1px solid #1a1a1a', width: 200, marginBottom: 4 }} />
          <p style={{ fontFamily: 'monospace', fontSize: 10, color: '#9a9a9a' }}>{expense.employee}</p>
        </div>
        <div>
          <p style={{ fontFamily: 'monospace', fontSize: 10, textTransform: 'uppercase', letterSpacing: 1, color: '#9a9a9a', marginBottom: 24 }}>
            Authorised By
          </p>
          <div style={{ borderBottom: '1px solid #1a1a1a', width: 200, marginBottom: 4 }} />
          <p style={{ fontFamily: 'monospace', fontSize: 10, color: '#9a9a9a' }}>Date: _______________</p>
        </div>
      </div>
    </div>
  )
}
