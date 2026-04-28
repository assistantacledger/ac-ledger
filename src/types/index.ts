// ─── Entities ───────────────────────────────────────────────────────────────

export type Entity = 'Actually Creative' | '419Studios' | 'RTW Records'

export const ENTITIES: Entity[] = ['Actually Creative', '419Studios', 'RTW Records']

export const ENTITY_STORAGE_KEYS: Record<Entity, string> = {
  'Actually Creative': 'ledger_company',
  '419Studios': 'ledger_company_419',
  'RTW Records': 'ledger_company_rtw',
}

// ─── Invoices ────────────────────────────────────────────────────────────────

export type InvoiceType = 'payable' | 'receivable'

export type InvoiceStatus =
  | 'draft'
  | 'pending'
  | 'submitted'
  | 'approved'
  | 'sent'
  | 'overdue'
  | 'part-paid'
  | 'paid'

export interface LineItem {
  description: string
  qty: number
  unit: number
  total: number
  vatAmt?: number
}

export interface PaymentInstalment {
  label: string
  pct: number
  dueDate: string
  paid: boolean
  paidDate?: string
}

export interface Invoice {
  id: string
  type: InvoiceType
  party: string
  ref: string
  amount: number
  currency: string
  due: string | null
  status: InvoiceStatus
  notes: string | null
  internal: string | null
  line_items: LineItem[] | null
  entity: Entity
  project_code: string | null
  project_name: string | null
  recurring: boolean
  pdf_url: string | null
  payment_schedule: PaymentInstalment[] | null
  bank_details?: BankDetails | null
  created_at: string
}

export type InvoiceInsert = Omit<Invoice, 'id' | 'created_at'>
export type InvoiceUpdate = Partial<InvoiceInsert>

// ─── Expenses ────────────────────────────────────────────────────────────────

export type ExpenseStatus = 'submitted' | 'approved' | 'paid'

export interface ExpenseLineItem {
  description: string
  category: 'Meals' | 'Travel' | 'Accommodation' | 'Equipment' | 'Other'
  amount: number
}

export interface BankDetails {
  accName: string
  bankName?: string
  sortCode: string
  accNum: string
  iban?: string
  swift?: string
  invCompany?: string
  invAddr?: string
}

export interface Expense {
  id: string
  employee: string
  date: string
  entity: Entity
  status: ExpenseStatus
  project_code: string | null
  project_name: string | null
  notes: string | null
  line_items: ExpenseLineItem[] | null
  receipt_urls: string[] | null
  bank_details: BankDetails | null
  total: number
  created_at: string
}

export type ExpenseInsert = Omit<Expense, 'id' | 'created_at'>
export type ExpenseUpdate = Partial<ExpenseInsert>

// ─── Projects ────────────────────────────────────────────────────────────────

export type ProjectStatus = 'active' | 'completed' | 'on-hold'

export interface Project {
  code: string
  name: string
  entity: Entity
  date: string
  budget: number
  status: ProjectStatus
  notes: string
  createdAt: string
}

// ─── Company Settings ────────────────────────────────────────────────────────

export interface CompanySettings {
  name: string
  addr: string
  email: string
  phone: string
  vatNum: string
  bankName: string
  sortCode: string
  accNum: string
  accName: string
  iban: string
  swift: string
  bankAddr: string
  terms: string
  vat: string
  prefix: string
}

// ─── Auth / Config ───────────────────────────────────────────────────────────

export interface AppConfig {
  url: string
  key: string
  company: string
  pass: string        // btoa(password)
  slack: string       // Pipedream or direct webhook URL
  reminderDays: number
  anthropicKey?: string
}

// ─── Payment Runs ────────────────────────────────────────────────────────────

export interface PayRunItem {
  id: string
  type: 'invoice' | 'expense'
  party: string
  ref: string
  amount: number
  currency: string
  projectLabel: string
}

export interface PayRun {
  id: string
  name: string
  date: string
  items: PayRunItem[]
  total: number
}

// ─── Invoice Templates ───────────────────────────────────────────────────────

export interface InvoiceTemplate {
  id: string
  name: string
  entity: Entity
  toName: string
  toAddr: string
  notes: string
  vat: string
  projectCode: string
  projectName: string
  items: LineItem[]
  createdAt: string
}

// ─── Project Notes / Files / Costs ───────────────────────────────────────────

export interface ProjectNote {
  id: string
  text: string
  createdAt: string
}

export interface ProjectFile {
  id: string
  name: string
  url: string
  type: 'image' | 'pdf'
  uploadedAt: string
  path: string  // storage path for deletion
}

export type CostCategory = 'Equipment' | 'Travel' | 'Crew' | 'Talent' | 'Venue' | 'Software' | 'Marketing' | 'Other'
export type CostStatus = 'planned' | 'confirmed' | 'paid'

export interface ProjectCost {
  id: string
  description: string
  category: CostCategory
  estimated: number
  actual: number
  status: CostStatus
  notes: string
  dueDate?: string   // ISO date string — highlights in red if overdue and not paid
  receiptUrl?: string
  receiptPath?: string
  receiptType?: 'image' | 'pdf'
  isEmployeeCost?: boolean
  employeeName?: string
  expenseId?: string  // Supabase expense ID once created
}

// ─── Employee Profiles ───────────────────────────────────────────────────────

export interface EmployeeProfile {
  id: string
  name: string
  accName: string
  bankName: string
  sortCode: string
  accNum: string
  iban: string
  swift: string
  invCompany: string
  invAddr: string
}

// ─── Audit Log ───────────────────────────────────────────────────────────────

export interface AuditEntry {
  action: string
  detail: string
  ts: string
}
