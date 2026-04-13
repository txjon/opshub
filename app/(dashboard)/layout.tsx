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

  const role = profile?.role ?? "readonly";
  const isManager = role === "manager";

  return (
    <>
      <AppShell
        email={user.email || ""}
        role={role}
        isManager={isManager}
        userId={user.id}
      >
        {children}
      </AppShell>
      <DashboardShell userId={user.id} />
    </>
  );
}
