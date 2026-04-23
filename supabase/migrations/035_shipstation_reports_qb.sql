ALTER TABLE shipstation_reports
  ADD COLUMN IF NOT EXISTS qb_invoice_id text,
  ADD COLUMN IF NOT EXISTS qb_invoice_number text,
  ADD COLUMN IF NOT EXISTS qb_payment_link text,
  ADD COLUMN IF NOT EXISTS qb_tax_amount numeric(14, 4),
  ADD COLUMN IF NOT EXISTS qb_total_with_tax numeric(14, 4),
  ADD COLUMN IF NOT EXISTS qb_invoice_created_at timestamptz,
  ADD COLUMN IF NOT EXISTS qb_invoice_updated_at timestamptz,
  ADD COLUMN IF NOT EXISTS sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS sent_to text[];

CREATE INDEX IF NOT EXISTS shipstation_reports_qb_invoice_idx
  ON shipstation_reports(qb_invoice_id)
  WHERE qb_invoice_id IS NOT NULL;
