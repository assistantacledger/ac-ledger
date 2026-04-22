'use client'

import { useState, useEffect } from 'react'
import { cn } from '@/lib/format'
import { TOAST_EVENT, type ToastEvent } from '@/lib/toast'
import { CheckCircle, XCircle, Info, X } from 'lucide-react'

interface Toast extends ToastEvent {
  exiting: boolean
}

export function ToastContainer() {
  const [toasts, setToasts] = useState<Toast[]>([])

  useEffect(() => {
    function handler(e: Event) {
      const { id, message, type } = (e as CustomEvent<ToastEvent>).detail
      setToasts(prev => [...prev, { id, message, type, exiting: false }])
      // Start fade-out after 2.7s, remove after 3s
      setTimeout(() => {
        setToasts(prev => prev.map(t => t.id === id ? { ...t, exiting: true } : t))
      }, 2700)
      setTimeout(() => {
        setToasts(prev => prev.filter(t => t.id !== id))
      }, 3100)
    }
    window.addEventListener(TOAST_EVENT, handler)
    return () => window.removeEventListener(TOAST_EVENT, handler)
  }, [])

  if (toasts.length === 0) return null

  return (
    <div className="fixed bottom-5 right-5 z-[100] flex flex-col gap-2 items-end pointer-events-none">
      {toasts.map(t => (
        <div
          key={t.id}
          className={cn(
            'flex items-center gap-2.5 px-4 py-2.5 bg-ink text-white font-mono text-xs shadow-lg transition-all duration-300 pointer-events-auto max-w-xs',
            t.exiting ? 'opacity-0 translate-y-1' : 'opacity-100 translate-y-0'
          )}
        >
          {t.type === 'success' && <CheckCircle size={13} className="text-ac-green flex-shrink-0" />}
          {t.type === 'error' && <XCircle size={13} className="text-red-400 flex-shrink-0" />}
          {t.type === 'info' && <Info size={13} className="text-blue-400 flex-shrink-0" />}
          <span className="flex-1">{t.message}</span>
          <button
            onClick={() => setToasts(prev => prev.filter(x => x.id !== t.id))}
            className="text-white/50 hover:text-white transition-colors ml-1"
          >
            <X size={11} />
          </button>
        </div>
      ))}
    </div>
  )
}
