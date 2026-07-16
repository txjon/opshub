import { parseDay, daysUntilDay } from "@/lib/dates";
// Vendor portal theme + formatting helpers. Independent copy of the
// client portal's _shared/theme — Jon wants the two portals
// visually consistent but logically separated so they can evolve
// without one breaking the other.

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

// "ASAP" is a valid ship-date sentinel set on the PO tab when the
// internal team wants the decorator to ship as soon as the print run
// is done (no specific calendar date). Pass it through verbatim
// instead of trying to parse it as an ISO string.
// Date-only strings (po_ship_dates, target_ship_date) must parse as LOCAL
// dates — bare new Date("YYYY-MM-DD") is UTC midnight and rendered the
// previous day here, which made the hub disagree with the PO PDF by a day.
const asLocalDate = (iso: string) => (iso.includes("T") ? new Date(iso) : parseDay(iso));

export const fmtDate = (iso: string) => {
  if (iso === "ASAP") return "ASAP";
  const d = asLocalDate(iso);
  return d && !isNaN(d.getTime()) ? d.toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "";
};

export const fmtDateYear = (iso: string) => {
  if (iso === "ASAP") return "ASAP";
  const d = asLocalDate(iso);
  return d && !isNaN(d.getTime()) ? d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "";
};

export const fmtDateLong = (iso: string) => {
  if (iso === "ASAP") return "ASAP";
  const d = asLocalDate(iso);
  return d && !isNaN(d.getTime()) ? d.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" }) : "";
};

export const fmtMoney = (n: number) =>
  "$" + Number(n || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// Same countdown vocabulary as the client portal. Late = red, within
// 3 days = amber, anything later = neutral muted (no "green ahead of
// schedule" — vendor doesn't need a thumbs-up, just an alert level).
export const daysUntil = (iso: string | null) => {
  if (!iso) return null;
  if (iso === "ASAP") return { text: "ASAP", color: C.red, urgent: true };
  const diff = daysUntilDay(iso);
  if (diff === null) return null;
  if (diff < 0) return { text: `${Math.abs(diff)}d late`, color: C.red, urgent: true };
  if (diff === 0) return { text: "today", color: C.red, urgent: true };
  if (diff <= 3) return { text: `${diff}d`, color: C.amber, urgent: true };
  if (diff <= 7) return { text: `${diff}d`, color: C.amber, urgent: false };
  return { text: `${diff}d`, color: C.muted, urgent: false };
};
