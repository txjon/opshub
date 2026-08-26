import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getActiveCompanyId } from "@/lib/company";
import ReconciliationClient from "../reconciliation/ReconciliationClient";

// BILLS — the Office's money-OUT surface (Financial V2 Phase 2, Aug 25 2026).
// /billing + /reconciliation are ONE surface; what renders is derived from
// WHO you are, not which URL you typed:
//   full powers  — is_god, a /reconciliation grant, or legacy owner/manager
//                  fallback → queue + history + freight + hours + Variances
//   billing-only — a /billing grant (Abigail): bill entry + history + inline
//                  per-line variance, no aggregate margin view
// /reconciliation now redirects here; grants of either route reach both via
// the V2 twin pair.
export default async function BillsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { data: profile } = await supabase
    .from("profiles").select("role, is_god, page_access").eq("id", user.id).single();
  const pageAccess: string[] | null = (profile as any)?.page_access ?? null;
  const hasExplicit = Array.isArray(pageAccess) && pageAccess.length > 0;
  const fullPowers = (profile as any)?.is_god === true
    || (hasExplicit
      ? pageAccess!.includes("/reconciliation")
      : ["owner", "manager"].includes((profile as any)?.role || ""));
  const companyId = await getActiveCompanyId();
  return <ReconciliationClient companyId={companyId} billingOnly={!fullPowers} />;
}
