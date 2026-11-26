"use client";
// THE VERDICT ROW (mig 215, Jon Nov 26 2026): As is · Change · Pass, one slim
// row on every line sheet card, the client's page AND HPD's builder. The pick
// fills in solid; tap it again to undo (back to Concepts). Read by shape, fill
// and word, never colour alone (Dante is red-green colourblind).
import type { Verdict } from "@/lib/line-sheets";

export type VerdictPalette = { line: string; dim: string; ink: string; green: string; amber: string; red: string; font: string };
type Settable = "asis" | "change" | "pass";

const Icon = ({ v, size }: { v: Settable; size: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    {v === "asis" && <path d="M20 6 9 17l-5-5" />}
    {v === "change" && <><path d="M12 20h9" /><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" /></>}
    {v === "pass" && <><path d="M18 6 6 18" /><path d="m6 6 12 12" /></>}
  </svg>
);

export const VERDICT_WORD: Record<Settable, string> = { asis: "As is", change: "Change", pass: "Pass" };

// value = the saved verdict; pending = a Change waiting on its note (outlined,
// not filled, until the note saves).
export function VerdictRow({ value, pending, onPick, p, compact, disabled }: {
  value: Verdict | null; pending?: boolean; onPick: (v: Settable) => void; p: VerdictPalette; compact?: boolean; disabled?: boolean;
}) {
  const col: Record<Settable, string> = { asis: p.green, change: p.amber, pass: p.red };
  return (
    <div role="group" aria-label="Verdict" style={{ display: "flex", gap: compact ? 4 : 6 }}>
      {(["asis", "change", "pass"] as Settable[]).map(v => {
        const on = value === v;
        const half = !on && pending && v === "change";
        return (
          <button key={v} type="button" disabled={disabled} aria-pressed={on}
            title={on ? `${VERDICT_WORD[v]} · tap again to undo` : VERDICT_WORD[v]}
            onClick={e => { e.stopPropagation(); onPick(v); }}
            // preventDefault: the tap never steals focus, so an open note box
            // stays open and the page reads what's in it (no blur-vs-tap race)
            onMouseDown={e => { e.preventDefault(); e.stopPropagation(); }} onTouchStart={e => e.stopPropagation()}
            style={{
              flex: 1, minWidth: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 2,
              padding: compact ? "5px 0 4px" : "7px 0 6px", borderRadius: 8, cursor: disabled ? "default" : "pointer", fontFamily: p.font,
              border: `1.5px solid ${on || half ? col[v] : p.line}`,
              background: on ? col[v] : "transparent",
              color: on ? p.ink : half ? col[v] : p.dim,
            }}>
            <Icon v={v} size={compact ? 13 : 15} />
            <span style={{ fontSize: compact ? 8.5 : 9.5, fontWeight: 800, letterSpacing: "0.06em", textTransform: "uppercase", lineHeight: 1 }}>{VERDICT_WORD[v]}</span>
          </button>
        );
      })}
    </div>
  );
}
