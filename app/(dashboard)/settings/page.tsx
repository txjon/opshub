import { createClient } from "@/lib/supabase/server";
import { createClient as createAdmin } from "@supabase/supabase-js";
import { redirect } from "next/navigation";
import SettingsClient from "./SettingsClient";
import { getActiveCompany } from "@/lib/company";

export default async function SettingsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase.from("profiles").select("*").eq("id", user.id).single();
  if (!["manager", "owner"].includes(profile?.role)) redirect("/dashboard");

  const company = await getActiveCompany();

  // Service-role client to read auth.users emails (which the regular
  // anon client can't see). Tenant scoping is enforced in app code
  // here since service-role bypasses RLS — we filter profiles to
  // only those with an active membership for the current tenant.
  const admin = createAdmin(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

  const { data: memberships } = await admin
    .from("user_company_memberships")
    .select("user_id")
    .eq("company_id", company.id)
    .eq("is_active", true);
  const memberIds = new Set((memberships || []).map((m: any) => m.user_id));

  const { data: allProfiles } = await admin.from("profiles").select("*").order("created_at");
  const profiles = (allProfiles || []).filter((p: any) => memberIds.has(p.id));

  const { data: { users: authUsers } } = await admin.auth.admin.listUsers();
  const emailMap = new Map(authUsers?.map(u => [u.id, u.email]) || []);

  const enriched = profiles.map(p => ({
    ...p,
    email: emailMap.get(p.id) || null,
  }));

  return <SettingsClient profiles={enriched} currentUserId={user.id} />;
}
