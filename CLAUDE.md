# AC Ledger — Claude Code Instructions

## What This Is

AC Ledger is a financial management platform built for **Actually Creative**, a creative agency operating three entities:
- **Actually Creative** (main entity)
- **419Studios**
- **RTW Records**

It handles invoices, expenses, projects, payment runs, bank reconciliation, and a public supplier submission portal. It was previously built as a single HTML file and is being rebuilt as a proper Next.js application.

## Existing Live App

- **Live URL:** https://acledger.pages.dev
- **Supplier Portal:** https://acledger.pages.dev/supplier.html
- **Supabase Project:** https://ftmqlcmqlebvbsgnkyvv.supabase.co

The existing app has real data in Supabase. Do not drop or reset any tables. All migrations should be additive only (`ALTER TABLE ... ADD COLUMN IF NOT EXISTS`).

---

## Tech Stack

| Layer | Choice | Reason |
|-------|--------|--------|
| Framework | Next.js 14 (App Router) | Full-stack, server components, API routes |
| Language | TypeScript | Type safety across a large codebase |
| Database | Supabase (existing) | Already set up with real data |
| Auth | Shared password (localStorage) + Supabase Auth ready | Simple now, extensible later |
| Styling | Tailwind CSS | Utility-first, consistent spacing |
| UI Components | shadcn/ui | Clean, accessible, unstyled base |
| Hosting | Cloudflare Pages | Current host, free tier |
| PDF Generation | react-pdf or browser print | Invoice and expense PDFs |
| Slack | Fetch to Pipedream webhook | Already working via Pipedream proxy |

---

## Design System

The current app uses a monochrome palette. Match this exactly:

```css
--ink: #1a1a1a
--paper: #f8f8f6
--cream: #f0f0ee
--rule: #e2e2e0
--muted: #9a9a9a
--green: #3a7a5a
--amber: #7a6a3a
--sidebar: #181818
```

**Fonts:**
- Display/headings: `Outfit` (600 weight)
- Monospace/labels: `JetBrains Mono`
- Body: `Outfit` (400 weight)

**Design principles:**
- Sharp corners everywhere (border-radius: 0 or 2px max)
- Dark sidebar (#181818), light main content (#f8f8f6)
- Uppercase monospace labels for all field labels and table headers
- Black top borders on cards (2-3px)
- Hover reveals action buttons on table rows
- Status badges: paid (green), pending (amber), overdue (red), draft (grey)

---

## Folder Structure

```
src/
  app/
    (auth)/
      page.tsx              # Login / first-time setup
    (app)/
      layout.tsx            # App shell with sidebar
      dashboard/page.tsx
      payable/page.tsx
      receivable/page.tsx
      balances/page.tsx
      generate/page.tsx
      scan/page.tsx
      clients/page.tsx
      projects/page.tsx
      expenses/page.tsx
      pl/page.tsx
      ageing/page.tsx
      vat/page.tsx
      templates/page.tsx
      accounts/page.tsx
      company/page.tsx
      settings/page.tsx
    supplier/page.tsx        # Public — no auth required
    api/
      slack/route.ts        # Proxy Slack webhook (CORS fix)
  components/
    layout/
      Sidebar.tsx
      Header.tsx
      AppShell.tsx
    ui/                     # shadcn components
    invoices/
      InvoiceTable.tsx
      InvoiceModal.tsx
      InvoiceRow.tsx
      PaymentSchedule.tsx
    expenses/
      ExpensesByPerson.tsx
      ExpenseModal.tsx
      ExpensePDF.tsx
    projects/
      ProjectGrid.tsx
      ProjectModal.tsx
      ProjectDetail.tsx
    accounts/
      PaymentRuns.tsx
      RunHistory.tsx
      BankReconcile.tsx
    supplier/
      SupplierForm.tsx
  hooks/
    useInvoices.ts
    useExpenses.ts
    useProjects.ts
    useAuth.ts
  lib/
    supabase.ts             # Supabase client
    supabase-server.ts      # Server-side client
    format.ts               # fmt(), fmtDate() etc
    pdf.ts                  # PDF generation helpers
    slack.ts                # Slack send helper
  types/
    index.ts                # All TypeScript types
  contexts/
    AuthContext.tsx
    ThemeContext.tsx
```

---

## Database Schema

All tables exist in Supabase. **Do not drop or recreate them.**

### `invoices`
```sql
id uuid primary key default gen_random_uuid()
type text                    -- 'payable' | 'receivable'
party text
ref text
amount numeric
currency text default '£'
due date
status text                  -- 'draft'|'pending'|'submitted'|'approved'|'sent'|'overdue'|'part-paid'|'paid'
notes text
internal text                -- team-only notes, never shown on invoice PDF
line_items jsonb             -- [{description, qty, unit, total}]
entity text default 'Actually Creative'
project_code text
project_name text
recurring boolean default false
pdf_url text                 -- Supabase Storage URL
payment_schedule jsonb       -- [{label, pct, dueDate, paid, paidDate}]
created_at timestamptz default now()
```

### `expenses`
```sql
id uuid primary key default gen_random_uuid()
employee text
date date
entity text default 'Actually Creative'
status text default 'submitted'  -- 'submitted'|'approved'|'paid'
project_code text
project_name text
notes text
line_items jsonb             -- [{description, category, amount}]
receipt_urls jsonb           -- array of Supabase Storage URLs
bank_details jsonb           -- {accName, bankName, sortCode, accNum, iban, swift, invCompany, invAddr}
total numeric default 0
created_at timestamptz default now()
```

### Supabase Storage Buckets
- `invoices` — stores uploaded PDF invoices and receipt images
  - Path pattern: `pdfs/{timestamp}-{filename}` for invoices
  - Path pattern: `receipts/{timestamp}-{filename}` for expense receipts
  - **Public bucket** — files accessible via public URL

---

## Authentication

**Current approach (implement first):**
```typescript
// Stored in localStorage
const CFG_KEY = 'ledger_cfg3'
// Config shape: { url, key, company, pass: btoa(password), slack: '', reminderDays: 3 }
// Session: sessionStorage key 'ledger_auth3' = 'ok'
```

**Future approach (scaffold but don't activate):**
- Supabase Auth with email/password
- Row Level Security (RLS) policies ready to enable
- Wrap with `AuthContext` that can switch between shared-password and Supabase Auth

---

## Key Business Logic

### Invoice Status Flow
`draft` → `submitted` → `approved` → `sent` → `paid`
Also: `pending` (default), `overdue` (auto-set when due date passes), `part-paid`

### Multi-Entity
All invoices and expenses have an `entity` field. Company settings are stored per-entity in localStorage under keys:
- `ledger_company` — Actually Creative
- `ledger_company_419` — 419Studios
- `ledger_company_rtw` — RTW Records

### PDF Generation
Invoice PDFs are generated client-side and printed via `window.print()` or downloaded. The invoice doc renders in a hidden overlay with exact A4 dimensions (794px × 1123px at 96dpi). Print CSS sets `@page { size: A4; margin: 1.5cm }`.

### Slack Integration
All Slack messages go via Pipedream (CORS proxy). The webhook URL is stored in config. The API route `api/slack/route.ts` should also proxy server-side as a fallback.

### Supplier Portal (`/supplier`)
Public page — no auth. Accepts `?project=CODE&entity=ENTITY` URL params to pre-lock fields. On submit, inserts a `draft` invoice into the `invoices` table. Supports both invoice and expense submission via a toggle.

### Payment Runs
Stored in localStorage (`ledger_pay_runs`). Each run: `{id, name, date, items: [{id, type, party, ref, amount, currency, projectLabel}], total}`. On execute, updates invoice/expense status to `paid` in Supabase.

### Bank Reconciliation
Client-side CSV parsing. Matches transactions against outstanding invoices by:
1. Reference number (green — exact match)
2. Amount (amber — possible match)
3. No match (red)

---

## Environment Variables

Create `.env.local`:
```
NEXT_PUBLIC_SUPABASE_URL=https://ftmqlcmqlebvbsgnkyvv.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZ0bXFsY21xbGVidmJzZ25reXZ2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMyMzUwNjQsImV4cCI6MjA4ODgxMTA2NH0.SZQxIaVxVjLh7_NFUf-3kfpLJgBHyYH6isFxZgu8Eec
```

---

## Build & Deploy

```bash
npm install
npm run dev          # localhost:3000
npm run build        # production build
npm run type-check   # tsc --noEmit
```

**Cloudflare Pages config:**
- Build command: `npm run build`
- Output directory: `.next`
- Use `@cloudflare/next-on-pages` adapter
- Node version: 18+

---

## Coding Standards

- All components in TypeScript with explicit prop types
- Use `async/await` not `.then()` chains
- Supabase calls always handle errors: `const { data, error } = await sb.from(...)`
- Never expose service role key — anon key only in client
- Format currency with `fmt()` helper: `'£' + n.toLocaleString('en-GB', { minimumFractionDigits: 2 })`
- Format dates with `fmtDate()`: `dd/mm/yyyy`
- All modals use the same `<Modal>` wrapper component
- Table rows show action buttons on hover only (opacity 0 → 1)
- Toast notifications for all user actions

---

## Do Not

- Drop or truncate any Supabase tables
- Change the `invoices` or `expenses` table structure without an `IF NOT EXISTS` migration
- Use the Supabase service role key anywhere in client code
- Add rounded corners greater than 2px (design system)
- Use any font other than Outfit and JetBrains Mono
- Change the dark sidebar colour (#181818)
