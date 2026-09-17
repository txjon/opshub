// Client Hub V2 — the SHOP skin (Jon's V2 aesthetic call, locked Jul 20 2026):
// black ground, white lowercase wordmark, wide-tracked uppercase labels, giant
// display headlines with the trailing period. The client-facing world follows
// housepartydistro.com; the internal app stays light. One token source so the
// per-job portal and the Client Hub can't drift as they merge.

export const H = {
  ink: "#0a0a0a",          // page ground
  panel: "#131313",        // bands / cards
  card: "#161616",         // modals
  surface: "#1e1e1e",      // inputs, wells
  line: "rgba(255,255,255,0.13)",
  text: "#ffffff",
  dim: "rgba(255,255,255,0.6)",
  faint: "rgba(255,255,255,0.35)",
  amber: "#f4b22b",
  green: "#58c93c",
  blue: "#8fc7d8",
  red: "#ff5a6e",
  font: "Inter, -apple-system, BlinkMacSystemFont, 'Helvetica Neue', sans-serif",
  mono: "ui-monospace, 'SF Mono', Menlo, monospace",
};

// Theme object for PackageApproval (it's portal-agnostic and styles itself
// entirely from this shape). accentText makes the primary pill white-on-ink.
// The hub-skin page wrapper: bleeds to the shell's edges by exactly the
// shell's own padding (--shell-pad, set by AppShell per breakpoint) and pads
// back in by the same amount. Never hardcode -24 here again.
export const HUB_PAGE = {
  background: H.ink,
  minHeight: "100vh",
  margin: "calc(-1 * var(--shell-pad, 24px))",
  padding: "var(--shell-pad, 24px)",
  color: H.text,
  fontFamily: H.font,
  minWidth: 0,
} as const;

export const H_APPROVAL_THEME = {
  font: H.font,
  card: H.panel,
  border: H.line,
  text: H.text,
  muted: H.dim,
  faint: H.faint,
  surface: H.surface,
  accent: "#ffffff",
  accentText: H.ink,
  amber: H.amber,
  amberBg: "rgba(244,178,43,0.10)",
  amberBorder: "rgba(244,178,43,0.4)",
  green: H.green,
  greenBg: "rgba(88,201,60,0.10)",
  greenBorder: "rgba(88,201,60,0.35)",
};

// Client-facing money ALWAYS shows cents — hub numbers must match the
// QuickBooks invoice to the cent (Jon, Jul 26; rounding read as a mismatch).
export const fmtMoney = (n: number | null | undefined) =>
  n == null ? "" : "$" + Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
