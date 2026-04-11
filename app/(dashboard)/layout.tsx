import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import Link from "next/link";
import { LogOut } from "lucide-react";
import { DashboardShell } from "@/components/DashboardShell";
import { GlobalSearch } from "@/components/GlobalSearch";
import { CollapsibleSidebar } from "@/components/CollapsibleSidebar";

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

  type NavItem = { href: string; label: string; roles: string[]; section?: never } | { section: string; href?: never; label?: never; roles?: never };
  const navItems: NavItem[] = [
    { section: "LABS" },
    { href: "/dashboard", label: "Dashboard", roles: ["manager","production","warehouse","shipping","sales","readonly"] },
    { href: "/jobs", label: "Projects", roles: ["manager","production","sales"] },
    { href: "/clients", label: "Clients", roles: ["manager","sales"] },
    { href: "/decorators", label: "Decorators", roles: ["manager","production"] },
    { href: "/production", label: "Production", roles: ["manager","production"] },
    { href: "/toolkit", label: "Tool Kit", roles: ["manager","production","sales"] },
    { href: "/staging", label: "Staging", roles: ["manager","sales"] },
    { section: "DISTRO" },
    { href: "/receiving", label: "Receiving", roles: ["manager","warehouse","shipping"] },
    { href: "/shipping", label: "Shipping", roles: ["manager","warehouse","shipping"] },
    { href: "/fulfillment", label: "Fulfillment", roles: ["manager","warehouse","shipping"] },
    { href: "/ecomm", label: "E-Comm", roles: ["manager","sales"] },
    { section: "" },
    { href: "/insights", label: "Insights", roles: ["manager"] },
    { href: "/reports", label: "Reports", roles: ["manager"] },
  ];

  return (
    <div className="min-h-screen bg-background flex">
      <CollapsibleSidebar
        navItems={navItems.filter(item => !("section" in item && item.section !== undefined) || item.section !== undefined)}
        role={role}
        email={user.email || ""}
        isManager={isManager}
        userId={user.id}
      />

      {/* Main */}
      <main className="flex-1 overflow-auto">
        <div className="p-6">
          {children}
        </div>
      </main>

      {/* Global components */}
      <DashboardShell userId={user.id} />
    </div>
  );
}
