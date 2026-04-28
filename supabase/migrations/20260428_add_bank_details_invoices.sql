-- Add bank_details column to invoices table
-- Run this in the Supabase SQL editor at:
-- https://ftmqlcmqlebvbsgnkyvv.supabase.co/project/default/sql

ALTER TABLE invoices ADD COLUMN IF NOT EXISTS bank_details jsonb;
