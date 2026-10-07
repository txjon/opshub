-- 197: one row per QuickBooks payment per invoice (Oct 7 2026).
--
-- The QB webhook and manual sync dedupe with check-then-insert on
-- (qb_payment_id, qb_invoice_id). An Intuit retry that lands before the first
-- insert commits slips past the check: the payment is recorded twice, and
-- since the client_paid production email it's emailed twice too. The database
-- now refuses the second row; the routes treat that refusal as "already
-- recorded". Rows without a QB payment id (legacy, manual) are unaffected.
-- Pre-check: 120 rows carry a QB payment id, 0 duplicate pairs.
create unique index if not exists uq_payment_records_qb_payment_invoice
  on payment_records(qb_payment_id, qb_invoice_id)
  where qb_payment_id is not null;
notify pgrst, 'reload schema';
