"use client";
import { ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { C } from "./theme";
import { useClientPortal } from "./context";

// The visual shell — header with client name, tab nav, toast stack, mobile
// layout. Renders {children} (the current tab's page).
//
// Mobile: header stacks, tab nav horizontally scrolls, padding shrinks. No
// separate mobile layout — just responsive CSS.

const TABS = [
  { label: "Overview", path: "" },
  { label: "Designs", path: "/designs" },
  { label: "Items", path: "/items" },
  { label: "Orders", path: "/orders" },
  { label: "Staging", path: "/staging" },
];

export default function Shell({ children }: { children: ReactNode }) {
  const { data, loading, error, token, toasts, dismissToast } = useClientPortal();
  const pathname = usePathname();
  const base = `/portal/client/${token}`;

  if (loading) return <CenterMsg msg="Loading…" />;
  if (error) return <CenterMsg msg={error} err />;
  if (!data) return <CenterMsg msg="Nothing here" />;

  return (
    <div style={{ minHeight: "100vh", background: C.bg, fontFamily: C.font, color: C.text }}>
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

      {/* Header */}
      <header style={{
        background: C.card, borderBottom: `1px solid ${C.border}`,
        padding: "14px 20px",
      }}>
        <div style={{
          maxWidth: 1200, margin: "0 auto",
          display: "flex", alignItems: "center", justifyContent: "space-between",
          gap: 12, flexWrap: "wrap",
        }}>
          <div>
            <div style={{
              fontSize: 10, color: C.muted, fontWeight: 700,
              letterSpacing: "0.1em", textTransform: "uppercase",
            }}>
              House Party Distro
            </div>
            <div style={{ fontSize: 18, fontWeight: 700, marginTop: 2 }}>
              {data.client.name}
            </div>
          </div>
        </div>

        {/* Tab nav */}
        <nav style={{
          maxWidth: 1200, margin: "12px auto 0",
          display: "flex", gap: 4, overflowX: "auto",
          scrollbarWidth: "none",
        }}>
          {TABS.map(t => {
            const href = base + t.path;
            const active = t.path === ""
              ? pathname === base || pathname === base + "/"
              : pathname?.startsWith(href);
            return (
              <Link key={t.label} href={href}
                style={{
                  padding: "8px 16px", minHeight: 44,
                  display: "flex", alignItems: "center",
                  fontSize: 13, fontWeight: 700,
                  color: active ? C.text : C.muted,
                  textDecoration: "none",
                  borderBottom: active ? `2px solid ${C.text}` : "2px solid transparent",
                  whiteSpace: "nowrap",
                  transition: "color 0.15s",
                }}>
                {t.label}
              </Link>
            );
          })}
        </nav>
      </header>

      <main style={{
        maxWidth: 1200, margin: "0 auto",
        padding: "clamp(16px, 4vw, 32px) clamp(12px, 3vw, 24px) 60px",
      }}>
        {children}
      </main>
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
