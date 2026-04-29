'use client'

import { useEffect } from 'react'
import { X, ExternalLink } from 'lucide-react'

interface Props {
  url: string
  name?: string
  onClose: () => void
}

function isPDF(url: string): boolean {
  return url.toLowerCase().includes('.pdf') || url.includes('application/pdf')
}

export function FilePreviewOverlay({ url, name, onClose }: Props) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [onClose])

  const pdf = isPDF(url)

  return (
    <div className="fixed inset-0 z-[60] flex flex-col" style={{ background: 'rgba(0,0,0,0.92)' }} onClick={onClose}>
      {/* Header bar */}
      <div
        className="flex items-center justify-between px-6 py-3 flex-shrink-0 border-b border-white/10"
        onClick={e => e.stopPropagation()}
      >
        <span className="font-mono text-xs text-white/60 truncate max-w-[60%]">{name ?? url.split('/').pop()}</span>
        <div className="flex items-center gap-4">
          <a href={url} target="_blank" rel="noopener noreferrer"
            className="font-mono text-xs text-white/60 hover:text-white transition-colors flex items-center gap-1.5">
            <ExternalLink size={13} /> Open in new tab
          </a>
          <button onClick={onClose} className="text-white/60 hover:text-white transition-colors">
            <X size={18} />
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-hidden" onClick={e => e.stopPropagation()}>
        {pdf ? (
          <iframe
            src={url}
            className="w-full h-full border-0 bg-white"
            title={name ?? 'Document'}
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center p-6">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={url}
              alt={name ?? 'Preview'}
              className="max-w-full max-h-full object-contain cursor-zoom-in"
              onClick={e => { e.stopPropagation(); window.open(url, '_blank') }}
            />
          </div>
        )}
      </div>
    </div>
  )
}
