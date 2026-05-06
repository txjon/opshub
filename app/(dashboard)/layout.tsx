import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { DashboardShell } from "@/components/DashboardShell";
import { AppShell } from "@/components/AppShell";
import { getActiveCompany } from "@/lib/company";

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
  const isGod = profile?.is_god === true;

  // Active company — derived from request hostname by middleware.
  const company = await getActiveCompany();

  // Tenant gate — verify the user has access to the active company.
  // Gods bypass the membership check (they own both tenants).
  if (!isGod) {
    const { data: membership } = await supabase
      .from("user_company_memberships")
      .select("id")
      .eq("user_id", user.id)
      .eq("company_id", company.id)
      .eq("is_active", true)
      .maybeSingle();
    if (!membership) {
      // User authenticated but doesn't belong to this tenant. Send them
      // to /login (which will bounce back to wherever they're allowed).
      redirect("/login?error=no_access");
    }
  }

  // Departments come from two sources, intersected:
  //   1. ROLE → which depts the user's role grants access to
  //   2. COMPANY → which depts this tenant actually runs (HPD has all,
  //      IHM only runs labs at launch, etc.)
  // Final list is the intersection so an HPD ops user who's also in
  // IHM via god mode sees only Labs on the IHM domain.
  const ROLE_DEPARTMENTS: Record<string, string[]> = {
    owner: ["owner", "labs", "distro", "ecomm", "contacts", "settings"],
    ops: ["labs", "distro", "ecomm", "contacts"],
    warehouse: ["distro"],
    viewer: ["labs", "distro", "ecomm", "contacts"],
    manager: ["owner", "labs", "distro", "ecomm", "contacts", "settings"],
    staff: ["labs", "distro", "ecomm", "contacts"],
  };
  const roleDepts = ROLE_DEPARTMENTS[role] || [];
  // "owner" + "settings" are app-wide capabilities, not tenant-specific
  // ones. Intersect only the tenant-specific depts; keep the app-wide
  // ones if the role has them.
  const APP_WIDE = new Set(["owner", "settings"]);
  const tenantDepts = (company.departments || []);
  const departments: string[] = roleDepts.filter(d =>
    APP_WIDE.has(d) || tenantDepts.includes(d)
  );
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
        companySlug={company.slug}
        companyName={company.name}
        isGod={isGod}
      >
        {children}
      </AppShell>
      <DashboardShell userId={user.id} />
    </>
  );
}
