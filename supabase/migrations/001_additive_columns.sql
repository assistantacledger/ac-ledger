-- AC Ledger — Additive migrations only
-- Run these in Supabase SQL Editor
-- NEVER drop or truncate tables

-- Add any missing columns to invoices
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS currency text DEFAULT '£';
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS internal text;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS recurring boolean DEFAULT false;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS entity text DEFAULT 'Actually Creative';
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS project_code text;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS project_name text;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS pdf_url text;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS payment_schedule jsonb;

-- Add any missing columns to expenses
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS bank_details jsonb;

-- Expenses table (create only if it doesn't exist)
CREATE TABLE IF NOT EXISTS expenses (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  employee text,
  date date,
  entity text DEFAULT 'Actually Creative',
  status text DEFAULT 'submitted',
  project_code text,
  project_name text,
  notes text,
  line_items jsonb,
  receipt_urls jsonb,
  bank_details jsonb,
  total numeric DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

-- Storage bucket (run in Supabase dashboard Storage section, not SQL)
-- Bucket name: invoices
-- Public: true
-- Policies:
--   Allow public uploads: INSERT with check (bucket_id = 'invoices')
--   Allow public reads: SELECT using (bucket_id = 'invoices')
