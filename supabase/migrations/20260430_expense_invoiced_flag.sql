-- Mark expenses as invoiced (independent of invoice linkage)
-- Additive only — no drops or truncates

ALTER TABLE expenses ADD COLUMN IF NOT EXISTS invoiced boolean DEFAULT false;
