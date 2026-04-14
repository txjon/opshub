import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { DashboardShell } from "@/components/DashboardShell";
import { AppShell } from "@/components/AppShell";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .single();

  const role = profile?.role ?? "viewer";
  const isOwner = role === "owner";
  // Departments derived from role — no separate DB column needed
  const ROLE_DEPARTMENTS: Record<string, string[]> = {
    owner: ["owner", "labs", "distro", "contacts", "settings"],
    ops: ["labs", "distro", "contacts"],
    warehouse: ["distro"],
    viewer: ["labs", "distro", "contacts"],
    // Legacy roles — map gracefully
    manager: ["owner", "labs", "distro", "contacts", "settings"],
    staff: ["labs", "distro", "contacts"],
  };
  const departments: string[] = ROLE_DEPARTMENTS[role] || [];
  const extraAccess: string[] = profile?.extra_access || [];

  return (
    <>
      <AppShell
        email={user.email || ""}
        role={role}
        isOwner={isOwner}
        departments={departments}
        extraAccess={extraAccess}
        userId={user.id}
      >
        {children}
      </AppShell>
      <DashboardShell userId={user.id} />
    </>
  );
}
