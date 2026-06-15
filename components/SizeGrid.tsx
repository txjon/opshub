// Shared size renderer. Pivots multi-dimensional size labels (pants:
// Fit / Waist / Inseam) into the apparel-standard cut-ticket grid; falls back to
// a plain inline list for 1-D sizes (S/M/L). One component for every React
// surface — the ecomm pre-order card (presence, no qtys) and the vendor portal
// PO (quantities + totals). Palette is passed in so it themes to both the dark
// app (`T`) and the light portal (`C`).

import { parseSizeMatrix, splitColHead } from "@/lib/size-grid";
import { sortSizes } from "@/lib/theme";

type Palette = {
  text: string;
  muted: string;
  faint: string;
  border: string;
  surface: string;   // subtle fill for total cells / header
  accent?: string;   // presence dots + grand-total accent
};

export default function SizeGrid({
  labels,
  qtys,
  palette,
  mono,
}: {
  labels: string[];
  qtys?: Record<string, number> | null;
  palette: Palette;
  mono: string;
}) {
  const matrix = parseSizeMatrix(labels, qtys ?? null);
  const presence = qtys == null;

  // 1-D sizes → the original inline list (qty mode: "S 12 · M 24").
  if (!matrix) {
    const text = presence
      ? sortSizes(labels).join("  ·  ")
      : sortSizes(labels.filter((l) => (qtys![l] || 0) > 0))
          .map((l) => `${l} ${qtys![l]}`)
          .join("  ·  ");
    return <span style={{ fontFamily: mono, color: palette.muted }}>{text}</span>;
  }

  const th: React.CSSProperties = {
    padding: "3px 7px", fontSize: 9, fontWeight: 700, color: palette.faint,
    textAlign: "center", borderBottom: `1px solid ${palette.border}`, whiteSpace: "nowrap",
  };
  const td: React.CSSProperties = {
    padding: "3px 7px", fontSize: 11, textAlign: "center", fontFamily: mono, color: palette.text,
  };
  const totCell: React.CSSProperties = {
    ...td, fontWeight: 700, color: palette.text, background: palette.surface,
  };

  return (
    <div style={{ display: "flex", flexDirection: "row", flexWrap: "wrap", alignItems: "flex-start", gap: 24, overflowX: "auto" }}>
      {matrix.groups.map((g, gi) => (
        <div key={gi}>
          {g.name && (
            <div style={{ fontSize: 9, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.07em", color: palette.muted, marginBottom: 3 }}>
              {g.name}
            </div>
          )}
          <table style={{ borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={{ ...th, textAlign: "left", color: palette.faint }}>Waist</th>
                {g.cols.map((c, ci) => {
                  const [n, sub] = splitColHead(c);
                  return (
                    <th key={ci} style={th}>
                      {n}
                      {sub && <div style={{ fontSize: 7.5, fontWeight: 600, color: palette.faint }}>{sub}</div>}
                    </th>
                  );
                })}
                {!presence && <th style={th}>Total</th>}
              </tr>
            </thead>
            <tbody>
              {g.rows.map((r, ri) => (
                <tr key={ri}>
                  <td style={{ padding: "3px 8px", fontSize: 11, fontWeight: 700, fontFamily: mono, color: palette.text, borderRight: `1px solid ${palette.border}`, whiteSpace: "nowrap" }}>
                    {r.label}
                  </td>
                  {r.cells.map((v, ci) => (
                    <td key={ci} style={td}>
                      {v == null
                        ? <span style={{ color: palette.faint }}>·</span>
                        : presence
                          ? <span style={{ color: palette.accent || palette.muted }}>•</span>
                          : v}
                    </td>
                  ))}
                  {!presence && <td style={totCell}>{r.total}</td>}
                </tr>
              ))}
            </tbody>
            {!presence && (
              <tfoot>
                <tr>
                  <td style={{ padding: "3px 8px", fontSize: 8, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: palette.faint, borderTop: `1px solid ${palette.border}` }}>
                    Total
                  </td>
                  {g.colTotals.map((t, ci) => (
                    <td key={ci} style={{ ...totCell, borderTop: `1px solid ${palette.border}` }}>{t}</td>
                  ))}
                  <td style={{ ...totCell, borderTop: `1px solid ${palette.border}`, color: palette.accent || palette.text, fontWeight: 800 }}>{g.grandTotal}</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      ))}
    </div>
  );
}
