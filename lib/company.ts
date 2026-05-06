import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { cache } from "react";

// Active company resolution for server-side code. Reads the slug
// stamped onto the request by lib/supabase/middleware.ts, looks up the
// matching companies row, and returns it for use in queries +
// INSERT injection.
//
// Cached per-request via React's `cache` so multiple callers in the
// same render don't re-query the companies table.

export type ActiveCompany = {
  id: string;
  slug: string;
  name: string;
  legal_name: string | null;
  job_number_prefix: string;
  default_payment_provider: "quickbooks" | "stripe";
  bill_to_address: string | null;
  warehouse_address: string | null;
  from_email_quotes: string | null;
  from_email_production: string | null;
  from_email_billing: string | null;
  branding: Record<string, unknown>;
};

export const getActiveCompany = cache(async (): Promise<ActiveCompany> => {
  const slug = (await headers()).get("x-company-slug") || "hpd";
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("companies")
    .select("id, slug, name, legal_name, job_number_prefix, default_payment_provider, bill_to_address, warehouse_address, from_email_quotes, from_email_production, from_email_billing, branding")
    .eq("slug", slug)
    .single();
  if (error || !data) {
    // Fall back to HPD if the resolved slug doesn't match a row. This
    // keeps the app functional during the rollout window where new
    // hostnames might be added before the matching companies row is
    // seeded. Logged so any miss in prod is visible.
    console.warn(`[company] no row for slug "${slug}", falling back to hpd`, error);
    const { data: hpd } = await supabase
      .from("companies")
      .select("id, slug, name, legal_name, job_number_prefix, default_payment_provider, bill_to_address, warehouse_address, from_email_quotes, from_email_production, from_email_billing, branding")
      .eq("slug", "hpd")
      .single();
    if (!hpd) throw new Error("[company] no companies rows in DB — run migration 056");
    return hpd as unknown as ActiveCompany;
  }
  return data as unknown as ActiveCompany;
});

// Convenience: just the id when that's all the caller needs.
export async function getActiveCompanyId(): Promise<string> {
  return (await getActiveCompany()).id;
}
