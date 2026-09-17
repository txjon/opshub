"use client";
import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { LogOut, Menu, X, ChevronDown } from "lucide-react";
import { GlobalSearch, type SearchPage } from "@/components/GlobalSearch";
import { useIsMobile } from "@/lib/useIsMobile";
import { grantedPages } from "@/lib/access";
import { V2_WRITES_LIVE, STUDIO_UNDER_DEV, STUDIO_HIDDEN_HREFS } from "@/lib/v2-flags";

type Department = "owner" | "labs" | "distro" | "ecomm" | "contacts" | "settings" | "billing";

// v2 warehouse cutover nav swap. When live: relabel the v2 pages to the primary
// department names and drop the legacy twins if they're also present. For the
// legacy-only fallback nav (DEPT_NAV), redirect the legacy href to its v2 page.
const V2_RELABEL: Record<string, string> = { "/production2": "Production", "/receiving2": "Receiving", "/shipping2": "Shipping", "/staging2": "Staging", "/projects": "Projects", "/billing": "Bills" };
const V2_REDIRECT: Record<string, string> = { "/production": "/production2", "/receiving": "/receiving2", "/shipping": "/shipping2", "/fulfillment": "/staging2", "/jobs": "/projects", "/distro": "/the-distro", "/reconciliation": "/billing" };
function swapV2Nav(items: { href: string; label: string }[]): { href: string; label: string }[] {
  if (!V2_WRITES_LIVE) return items;
  const hrefs = new Set(items.map(i => i.href));
  return items
    // drop a legacy entry only when its v2 twin is already in the list
    .filter(i => !(V2_REDIRECT[i.href] && hrefs.has(V2_REDIRECT[i.href])))
    .map(i => {
      if (V2_RELABEL[i.href]) return { ...i, label: V2_RELABEL[i.href] };      // v2 → primary name
      if (V2_REDIRECT[i.href]) return { href: V2_REDIRECT[i.href], label: i.label }; // legacy-only fallback → point at v2
      return i;
    });
}

const DEPT_NAV: Record<Department, { href: string; label: string }[]> = {
  owner: [
    // Insights merged into God Mode ("Overview") — /insights now redirects there.
    { href: "/reconciliation", label: "Bills" },
    { href: "/reports", label: "Reports" },
    { href: "/hours", label: "Hours" },
    { href: "/integrations", label: "Integrations" },
  ],
  labs: [
    { href: "/house", label: "The House" },
    { href: "/intake", label: "Intake" },
    { href: "/jobs", label: "Projects" },
    { href: "/studio", label: "The Studio" },
    { href: "/production", label: "Production" },
  ],
  distro: [
    { href: "/distro", label: "Dashboard" },
    { href: "/receiving", label: "Receiving" },
    { href: "/shipping", label: "Shipping" },
    { href: "/fulfillment", label: "Fulfillment" },
  ],
  ecomm: [
    { href: "/ecomm", label: "The Shop" },
  ],
  contacts: [
    { href: "/clients", label: "Clients" },
    { href: "/decorators", label: "Decorators" },
    { href: "/settings/designers", label: "Designers" },
  ],
  settings: [
    { href: "/settings", label: "Team" },
  ],
  billing: [
    { href: "/billing", label: "Billing" },
  ],
};

// Side quest pages accessible from any department
const SIDE_QUESTS = [
  { href: "/toolkit", label: "Toolkit" },
];

export function AppShell({
  email, role, isOwner, departments, extraAccess, userId,
  companySlug, companyName, isGod, pageAccess,
  children,
}: {
  email: string; role: string; isOwner: boolean;
  departments: string[]; extraAccess: string[]; userId: string;
  companySlug?: string; companyName?: string; isGod?: boolean;
  pageAccess?: string[] | null;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const isViewer = role === "viewer";
  // Sign out via fetch, not a <form>: Safari warns before submitting any form
  // over plain http (the LAN dev address), and the sheet made the bottom-bar
  // button look like part of search.
  const signOut = async () => {
    try { await fetch("/api/auth/signout", { method: "POST", cache: "no-store" }); } catch {}
    window.location.href = "/login";
  };
  // Per-user page access (lib/access). When page_access is set, the whole sidebar
  // is driven off the granted catalog pages; otherwise fall back to the legacy
  // role∩company department list so un-seeded users are completely unchanged.
  // Gods always use the catalog-driven nav (they see every page, incl new ones
  // like Billing) — never the legacy DEPT_NAV, which would silently miss pages.
  const usePerUser = !!isGod || (Array.isArray(pageAccess) && pageAccess.length > 0);
  const grantedCatalog = usePerUser ? grantedPages({ role, isGod, pageAccess }) : [];
  const grantedHrefs = new Set(grantedCatalog.map(p => p.href));
  const grantedGroups = new Set(grantedCatalog.map(p => p.group));
  const navByGroup: Record<string, { href: string; label: string }[]> = {};
  for (const p of grantedCatalog) (navByGroup[p.group] ||= []).push({ href: p.href, label: p.label });
  const hasExtra = (page: string) => extraAccess.includes(page);
  const isMobile = useIsMobile();
  // The inbox badge — open external items (lib/inbox), polled each minute.
  // No "seen" clock: the number only drops when an item resolves or is cleared.
  const [inboxCount, setInboxCount] = useState(0);
  const [menuOpen, setMenuOpen] = useState(false);
  useEffect(() => { setMenuOpen(false); }, [pathname]);
  // Per-section "your move" counts under The House (lib/house-counts) —
  // greyed next to Intake / Projects / The Studio / Production.
  const [houseCounts, setHouseCounts] = useState<Record<string, number> | null>(null);
  const HOUSE_SECTION_BY_HREF: Record<string, string> = { "/intake": "intake", "/projects": "projects", "/jobs": "projects", "/studio": "studio", "/production2": "production", "/production": "production" };

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch("/api/inbox", { cache: "no-store" });
        if (!res.ok) return;
        const body = await res.json();
        if (cancelled) return;
        // pink pillar badge = the INBOX (someone outside is waiting on us);
        // the grey section numbers carry the workload (Jon, Sep 16)
        setInboxCount(Number(body.count) || 0);
        setHouseCounts(body.sections || null);
      } catch {}
    };
    load();
    const id = setInterval(load, 60_000);
    return () => { cancelled = true; clearInterval(id); };
  }, [pathname]);

  // ── Hub sidebar (desktop) — ONE nav, grouped by workflow, every granted
  // destination visible and one click away (Jon, Jul 27: "we're in
  // production, need receiving → click Distro → land on Distro home → click
  // Receiving" — adjacent pipeline steps were two hops + a mode switch).
  // Nav cleanup (Jon, Aug 13): three branded pillars + People + The Office in
  // the main list; Team/Integrations join References/Toolkit as bottom
  // utilities. Billing folded into The Office; Releases moved to The Shop.
  const GROUP_ORDER: Department[] = ["labs", "distro", "ecomm", "contacts", "owner"];
  const GROUP_LABELS: Record<string, string> = { labs: "Labs", distro: "Distro", ecomm: "Ecomm", contacts: "People", owner: "The Office", billing: "Billing", settings: "Admin" };
  // Groups whose header IS their home page (big clickable pillar). Groups
  // without one (People, The Office) get a plain label header — no more
  // "first page accidentally becomes the header" (Intake, Overview).
  const GROUP_HOMES: Partial<Record<Department, string>> = { labs: "/house", distro: "/the-distro", ecomm: "/ecomm" };
  const filterNavItems = (items: { href: string; label: string }[]) => {
    const swapped = swapV2Nav(items);
    const studioFiltered = STUDIO_UNDER_DEV ? swapped.filter((i: any) => !STUDIO_HIDDEN_HREFS.includes(i.href)) : swapped;
    // Retired pages and parked mockups don't earn nav rows.
    return studioFiltered.filter((i: any) => !/retired/i.test(i.label) && !/mockup/i.test(i.label));
  };
  // The House leads Labs — the team's daily driver comes first.
  const NAV_FIRST: Record<string, string> = { labs: "/house" };
  const sidebarGroups: { key: string; label: string; items: { href: string; label: string }[] }[] = GROUP_ORDER
    .map(g => {
      let items: { href: string; label: string }[] = [];
      if (usePerUser) items = navByGroup[g] || [];
      else if (departments.includes(g)) {
        items = DEPT_NAV[g] || [];
        if (g === "owner" && email === "jon@housepartydistro.com") items = [{ href: "/god-mode", label: "Overview" }, ...items];
      }
      let filtered = filterNavItems(items);
      const first = NAV_FIRST[g];
      if (first && filtered.some(i => i.href === first)) filtered = [...filtered.filter(i => i.href === first), ...filtered.filter(i => i.href !== first)];
      return { key: g, label: GROUP_LABELS[g] || g, items: filtered };
    })
    .filter(g => g.items.length > 0);
  const sideQuestItems = SIDE_QUESTS.filter(sq => usePerUser ? grantedHrefs.has(sq.href) : hasExtra(sq.label.toLowerCase()));
  const showRefs = !usePerUser || grantedHrefs.has("/references");
  // Admin utilities (Team, Integrations) render at the bottom with References
  // and Toolkit — quiet flat rows, not a nav group.
  const utilityItems = filterNavItems(usePerUser ? (navByGroup["settings"] || []) : (departments.includes("settings") ? DEPT_NAV.settings : []));

  // Every granted destination, flat, for the search-as-nav quick list —
  // built from the SAME filtered/swapped groups the sidebar renders, so
  // search never offers a page the sidebar wouldn't.
  const searchPages: SearchPage[] = [
    ...sidebarGroups.flatMap(g => {
      const homeHref = GROUP_HOMES[g.key as Department];
      const title = (homeHref && g.items.find(i => i.href === homeHref)?.label) || g.label;
      return g.items.map(i => ({ href: i.href, label: i.label, group: title }));
    }),
    ...utilityItems.map(u => ({ href: u.href, label: u.label, group: "Utilities" })),
    ...(showRefs ? [{ href: "/references", label: "References", group: "Utilities" }] : []),
    ...sideQuestItems.map(sq => ({ href: sq.href, label: sq.label, group: "Utilities" })),
  ];

  return (
    <div style={{ height: "100vh", display: "flex", background: "#0a0a0a" }}>
      {/* ── HUB SIDEBAR (desktop) — one nav, grouped by workflow ── */}
      {!isMobile && (
      <aside style={{ width: 218, background: "#0d0d0d", borderRight: "1px solid rgba(255,255,255,0.09)", display: "flex", flexDirection: "column", flexShrink: 0, minHeight: 0 }}>
        {/* brand */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "14px 14px 10px" }}>
          <div style={{ width: 30, height: 30, borderRadius: 8, background: "#222", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <rect x="1" y="1" width="5" height="5" rx="1" fill="white"/>
              <rect x="8" y="1" width="5" height="5" rx="1" fill="white" opacity="0.6"/>
              <rect x="1" y="8" width="5" height="5" rx="1" fill="white" opacity="0.6"/>
              <rect x="8" y="8" width="5" height="5" rx="1" fill="white"/>
            </svg>
          </div>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 800, color: "#fff", letterSpacing: "-0.01em", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{companyName || "OpsHub"}</div>
            {companySlug && <div style={{ fontSize: 8.5, fontWeight: 800, letterSpacing: "0.08em", color: "#777", textTransform: "uppercase" }}>{companySlug}</div>}
          </div>
        </div>

        {/* search — the fastest nav in the app, up top where it's found */}
        <div style={{ padding: "0 10px 10px" }}>
          <GlobalSearch pages={searchPages} />
        </div>

        {/* nav groups */}
        <div style={{ flex: 1, overflowY: "auto", minHeight: 0, padding: "0 8px 8px" }}>
          {sidebarGroups.map(g => {
            // Pillar groups (GROUP_HOMES) get their home page as a big
            // clickable header ("The House", "The Distro", "The Shop");
            // label-only groups (People, The Office) get a plain header and
            // every page indents under it.
            const homeHref = GROUP_HOMES[g.key as Department];
            const head = homeHref ? g.items.find((i: any) => i.href === homeHref) : undefined;
            const children = head ? g.items.filter((i: any) => i !== head) : g.items;
            const headActive = !!head && (pathname === head.href || pathname?.startsWith(head.href + "/"));
            const headBadge = head?.href === "/house" && inboxCount > 0;
            const headStyle = { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, padding: "7px 8px", borderRadius: 8, fontSize: 15, fontWeight: 800, letterSpacing: "-0.01em" } as const;
            return (
              <div key={g.key} style={{ marginBottom: 14 }}>
                {head ? (
                  <Link href={head.href}
                    style={{ ...headStyle, textDecoration: "none", color: headActive ? "#fff" : "rgba(255,255,255,0.88)", background: headActive ? "rgba(255,255,255,0.10)" : "transparent" }}>
                    <span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{head.label}</span>
                    {headBadge && <span style={{ background: "#e8569b", color: "#fff", fontSize: 9.5, fontWeight: 800, padding: "1px 6px", borderRadius: 99, lineHeight: 1.4, minWidth: 16, textAlign: "center" }}>{inboxCount}</span>}
                  </Link>
                ) : (
                  <div style={{ ...headStyle, color: "rgba(255,255,255,0.88)" }}>
                    <span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{g.label}</span>
                  </div>
                )}
                {children.map((item: any) => {
                  const isActive = pathname === item.href || pathname?.startsWith(item.href + "/");
                  const showBadge = item.href === "/house" && inboxCount > 0;
                  const sectionKey = g.key === "labs" ? HOUSE_SECTION_BY_HREF[item.href] : undefined;
                  const sectionCount = sectionKey && houseCounts ? houseCounts[sectionKey] || 0 : 0;
                  return (
                    <Link key={item.href} href={item.href}
                      style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, padding: "5px 8px 5px 20px", borderRadius: 7, fontSize: 12.5, fontWeight: isActive ? 700 : 500, textDecoration: "none", color: isActive ? "#fff" : "rgba(255,255,255,0.6)", background: isActive ? "rgba(255,255,255,0.10)" : "transparent" }}>
                      <span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{item.label}</span>
                      {showBadge && <span style={{ background: "#e8569b", color: "#fff", fontSize: 9.5, fontWeight: 800, padding: "1px 6px", borderRadius: 99, lineHeight: 1.4, minWidth: 16, textAlign: "center" }}>{inboxCount}</span>}
                      {sectionCount > 0 && <span style={{ fontSize: 10.5, fontWeight: 800, fontFamily: "ui-monospace, 'SF Mono', Menlo, monospace", color: isActive ? "rgba(255,255,255,0.7)" : "rgba(255,255,255,0.38)", minWidth: 16, textAlign: "right" }}>{sectionCount}</span>}
                    </Link>
                  );
                })}
              </div>
            );
          })}
          {(showRefs || sideQuestItems.length > 0 || utilityItems.length > 0) && (
            <div style={{ marginBottom: 10, borderTop: "1px solid rgba(255,255,255,0.07)", paddingTop: 8 }}>
              {utilityItems.map(u => (
                <Link key={u.href} href={u.href} style={{ display: "block", padding: "6px 8px", borderRadius: 7, fontSize: 12.5, fontWeight: pathname === u.href || pathname?.startsWith(u.href + "/") ? 700 : 500, textDecoration: "none", color: pathname === u.href || pathname?.startsWith(u.href + "/") ? "#fff" : "rgba(255,255,255,0.6)", background: pathname === u.href || pathname?.startsWith(u.href + "/") ? "rgba(255,255,255,0.10)" : "transparent" }}>{u.label}</Link>
              ))}
              {showRefs && (
                <Link href="/references" style={{ display: "block", padding: "6px 8px", borderRadius: 7, fontSize: 12.5, fontWeight: pathname?.startsWith("/references") ? 700 : 500, textDecoration: "none", color: pathname?.startsWith("/references") ? "#fff" : "rgba(255,255,255,0.6)", background: pathname?.startsWith("/references") ? "rgba(255,255,255,0.10)" : "transparent" }}>References</Link>
              )}
              {sideQuestItems.map(sq => (
                <Link key={sq.href} href={sq.href} style={{ display: "block", padding: "6px 8px", borderRadius: 7, fontSize: 12.5, fontWeight: pathname === sq.href ? 700 : 500, textDecoration: "none", color: pathname === sq.href ? "#fff" : "rgba(255,255,255,0.6)", background: pathname === sq.href ? "rgba(255,255,255,0.10)" : "transparent" }}>{sq.label}</Link>
              ))}
            </div>
          )}
        </div>

        {/* footer: user + sign out */}
        <div style={{ borderTop: "1px solid rgba(255,255,255,0.09)", padding: "8px 10px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
          <span style={{ fontSize: 11, color: "#a0a0ad", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{email?.split("@")[0]}</span>
          <button type="button" onClick={signOut} title="Sign out" aria-label="Sign out" style={{ width: 30, height: 30, borderRadius: 8, border: "none", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", background: "transparent", color: "#666" }}>
            <LogOut size={15} />
          </button>
        </div>
      </aside>
      )}

      {/* ── Main content area ── */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", minWidth: 0 }}>
        {/* ── Top bar — MOBILE ONLY: ☰ + where you are. The menu is the
            whole grouped nav with the current department expanded (Jon,
            Sep 17 2026, option 1); desktop nav lives in the hub sidebar. ── */}
        {isMobile && (() => {
          const allRows = [...sidebarGroups.flatMap(g => g.items.map(i => ({ ...i, group: g.key, groupLabel: g.label }))), ...utilityItems.map(u => ({ ...u, group: "settings", groupLabel: "Admin" }))];
          const here = allRows
            .filter(i => pathname === i.href || pathname?.startsWith(i.href + "/"))
            .sort((a, b) => b.href.length - a.href.length)[0];
          const hereGroup = sidebarGroups.find(g => g.key === here?.group);
          const hereHome = hereGroup ? GROUP_HOMES[hereGroup.key as Department] : undefined;
          const pillar = hereGroup ? (hereHome && hereGroup.items.find(i => i.href === hereHome)?.label) || hereGroup.label : "";
          const isHome = !!here && here.href === hereHome;
          return (
            <div style={{ background: "#131313", borderBottom: "1px solid rgba(255,255,255,0.13)", padding: "0 8px 0 4px", display: "flex", alignItems: "center", gap: 6, height: 52, flexShrink: 0 }}>
              <button type="button" onClick={() => setMenuOpen(true)} aria-label="Menu" aria-expanded={menuOpen}
                style={{ width: 44, height: 44, borderRadius: 10, border: "none", background: "transparent", color: "#fff", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                <Menu size={22} />
              </button>
              <div style={{ minWidth: 0, flex: 1, display: "flex", alignItems: "baseline", gap: 8, overflow: "hidden" }}>
                <span style={{ fontSize: 16, fontWeight: 800, color: "#fff", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{isHome || !here ? (pillar || companyName || "OpsHub") : here.label}</span>
                {!isHome && here && pillar && <span style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: "0.1em", textTransform: "uppercase", color: "rgba(255,255,255,0.45)", whiteSpace: "nowrap" }}>{pillar}</span>}
              </div>
              {inboxCount > 0 && (
                <Link href="/house" aria-label={`${inboxCount} in the inbox`} style={{ background: "#e8569b", color: "#fff", fontSize: 10.5, fontWeight: 800, padding: "3px 8px", borderRadius: 99, lineHeight: 1.3, minWidth: 20, textAlign: "center", textDecoration: "none", flexShrink: 0 }}>{inboxCount}</Link>
              )}
            </div>
          );
        })()}

        {isMobile && menuOpen && (
          <MobileNavMenu
            groups={sidebarGroups}
            homes={GROUP_HOMES as Record<string, string | undefined>}
            currentGroup={sidebarGroups.find(g => g.items.some(i => pathname === i.href || pathname?.startsWith(i.href + "/")))?.key || null}
            pathname={pathname || ""}
            inboxCount={inboxCount}
            sectionCounts={houseCounts}
            sectionByHref={HOUSE_SECTION_BY_HREF}
            utilities={[...utilityItems, ...(showRefs ? [{ href: "/references", label: "References" }] : []), ...sideQuestItems]}
            email={email}
            onClose={() => setMenuOpen(false)}
          />
        )}

        {/* ── Page content ── */}
        {/* --shell-pad is the ONE number hub-skin pages pull against
            (HUB_PAGE in components/hub/theme) — a hardcoded -24 was 24px
            wider than a phone (Jon, Sep 17). The body never scrolls
            sideways; wide tables scroll inside their own container. */}
        <div style={{
          flex: 1,
          padding: isMobile ? "12px 12px" : 24,
          paddingBottom: isMobile ? 76 : 24, // account for fixed bottom nav
          overflowY: "auto",
          overflowX: "hidden",
          minHeight: 0,
          ["--shell-pad" as any]: isMobile ? "12px" : "24px",
        }}>
          {children}
        </div>
      </div>

      {/* ── Mobile bottom bar — master search-as-nav (replaced the dept icon
          rail, Aug 13). One search finds pages, projects, clients, vendors,
          and items; the empty state IS the full grouped nav, so every child
          page is one tap away instead of hidden behind icons. ── */}
      {isMobile && (
        <div style={{
          position: "fixed", bottom: 0, left: 0, right: 0, zIndex: 50,
          background: "#000", borderTop: "1px solid #222",
          display: "flex", alignItems: "center", gap: 8,
          padding: "8px 10px calc(8px + env(safe-area-inset-bottom))",
        }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <GlobalSearch bar pages={searchPages} />
          </div>
          <button type="button" onClick={signOut} title="Sign out" aria-label="Sign out"
            style={{
              width: 44, height: 44, borderRadius: 10, flexShrink: 0,
              background: "transparent", border: "none", color: "#888", cursor: "pointer",
              display: "flex", alignItems: "center", justifyContent: "center",
            }}>
            <LogOut size={17} />
          </button>
        </div>
      )}
    </div>
  );
}


// ── MOBILE NAV MENU — the whole grouped nav in one sheet. The department
// you're in comes first and open (its pages with their grey counts); the
// other pillars sit collapsed beneath; admin utilities at the bottom.
function MobileNavMenu({ groups, homes, currentGroup, pathname, inboxCount, sectionCounts, sectionByHref, utilities, email, onClose }: {
  groups: { key: string; label: string; items: { href: string; label: string }[] }[];
  homes: Record<string, string | undefined>;
  currentGroup: string | null;
  pathname: string;
  inboxCount: number;
  sectionCounts: Record<string, number> | null;
  sectionByHref: Record<string, string>;
  utilities: { href: string; label: string }[];
  email?: string | null;
  onClose: () => void;
}) {
  const ordered = [...groups].sort((a, b) => (a.key === currentGroup ? -1 : 0) - (b.key === currentGroup ? -1 : 0));
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(currentGroup ? [currentGroup] : [ordered[0]?.key].filter(Boolean) as string[]));
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow; document.body.style.overflow = "hidden";
    return () => { window.removeEventListener("keydown", onKey); document.body.style.overflow = prev; };
  }, [onClose]);
  const toggle = (k: string) => setExpanded(prev => { const n = new Set(prev); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  const active = (href: string) => pathname === href || pathname.startsWith(href + "/");
  const row = (href: string, label: string, opts: { count?: number; badge?: number; indent?: boolean } = {}) => {
    const on = active(href);
    return (
      <Link key={href} href={href} onClick={onClose}
        style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, minHeight: 48, padding: opts.indent ? "0 14px 0 26px" : "0 14px", borderRadius: 10, textDecoration: "none", fontSize: 15, fontWeight: on ? 700 : 500, color: on ? "#fff" : "rgba(255,255,255,0.7)", background: on ? "rgba(255,255,255,0.10)" : "transparent" }}>
        <span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{label}</span>
        <span style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
          {!!opts.badge && <span style={{ background: "#e8569b", color: "#fff", fontSize: 10.5, fontWeight: 800, padding: "2px 8px", borderRadius: 99, lineHeight: 1.3, minWidth: 20, textAlign: "center" }}>{opts.badge}</span>}
          {!!opts.count && <span style={{ fontSize: 12, fontWeight: 800, fontFamily: "ui-monospace, 'SF Mono', Menlo, monospace", color: on ? "rgba(255,255,255,0.7)" : "rgba(255,255,255,0.38)" }}>{opts.count}</span>}
        </span>
      </Link>
    );
  };
  return (
    <div role="dialog" aria-modal="true" aria-label="Navigation" style={{ position: "fixed", inset: 0, zIndex: 120, background: "#0d0d0d", color: "#fff", display: "flex", flexDirection: "column" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 8px 0 18px", height: 52, borderBottom: "1px solid rgba(255,255,255,0.13)", flexShrink: 0 }}>
        <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: "0.14em", textTransform: "uppercase", color: "rgba(255,255,255,0.5)" }}>{email?.split("@")[0] || "menu"}</span>
        <button type="button" onClick={onClose} aria-label="Close menu" style={{ width: 44, height: 44, borderRadius: 10, border: "none", background: "transparent", color: "#fff", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}><X size={22} /></button>
      </div>
      <div style={{ flex: 1, overflowY: "auto", padding: "10px 8px calc(24px + env(safe-area-inset-bottom))" }}>
        {ordered.map(g => {
          const homeHref = homes[g.key];
          const head = homeHref ? g.items.find(i => i.href === homeHref) : undefined;
          const children = head ? g.items.filter(i => i !== head) : g.items;
          const open = expanded.has(g.key);
          const headOn = !!head && active(head.href);
          return (
            <div key={g.key} style={{ marginBottom: 6 }}>
              <div style={{ display: "flex", alignItems: "stretch", gap: 2 }}>
                {head ? (
                  <Link href={head.href} onClick={onClose}
                    style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, minHeight: 52, padding: "0 14px", borderRadius: 10, textDecoration: "none", fontSize: 19, fontWeight: 800, letterSpacing: "-0.01em", color: "#fff", background: headOn ? "rgba(255,255,255,0.10)" : "transparent" }}>
                    <span>{head.label}</span>
                    {head.href === "/house" && inboxCount > 0 && <span style={{ background: "#e8569b", color: "#fff", fontSize: 10.5, fontWeight: 800, padding: "2px 8px", borderRadius: 99, lineHeight: 1.3, minWidth: 20, textAlign: "center" }}>{inboxCount}</span>}
                  </Link>
                ) : (
                  <button type="button" onClick={() => toggle(g.key)}
                    style={{ flex: 1, display: "flex", alignItems: "center", minHeight: 52, padding: "0 14px", borderRadius: 10, border: "none", background: "transparent", color: "#fff", fontSize: 19, fontWeight: 800, letterSpacing: "-0.01em", textAlign: "left", cursor: "pointer", font: "inherit" }}>
                    {g.label}
                  </button>
                )}
                {children.length > 0 && (
                  <button type="button" onClick={() => toggle(g.key)} aria-label={open ? `Collapse ${g.label}` : `Expand ${g.label}`} aria-expanded={open}
                    style={{ width: 48, borderRadius: 10, border: "none", background: "transparent", color: "rgba(255,255,255,0.6)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
                    <ChevronDown size={20} style={{ transform: open ? "rotate(180deg)" : "none", transition: "transform .15s" }} />
                  </button>
                )}
              </div>
              {open && children.map(i => row(i.href, i.label, { indent: true, count: g.key === "labs" && sectionCounts ? sectionCounts[sectionByHref[i.href] || ""] || 0 : 0 }))}
            </div>
          );
        })}
        {utilities.length > 0 && (
          <div style={{ borderTop: "1px solid rgba(255,255,255,0.09)", marginTop: 10, paddingTop: 10 }}>
            {utilities.map(u => row(u.href, u.label))}
          </div>
        )}
      </div>
    </div>
  );
}
