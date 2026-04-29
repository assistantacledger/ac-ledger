'use client'

import { useState, useEffect } from 'react'
import { X, Save } from 'lucide-react'
import type { EmployeeProfile, BankDetails } from '@/types'

interface Props {
  name: string
  existing: EmployeeProfile | null
  onSave: (name: string, bank: BankDetails) => void
  onClose: () => void
}

const BLANK: BankDetails = {
  accName: '', bankName: '', sortCode: '', accNum: '',
  iban: '', swift: '', invCompany: '', invAddr: '',
}

function Field({ label, value, onChange, multiline, placeholder }: {
  label: string
  value: string
  onChange: (v: string) => void
  multiline?: boolean
  placeholder?: string
}) {
  return (
    <div>
      <label className="field-label">{label}</label>
      {multiline ? (
        <textarea
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder={placeholder}
          rows={3}
          className="w-full border border-rule bg-white px-2 py-1.5 text-xs text-ink focus:outline-none focus:border-ink font-mono resize-none"
        />
      ) : (
        <input
          type="text"
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder={placeholder}
          className="w-full border border-rule bg-white px-2 py-1.5 text-xs text-ink focus:outline-none focus:border-ink font-mono"
        />
      )}
    </div>
  )
}

export function EditProfileModal({ name, existing, onSave, onClose }: Props) {
  const [form, setForm] = useState<BankDetails>(BLANK)

  useEffect(() => {
    if (existing) {
      setForm({
        accName: existing.accName ?? '',
        bankName: existing.bankName ?? '',
        sortCode: existing.sortCode ?? '',
        accNum: existing.accNum ?? '',
        iban: existing.iban ?? '',
        swift: existing.swift ?? '',
        invCompany: existing.invCompany ?? '',
        invAddr: existing.invAddr ?? '',
      })
    } else {
      setForm(BLANK)
    }
  }, [existing])

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [onClose])

  function set(field: keyof BankDetails, val: string) {
    setForm(f => ({ ...f, [field]: val }))
  }

  function handleSave() {
    onSave(name, form)
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-end" onClick={onClose}>
      <div
        className="h-full w-full max-w-md bg-white shadow-2xl flex flex-col border-l border-rule overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-rule flex-shrink-0 bg-cream">
          <div>
            <h2 className="font-display text-sm font-semibold text-ink">Edit Profile</h2>
            <p className="font-mono text-[10px] text-muted mt-0.5">{name}</p>
          </div>
          <button onClick={onClose} className="p-1 text-muted hover:text-ink transition-colors">
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 p-5 space-y-5 overflow-y-auto">
          {/* Invoice details */}
          <div>
            <p className="font-mono text-[10px] uppercase tracking-wider text-muted mb-3 pb-1 border-b border-rule">Invoice Details</p>
            <div className="space-y-3">
              <Field label="Full Name" value={name} onChange={() => {}} placeholder={name} />
              <Field label="Company / Trading Name" value={form.invCompany ?? ''} onChange={v => set('invCompany', v)} placeholder="e.g. Acme Ltd" />
              <Field label="Address" value={form.invAddr ?? ''} onChange={v => set('invAddr', v)} multiline placeholder={'123 Example St\nLondon\nSW1A 1AA'} />
            </div>
          </div>

          {/* Bank details */}
          <div>
            <p className="font-mono text-[10px] uppercase tracking-wider text-muted mb-3 pb-1 border-b border-rule">Bank Details</p>
            <div className="space-y-3">
              <Field label="Account Name" value={form.accName} onChange={v => set('accName', v)} placeholder="As shown on bank account" />
              <Field label="Bank Name" value={form.bankName ?? ''} onChange={v => set('bankName', v)} placeholder="e.g. Barclays" />
              <div className="grid grid-cols-2 gap-3">
                <Field label="Sort Code" value={form.sortCode} onChange={v => set('sortCode', v)} placeholder="00-00-00" />
                <Field label="Account Number" value={form.accNum} onChange={v => set('accNum', v)} placeholder="12345678" />
              </div>
              <Field label="IBAN" value={form.iban ?? ''} onChange={v => set('iban', v)} placeholder="GB00 XXXX 0000 0000 0000 00" />
              <Field label="SWIFT / BIC" value={form.swift ?? ''} onChange={v => set('swift', v)} placeholder="BARCGB22" />
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 py-4 border-t border-rule flex-shrink-0 bg-cream flex items-center justify-end gap-3">
          <button onClick={onClose} className="font-mono text-xs px-3 py-1.5 border border-rule text-muted hover:text-ink hover:border-ink transition-colors">
            Cancel
          </button>
          <button onClick={handleSave}
            className="font-mono text-xs px-4 py-1.5 bg-ink text-white hover:bg-[#333] transition-colors flex items-center gap-1.5">
            <Save size={12} /> Save Profile
          </button>
        </div>
      </div>
    </div>
  )
}
