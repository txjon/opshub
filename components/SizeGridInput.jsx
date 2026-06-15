"use client";
import { useRef } from "react";
import { parseSizeMatrix, splitColHead } from "@/lib/size-grid";
import { T, mono } from "@/lib/theme";

// Editable cut-ticket grid for size/qty ENTRY. Same waist x inseam pivot as the
// read-only <SizeGrid/>, but every existing variant is an input wired to the
// caller's qty handlers, with live row / column / grand totals. Returns null for
// 1-D sizes (S/M/L) so the caller keeps its simple inline layout.
//
// Handlers are keyed by the ORIGINAL size label (e.g. "Relaxed / 32 / 34 (Long)")
// so the grid drops into existing per-label state (getLocalQty/commitQty/etc).
// Vertical nav: Enter / ArrowDown / ArrowUp move within a column. Horizontal nav
// is the browser's native Tab order (table DOM order = left-to-right, top-down).
export default function SizeGridInput({ sizes, getValue, onChange, onCommit, disabled, ic }) {
  const matrix = parseSizeMatrix(sizes, null); // presence mode → structure only
  const refs = useRef({});
  if (!matrix) return null;

  // (group||"") ~ waist ~ inseam  ->  original size label
  const labelLookup = {};
  for (const sz of sizes) {
    const p = String(sz).split(" / ").map((s) => s.trim());
    if (p.length >= 3) labelLookup[`${p[0]}~${p[1]}~${p.slice(2).join(" / ")}`] = sz;
    else if (p.length === 2) labelLookup[`~${p[0]}~${p[1]}`] = sz;
  }
  const num = (label) => { const n = parseInt(getValue(label), 10); return isNaN(n) ? 0 : n; };
  const focus = (gi, ri, ci) => { const el = refs.current[`${gi}-${ri}-${ci}`]; if (el) { el.focus(); el.select?.(); } };

  const th = { padding: "3px 7px", fontSize: 9, fontWeight: 700, color: T.faint, textAlign: "center", borderBottom: `1px solid ${T.border}`, whiteSpace: "nowrap" };
  const totCell = { padding: "3px 7px", fontSize: 12, textAlign: "center", fontFamily: mono, fontWeight: 700, color: T.text, background: T.surface };
  const cellInput = { ...ic, width: 46, height: 32, textAlign: "center", fontSize: 13, fontWeight: 600, padding: "2px", boxSizing: "border-box", opacity: disabled ? 0.5 : 1 };

  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 20, alignItems: "flex-start", overflowX: "auto" }}>
      {matrix.groups.map((g, gi) => {
        const colTotals = g.cols.map(() => 0);
        let grand = 0;
        const rows = g.rows.map((r, ri) => {
          let rowTot = 0;
          const cells = g.cols.map((c, ci) => {
            const label = labelLookup[`${g.name ?? ""}~${r.label}~${c}`];
            if (label) { const v = num(label); colTotals[ci] += v; rowTot += v; grand += v; }
            return { label, ci };
          });
          return { r, ri, cells, rowTot };
        });
        return (
          <div key={gi}>
            {g.name && (
              <div style={{ fontSize: 9, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.07em", color: T.muted, marginBottom: 3 }}>{g.name}</div>
            )}
            <table style={{ borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  <th style={{ ...th, textAlign: "left" }}>Waist</th>
                  {g.cols.map((c, ci) => {
                    const [n, sub] = splitColHead(c);
                    return (
                      <th key={ci} style={th}>
                        {n}
                        {sub && <div style={{ fontSize: 7.5, fontWeight: 600, color: T.faint }}>{sub}</div>}
                      </th>
                    );
                  })}
                  <th style={th}>Total</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(({ r, ri, cells, rowTot }) => (
                  <tr key={ri}>
                    <td style={{ padding: "2px 8px", fontSize: 12, fontWeight: 700, fontFamily: mono, color: T.text, borderRight: `1px solid ${T.border}`, whiteSpace: "nowrap" }}>{r.label}</td>
                    {cells.map(({ label, ci }) => (
                      <td key={ci} style={{ padding: "2px 3px", textAlign: "center" }}>
                        {label ? (
                          <input
                            ref={(el) => { refs.current[`${gi}-${ri}-${ci}`] = el; }}
                            type="text" inputMode="numeric" value={getValue(label)} disabled={disabled}
                            onChange={(e) => { if (!disabled) onChange(label, e.target.value); }}
                            onFocus={(e) => e.target.select()}
                            onBlur={() => onCommit(label)}
                            onKeyDown={(e) => {
                              if (disabled) return;
                              if (e.key === "Enter" || e.key === "ArrowDown") { e.preventDefault(); onCommit(label); focus(gi, ri + 1, ci); }
                              else if (e.key === "ArrowUp") { e.preventDefault(); onCommit(label); focus(gi, ri - 1, ci); }
                            }}
                            style={cellInput}
                          />
                        ) : (
                          <span style={{ color: T.faint, fontSize: 12 }}>·</span>
                        )}
                      </td>
                    ))}
                    <td style={totCell}>{rowTot}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td style={{ padding: "3px 8px", fontSize: 8, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: T.faint, borderTop: `1px solid ${T.border}` }}>Total</td>
                  {colTotals.map((t, ci) => (
                    <td key={ci} style={{ ...totCell, borderTop: `1px solid ${T.border}` }}>{t}</td>
                  ))}
                  <td style={{ ...totCell, borderTop: `1px solid ${T.border}`, color: T.accent || T.text, fontWeight: 800 }}>{grand}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        );
      })}
    </div>
  );
}
