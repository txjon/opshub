import { parseDay, daysUntilDay } from "@/lib/dates";

// Shared theme + formatting helpers for the client portal shell and tabs.
// Mirrors OpsHub's T palette from lib/theme.ts so portals look like
// extensions of the dashboard, not their own brand. Borders are derived
// from each color's *Dim background tone.

export const C = {
  bg: "#f4f4f6",        // T.bg
  card: "#ffffff",      // T.card
  surface: "#eaeaee",   // T.surface
  border: "#dcdce0",    // T.border
  text: "#1a1a1a",      // T.text
  muted: "#6b6b78",     // T.muted
  faint: "#a0a0ad",     // T.faint
  accent: "#000000",    // T.accent
  green: "#47b12b",     // T.green
  greenBg: "#e5f9ed",   // T.greenDim
  greenBorder: "#bdebd0",
  amber: "#f4b22b",     // T.amber
  amberBg: "#fef5e0",   // T.amberDim
  amberBorder: "#f5dfa8",
  red: "#ff324d",       // T.red
  redBg: "#ffe8ec",     // T.redDim
  redBorder: "#ffc3cc",
  purple: "#fd3aa3",    // T.purple
  purpleBg: "#fee8f4",  // T.purpleDim
  purpleBorder: "#fbc3df",
  blue: "#73b6c9",      // T.blue
  blueBg: "#e3f1f5",    // T.blueDim
  blueBorder: "#bbdde6",
  font: "'IBM Plex Sans', 'Helvetica Neue', Arial, sans-serif",
  mono: "'IBM Plex Mono', 'Courier New', monospace",
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
