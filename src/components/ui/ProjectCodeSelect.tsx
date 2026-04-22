'use client'

import { useState, useRef, useEffect } from 'react'
import { Search, X } from 'lucide-react'
import { cn } from '@/lib/format'

interface Option { code: string; name: string }

interface Props {
  value: string | null
  onChange: (code: string | null, name: string | null) => void
  options: Option[]
  placeholder?: string
  className?: string
  disabled?: boolean
}

export function ProjectCodeSelect({ value, onChange, options, placeholder = 'Select project…', className, disabled }: Props) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const containerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const filtered = options.filter(o =>
    !query || o.code.toLowerCase().includes(query.toLowerCase()) || o.name.toLowerCase().includes(query.toLowerCase())
  )

  const selected = value ? options.find(o => o.code === value) : null

  useEffect(() => {
    function outside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
        setQuery('')
      }
    }
    document.addEventListener('mousedown', outside)
    return () => document.removeEventListener('mousedown', outside)
  }, [])

  function select(opt: Option | null) {
    onChange(opt?.code ?? null, opt?.name ?? null)
    setOpen(false)
    setQuery('')
  }

  function handleToggle() {
    if (disabled) return
    setOpen(o => !o)
    setTimeout(() => inputRef.current?.focus(), 50)
  }

  return (
    <div ref={containerRef} className={cn('relative', className)}>
      {/* Trigger */}
      <button
        type="button"
        onClick={handleToggle}
        disabled={disabled}
        className={cn(
          'w-full flex items-center justify-between border border-rule bg-white px-3 py-2 text-sm font-mono text-left focus:outline-none focus:border-ink transition-colors disabled:opacity-50',
          open && 'border-ink'
        )}
      >
        <span className={selected ? 'text-ink' : 'text-muted'}>
          {selected ? `${selected.code} — ${selected.name}` : placeholder}
        </span>
        {value && (
          <span
            role="button"
            tabIndex={0}
            onClick={e => { e.stopPropagation(); select(null) }}
            onKeyDown={e => e.key === 'Enter' && select(null)}
            className="ml-2 text-muted hover:text-ink"
          >
            <X size={12} />
          </span>
        )}
      </button>

      {/* Dropdown */}
      {open && (
        <div className="absolute z-50 top-full left-0 right-0 mt-0.5 bg-white border border-rule shadow-lg max-h-56 flex flex-col">
          {/* Search */}
          <div className="flex items-center border-b border-rule px-2 py-1.5 gap-1.5">
            <Search size={11} className="text-muted flex-shrink-0" />
            <input
              ref={inputRef}
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Search…"
              className="flex-1 text-xs font-mono text-ink focus:outline-none bg-transparent"
              onKeyDown={e => {
                if (e.key === 'Escape') { setOpen(false); setQuery('') }
                if (e.key === 'Enter' && filtered.length === 1) select(filtered[0])
              }}
            />
          </div>
          {/* Options */}
          <div className="overflow-y-auto">
            {value && (
              <button
                onClick={() => select(null)}
                className="w-full text-left px-3 py-2 text-xs font-mono text-muted hover:bg-cream transition-colors"
              >
                — Clear
              </button>
            )}
            {filtered.length === 0 ? (
              <p className="px-3 py-2 text-xs font-mono text-muted">No matches</p>
            ) : (
              filtered.map(o => (
                <button
                  key={o.code}
                  onClick={() => select(o)}
                  className={cn(
                    'w-full text-left px-3 py-2 text-xs font-mono hover:bg-cream transition-colors',
                    o.code === value ? 'bg-cream/80 text-ink font-semibold' : 'text-ink'
                  )}
                >
                  <span className="text-muted mr-2">{o.code}</span>
                  {o.name !== o.code && o.name}
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  )
}
