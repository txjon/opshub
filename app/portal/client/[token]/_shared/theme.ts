import { parseDay, daysUntilDay } from "@/lib/dates";

// Shared theme + formatting helpers for the client portal shell and tabs.
// SHOP SKIN (Jul 20 2026): the client-facing hub follows the website's
// dark storefront — same world as components/hub/theme (H tokens). This
// C object keeps its historical KEYS so every tab restyles in one move;
// the VALUES are now the dark palette. Internal OpsHub stays light.

export const C = {
  bg: "#0a0a0a",                      // H.ink
  card: "#131313",                    // H.panel
  surface: "#1e1e1e",                 // H.surface
  border: "rgba(255,255,255,0.13)",   // H.line
  text: "#ffffff",
  muted: "rgba(255,255,255,0.6)",     // H.dim
  faint: "rgba(255,255,255,0.35)",    // H.faint
  accent: "#ffffff",
  green: "#58c93c",
  greenBg: "rgba(88,201,60,0.10)",
  greenBorder: "rgba(88,201,60,0.35)",
  amber: "#f4b22b",
  amberBg: "rgba(244,178,43,0.10)",
  amberBorder: "rgba(244,178,43,0.4)",
  red: "#ff5a6e",
  redBg: "rgba(255,90,110,0.12)",
  redBorder: "rgba(255,90,110,0.4)",
  purple: "#fd3aa3",
  purpleBg: "rgba(253,58,163,0.12)",
  purpleBorder: "rgba(253,58,163,0.4)",
  blue: "#8fc7d8",
  blueBg: "rgba(143,199,216,0.12)",
  blueBorder: "rgba(143,199,216,0.4)",
  font: "Inter, -apple-system, BlinkMacSystemFont, 'Helvetica Neue', sans-serif",
  mono: "ui-monospace, 'SF Mono', Menlo, monospace",
};

// Date-only values (client_eta, target_ship_date, paid_date, target_date,
// deadline) MUST NOT go through bare new Date() — that parses UTC midnight
// and renders the previous day in US timezones. parseDay split-parses them
// as local; full timestamps still go through new Date().
const asLocalDate = (iso: string) => (iso.includes("T") ? new Date(iso) : parseDay(iso));

export const fmtDate = (iso: string) => {
  const d = asLocalDate(iso);
  return d && !isNaN(d.getTime()) ? d.toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "";
};

export const fmtDateYear = (iso: string) => {
  const d = asLocalDate(iso);
  return d && !isNaN(d.getTime()) ? d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "";
};

export const daysUntil = (iso: string | null) => {
  const diff = daysUntilDay(iso);
  if (diff === null) return null;
  if (diff < 0) return { text: `${Math.abs(diff)}d overdue`, color: C.red };
  if (diff === 0) return { text: "today", color: C.red };
  if (diff <= 3) return { text: `${diff}d`, color: C.amber };
  return { text: `${diff}d`, color: C.muted };
};

// Proxied via /api/files/thumbnail?thumb=1 — returns Drive's pre-sized
// thumbnailLink (small, fast) instead of the full file, cached 24h.
export const thumbUrl = (id: string | null | undefined) =>
  id ? `/api/files/thumbnail?id=${id}&thumb=1` : null;
