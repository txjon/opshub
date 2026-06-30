import { getActiveCompanyId } from "@/lib/company";
import ReconciliationClient from "../reconciliation/ReconciliationClient";

// Billing — the bookkeeper's surface (Abigail). Renders the SAME component as
// /reconciliation with billingOnly: New Bill entry + Bill History + per-line
// INLINE variance (so she flags mis-bills) + QB push, but WITHOUT the aggregate
// Variances / margin view (that stays owner-only on /reconciliation). One source
// of truth — no forked billing UI.
export default async function BillingPage() {
  const companyId = await getActiveCompanyId();
  return <ReconciliationClient companyId={companyId} billingOnly />;
}
