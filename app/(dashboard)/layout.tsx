import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import Link from "next/link";
import { LogOut } from "lucide-react";
import { DashboardShell, SidebarNotifications } from "@/components/DashboardShell";
import { GlobalSearch } from "@/components/GlobalSearch";

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

  const navItems = [
    { href: "/dashboard", label: "Dashboard", roles: ["manager","production","warehouse","shipping","sales","readonly"] },
    { href: "/jobs", label: "Projects", roles: ["manager","production","sales"] },
    { href: "/production", label: "Production", roles: ["manager","production"] },
    { href: "/warehouse", label: "Warehouse", roles: ["manager","warehouse","shipping"] },
    { href: "/clients", label: "Clients", roles: ["manager","sales"] },
    { href: "/decorators", label: "Decorators", roles: ["manager","production"] },
    { href: "/reports", label: "Reports", roles: ["manager"] },
    { href: "/toolkit", label: "Tool Kit", roles: ["manager","production","sales"] },
  ].filter(item => item.roles.includes(role));

  return (
    <div className="min-h-screen bg-background flex">
      {/* Sidebar */}
      <aside className="w-56 border-r border-border flex flex-col shrink-0">
        <div className="p-4 border-b border-border">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-md bg-primary flex items-center justify-center shrink-0">
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <rect x="1" y="1" width="5" height="5" rx="1" fill="white"/>
                <rect x="8" y="1" width="5" height="5" rx="1" fill="white" opacity="0.6"/>
                <rect x="1" y="8" width="5" height="5" rx="1" fill="white" opacity="0.6"/>
                <rect x="8" y="8" width="5" height="5" rx="1" fill="white"/>
              </svg>
            </div>
            <span className="font-bold text-sm tracking-tight">OpsHub</span>
          </div>
          <SidebarNotifications userId={user.id} />
        </div>

        <div className="px-3 pt-3 pb-1">
          <GlobalSearch />
        </div>
        <nav className="flex-1 p-3 space-y-0.5">
          {navItems.map(item => (
            <Link
              key={item.href}
              href={item.href}
              className="flex items-center px-3 py-2 rounded-md text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
            >
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="p-3 border-t border-border space-y-1">
          <div className="px-3 py-1">
            <p className="text-xs text-muted-foreground truncate">{user.email}</p>
            <p className="text-xs font-medium capitalize text-primary">{role}</p>
          </div>
          {isManager && (
            <Link href="/settings" className="flex items-center px-3 py-2 rounded-md text-sm text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors">
              Settings
            </Link>
          )}
          <form action="/api/auth/signout" method="post">
            <button
              type="submit"
              className="w-full flex items-center gap-2 px-3 py-2 rounded-md text-sm text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
            >
              <LogOut size={14} />
              Sign out
            </button>
          </form>
        </div>
      </aside>

      {/* Main */}
      <main className="flex-1 overflow-auto">
        <div className="max-w-7xl mx-auto p-6">
          {children}
        </div>
      </main>

      {/* Global components */}
      <DashboardShell userId={user.id} />
    </div>
  );
}
