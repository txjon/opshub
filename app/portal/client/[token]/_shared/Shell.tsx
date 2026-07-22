"use client";
import { ReactNode, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { C } from "./theme";
import { useClientPortal } from "./context";
import { getLogoSvgForSlug } from "@/lib/branding-client";

// The real wordmark, recolored for the dark ground (the branding SVG is
// black-filled for PDFs) and sized for chrome.
function LogoMark({ width = 170 }: { width?: number }) {
  const { data } = useClientPortal();
  const svg = getLogoSvgForSlug(data?.company?.slug || "hpd")
    .replace(/#000000/g, "#ffffff")
    .replace(/#161616/g, "#ffffff")
    .replace(/style="[^"]*"/, `style="width:${width}px;max-width:100%;height:auto;display:block"`);
  return <span style={{ display: "inline-block", lineHeight: 0, maxWidth: "100%" }} dangerouslySetInnerHTML={{ __html: svg }} />;
}

// The visual shell — header, tab nav, toast stack, mobile layout.
// Renders {children} (the current tab's page).
//
// Two nav surfaces, gated by CSS media query at 640px:
//   • Desktop: horizontal tabs under the header (the old layout).
//   • Mobile : fixed bottom tab bar with line icons + labels, thumb-
//     reach. The top header tabs are hidden on mobile so the screen
//     real estate goes to content. Both render in the DOM at all
//     sizes — switching is a media-query swap, no JS viewport detect,
//     so SSR + first paint match.
//
// Staging tab shelved 2026-05-17 — release planner is on hold while we
// rework the fulfillment flow. The /staging route still exists so any
// bookmarked URLs don't 404, but it's no longer linked from the shell.

type TabIcon = (active: boolean) => ReactNode;

// Inline line-icons. 24×24, 1.6 stroke, no fill — matches SF Symbols'
// outline style at a similar weight. Active state swaps to fill.
const ICONS: Record<string, TabIcon> = {
  Overview: (active) => (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth={active ? 2 : 1.6}
      strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 11.5 12 4l9 7.5" />
      <path d="M5 10v9.5A1.5 1.5 0 0 0 6.5 21H10V14h4v7h3.5a1.5 1.5 0 0 0 1.5-1.5V10" />
    </svg>
  ),
  Designs: (active) => (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth={active ? 2 : 1.6}
      strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="18" height="18" rx="3" />
      <circle cx="8.5" cy="9.5" r="1.5" />
      <path d="m21 16-5-5-9 9" />
    </svg>
  ),
  Items: (active) => (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth={active ? 2 : 1.6}
      strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="8" height="8" rx="1.5" />
      <rect x="13" y="3" width="8" height="8" rx="1.5" />
      <rect x="3" y="13" width="8" height="8" rx="1.5" />
      <rect x="13" y="13" width="8" height="8" rx="1.5" />
    </svg>
  ),
  Orders: (active) => (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth={active ? 2 : 1.6}
      strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 3h9l4 4v13a1.5 1.5 0 0 1-1.5 1.5h-11.5A1.5 1.5 0 0 1 4.5 20V4.5A1.5 1.5 0 0 1 6 3Z" />
      <path d="M14 3v5h5" />
      <path d="M8 13h8M8 17h5" />
    </svg>
  ),
  Studio: (active) => (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth={active ? 2 : 1.6}
      strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3l1.9 5.6L20 10l-6.1 1.4L12 17l-1.9-5.6L4 10l6.1-1.4L12 3Z" />
      <path d="M19 15l.9 2.6L22 18l-2.1.9L19 21l-.9-2.1L16 18l2.1-.4L19 15Z" />
    </svg>
  ),
  Drops: (active) => (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth={active ? 2 : 1.6}
      strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3c3.5 1.8 5.5 5.2 5.5 9.2L12 21l-5.5-8.8C6.5 8.2 8.5 4.8 12 3Z" />
      <circle cx="12" cy="10" r="1.8" />
    </svg>
  ),
  Reorder: (active) => (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth={active ? 2 : 1.6}
      strokeLinecap="round" strokeLinejoin="round">
      <circle cx="9" cy="20" r="1.5" />
      <circle cx="18" cy="20" r="1.5" />
      <path d="M2.5 3.5h2.5l2.4 12.2a1.5 1.5 0 0 0 1.47 1.2h8.9a1.5 1.5 0 0 0 1.46-1.16L21.5 8H6" />
    </svg>
  ),
};

// display labels renamed Jul 20 (Jon): Home / Product Development /
// Pipeline. Routes unchanged — /designs and /items keep their URLs.
const TABS: { label: keyof typeof ICONS; path: string; display: string; unreadKey?: "designs" }[] = [
  { label: "Overview", display: "Home", path: "" },
  // Product Development (the old /designs surface) stays unlisted; the
  // Studio (grant 'studio') is its stripped-down replacement.
  { label: "Studio", display: "Studio", path: "/studio" },
  { label: "Drops", display: "Drops", path: "/drops" },
  { label: "Orders", display: "Orders", path: "/orders" },
  { label: "Items", display: "Pipeline", path: "/items" },
  // "Catalog" (Jon, Jul 22): one vocabulary on both sides of the glass — the
  // client's catalog is what we call it too (rack/reorder retired as names).
  // Route unchanged, same pattern as the Jul 20 renames.
  { label: "Reorder", display: "Catalog", path: "/reorder" },
];

export default function Shell({ children }: { children: ReactNode }) {
  const { data, loading, error, token, toasts, dismissToast } = useClientPortal();
  const pathname = usePathname();
  const base = `/portal/client/${token}`;

  if (loading) return <CenterMsg msg="Loading…" />;
  if (error) return <CenterMsg msg={error} err />;
  if (!data) return <CenterMsg msg="Nothing here" />;

  const unreadCounts: Record<NonNullable<(typeof TABS)[number]["unreadKey"]>, number> = {
    designs: data.briefs.filter(b => b.has_unread_external).length,
  };

  // Feature grants (mig 132): Pipeline is a granted surface — standard-tier
  // clients see Home / Orders / Reorder only.
  const features: string[] = (data as any).features || [];
  const visibleTabs = TABS.filter(t =>
    (t.path !== "/items" || features.includes("pipeline")) &&
    (t.path !== "/studio" || features.includes("studio")) &&
    (t.path !== "/drops" || features.includes("studio")));

  const isActive = (path: string) =>
    path === "" ? pathname === base || pathname === base + "/" : !!pathname?.startsWith(base + path);

  // Website header: one slim fixed bar, wordmark always centered,
  // nav lives in the hamburger. Content starts right beneath it.
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <div className="portal-shell" style={{ minHeight: "100vh", background: C.bg, fontFamily: C.font, color: C.text }}>
      <style>{`
        .portal-desk-head, .portal-fixed-head { display: none; }
        @media (max-width: 640px) {
          .portal-top-tabs { display: none !important; }
          .portal-main { padding-bottom: calc(72px + env(safe-area-inset-bottom)) !important; }
        }
        @media (min-width: 641px) {
          .portal-bottom-nav { display: none !important; }
          .portal-mobile-head { display: none !important; }
          .portal-top-tabs { display: none !important; }
          .portal-fixed-head { display: flex; }
          .portal-main { padding-top: 78px !important; }
        }
        .portal-tab-active-pill {
          background: ${C.surface};
        }
      `}</style>

      {/* Fixed header — hamburger + centered wordmark, always on */}
      {(
        <div className="portal-fixed-head" style={{ position: "fixed", top: 0, left: 0, right: 0, zIndex: 90, alignItems: "center", padding: "12px 20px", background: "rgba(10,10,10,0.92)", backdropFilter: "blur(10px)", borderBottom: `1px solid ${C.border}` }}>
          <button onClick={() => setMenuOpen(true)} aria-label="Menu"
            style={{ background: "none", border: "none", cursor: "pointer", padding: 6, display: "flex", flexDirection: "column", gap: 5 }}>
            <span style={{ width: 22, height: 2, background: C.text, display: "block" }} />
            <span style={{ width: 22, height: 2, background: C.text, display: "block" }} />
          </button>
          <div style={{ flex: 1, display: "flex", justifyContent: "center" }}>
            <Link href={base}><LogoMark width={168} /></Link>
          </div>
          <div style={{ width: 34 }} />
        </div>
      )}

      {/* Hamburger menu overlay */}
      {menuOpen && (
        <div style={{ position: "fixed", inset: 0, zIndex: 200, background: C.bg, display: "flex", flexDirection: "column", padding: "26px 38px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <button onClick={() => setMenuOpen(false)} aria-label="Close menu" style={{ background: "none", border: "none", color: C.text, fontSize: 30, cursor: "pointer", lineHeight: 1, padding: 4 }}>×</button>
            <LogoMark width={168} />
            <div style={{ width: 38 }} />
          </div>
          <nav style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 48 }}>
            {visibleTabs.map(t => (
              <Link key={t.label} href={base + t.path} onClick={() => setMenuOpen(false)}
                style={{ fontSize: "clamp(17px,2vw,22px)", fontWeight: 900, letterSpacing: "-0.01em", textTransform: "uppercase", color: isActive(t.path) ? C.text : C.muted, textDecoration: "none", padding: "8px 0" }}>
                {t.display}
              </Link>
            ))}
          </nav>
          <div style={{ marginTop: "auto", fontSize: 9, fontWeight: 800, letterSpacing: "0.14em", textTransform: "uppercase", color: C.faint }}>Built in Las Vegas</div>
        </div>
      )}

      <div className="portal-content">

      {/* Toasts — polling-driven, dismissable */}
      <div style={{
        position: "fixed", top: 16, right: 16, zIndex: 2000,
        display: "flex", flexDirection: "column", gap: 8, maxWidth: 320,
      }}>
        {toasts.map(t => (
          <Link key={t.id} href={`${base}/designs?brief=${t.briefId}`}
            onClick={() => dismissToast(t.id)}
            style={{
              background: C.card, border: `2px solid ${C.red}`, borderRadius: 8,
              padding: "10px 14px", cursor: "pointer",
              boxShadow: "0 6px 20px rgba(0,0,0,0.12)", textDecoration: "none",
            }}>
            <div style={{ fontSize: 9, fontWeight: 800, color: C.red, letterSpacing: "0.08em", marginBottom: 3 }}>NEW</div>
            <div style={{ fontSize: 13, fontWeight: 700, color: C.text, marginBottom: 2 }}>{t.title}</div>
            <div style={{ fontSize: 11, color: C.muted }}>{t.preview}</div>
          </Link>
        ))}
      </div>

      {/* Header — site chrome: lowercase wordmark centered, client name
          small and tracked beneath, nav as wide-tracked uppercase links. */}
      <header className="portal-mobile-head" style={{
        background: C.bg, borderBottom: `1px solid ${C.border}`,
        padding: "20px 20px 14px",
      }}>
        <div style={{ textAlign: "center" }}>
          <LogoMark width={170} />
          <div style={{ fontSize: 10, fontWeight: 800, marginTop: 8, color: C.faint, letterSpacing: "0.16em", textTransform: "uppercase" }}>
            {data.client.name}
          </div>
        </div>

        {/* Desktop tab nav — hidden on mobile via CSS. */}
        <nav className="portal-top-tabs" style={{
          margin: "16px auto 0",
          display: "flex", gap: 26, overflowX: "auto",
          scrollbarWidth: "none", justifyContent: "center",
        }}>
          {TABS.map(t => {
            const href = base + t.path;
            const active = isActive(t.path);
            const unread = t.unreadKey ? unreadCounts[t.unreadKey] : 0;
            return (
              <Link key={t.label} href={href}
                style={{
                  padding: "10px 2px 12px", minHeight: 44,
                  display: "flex", alignItems: "center", gap: 6,
                  fontSize: 11, fontWeight: 800,
                  letterSpacing: "0.14em", textTransform: "uppercase",
                  color: active ? C.text : C.muted,
                  textDecoration: "none",
                  borderBottom: active ? `2px solid ${C.text}` : "2px solid transparent",
                  whiteSpace: "nowrap",
                  transition: "color 0.15s",
                }}>
                {t.display}
                {unread > 0 && (
                  <span style={{
                    background: C.purple, color: "#fff",
                    fontSize: 10, fontWeight: 800,
                    minWidth: 18, height: 18, padding: "0 5px",
                    borderRadius: 9, display: "inline-flex",
                    alignItems: "center", justifyContent: "center",
                    lineHeight: 1,
                  }}>
                    {unread > 99 ? "99+" : unread}
                  </span>
                )}
              </Link>
            );
          })}
        </nav>
      </header>

      <main className="portal-main" style={{
        maxWidth: 1200, margin: "0 auto",
        padding: "clamp(16px, 4vw, 32px) clamp(12px, 3vw, 24px) 60px",
      }}>
        {children}
      </main>

      {/* Mobile bottom nav — hidden on desktop via CSS. Fixed to the
          bottom edge, safe-area aware. Each tab is icon + label,
          minimum 44px touch target. Active tab swaps stroke weight on
          the icon and pulls the label to full text color. Unread
          badges ride on the icon corner like iOS. */}
      <nav className="portal-bottom-nav" style={{
        position: "fixed", left: 0, right: 0, bottom: 0, zIndex: 100,
        background: C.card,
        borderTop: `1px solid ${C.border}`,
        paddingBottom: "env(safe-area-inset-bottom)",
        display: "flex",
        justifyContent: "space-around",
        boxShadow: "0 -2px 12px rgba(0,0,0,0.04)",
      }}>
        {visibleTabs.map(t => {
          const href = base + t.path;
          const active = isActive(t.path);
          const unread = t.unreadKey ? unreadCounts[t.unreadKey] : 0;
          return (
            <Link key={t.label} href={href}
              style={{
                flex: 1,
                display: "flex", alignItems: "center", justifyContent: "center",
                padding: "16px 4px",
                minHeight: 58,
                color: active ? C.text : C.muted,
                textDecoration: "none",
                position: "relative",
                transition: "color 0.15s",
              }}>
              <span style={{
                fontSize: 12, fontWeight: 800,
                letterSpacing: "0.1em", textTransform: "uppercase",
                position: "relative",
              }}>
                {t.display}
                {unread > 0 && (
                  <span style={{
                    position: "absolute", top: -7, right: -14,
                    background: C.purple, color: "#fff",
                    fontSize: 9, fontWeight: 800,
                    minWidth: 15, height: 15, padding: "0 4px",
                    borderRadius: 8, display: "inline-flex",
                    alignItems: "center", justifyContent: "center",
                    lineHeight: 1,
                  }}>
                    {unread > 9 ? "9+" : unread}
                  </span>
                )}
              </span>
            </Link>
          );
        })}
      </nav>
      </div>
    </div>
  );
}

function CenterMsg({ msg, err = false }: { msg: string; err?: boolean }) {
  return (
    <div style={{
      minHeight: "100vh", background: C.bg,
      display: "flex", alignItems: "center", justifyContent: "center",
      fontFamily: C.font,
    }}>
      <div style={{
        padding: "16px 20px", background: err ? C.redBg : C.card,
        border: `1px solid ${err ? C.redBorder : C.border}`,
        borderRadius: 10, color: err ? C.red : C.text,
        fontSize: 14, fontWeight: 600,
      }}>
        {msg}
      </div>
    </div>
  );
}
