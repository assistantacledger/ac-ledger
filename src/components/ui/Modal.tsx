'use client'

import { useEffect } from 'react'
import { X } from 'lucide-react'
import { cn } from '@/lib/format'

interface ModalProps {
  isOpen: boolean
  onClose: () => void
  title: string
  children: React.ReactNode
  size?: 'md' | 'lg' | 'xl' | '2xl' | '3xl'
  footer?: React.ReactNode
}

export function Modal({ isOpen, onClose, title, children, size = 'xl', footer }: ModalProps) {
  useEffect(() => {
    if (!isOpen) return
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [isOpen, onClose])

  if (!isOpen) return null

  const maxW = { md: 'max-w-md', lg: 'max-w-lg', xl: 'max-w-xl', '2xl': 'max-w-2xl', '3xl': 'max-w-3xl' }[size]

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center p-6 overflow-y-auto"
      style={{ background: 'rgba(26,26,26,0.45)', backdropFilter: 'blur(2px)' }}
      onClick={onClose}
    >
      <div
        className={cn('w-full bg-white border border-rule flex flex-col my-auto', maxW)}
        style={{ borderTopWidth: 2, borderTopColor: '#1a1a1a' }}
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-3 bg-cream border-b border-rule flex-shrink-0">
          <p className="tbl-lbl">{title}</p>
          <button onClick={onClose} className="text-muted hover:text-ink transition-colors p-0.5">
            <X size={13} />
          </button>
        </div>
        <div className="overflow-y-auto flex-1 max-h-[78vh]">
          {children}
        </div>
        {footer && (
          <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-rule bg-cream flex-shrink-0">
            {footer}
          </div>
        )}
      </div>
    </div>
  )
}
