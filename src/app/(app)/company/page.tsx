'use client'

import { useState, useEffect } from 'react'
import { Header } from '@/components/layout/Header'
import { cn } from '@/lib/format'
import type { Entity, CompanySettings } from '@/types'
import { ENTITIES, ENTITY_STORAGE_KEYS } from '@/types'

const ENTITY_DEFAULTS: Record<Entity, Partial<CompanySettings>> = {
  'Actually Creative': { prefix: 'AC', name: 'Actually Creative' },
  '419Studios': { prefix: '419', name: '419Studios' },
  'RTW Records': { prefix: 'RTW', name: 'RTW Records' },
}

const BLANK: CompanySettings = {
  name: '', addr: '', email: '', phone: '', vatNum: '',
  bankName: '', sortCode: '', accNum: '', accName: '',
  iban: '', swift: '', bankAddr: '',
  terms: 'Payment due within 30 days of invoice date. Please reference invoice number when paying.',
  vat: '20', prefix: '',
}

function load(entity: Entity): CompanySettings {
  try {
    const raw = localStorage.getItem(ENTITY_STORAGE_KEYS[entity])
    return raw ? JSON.parse(raw) : { ...BLANK, ...ENTITY_DEFAULTS[entity] }
  } catch {
    return { ...BLANK, ...ENTITY_DEFAULTS[entity] }
  }
}

interface FieldProps {
  label: string
  value: string
  onChange: (v: string) => void
  type?: string
  mono?: boolean
  placeholder?: string
}
function Field({ label, value, onChange, type = 'text', mono, placeholder }: FieldProps) {
  return (
    <div>
      <label className="field-label">{label}</label>
      <input
        type={type}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        className={cn(
          'w-full border border-rule bg-paper px-3 py-2 text-sm text-ink focus:outline-none focus:border-ink',
          mono && 'font-mono'
        )}
      />
    </div>
  )
}

export default function CompanyPage() {
  const [entity, setEntity] = useState<Entity>('Actually Creative')
  const [form, setForm] = useState<CompanySettings>(() => load('Actually Creative'))
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    setForm(load(entity))
    setSaved(false)
  }, [entity])

  function set<K extends keyof CompanySettings>(key: K, val: string) {
    setSaved(false)
    setForm(f => ({ ...f, [key]: val }))
  }

  function save() {
    localStorage.setItem(ENTITY_STORAGE_KEYS[entity], JSON.stringify(form))
    setSaved(true)
    setTimeout(() => setSaved(false), 2500)
  }

  return (
    <>
      <Header title="Company Settings" />
      <main className="flex-1 overflow-y-auto px-6 py-6">
        <div className="max-w-2xl">

          {/* Entity tabs */}
          <div className="flex border-b border-rule mb-6">
            {ENTITIES.map(e => (
              <button
                key={e}
                onClick={() => setEntity(e)}
                className={cn(
                  'px-5 py-2.5 font-mono text-xs uppercase tracking-wider border-b-2 -mb-px transition-colors',
                  entity === e
                    ? 'border-ink text-ink'
                    : 'border-transparent text-muted hover:text-ink'
                )}
              >
                {e === 'Actually Creative' ? 'Actually Creative' : e}
              </button>
            ))}
          </div>

          <div className="space-y-5">
            {/* Company Info */}
            <div className="s-section">
              <p className="tbl-lbl mb-4">Company Info</p>
              <div className="grid grid-cols-2 gap-4">
                <div className="col-span-2">
                  <Field label="Company Name" value={form.name} onChange={v => set('name', v)} />
                </div>
                <div className="col-span-2">
                  <label className="field-label">Address</label>
                  <textarea
                    value={form.addr}
                    onChange={e => set('addr', e.target.value)}
                    rows={3}
                    placeholder="123 Studio Road&#10;London&#10;W1A 1AA"
                    className="w-full border border-rule bg-paper px-3 py-2 text-sm text-ink focus:outline-none focus:border-ink resize-none"
                  />
                </div>
                <Field label="Email" value={form.email} onChange={v => set('email', v)} type="email" />
                <Field label="Phone" value={form.phone} onChange={v => set('phone', v)} type="tel" />
                <Field label="VAT Number" value={form.vatNum} onChange={v => set('vatNum', v)} mono placeholder="GB123456789" />
                <Field label="Default VAT Rate (%)" value={form.vat} onChange={v => set('vat', v)} mono placeholder="20" />
                <Field label="Invoice Prefix" value={form.prefix} onChange={v => set('prefix', v)} mono placeholder="AC" />
              </div>
            </div>

            {/* Bank Details */}
            <div className="s-section">
              <p className="tbl-lbl mb-4">Bank Details</p>
              <div className="grid grid-cols-2 gap-4">
                <Field label="Account Name" value={form.accName} onChange={v => set('accName', v)} />
                <Field label="Bank Name" value={form.bankName} onChange={v => set('bankName', v)} />
                <Field label="Sort Code" value={form.sortCode} onChange={v => set('sortCode', v)} mono placeholder="00-00-00" />
                <Field label="Account Number" value={form.accNum} onChange={v => set('accNum', v)} mono placeholder="12345678" />
                <Field label="IBAN" value={form.iban} onChange={v => set('iban', v)} mono placeholder="GB00XXXX00000000000000" />
                <Field label="SWIFT / BIC" value={form.swift} onChange={v => set('swift', v)} mono placeholder="XXXXGB22" />
                <div className="col-span-2">
                  <label className="field-label">Bank Address</label>
                  <textarea
                    value={form.bankAddr}
                    onChange={e => set('bankAddr', e.target.value)}
                    rows={2}
                    className="w-full border border-rule bg-paper px-3 py-2 text-sm text-ink focus:outline-none focus:border-ink resize-none"
                  />
                </div>
              </div>
            </div>

            {/* Terms */}
            <div className="s-section">
              <p className="tbl-lbl mb-4">Invoice Terms</p>
              <label className="field-label">Default Terms &amp; Conditions</label>
              <textarea
                value={form.terms}
                onChange={e => set('terms', e.target.value)}
                rows={4}
                className="w-full border border-rule bg-paper px-3 py-2 text-sm text-ink focus:outline-none focus:border-ink resize-none"
              />
            </div>
          </div>

          <div className="flex items-center gap-3 mt-6">
            <button
              onClick={save}
              className={cn(
                'px-5 py-2.5 text-xs font-mono uppercase tracking-wider transition-colors',
                saved ? 'bg-ac-green text-white' : 'bg-ink text-white hover:bg-[#333]'
              )}
            >
              {saved ? 'Saved!' : `Save ${entity === 'Actually Creative' ? 'AC' : entity} Settings`}
            </button>
          </div>
        </div>
      </main>
    </>
  )
}
