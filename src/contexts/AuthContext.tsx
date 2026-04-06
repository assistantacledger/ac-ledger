'use client'

import { createContext, useContext, useState, useEffect, useCallback } from 'react'
import type { AppConfig } from '@/types'

const CFG_KEY = 'ledger_cfg3'
const AUTH_KEY = 'ledger_auth3'

interface AuthContextValue {
  isAuthenticated: boolean
  config: AppConfig | null
  login: (password: string) => boolean
  logout: () => void
  saveConfig: (config: AppConfig) => void
  resetConfig: () => void
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [isAuthenticated, setIsAuthenticated] = useState(false)
  const [config, setConfig] = useState<AppConfig | null>(null)

  useEffect(() => {
    const cfg = getConfig()
    setConfig(cfg)
    const auth = sessionStorage.getItem(AUTH_KEY)
    if (auth === 'ok' && cfg) {
      setIsAuthenticated(true)
    }
  }, [])

  const login = useCallback((password: string): boolean => {
    const cfg = getConfig()
    if (!cfg) return false
    if (btoa(password) === cfg.pass) {
      sessionStorage.setItem(AUTH_KEY, 'ok')
      setIsAuthenticated(true)
      setConfig(cfg)
      return true
    }
    return false
  }, [])

  const logout = useCallback(() => {
    sessionStorage.removeItem(AUTH_KEY)
    setIsAuthenticated(false)
  }, [])

  const saveConfig = useCallback((cfg: AppConfig) => {
    localStorage.setItem(CFG_KEY, JSON.stringify(cfg))
    setConfig(cfg)
  }, [])

  const resetConfig = useCallback(() => {
    localStorage.removeItem(CFG_KEY)
    sessionStorage.removeItem(AUTH_KEY)
    setIsAuthenticated(false)
    setConfig(null)
  }, [])

  return (
    <AuthContext.Provider value={{ isAuthenticated, config, login, logout, saveConfig, resetConfig }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getConfig(): AppConfig | null {
  try {
    const raw = localStorage.getItem(CFG_KEY)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}
