"use client";
import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { LogOut, Menu, X } from "lucide-react";
import { GlobalSearch } from "@/components/GlobalSearch";

type NavItem = { href?: string; label?: string; roles?: string[]; section?: string };

export function CollapsibleSidebar({
  navItems, role, email, isManager, userId,
}: {
  navItems: NavItem[]; role: string; email: string; isManager: boolean; userId: string;
}) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  return (
    <>
      {/* Slim rail — always visible */}
      <div className="w-12 border-r border-border flex flex-col items-center py-3 shrink-0 bg-card">
        <button
          onClick={() => setOpen(!open)}
          className="w-8 h-8 rounded-md flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
        >
          {open ? <X size={18} /> : <Menu size={18} />}
        </button>
      </div>

      {/* Expanded drawer — slides over */}
      {open && (
        <>
          <div className="fixed inset-0 bg-black/20 z-40" onClick={() => setOpen(false)} />
          <aside className="fixed left-12 top-0 bottom-0 w-56 bg-card border-r border-border flex flex-col z-50 shadow-lg">
            <div className="px-3 pt-4 pb-2">
              <div className="flex items-center gap-2 mb-3">
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
              <GlobalSearch />
            </div>

            <nav className="flex-1 p-3 space-y-0.5 overflow-y-auto">
              {navItems.map((item, i) => {
                if ("section" in item && item.section !== undefined) {
                  if (!item.section) return <div key={`sep-${i}`} className="pt-2" />;
                  return (
                    <div key={item.section} className="pt-3 pb-1 px-3">
                      <span className="text-[9px] font-bold tracking-[0.12em] text-muted-foreground/50 uppercase">{item.section}</span>
                    </div>
                  );
                }
                if (!item.roles?.includes(role)) return null;
                const isActive = pathname === item.href || pathname?.startsWith(item.href + "/");
                return (
                  <Link
                    key={item.href}
                    href={item.href!}
                    onClick={() => setOpen(false)}
                    className={`flex items-center px-3 py-1.5 rounded-md text-[13px] font-medium transition-colors ${
                      isActive
                        ? "text-foreground bg-secondary font-semibold"
                        : "text-muted-foreground hover:text-foreground hover:bg-secondary"
                    }`}
                  >
                    {item.label}
                  </Link>
                );
              })}
            </nav>

            <div className="p-3 border-t border-border space-y-1">
              <div className="px-3 py-1">
                <p className="text-xs text-muted-foreground truncate">{email}</p>
                <p className="text-xs font-medium capitalize text-primary">{role}</p>
              </div>
              {isManager && (
                <Link href="/settings" onClick={() => setOpen(false)} className="flex items-center px-3 py-2 rounded-md text-sm text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors">
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
        </>
      )}
    </>
  );
}
