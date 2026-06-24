import { getActiveCompanyId } from "@/lib/company";
import ReconciliationClient from "./ReconciliationClient";

// Server wrapper: resolves the active company (from request host/slug) and scopes the
// reconciliation board to it, so HPD's KPIs never include other tenants' jobs (e.g. IHM).
export default async function ReconciliationPage() {
  const companyId = await getActiveCompanyId();
  return <ReconciliationClient companyId={companyId} />;
}
