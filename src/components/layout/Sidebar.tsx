'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { cn } from '@/lib/format'
import { sb } from '@/lib/supabase'
import {
  LayoutDashboard, ArrowUp, ArrowDown, Scale, FileText,
  ScanLine, Users, FolderOpen, Receipt, TrendingUp,
  Clock, Percent, LayoutTemplate, Landmark, Building2, Settings,
  Search, Eye, EyeOff, Settings2, X,
} from 'lucide-react'

const NAV_PREFS_KEY = 'ledger_nav_prefs'

const CLIENT_NAV = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/payable', label: 'To Pay', icon: ArrowUp },
  { href: '/receivable', label: 'Incoming', icon: ArrowDown },
  { href: '/balances', label: 'Balances', icon: Scale },
  { href: '/generate', label: 'Generate', icon: FileText },
  { href: '/scan', label: 'Scan PDFs', icon: ScanLine },
  { href: '/clients', label: 'Clients', icon: Users },
]

const INTERNAL_NAV = [
  { href: '/projects', label: 'Projects', icon: FolderOpen },
  { href: '/expenses', label: 'Expenses', icon: Receipt },
  { href: '/pl', label: 'P&L', icon: TrendingUp },
  { href: '/ageing', label: 'Ageing', icon: Clock },
  { href: '/vat', label: 'VAT Report', icon: Percent },
  { href: '/templates', label: 'Templates', icon: LayoutTemplate },
  { href: '/accounts', label: 'AC Accounts', icon: Landmark },
]

const SETTINGS_NAV = [
  { href: '/company', label: 'Company', icon: Building2 },
  { href: '/settings', label: 'Slack', icon: Settings },
]

// ─── Search ───────────────────────────────────────────────────────────────────

type SearchResult =
  | { kind: 'invoice'; id: string; label: string; sub: string; href: string }
  | { kind: 'expense'; id: string; label: string; sub: string; href: string }
  | { kind: 'project'; id: string; label: string; sub: string; href: string }

function useSearch(query: string) {
  const [results, setResults] = useState<SearchResult[]>([])
  const [loading, setLoading] = useState(false)

  const run = useCallback(async (q: string) => {
    if (!q.trim()) { setResults([]); return }
    setLoading(true)
    try {
      const qLow = q.toLowerCase()

      // Projects from localStorage
      const projResults: SearchResult[] = []
      for (const key of ['ledger_projects', 'ledger_projects_v2']) {
        try {
          const raw = localStorage.getItem(key)
          if (!raw) continue
          const projs = JSON.parse(raw) as Array<{ code: string; name: string; status: string }>
          for (const p of projs) {
            if (p.code?.toLowerCase().includes(qLow) || p.name?.toLowerCase().includes(qLow)) {
              if (!projResults.find(r => r.id === p.code)) {
                projResults.push({ kind: 'project', id: p.code, label: p.name, sub: p.code, href: `/projects?open=${p.code}` })
              }
            }
          }
        } catch { /* ignore */ }
      }

      // Invoices + expenses from Supabase
      const [{ data: invs }, { data: exps }] = await Promise.all([
        sb.from('invoices').select('id,type,party,ref,amount,status,project_code').or(
          `party.ilike.%${q}%,ref.ilike.%${q}%,project_code.ilike.%${q}%`
        ).limit(8),
        sb.from('expenses').select('id,employee,total,status,project_code').or(
          `employee.ilike.%${q}%,project_code.ilike.%${q}%`
        ).limit(5),
      ])

      const invResults: SearchResult[] = (invs ?? []).map(i => ({
        kind: 'invoice' as const,
        id: i.id,
        label: i.party,
        sub: `${i.ref ?? ''} · ${i.status}`,
        href: `/${i.type}`,
      }))

      const expResults: SearchResult[] = (exps ?? []).map(e => ({
        kind: 'expense' as const,
        id: e.id,
        label: e.employee,
        sub: `£${Number(e.total).toFixed(2)} · ${e.status}`,
        href: '/expenses',
      }))

      setResults([...projResults.slice(0, 4), ...invResults, ...expResults])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    const t = setTimeout(() => run(query), 250)
    return () => clearTimeout(t)
  }, [query, run])

  return { results, loading }
}

function GlobalSearch() {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const { results, loading } = useSearch(query)
  const router = useRouter()
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  function select(r: SearchResult) {
    router.push(r.href)
    setQuery('')
    setOpen(false)
  }

  const kindLabel = { invoice: 'INV', expense: 'EXP', project: 'PRJ' }
  const kindCls = { invoice: 'text-blue-400', expense: 'text-amber-400', project: 'text-green-400' }

  return (
    <div ref={ref} className="px-4 py-3 border-b border-[#2a2a2a] relative">
      <div className="relative">
        <Search size={11} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[#555]" />
        <input
          type="text"
          value={query}
          onChange={e => { setQuery(e.target.value); setOpen(true) }}
          onFocus={() => setOpen(true)}
          placeholder="Search…"
          className="w-full pl-7 pr-2 py-1.5 text-xs bg-[#222] border border-[#2a2a2a] text-[#ccc] placeholder:text-[#555] focus:outline-none focus:border-[#555] font-mono"
        />
        {query && (
          <button onClick={() => { setQuery(''); setOpen(false) }} className="absolute right-2 top-1/2 -translate-y-1/2 text-[#555] hover:text-[#aaa]">
            <X size={10} />
          </button>
        )}
      </div>
      {open && query && (
        <div className="absolute left-4 right-4 top-full mt-0.5 z-50 bg-[#1e1e1e] border border-[#333] shadow-xl max-h-64 overflow-y-auto">
          {loading && <p className="px-3 py-2 font-mono text-[10px] text-[#555]">Searching…</p>}
          {!loading && results.length === 0 && <p className="px-3 py-2 font-mono text-[10px] text-[#555]">No results</p>}
          {results.map(r => (
            <button key={r.id} onClick={() => select(r)}
              className="w-full flex items-start gap-2 px-3 py-2 hover:bg-white/[0.06] transition-colors text-left border-b border-[#2a2a2a] last:border-0">
              <span className={cn('font-mono text-[9px] font-bold mt-0.5 flex-shrink-0', kindCls[r.kind])}>
                {kindLabel[r.kind]}
              </span>
              <div className="min-w-0">
                <p className="text-xs text-[#ddd] truncate">{r.label}</p>
                <p className="font-mono text-[10px] text-[#666] truncate">{r.sub}</p>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Main Sidebar ─────────────────────────────────────────────────────────────

export function Sidebar() {
  const pathname = usePathname()
  const [customizing, setCustomizing] = useState(false)
  const [hidden, setHidden] = useState<Set<string>>(new Set())

  useEffect(() => {
    try {
      const raw = localStorage.getItem(NAV_PREFS_KEY)
      if (raw) setHidden(new Set(JSON.parse(raw) as string[]))
    } catch { /* ignore */ }
  }, [])

  function toggleHide(href: string) {
    setHidden(prev => {
      const next = new Set(prev)
      if (next.has(href)) next.delete(href)
      else next.add(href)
      try { localStorage.setItem(NAV_PREFS_KEY, JSON.stringify(Array.from(next))) } catch { /* ignore */ }
      return next
    })
  }

  return (
    <nav className="flex flex-col flex-1 overflow-y-auto">
      <GlobalSearch />

      <div className="flex-1">
        <NavSection label="Client" items={CLIENT_NAV} pathname={pathname} hidden={hidden} customizing={customizing} onToggle={toggleHide} />
        <NavSection label="Internal" items={INTERNAL_NAV} pathname={pathname} hidden={hidden} customizing={customizing} onToggle={toggleHide} />
        <NavSection label="Settings" items={SETTINGS_NAV} pathname={pathname} hidden={hidden} customizing={customizing} onToggle={toggleHide} />
      </div>

      {/* Customize toggle */}
      <div className="border-t border-[#2a2a2a] px-5 py-3">
        <button
          onClick={() => setCustomizing(c => !c)}
          className={cn(
            'flex items-center gap-2 font-mono text-[10px] uppercase tracking-widest transition-colors',
            customizing ? 'text-[#ddd]' : 'text-[#444] hover:text-[#888]'
          )}
        >
          <Settings2 size={11} />
          {customizing ? 'Done' : 'Customise'}
        </button>
      </div>
    </nav>
  )
}

function NavSection({
  label, items, pathname, hidden, customizing, onToggle,
}: {
  label: string
  items: typeof CLIENT_NAV
  pathname: string
  hidden: Set<string>
  customizing: boolean
  onToggle: (href: string) => void
}) {
  return (
    <div>
      <p className="font-mono text-[10px] uppercase tracking-widest text-[#444] px-5 pt-4 pb-1">
        {label}
      </p>
      {items.map(({ href, label, icon: Icon }) => {
        const isActive = pathname === href || pathname.startsWith(href + '/')
        const isHidden = hidden.has(href) && !isActive

        if (isHidden && !customizing) return null

        return (
          <div key={href} className="flex items-center group/row">
            <Link
              href={href}
              className={cn(
                'flex items-center gap-2.5 px-5 py-2 text-sm font-medium transition-all border-l-2 flex-1 min-w-0',
                isActive
                  ? 'text-white border-[#888] bg-white/[0.06]'
                  : hidden.has(href)
                    ? 'text-[#555] border-transparent hover:text-[#888]'
                    : 'text-[#888] border-transparent hover:text-[#ddd] hover:bg-white/[0.04]',
              )}
            >
              <Icon size={15} className="flex-shrink-0" />
              <span className="truncate">{label}</span>
            </Link>
            {customizing && (
              <button
                onClick={() => onToggle(href)}
                title={hidden.has(href) ? 'Show item' : 'Hide item'}
                className="pr-3 text-[#444] hover:text-[#888] transition-colors flex-shrink-0"
              >
                {hidden.has(href) ? <EyeOff size={12} /> : <Eye size={12} />}
              </button>
            )}
          </div>
        )
      })}
    </div>
  )
}
