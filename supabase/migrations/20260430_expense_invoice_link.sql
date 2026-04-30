-- Link expenses to invoices
-- Additive only — no drops or truncates

ALTER TABLE expenses ADD COLUMN IF NOT EXISTS invoice_id uuid REFERENCES invoices(id) ON DELETE SET NULL;
