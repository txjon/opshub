"use client";
import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { LogOut, FlaskConical, Truck, Store, Users, Cog, ChartColumn, Lightbulb } from "lucide-react";
import { GlobalSearch } from "@/components/GlobalSearch";
import { useIsMobile } from "@/lib/useIsMobile";

type Department = "owner" | "labs" | "distro" | "ecomm" | "contacts" | "settings";

const DEPT_NAV: Record<Department, { href: string; label: string }[]> = {
  owner: [
    // Insights merged into God Mode ("Overview") — /insights now redirects there.
    { href: "/reports", label: "Reports" },
    { href: "/integrations", label: "Integrations" },
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
    { href: "/intake", label: "Intake" },
    { href: "/clients", label: "Clients" },
    { href: "/decorators", label: "Decorators" },
    { href: "/settings/designers", label: "Designers" },
  ],
  settings: [
    { href: "/settings", label: "Team" },
  ],
};

// Side quest pages accessible from any department
const SIDE_QUESTS = [
  { href: "/toolkit", label: "Toolkit" },
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
  if (["/insights", "/reports", "/god-mode", "/integrations"].some(p => pathname.startsWith(p))) return "owner";
  if (["/ecomm"].some(p => pathname.startsWith(p))) return "ecomm";
  if (["/distro", "/receiving", "/shipping", "/fulfillment"].some(p => pathname.startsWith(p))) return "distro";
  // Designers nav lives under Contacts even though the page itself
  // still resolves at /settings/designers — match the more specific
  // path BEFORE the generic /settings catch so the right dept lights up.
  if (pathname.startsWith("/settings/designers")) return "contacts";
  if (["/intake", "/clients", "/decorators"].some(p => pathname.startsWith(p))) return "contacts";
  if (["/settings"].some(p => pathname.startsWith(p))) return "settings";
  return "labs";
}

export function AppShell({
  email, role, isOwner, departments, extraAccess, userId,
  companySlug, companyName, isGod,
  children,
}: {
  email: string; role: string; isOwner: boolean;
  departments: string[]; extraAccess: string[]; userId: string;
  companySlug?: string; companyName?: string; isGod?: boolean;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const isViewer = role === "viewer";
  const hasDept = (d: string) => departments.includes(d);
  const hasExtra = (page: string) => extraAccess.includes(page);
  const [activeDept, setActiveDept] = useState<Department>(detectDept(pathname));
  const [showSideQuests, setShowSideQuests] = useState(false);
  const isMobile = useIsMobile();
  // Dashboard nav badge — count of external-driven items awaiting an
  // HPD response (quote rejections, proof revisions, vendor flags,
  // unread Art Studio briefs). Refreshes when the user navigates
  // away from /dashboard and on a slow background poll.
  const [dashboardUnread, setDashboardUnread] = useState(0);

  // Sync dept when pathname changes (after navigation completes, not during render)
  useEffect(() => {
    const deptFromPath = detectDept(pathname);
    setActiveDept(deptFromPath);
  }, [pathname]);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch("/api/dashboard/unread-count", { cache: "no-store" });
        if (!res.ok) return;
        const body = await res.json();
        if (!cancelled) setDashboardUnread(Number(body.count) || 0);
      } catch {}
    };
    // Strict-messenger flow: landing on /dashboard bumps the team-wide
    // last-seen-at via POST /api/dashboard/seen, which clears the badge.
    // We also optimistically zero it locally so the UI doesn't flash a
    // stale number while the round-trip completes.
    if (pathname === "/dashboard") {
      setDashboardUnread(0);
      fetch("/api/dashboard/seen", { method: "POST", cache: "no-store" }).catch(() => {});
    }
    load();
    const id = setInterval(load, 60_000);
    return () => { cancelled = true; clearInterval(id); };
  }, [pathname]);

  const baseNavItems = DEPT_NAV[activeDept] || [];
  // "Overview" (route stays /god-mode for backwards-compat) is email-gated
  // to Jon — it's the owner's high-altitude decision view, not for other
  // owner-role users. Prepended so it's the landing tab when Jon clicks
  // the Owner department icon.
  const navItems = activeDept === "owner" && email === "jon@housepartydistro.com"
    ? [{ href: "/god-mode", label: "Overview" }, ...baseNavItems]
    : baseNavItems;
  // Tenant override for the "Labs" department label. IHM doesn't think
  // of itself as a "Labs" production shop — it's just the IHM brand —
  // so show "IHM" in the sidebar + cross-link instead. HPD keeps Labs.
  const labsLabel = companySlug === "ihm" ? "IHM" : "Labs";
  const deptIcons: Record<Department, { Icon: any; label: string }> = {
    ...DEPT_ICONS,
    labs: { ...DEPT_ICONS.labs, label: labsLabel },
  };
  const rawCrossLink = DEPT_CROSSLINKS[activeDept];
  const crossLink = rawCrossLink && hasDept(rawCrossLink.dept)
    ? (rawCrossLink.dept === "labs" ? { ...rawCrossLink, label: `← ${labsLabel}` } : rawCrossLink)
    : null;

  return (
    <div style={{ height: "100vh", display: "flex", background: "#f4f4f6" }}>
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
            display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 4,
          }}>
            <svg width="16" height="16" viewBox="0 0 14 14" fill="none">
              <rect x="1" y="1" width="5" height="5" rx="1" fill="white"/>
              <rect x="8" y="1" width="5" height="5" rx="1" fill="white" opacity="0.6"/>
              <rect x="1" y="8" width="5" height="5" rx="1" fill="white" opacity="0.6"/>
              <rect x="8" y="8" width="5" height="5" rx="1" fill="white"/>
            </svg>
          </div>
          {/* Tenant slug — tiny indicator under the logo so the active
              company is visible at a glance. Useful when god-mode users
              switch between tenants. */}
          {companySlug && (
            <div title={companyName || companySlug}
              style={{
                fontSize: 8, fontWeight: 800, letterSpacing: "0.06em",
                color: "#888", textTransform: "uppercase",
                marginBottom: 8,
              }}>
              {companySlug}
            </div>
          )}

          {/* Department icons */}
          {(Object.entries(deptIcons) as [Department, { Icon: any; label: string }][]).map(([dept, { Icon, label }]) => {
            if (!hasDept(dept)) return null;
            const isActive = activeDept === dept;
            // For Jon, clicking the Owner icon lands on Overview (/god-mode)
            // since it's the prepended first tab. Everyone else lands on
            // the static DEPT_NAV first entry (/insights for owner).
            const landingHref =
              dept === "owner" && email === "jon@housepartydistro.com"
                ? "/god-mode"
                : DEPT_NAV[dept][0].href;
            return (
              <Link
                key={dept}
                href={landingHref}
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

          {/* References — team SOPs + training docs. Always visible to
              every authenticated user; not gated by department access. */}
          {(() => {
            const isActive = pathname === "/references" || pathname?.startsWith("/references/");
            return (
              <Link
                href="/references"
                title="References"
                style={{
                  width: 40, height: 40, borderRadius: 8,
                  display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
                  gap: 2, textDecoration: "none", transition: "all 0.15s",
                  background: isActive ? "#73b6c9" : "transparent",
                  color: isActive ? "#000" : "#fff",
                }}
              >
                <Lightbulb size={18} />
                <span style={{ fontSize: 7, fontWeight: 600, letterSpacing: "0.05em", textTransform: "uppercase" }}>Refs</span>
              </Link>
            );
          })()}
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
      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", minWidth: 0 }}>
        {/* ── Top nav bar ── */}
        <div style={{
          background: "#fff", borderBottom: "1px solid #dcdce0",
          padding: isMobile ? "0 4px 0 8px" : "0 24px", display: "flex", alignItems: "center", justifyContent: "space-between",
          height: isMobile ? 52 : 48, flexShrink: 0, gap: 4,
        }}>
          {/* Left: nav links (horizontally scrollable on mobile)
              Mobile gets taller, bolder tabs with iOS-style underline
              for the active state — proper 44px touch targets and
              scroll-snap so they land cleanly when swiped. */}
          <div style={{
            display: "flex", alignItems: "center", gap: isMobile ? 0 : 2,
            overflowX: "auto", overflowY: "hidden",
            minWidth: 0, flex: 1,
            scrollbarWidth: "none", WebkitOverflowScrolling: "touch",
            scrollSnapType: isMobile ? "x proximity" : undefined,
          }}>
            {navItems.map((item: any) => {
              const isActive = pathname === item.href || pathname?.startsWith(item.href + "/");
              const isDashboard = item.href === "/dashboard";
              const showBadge = isDashboard && dashboardUnread > 0;
              const linkStyle = isMobile ? ({
                padding: "0 14px", minHeight: 44, fontSize: 15,
                fontWeight: isActive ? 700 : 500,
                textDecoration: "none", transition: "color 0.12s",
                color: isActive ? "#000" : "#6b6b78",
                background: "transparent",
                borderBottom: isActive ? "2px solid #000" : "2px solid transparent",
                flexShrink: 0, whiteSpace: "nowrap",
                display: "inline-flex", alignItems: "center", gap: 8,
                scrollSnapAlign: "start",
              } as const) : ({
                padding: "6px 14px", borderRadius: 6, fontSize: 13, fontWeight: isActive ? 700 : 500,
                textDecoration: "none", transition: "all 0.12s",
                color: isActive ? "#000" : "#6b6b78",
                background: isActive ? "#eaeaee" : "transparent",
                flexShrink: 0, whiteSpace: "nowrap",
                display: "inline-flex", alignItems: "center", gap: 8,
              } as const);
              const badge = showBadge ? (
                <span style={{
                  background: "#e8569b", color: "#fff",
                  fontSize: 10, fontWeight: 800,
                  padding: "2px 7px", borderRadius: 99, lineHeight: 1.3,
                  minWidth: 18, textAlign: "center",
                }}>{dashboardUnread}</span>
              ) : null;
              // External links (static files outside Next routing) use <a> + target=_blank
              if (item.external) {
                return (
                  <a key={item.href} href={item.href} target="_blank" rel="noopener noreferrer" style={linkStyle}>
                    {item.label}
                    {badge}
                  </a>
                );
              }
              return (
                <Link key={item.href} href={item.href} style={linkStyle}>
                  {item.label}
                  {badge}
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

          {/* Right: search + user. Compact icon button on mobile, full
              search field on desktop. */}
          <div style={{ display: "flex", alignItems: "center", gap: isMobile ? 0 : 12, flexShrink: 0 }}>
            <GlobalSearch compact={isMobile} />
            {!isMobile && <span style={{ fontSize: 11, color: "#a0a0ad" }}>{email?.split("@")[0]}</span>}
          </div>
        </div>

        {/* ── Page content ── */}
        <div style={{
          flex: 1,
          padding: isMobile ? "12px 12px" : 24,
          paddingBottom: isMobile ? 76 : 24, // account for fixed bottom nav
          overflow: "auto",
          minHeight: 0,
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
          {(Object.entries(deptIcons) as [Department, { Icon: any; label: string }][]).map(([dept, { Icon, label }]) => {
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
          {/* References — always visible to every authenticated user. */}
          {(() => {
            const isActive = pathname === "/references" || pathname?.startsWith("/references/");
            return (
              <Link
                href="/references"
                style={{
                  flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
                  gap: 2, padding: "6px 4px", borderRadius: 8,
                  textDecoration: "none",
                  background: isActive ? "#73b6c9" : "transparent",
                  color: isActive ? "#000" : "#fff",
                  minHeight: 44,
                }}
              >
                <Lightbulb size={18} />
                <span style={{ fontSize: 9, fontWeight: 600, letterSpacing: "0.03em", textTransform: "uppercase" }}>Refs</span>
              </Link>
            );
          })()}
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
