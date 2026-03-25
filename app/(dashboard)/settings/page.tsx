import { createClient } from "@/lib/supabase/server";
import { createClient as createAdmin } from "@supabase/supabase-js";
import { redirect } from "next/navigation";
import SettingsClient from "./SettingsClient";

export default async function SettingsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase.from("profiles").select("*").eq("id", user.id).single();
  if (profile?.role !== "manager") redirect("/dashboard");

  // Use service role to access auth.users for emails
  const admin = createAdmin(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const { data: profiles } = await admin.from("profiles").select("*").order("created_at");

  // Fetch user emails via admin auth API
  const { data: { users: authUsers } } = await admin.auth.admin.listUsers();
  const emailMap = new Map(authUsers?.map(u => [u.id, u.email]) || []);

  const enriched = (profiles || []).map(p => ({
    ...p,
    email: emailMap.get(p.id) || null,
  }));

  return <SettingsClient profiles={enriched} currentUserId={user.id} />;
}
