// Shared theme + formatting helpers for the client portal shell and tabs.
// Document-style (light) palette — matches designer + vendor portals.

export const C = {
  bg: "#f8f8f9", card: "#ffffff", surface: "#f3f3f5", border: "#e0e0e4",
  text: "#1a1a1a", muted: "#6b6b78", faint: "#a0a0ad",
  accent: "#1a1a1a",
  green: "#1a8c5c", greenBg: "#edf7f2", greenBorder: "#b4dfc9",
  amber: "#b45309", amberBg: "#fef9ee", amberBorder: "#f5dfa8",
  red: "#c43030", redBg: "#fdf2f2", redBorder: "#f0c0c0",
  purple: "#7c3aed", purpleBg: "#f3ebfd", purpleBorder: "#d9c7f2",
  blue: "#2d7a8f", blueBg: "#e0f2f7", blueBorder: "#b6dce6",
  font: "'Inter', -apple-system, BlinkMacSystemFont, 'Helvetica Neue', sans-serif",
  mono: "'SF Mono', 'IBM Plex Mono', Menlo, monospace",
};

export const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });

export const fmtDateYear = (iso: string) =>
  new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

export const daysUntil = (iso: string | null) => {
  if (!iso) return null;
  const diff = Math.ceil((new Date(iso).getTime() - Date.now()) / 86400000);
  if (diff < 0) return { text: `${Math.abs(diff)}d overdue`, color: C.red };
  if (diff === 0) return { text: "today", color: C.red };
  if (diff <= 3) return { text: `${diff}d`, color: C.amber };
  return { text: `${diff}d`, color: C.muted };
};

// Proxied via /api/files/thumbnail?thumb=1 — returns Drive's pre-sized
// thumbnailLink (small, fast) instead of the full file, cached 24h.
export const thumbUrl = (id: string | null | undefined) =>
  id ? `/api/files/thumbnail?id=${id}&thumb=1` : null;
