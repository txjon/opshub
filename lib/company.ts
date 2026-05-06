import { headers } from "next/headers";
import { createClient as createAdminClient } from "@supabase/supabase-js";
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
  departments: string[];
  drive_folder_id: string | null;
};

// Same Host → slug map as lib/supabase/middleware.ts. Used as a
// fallback when x-company-slug isn't on the request — that header is
// only stamped on routes that go through middleware, and /api/* is
// explicitly excluded so API routes have to derive the slug from the
// Host themselves.
function slugFromHost(host: string | null): string {
  if (!host) return "hpd";
  const h = host.toLowerCase().split(":")[0];
  if (h === "app.inhousemerchandise.com" || h === "ihm.localhost") return "ihm";
  return "hpd";
}

export const getActiveCompany = cache(async (): Promise<ActiveCompany> => {
  const h = await headers();
  const slug = h.get("x-company-slug") || slugFromHost(h.get("host"));
  // Service-role client: companies branding is essentially public config
  // (name, address, emails, logos) and the slug is already trust-checked
  // by middleware (or derived from the request Host). Using anon + RLS
  // here breaks internal flows that have no auth cookie — the email-
  // send → /api/pdf/quote chain calls with x-internal-key, no user
  // session, and RLS denies the companies read → PDF gen fails.
  const supabase = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
  const { data, error } = await supabase
    .from("companies")
    .select("id, slug, name, legal_name, job_number_prefix, default_payment_provider, bill_to_address, warehouse_address, from_email_quotes, from_email_production, from_email_billing, branding, departments, drive_folder_id")
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
      .select("id, slug, name, legal_name, job_number_prefix, default_payment_provider, bill_to_address, warehouse_address, from_email_quotes, from_email_production, from_email_billing, branding, departments, drive_folder_id")
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
