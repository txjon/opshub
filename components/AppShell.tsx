"use client";
import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { LogOut, FlaskConical, Truck, Store, Users, Cog, ChartColumn } from "lucide-react";
import { GlobalSearch } from "@/components/GlobalSearch";
import { useIsMobile } from "@/lib/useIsMobile";

type Department = "owner" | "labs" | "distro" | "ecomm" | "contacts" | "settings";

const DEPT_NAV: Record<Department, { href: string; label: string }[]> = {
  owner: [
    { href: "/insights", label: "Insights" },
    { href: "/reports", label: "Reports" },
  ],
  labs: [
    { href: "/dashboard", label: "Dashboard" },
    { href: "/jobs", label: "Projects" },
    { href: "/art-studio", label: "Art Studio" },
    { href: "/production", label: "Production" },
  ],
  distro: [
    { href: "/distro", label: "Dashboard" },
    { href: "/receiving", label: "Receiving" },
    { href: "/shipping", label: "Shipping" },
    { href: "/fulfillment", label: "Fulfillment" },
  ],
  ecomm: [
    { href: "/ecomm", label: "Dashboard" },
  ],
  contacts: [
    { href: "/clients", label: "Clients" },
    { href: "/decorators", label: "Decorators" },
  ],
  settings: [
    { href: "/settings", label: "Team" },
    { href: "/settings/designers", label: "Designers" },
  ],
};

// Side quest pages accessible from any department
const SIDE_QUESTS = [
  { href: "/toolkit", label: "Toolkit" },
  { href: "/staging", label: "Staging" },
];

const DEPT_ICONS: Record<Department, { Icon: any; label: string }> = {
  owner: { Icon: ChartColumn, label: "Owner" },
  labs: { Icon: FlaskConical, label: "Labs" },
  distro: { Icon: Truck, label: "Distro" },
  ecomm: { Icon: Store, label: "Ecomm" },
  contacts: { Icon: Users, label: "Contacts" },
  settings: { Icon: Cog, label: "Settings" },
};

// Cross-links between departments
const DEPT_CROSSLINKS: Partial<Record<Department, { href: string; label: string; dept: Department }>> = {
  labs: { href: "/distro", label: "Distro →", dept: "distro" },
  distro: { href: "/dashboard", label: "← Labs", dept: "labs" },
};

function detectDept(pathname: string): Department {
  if (["/insights", "/reports", "/god-mode"].some(p => pathname.startsWith(p))) return "owner";
  if (["/ecomm"].some(p => pathname.startsWith(p))) return "ecomm";
  if (["/distro", "/receiving", "/shipping", "/fulfillment"].some(p => pathname.startsWith(p))) return "distro";
  if (["/clients", "/decorators"].some(p => pathname.startsWith(p))) return "contacts";
  if (["/settings"].some(p => pathname.startsWith(p))) return "settings";
  return "labs";
}

export function AppShell({
  email, role, isOwner, departments, extraAccess, userId, children,
}: {
  email: string; role: string; isOwner: boolean; departments: string[]; extraAccess: string[]; userId: string; children: React.ReactNode;
}) {
  const pathname = usePathname();
  const isViewer = role === "viewer";
  const hasDept = (d: string) => departments.includes(d);
  const hasExtra = (page: string) => extraAccess.includes(page);
  const [activeDept, setActiveDept] = useState<Department>(detectDept(pathname));
  const [showSideQuests, setShowSideQuests] = useState(false);
  const isMobile = useIsMobile();

  // Sync dept when pathname changes (after navigation completes, not during render)
  useEffect(() => {
    const deptFromPath = detectDept(pathname);
    setActiveDept(deptFromPath);
  }, [pathname]);

  const baseNavItems = DEPT_NAV[activeDept] || [];
  // God Mode + Planner are email-gated (owner personal tools) — shown only
  // to Jon even among other owner-role users. Planner is a local-only symlink
  // to ~/claude-planner; gitignored so it never deploys to Vercel.
  const navItems = activeDept === "owner" && email === "jon@housepartydistro.com"
    ? [...baseNavItems, { href: "/god-mode", label: "God Mode" }, { href: "/planner/index.html", label: "Planner", external: true }]
    : baseNavItems;
  const rawCrossLink = DEPT_CROSSLINKS[activeDept];
  const crossLink = rawCrossLink && hasDept(rawCrossLink.dept) ? rawCrossLink : null;

  return (
    <div style={{ minHeight: "100vh", display: "flex", background: "#f4f4f6" }}>
      {/* ── Slim sidebar (department switcher) — desktop only ── */}
      {!isMobile && (
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
          {(Object.entries(DEPT_ICONS) as [Department, { Icon: any; label: string }][]).map(([dept, { Icon, label }]) => {
            if (!hasDept(dept)) return null;
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
                  gap: 2, textDecoration: "none", transition: "all 0.15s",
                  background: isActive ? "#73b6c9" : "transparent",
                  color: isActive ? "#000" : "#fff",
                }}
              >
                <Icon size={18} />
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
      )}

      {/* ── Main content area ── */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "auto", minWidth: 0 }}>
        {/* ── Top nav bar ── */}
        <div style={{
          background: "#fff", borderBottom: "1px solid #dcdce0",
          padding: isMobile ? "0 12px" : "0 24px", display: "flex", alignItems: "center", justifyContent: "space-between",
          height: 48, flexShrink: 0, gap: 8,
        }}>
          {/* Left: nav links (horizontally scrollable on mobile) */}
          <div style={{
            display: "flex", alignItems: "center", gap: 2,
            overflowX: "auto", overflowY: "hidden",
            minWidth: 0, flex: 1,
            scrollbarWidth: "none", WebkitOverflowScrolling: "touch",
          }}>
            {navItems.map((item: any) => {
              const isActive = pathname === item.href || pathname?.startsWith(item.href + "/");
              const linkStyle = {
                padding: "6px 14px", borderRadius: 6, fontSize: 13, fontWeight: isActive ? 700 : 500,
                textDecoration: "none", transition: "all 0.12s",
                color: isActive ? "#000" : "#6b6b78",
                background: isActive ? "#eaeaee" : "transparent",
                flexShrink: 0, whiteSpace: "nowrap",
              } as const;
              // External links (static files outside Next routing) use <a> + target=_blank
              if (item.external) {
                return (
                  <a key={item.href} href={item.href} target="_blank" rel="noopener noreferrer" style={linkStyle}>
                    {item.label}
                  </a>
                );
              }
              return (
                <Link key={item.href} href={item.href} style={linkStyle}>
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
                  flexShrink: 0, whiteSpace: "nowrap",
                }}
              >
                {crossLink.label}
              </Link>
            )}

            {/* Side quests dropdown — uses position:fixed w/ ref-measured coords
                so it escapes the nav container's overflow:hidden clip */}
            {SIDE_QUESTS.some(sq => hasExtra(sq.label.toLowerCase())) && (
              <SideQuestsMenu
                items={SIDE_QUESTS.filter(sq => hasExtra(sq.label.toLowerCase()))}
                pathname={pathname}
                open={showSideQuests}
                setOpen={setShowSideQuests}
              />
            )}
          </div>

          {/* Right: search + user */}
          <div style={{ display: "flex", alignItems: "center", gap: 12, flexShrink: 0 }}>
            <GlobalSearch />
            {!isMobile && <span style={{ fontSize: 11, color: "#a0a0ad" }}>{email?.split("@")[0]}</span>}
          </div>
        </div>

        {/* ── Page content ── */}
        <div style={{
          flex: 1,
          padding: isMobile ? "12px 12px" : 24,
          paddingBottom: isMobile ? 76 : 24, // account for fixed bottom nav
        }}>
          {children}
        </div>
      </div>

      {/* ── Mobile bottom nav (department switcher) ── */}
      {isMobile && (
        <div style={{
          position: "fixed", bottom: 0, left: 0, right: 0, zIndex: 50,
          background: "#000", color: "#fff",
          display: "flex", alignItems: "center", justifyContent: "space-around",
          padding: "6px 4px",
          borderTop: "1px solid #222",
        }}>
          {(Object.entries(DEPT_ICONS) as [Department, { Icon: any; label: string }][]).map(([dept, { Icon, label }]) => {
            if (!hasDept(dept)) return null;
            const isActive = activeDept === dept;
            return (
              <Link
                key={dept}
                href={DEPT_NAV[dept][0].href}
                onClick={() => setActiveDept(dept)}
                style={{
                  flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
                  gap: 2, padding: "6px 4px", borderRadius: 8,
                  textDecoration: "none",
                  background: isActive ? "#73b6c9" : "transparent",
                  color: isActive ? "#000" : "#fff",
                  minHeight: 44,
                }}
              >
                <Icon size={18} />
                <span style={{ fontSize: 9, fontWeight: 600, letterSpacing: "0.03em", textTransform: "uppercase" }}>{label}</span>
              </Link>
            );
          })}
          <form action="/api/auth/signout" method="post" style={{ flex: 1, display: "flex", justifyContent: "center" }}>
            <button
              type="submit"
              title="Sign out"
              style={{
                display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
                gap: 2, padding: "6px 4px", borderRadius: 8,
                background: "transparent", border: "none", color: "#888", cursor: "pointer",
                minHeight: 44, minWidth: 44,
              }}
            >
              <LogOut size={16} />
              <span style={{ fontSize: 9, fontWeight: 600, letterSpacing: "0.03em", textTransform: "uppercase" }}>Out</span>
            </button>
          </form>
        </div>
      )}
    </div>
  );
}

// Portal-less dropdown that escapes the nav's overflow:hidden by using
// position:fixed with measured coords from the trigger button.
function SideQuestsMenu({ items, pathname, open, setOpen }: {
  items: { href: string; label: string }[];
  pathname: string | null;
  open: boolean;
  setOpen: (v: boolean) => void;
}) {
  const btnRef = useRef<HTMLButtonElement>(null);
  const [coords, setCoords] = useState<{ top: number; left: number }>({ top: 0, left: 0 });

  useEffect(() => {
    if (!open || !btnRef.current) return;
    const rect = btnRef.current.getBoundingClientRect();
    setCoords({ top: rect.bottom + 4, left: rect.left });
  }, [open]);

  return (
    <div style={{ marginLeft: 4, flexShrink: 0 }}>
      <button
        ref={btnRef}
        onClick={() => setOpen(!open)}
        style={{
          padding: "6px 10px", borderRadius: 6, fontSize: 12, fontWeight: 500,
          border: "none", cursor: "pointer", color: "#a0a0ad",
          background: open ? "#eaeaee" : "transparent",
        }}
      >
        ···
      </button>
      {open && (
        <>
          <div style={{ position: "fixed", inset: 0, zIndex: 99 }} onClick={() => setOpen(false)} />
          <div style={{
            position: "fixed", top: coords.top, left: coords.left, zIndex: 100,
            background: "#fff", border: "1px solid #dcdce0", borderRadius: 8,
            boxShadow: "0 4px 12px rgba(0,0,0,0.08)", minWidth: 140, padding: 4,
          }}>
            {items.map(sq => (
              <Link
                key={sq.href}
                href={sq.href}
                onClick={() => setOpen(false)}
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
  );
}
