// THE STUDIO's palette + control styles — ONE source for the studio page, the
// designer-lane components, and the designer's public page. (Extracted from
// app/(dashboard)/studio/page.tsx on Aug 26 2026 when Room 2 graduated; the
// studio is the one deliberately dark surface, mirroring the Lab it grew from.)
import type { CSSProperties } from "react";

export const H = {
  ink: "#0a0a0a", panel: "#131313", surface: "#1e1e1e",
  line: "rgba(255,255,255,.13)", line2: "rgba(255,255,255,.07)",
  text: "#fff", dim: "rgba(255,255,255,.6)", faint: "rgba(255,255,255,.38)",
  amber: "#f4b22b", green: "#58c93c", blue: "#8fc7d8", red: "#ff5a6e",
  font: "Inter, -apple-system, BlinkMacSystemFont, 'Helvetica Neue', Arial, sans-serif",
  mono: "ui-monospace, 'SF Mono', Menlo, monospace",
};

export const primaryBtn: CSSProperties = { background: "#fff", color: H.ink, border: "none", borderRadius: 999, padding: "10px 18px", fontSize: 11, fontWeight: 800, letterSpacing: "0.05em", textTransform: "uppercase", cursor: "pointer", fontFamily: H.font };
export const ghostBtn: CSSProperties = { background: "transparent", color: H.text, border: `1px solid ${H.line}`, borderRadius: 999, padding: "10px 14px", fontSize: 10.5, fontWeight: 800, letterSpacing: "0.05em", textTransform: "uppercase", cursor: "pointer", fontFamily: H.font };
export const inp: CSSProperties = { width: "100%", boxSizing: "border-box", background: H.surface, border: `1px solid ${H.line}`, borderRadius: 9, color: H.text, fontSize: 13, padding: "9px 11px", outline: "none", fontFamily: H.font };
export const lbl: CSSProperties = { display: "block", fontSize: 9, fontWeight: 800, letterSpacing: "0.12em", textTransform: "uppercase", color: H.faint, marginBottom: 6 };
// flat uppercase color-text label (house rule: no pills)
export const tag = (color: string, size = 9.5): CSSProperties => ({ fontSize: size, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", color });

export const fmtStamp = (iso?: string | null) => iso ? new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "";
export const fmtDue = (iso?: string | null) => iso ? new Date(iso + "T00:00:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }) : "";
// "2h ago" / "3d ago" — the desk's clock
export function ago(iso?: string | null): string {
  if (!iso) return "";
  const m = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60); if (h < 36) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}
