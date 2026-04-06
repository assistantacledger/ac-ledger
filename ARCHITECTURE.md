# AC Ledger — Architecture Decision Records (ADR)

## ADR-001: Next.js App Router over Pages Router

**Status:** Accepted  
**Date:** 2024

**Context:** Rebuilding a single-file HTML app into a proper codebase.

**Decision:** Use Next.js 14 with the App Router.

**Reasons:**
- Server Components reduce client-side JavaScript for data-heavy pages like invoice tables
- Nested layouts allow the sidebar to persist without re-rendering
- API routes replace the Netlify/Cloudflare function we use for the Slack CORS proxy
- Better TypeScript integration out of the box

**Consequences:**
- Learning curve if unfamiliar with React Server Components
- `use client` directive needed for interactive components (modals, forms, charts)

---

## ADR-002: Supabase as Database (Keep Existing)

**Status:** Accepted

**Context:** The app already has live data in Supabase with real invoices and expenses.

**Decision:** Keep the existing Supabase project. All schema changes must be additive only.

**Migration rules:**
- Always use `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`
- Never use `DROP TABLE`, `TRUNCATE`, or `DROP COLUMN`
- All new tables get RLS policies from day one (even if not enforced yet)

**Client setup:**
```typescript
// lib/supabase.ts — browser client
import { createClient } from '@supabase/supabase-js'
export const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

// lib/supabase-server.ts — server component client
import { createServerClient } from '@supabase/ssr'
```

---

## ADR-003: Shared Password Auth First, Supabase Auth Ready

**Status:** Accepted

**Context:** The current app uses a shared team password stored as `btoa(password)` in localStorage. Per-user logins are desired in the future but not immediately needed.

**Decision:** Implement shared password auth to match current behaviour, but architect the `AuthContext` so that swapping to Supabase Auth requires minimal changes.

**Implementation:**
```typescript
// contexts/AuthContext.tsx
type AuthMode = 'shared-password' | 'supabase-auth'

interface AuthContext {
  isAuthenticated: boolean
  login: (password: string) => Promise<boolean>
  logout: () => void
  mode: AuthMode
}
```

**To activate Supabase Auth later:** change `mode` to `'supabase-auth'` and implement the Supabase Auth methods. The rest of the app doesn't need to change.

---

## ADR-004: Client-side PDF Generation

**Status:** Accepted

**Context:** Invoice and expense PDFs need to look professional and print cleanly to A4.

**Decision:** Use browser `window.print()` with print CSS for now. The invoice renders in a full-screen overlay with exact A4 dimensions. Long-term, consider `@react-pdf/renderer` for true PDF generation.

**Print CSS pattern:**
```css
@media print {
  @page { size: A4; margin: 1.5cm; }
  body * { visibility: hidden; }
  #invoice-doc, #invoice-doc * { visibility: visible; }
  #invoice-doc { position: fixed; inset: 0; padding: 1.5cm; }
}
```

**A4 dimensions at 96dpi:** 794px × 1123px

---

## ADR-005: Slack via API Route (CORS Proxy)

**Status:** Accepted

**Context:** Direct browser-to-Slack fetch calls are blocked by CORS. The current workaround uses Pipedream as a middleman.

**Decision:** Add a Next.js API route that proxies Slack messages server-side. This eliminates the Pipedream dependency.

```typescript
// app/api/slack/route.ts
export async function POST(req: Request) {
  const { webhookUrl, text } = await req.json()
  const res = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text })
  })
  return Response.json({ ok: res.ok })
}
```

**Note:** The Pipedream URL currently stored in user config still works. The new API route (`/api/slack`) is preferred going forward.

---

## ADR-006: Multi-Entity Architecture

**Status:** Accepted

**Context:** The app manages three companies: Actually Creative, 419Studios, and RTW Records. Each has separate branding, bank details, and invoice numbering.

**Decision:** Entity is a field on every invoice and expense. Company settings are stored per-entity in localStorage. No separate database tables per entity.

**Entity keys:**
```typescript
const ENTITY_KEYS = {
  'Actually Creative': 'ledger_company',
  '419Studios': 'ledger_company_419',
  'RTW Records': 'ledger_company_rtw',
} as const

type Entity = keyof typeof ENTITY_KEYS
```

**Future:** If entities need truly separate data isolation, add Supabase RLS policies filtering by entity.

---

## ADR-007: localStorage for User Preferences and Run History

**Status:** Accepted

**Context:** Payment run history, company settings, employee profiles, invoice templates, and saved projects are stored in localStorage. This means they are device-specific.

**Decision:** Keep localStorage for these non-critical preferences. They don't need to be shared across devices for now.

**Keys in use:**
```
ledger_cfg3              — Supabase credentials + password + Slack webhook
ledger_auth3             — Session token (sessionStorage)
ledger_company           — Actually Creative settings
ledger_company_419       — 419Studios settings  
ledger_company_rtw       — RTW Records settings
ledger_pay_runs          — Payment run history
ledger_templates_v1      — Invoice templates
ledger_projects_v2       — Saved projects
ledger_emp_profiles      — Employee bank detail profiles
ledger_dark              — Dark mode preference
ledger_audit             — Audit log (last 200 entries)
```

**Future:** Move to Supabase tables when per-user isolation is needed.

---

## ADR-008: Cloudflare Pages Deployment

**Status:** Accepted

**Context:** Currently hosted on Cloudflare Pages as a static HTML file. Next.js requires a build adapter.

**Decision:** Use `@cloudflare/next-on-pages` to deploy Next.js to Cloudflare Pages.

**cloudflare.json / wrangler config:**
```json
{
  "name": "ac-ledger",
  "compatibility_date": "2024-01-01",
  "pages_build_output_dir": ".vercel/output/static"
}
```

**Alternative:** Vercel is simpler for Next.js deployment if Cloudflare causes issues. The codebase is hosting-agnostic.

---

## ADR-009: Feature Flags for Incremental Rollout

**Status:** Proposed

**Context:** Moving from a working single-file app to a full rebuild carries risk. Some features are more complex to rebuild than others.

**Decision:** Implement a simple feature flag system so features can be enabled/disabled without code changes.

```typescript
// lib/flags.ts
export const FLAGS = {
  SUPPLIER_PORTAL: true,
  BANK_RECONCILIATION: true,
  PDF_SCANNER: true,        // Requires Anthropic API key
  SUPABASE_AUTH: false,     // Not yet activated
  RECURRING_INVOICES: true,
} as const
```

---

## Feature Inventory

Full list of features to implement, in priority order:

### P0 — Core (must work on day 1)
- [ ] Login (shared password)
- [ ] Dashboard with stats
- [ ] To Pay (payable invoices)
- [ ] Incoming (receivable invoices)
- [ ] Add / Edit / Delete invoice
- [ ] Mark invoice as paid
- [ ] Balances page

### P1 — Important
- [ ] Generate Invoice (A4 PDF)
- [ ] Company settings (per entity)
- [ ] Projects page with Create Project
- [ ] Expenses — person view, add/edit/delete
- [ ] Expense reimbursement PDF invoice
- [ ] Payment schedule (instalments)
- [ ] Duplicate invoice
- [ ] Dark mode

### P2 — Full Feature Set
- [ ] Scan PDFs (AI extraction via Anthropic API)
- [ ] Client address book
- [ ] Supplier portal (public `/supplier` page)
- [ ] AC Accounts + Payments (payment runs + history)
- [ ] Bank reconciliation (CSV upload)
- [ ] Invoice ageing report
- [ ] VAT report
- [ ] Invoice templates
- [ ] P&L summary
- [ ] Slack integration

### P3 — Nice to Have
- [ ] Invoice approval flow
- [ ] Audit log viewer
- [ ] Employee profiles (auto-fill bank details)
- [ ] Move invoice ↔ expense
- [ ] Recurring invoice scheduler
- [ ] Supabase Auth (per-user logins)
