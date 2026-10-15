// THE STUDIO API GUARD (Oct 15 2026). Every /api/studio/* route reads through
// the service role, so sign-in alone let ANY account in: a retired-tenant
// login (IHM), staff with no Studio access, stray e2e test users. This is
// the one gate, and unlike the page middleware it FAILS CLOSED: a missing
// profile, a read error or no membership all mean no.
//
// A user passes when they are:
//   1. signed in,
//   2. an active member of the company this request is for (host → slug),
//   3. granted The Studio OR Projects (job detail embeds the work-order
//      panels that call /api/studio/work-orders and /briefs).
//
// Returns the user, or null. Routes keep their own `if (!user)` handling,
// so a refusal reads as a 401 everywhere.
import type { User } from "@supabase/supabase-js";
import { createClient as createAdmin } from "@supabase/supabase-js";
import { canAccessKey } from "@/lib/access";

const STUDIO_KEYS = ["/studio", "/jobs"];

export async function studioUser(supabase: { auth: { getUser: () => Promise<{ data: { user: User | null } }> } }): Promise<User | null> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  try {
    const db = createAdmin(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
    const { getActiveCompanyId } = await import("@/lib/company");   // request-scoped (headers)
    return (await studioAllowed(db, user.id, await getActiveCompanyId())) ? user : null;
  } catch {
    return null;
  }
}

// The decision itself, request-free so it can be checked against real accounts.
export async function studioAllowed(db: any, userId: string, companyId: string): Promise<boolean> {
  const [{ data: prof, error: pe }, { data: mem, error: me }] = await Promise.all([
    db.from("profiles").select("role, is_god, page_access").eq("id", userId).maybeSingle(),
    db.from("user_company_memberships").select("user_id").eq("user_id", userId).eq("company_id", companyId).eq("is_active", true).limit(1),
  ]);
  if (pe || me || !prof || !mem?.length) return false;
  const who = { role: prof.role, isGod: prof.is_god === true, pageAccess: prof.page_access };
  return STUDIO_KEYS.some(k => canAccessKey(k, who));
}
