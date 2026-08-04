-- Projects table
CREATE TABLE IF NOT EXISTS projects (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  code text UNIQUE NOT NULL,
  name text NOT NULL,
  entity text DEFAULT 'Actually Creative',
  status text DEFAULT 'active',
  start_date date,
  budget numeric DEFAULT 0,
  notes text,
  created_at timestamptz DEFAULT now()
);

-- Project costs table
CREATE TABLE IF NOT EXISTS project_costs (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  project_code text NOT NULL,
  description text,
  category text DEFAULT 'Other',
  estimated numeric DEFAULT 0,
  actual numeric DEFAULT 0,
  qty numeric DEFAULT 1,
  unit_price numeric DEFAULT 0,
  status text DEFAULT 'planned',
  due_date date,
  employee_name text,
  is_employee_expense boolean DEFAULT false,
  receipt_url text,
  receipt_path text,
  receipt_type text,
  expense_id uuid,
  invoice_id uuid,
  notes text,
  sort_order integer DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

-- Project notes table
CREATE TABLE IF NOT EXISTS project_notes (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  project_code text NOT NULL,
  text text,
  created_at timestamptz DEFAULT now()
);

-- Project files table
CREATE TABLE IF NOT EXISTS project_files (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  project_code text NOT NULL,
  name text,
  url text,
  type text,
  path text,
  uploaded_at timestamptz DEFAULT now(),
  created_at timestamptz DEFAULT now()
);

-- Project whiteboards table (one row per project)
CREATE TABLE IF NOT EXISTS project_whiteboards (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  project_code text UNIQUE NOT NULL,
  elements jsonb DEFAULT '[]'::jsonb,
  updated_at timestamptz DEFAULT now(),
  created_at timestamptz DEFAULT now()
);
