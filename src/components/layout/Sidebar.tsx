'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/format'
import {
  LayoutDashboard, ArrowUp, ArrowDown, Scale, FileText,
  ScanLine, Users, FolderOpen, Receipt, TrendingUp,
  Clock, Percent, LayoutTemplate, Landmark, Building2, Settings
} from 'lucide-react'

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

export function Sidebar() {
  const pathname = usePathname()

  return (
    <nav className="flex flex-col">
      <NavSection label="Client" items={CLIENT_NAV} pathname={pathname} />
      <NavSection label="Internal" items={INTERNAL_NAV} pathname={pathname} />
      <NavSection label="Settings" items={SETTINGS_NAV} pathname={pathname} />
    </nav>
  )
}

function NavSection({
  label,
  items,
  pathname,
}: {
  label: string
  items: typeof CLIENT_NAV
  pathname: string
}) {
  return (
    <div>
      <p className="font-mono text-[10px] uppercase tracking-widest text-[#444] px-5 pt-4 pb-1">
        {label}
      </p>
      {items.map(({ href, label, icon: Icon }) => {
        const active = pathname === href || pathname.startsWith(href + '/')
        return (
          <Link
            key={href}
            href={href}
            className={cn(
              'flex items-center gap-2.5 px-5 py-2 text-sm font-medium transition-all border-l-2',
              active
                ? 'text-white border-[#888] bg-white/[0.06]'
                : 'text-[#888] border-transparent hover:text-[#ddd] hover:bg-white/[0.04]'
            )}
          >
            <Icon size={15} className="flex-shrink-0" />
            <span>{label}</span>
          </Link>
        )
      })}
    </div>
  )
}
