"use client";
import { ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { C } from "./theme";
import { useClientPortal } from "./context";

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

const TABS: { label: keyof typeof ICONS; path: string; unreadKey?: "designs" }[] = [
  { label: "Overview", path: "" },
  { label: "Designs", path: "/designs", unreadKey: "designs" },
  { label: "Orders", path: "/orders" },
  { label: "Items", path: "/items" },
  { label: "Reorder", path: "/reorder" },
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

  const isActive = (path: string) =>
    path === "" ? pathname === base || pathname === base + "/" : !!pathname?.startsWith(base + path);

  return (
    <div style={{ minHeight: "100vh", background: C.bg, fontFamily: C.font, color: C.text }}>
      <style>{`
        @media (max-width: 640px) {
          .portal-top-tabs { display: none !important; }
          .portal-main { padding-bottom: calc(72px + env(safe-area-inset-bottom)) !important; }
        }
        @media (min-width: 641px) {
          .portal-bottom-nav { display: none !important; }
        }
        .portal-tab-active-pill {
          background: ${C.surface};
        }
      `}</style>

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
      <header style={{
        background: C.bg, borderBottom: `1px solid ${C.border}`,
        padding: "22px 20px 0",
      }}>
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: 21, fontWeight: 800, letterSpacing: "-0.01em", textTransform: "lowercase", color: C.text }}>
            {(data.company?.name || "House Party Distro").toLowerCase()}
          </div>
          <div style={{ fontSize: 10, fontWeight: 800, marginTop: 5, color: C.faint, letterSpacing: "0.16em", textTransform: "uppercase" }}>
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
                {t.label}
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
        {TABS.map(t => {
          const href = base + t.path;
          const active = isActive(t.path);
          const unread = t.unreadKey ? unreadCounts[t.unreadKey] : 0;
          return (
            <Link key={t.label} href={href}
              style={{
                flex: 1,
                display: "flex", flexDirection: "column",
                alignItems: "center", justifyContent: "center",
                gap: 3,
                padding: "8px 4px 10px",
                minHeight: 56,
                color: active ? C.text : C.muted,
                textDecoration: "none",
                position: "relative",
                transition: "color 0.15s",
              }}>
              <div style={{ position: "relative", lineHeight: 0 }}>
                {ICONS[t.label](active)}
                {unread > 0 && (
                  <span style={{
                    position: "absolute", top: -3, right: -8,
                    background: C.purple, color: "#fff",
                    fontSize: 9, fontWeight: 800,
                    minWidth: 16, height: 16, padding: "0 4px",
                    borderRadius: 8, display: "inline-flex",
                    alignItems: "center", justifyContent: "center",
                    lineHeight: 1, border: `2px solid ${C.card}`,
                  }}>
                    {unread > 9 ? "9+" : unread}
                  </span>
                )}
              </div>
              <span style={{
                fontSize: 10, fontWeight: active ? 700 : 600,
                letterSpacing: "0.01em",
              }}>{t.label}</span>
            </Link>
          );
        })}
      </nav>
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
