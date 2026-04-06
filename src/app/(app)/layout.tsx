'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/contexts/AuthContext'
import { Sidebar } from '@/components/layout/Sidebar'

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, config } = useAuth()
  const router = useRouter()

  useEffect(() => {
    // Wait for hydration — config will be null on first render (SSR)
    // Only redirect once we know auth state has been read from storage
    if (typeof window === 'undefined') return
    if (!isAuthenticated) {
      router.replace('/')
    }
  }, [isAuthenticated, router])

  // Render a blank shell while auth state loads or redirect is in-flight
  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-paper flex items-center justify-center">
        <div className="w-5 h-5 border-2 border-ink border-t-transparent animate-spin" />
      </div>
    )
  }

  return (
    <div className="flex h-screen overflow-hidden bg-paper">
      {/* Sidebar */}
      <div className="flex flex-col bg-sidebar w-48 flex-shrink-0 border-r border-[#1a1a1a]">
        {/* Logo strip */}
        <div className="h-12 flex items-center px-5 border-b border-[#252525] flex-shrink-0">
          <span className="font-sans font-semibold text-white text-sm tracking-tight">AC Ledger</span>
        </div>
        <div className="flex-1 overflow-y-auto">
          <Sidebar />
        </div>
      </div>

      {/* Main content */}
      <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
        {children}
      </div>
    </div>
  )
}
