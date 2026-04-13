"use client";
import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { LogOut } from "lucide-react";
import { GlobalSearch } from "@/components/GlobalSearch";

type Department = "labs" | "distro" | "contacts" | "settings";

const DEPT_NAV: Record<Department, { href: string; label: string }[]> = {
  labs: [
    { href: "/dashboard", label: "Dashboard" },
    { href: "/jobs", label: "Projects" },
    { href: "/production", label: "Production" },
  ],
  distro: [
    { href: "/receiving", label: "Receiving" },
    { href: "/shipping", label: "Shipping" },
    { href: "/fulfillment", label: "Fulfillment" },
  ],
  contacts: [
    { href: "/clients", label: "Clients" },
    { href: "/decorators", label: "Decorators" },
  ],
  settings: [
    { href: "/settings", label: "Settings" },
    { href: "/reports", label: "Reports" },
  ],
};

// Side quest pages accessible from any department
const SIDE_QUESTS = [
  { href: "/toolkit", label: "Toolkit" },
  { href: "/staging", label: "Staging" },
  { href: "/insights", label: "Insights" },
  { href: "/ecomm", label: "E-Comm" },
];

const DEPT_ICONS: Record<Department, { icon: string; label: string }> = {
  labs: { icon: "⚡", label: "Labs" },
  distro: { icon: "📦", label: "Distro" },
  contacts: { icon: "👥", label: "Contacts" },
  settings: { icon: "⚙", label: "Settings" },
};

// Cross-links between departments
const DEPT_CROSSLINKS: Partial<Record<Department, { href: string; label: string; dept: Department }>> = {
  labs: { href: "/receiving", label: "Distro →", dept: "distro" },
  distro: { href: "/dashboard", label: "← Labs", dept: "labs" },
};

function detectDept(pathname: string): Department {
  if (["/receiving", "/shipping", "/fulfillment", "/ecomm"].some(p => pathname.startsWith(p))) return "distro";
  if (["/clients", "/decorators"].some(p => pathname.startsWith(p))) return "contacts";
  if (["/settings", "/reports"].some(p => pathname.startsWith(p))) return "settings";
  return "labs";
}

export function AppShell({
  email, role, isManager, userId, children,
}: {
  email: string; role: string; isManager: boolean; userId: string; children: React.ReactNode;
}) {
  const pathname = usePathname();
  const [activeDept, setActiveDept] = useState<Department>(detectDept(pathname));
  const [showSideQuests, setShowSideQuests] = useState(false);

  // Update dept when pathname changes (e.g., cross-link click)
  const currentDept = detectDept(pathname);
  if (currentDept !== activeDept) {
    setActiveDept(currentDept);
  }

  const navItems = DEPT_NAV[activeDept] || [];
  const crossLink = DEPT_CROSSLINKS[activeDept];

  return (
    <div style={{ minHeight: "100vh", display: "flex", background: "#f4f4f6" }}>
      {/* ── Slim sidebar (department switcher) ── */}
      <div style={{
        width: 56, background: "#000", display: "flex", flexDirection: "column",
        alignItems: "center", paddingTop: 12, paddingBottom: 12, flexShrink: 0,
        justifyContent: "space-between",
      }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 4, alignItems: "center" }}>
          {/* Logo */}
          <div style={{
            width: 36, height: 36, borderRadius: 8, background: "#222",
            display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 8,
          }}>
            <svg width="16" height="16" viewBox="0 0 14 14" fill="none">
              <rect x="1" y="1" width="5" height="5" rx="1" fill="white"/>
              <rect x="8" y="1" width="5" height="5" rx="1" fill="white" opacity="0.6"/>
              <rect x="1" y="8" width="5" height="5" rx="1" fill="white" opacity="0.6"/>
              <rect x="8" y="8" width="5" height="5" rx="1" fill="white"/>
            </svg>
          </div>

          {/* Department icons */}
          {(Object.entries(DEPT_ICONS) as [Department, { icon: string; label: string }][]).map(([dept, { icon, label }]) => {
            if (dept === "settings" && !isManager) return null;
            const isActive = activeDept === dept;
            return (
              <Link
                key={dept}
                href={DEPT_NAV[dept][0].href}
                onClick={() => setActiveDept(dept)}
                title={label}
                style={{
                  width: 40, height: 40, borderRadius: 8,
                  display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
                  gap: 1, textDecoration: "none", transition: "all 0.15s",
                  background: isActive ? "#333" : "transparent",
                  color: isActive ? "#fff" : "#888",
                }}
              >
                <span style={{ fontSize: 18 }}>{icon}</span>
                <span style={{ fontSize: 7, fontWeight: 600, letterSpacing: "0.05em", textTransform: "uppercase" }}>{label}</span>
              </Link>
            );
          })}
        </div>

        {/* Bottom: sign out */}
        <form action="/api/auth/signout" method="post">
          <button
            type="submit"
            title="Sign out"
            style={{
              width: 40, height: 40, borderRadius: 8, border: "none", cursor: "pointer",
              display: "flex", alignItems: "center", justifyContent: "center",
              background: "transparent", color: "#666", transition: "color 0.15s",
            }}
          >
            <LogOut size={16} />
          </button>
        </form>
      </div>

      {/* ── Main content area ── */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "auto" }}>
        {/* ── Top nav bar ── */}
        <div style={{
          background: "#fff", borderBottom: "1px solid #dcdce0",
          padding: "0 24px", display: "flex", alignItems: "center", justifyContent: "space-between",
          height: 48, flexShrink: 0,
        }}>
          {/* Left: nav links */}
          <div style={{ display: "flex", alignItems: "center", gap: 2 }}>
            {navItems.map(item => {
              const isActive = pathname === item.href || pathname?.startsWith(item.href + "/");
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  style={{
                    padding: "6px 14px", borderRadius: 6, fontSize: 13, fontWeight: isActive ? 700 : 500,
                    textDecoration: "none", transition: "all 0.12s",
                    color: isActive ? "#000" : "#6b6b78",
                    background: isActive ? "#eaeaee" : "transparent",
                  }}
                >
                  {item.label}
                </Link>
              );
            })}

            {/* Cross-link to other department */}
            {crossLink && (
              <Link
                href={crossLink.href}
                onClick={() => setActiveDept(crossLink.dept)}
                style={{
                  padding: "6px 14px", borderRadius: 6, fontSize: 12, fontWeight: 500,
                  textDecoration: "none", color: "#a0a0ad", marginLeft: 4,
                }}
              >
                {crossLink.label}
              </Link>
            )}

            {/* Side quests dropdown */}
            <div style={{ position: "relative", marginLeft: 4 }}>
              <button
                onClick={() => setShowSideQuests(!showSideQuests)}
                style={{
                  padding: "6px 10px", borderRadius: 6, fontSize: 12, fontWeight: 500,
                  border: "none", cursor: "pointer", color: "#a0a0ad",
                  background: showSideQuests ? "#eaeaee" : "transparent",
                }}
              >
                ···
              </button>
              {showSideQuests && (
                <>
                  <div style={{ position: "fixed", inset: 0, zIndex: 99 }} onClick={() => setShowSideQuests(false)} />
                  <div style={{
                    position: "absolute", top: "100%", left: 0, marginTop: 4, zIndex: 100,
                    background: "#fff", border: "1px solid #dcdce0", borderRadius: 8,
                    boxShadow: "0 4px 12px rgba(0,0,0,0.08)", minWidth: 140, padding: 4,
                  }}>
                    {SIDE_QUESTS.map(sq => (
                      <Link
                        key={sq.href}
                        href={sq.href}
                        onClick={() => setShowSideQuests(false)}
                        style={{
                          display: "block", padding: "8px 12px", borderRadius: 4,
                          fontSize: 12, fontWeight: 500, textDecoration: "none",
                          color: pathname === sq.href ? "#000" : "#6b6b78",
                          background: pathname === sq.href ? "#eaeaee" : "transparent",
                        }}
                      >
                        {sq.label}
                      </Link>
                    ))}
                  </div>
                </>
              )}
            </div>
          </div>

          {/* Right: search + user */}
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <GlobalSearch />
            <span style={{ fontSize: 11, color: "#a0a0ad" }}>{email?.split("@")[0]}</span>
          </div>
        </div>

        {/* ── Page content ── */}
        <div style={{ flex: 1, padding: 24 }}>
          {children}
        </div>
      </div>
    </div>
  );
}
