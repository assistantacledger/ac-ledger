'use client'

import { useAuth } from '@/contexts/AuthContext'
import { useTheme } from '@/contexts/ThemeContext'
import { LogOut, Sun, Moon } from 'lucide-react'

interface HeaderProps {
  title: string
  subtitle?: string
}

export function Header({ title, subtitle }: HeaderProps) {
  const { logout, config } = useAuth()
  const { theme, toggle } = useTheme()

  return (
    <header className="h-12 bg-white border-b border-rule flex items-center justify-between px-6 flex-shrink-0">
      <div className="flex items-center gap-3">
        <h2 className="font-sans font-semibold text-sm text-ink">{title}</h2>
        {subtitle && (
          <span className="font-mono text-xs text-muted uppercase tracking-wider">{subtitle}</span>
        )}
      </div>
      <div className="flex items-center gap-4">
        {config?.company && (
          <span className="font-mono text-xs uppercase tracking-widest text-muted">
            {config.company}
          </span>
        )}
        <button
          onClick={toggle}
          className="text-muted hover:text-ink transition-colors"
          title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
        >
          {theme === 'dark' ? <Sun size={14} /> : <Moon size={14} />}
        </button>
        <button
          onClick={logout}
          className="flex items-center gap-1.5 font-mono text-xs uppercase tracking-wider text-muted hover:text-ink transition-colors"
        >
          <LogOut size={12} />
          Sign out
        </button>
      </div>
    </header>
  )
}
