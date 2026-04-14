'use client'

import { useState, useEffect, useCallback } from 'react'
import type { EmployeeProfile, BankDetails } from '@/types'

const KEY = 'ledger_employee_profiles'

export function useEmployeeProfiles() {
  const [profiles, setProfiles] = useState<EmployeeProfile[]>([])

  useEffect(() => {
    try {
      const raw = localStorage.getItem(KEY)
      setProfiles(raw ? JSON.parse(raw) : [])
    } catch { setProfiles([]) }
  }, [])

  const saveProfile = useCallback((name: string, bank: BankDetails) => {
    if (!name.trim()) return
    setProfiles(prev => {
      const key = name.trim().toLowerCase()
      const existing = prev.find(p => p.name.toLowerCase() === key)
      const entry: EmployeeProfile = {
        id: existing?.id ?? crypto.randomUUID(),
        name: name.trim(),
        accName: bank.accName ?? '',
        bankName: bank.bankName ?? '',
        sortCode: bank.sortCode ?? '',
        accNum: bank.accNum ?? '',
        iban: bank.iban ?? '',
        swift: bank.swift ?? '',
        invCompany: bank.invCompany ?? '',
        invAddr: bank.invAddr ?? '',
      }
      const next = existing
        ? prev.map(p => p.name.toLowerCase() === key ? entry : p)
        : [...prev, entry]
      localStorage.setItem(KEY, JSON.stringify(next))
      return next
    })
  }, [])

  const getProfile = useCallback((name: string): EmployeeProfile | null => {
    const key = name.trim().toLowerCase()
    return profiles.find(p => p.name.toLowerCase() === key) ?? null
  }, [profiles])

  return { profiles, saveProfile, getProfile }
}
