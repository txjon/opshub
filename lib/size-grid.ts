// Size matrix / "cut ticket" pivot.
//
// High-variant items (pants especially) carry size labels shaped like
// "Relaxed / 32 / 34 (Long)" = Fit / Waist / Inseam(Length). Rendered as a flat
// list those become a 50+ entry run-on string a vendor can't sort. This pivots
// them into the apparel-standard grid: one table per fit, waist down the side,
// inseam across the top, with row / column / grand totals.
//
// Pure + framework-agnostic so every surface shares ONE pivot: the React
// <SizeGrid/> (ecomm card, vendor portal) and the PO PDF HTML builder both call
// parseSizeMatrix. 1-D sizes (S/M/L) return null → callers keep the inline list.

import { SIZE_ORDER } from "./theme";

export type SizeMatrixGroup = {
  name: string | null;                 // the fit (3-D labels); null for 2-D
  cols: string[];                       // inseam labels, e.g. "30 (Short)"
  rows: { label: string; cells: (number | null)[]; total: number }[];
  colTotals: number[];
  grandTotal: number;
};
export type SizeMatrix = { groups: SizeMatrixGroup[]; presence: boolean };

const leadingNum = (s: string): number | null => {
  const m = s.match(/^\s*(\d+(?:\.\d+)?)/);
  return m ? parseFloat(m[1]) : null;
};

// Sort size keys: numeric-first (28,30,32…), then known S/M/L order, then alpha.
const cmpSize = (a: string, b: string): number => {
  const na = leadingNum(a), nb = leadingNum(b);
  if (na != null && nb != null) return na - nb || a.localeCompare(b);
  const ia = SIZE_ORDER.indexOf(String(a).toUpperCase()), ib = SIZE_ORDER.indexOf(String(b).toUpperCase()); // case-insensitive: Shopify sizes are lowercase
  if (ia !== -1 || ib !== -1) {
    if (ia === -1) return 1;
    if (ib === -1) return -1;
    return ia - ib;
  }
  return a.localeCompare(b);
};

const splitParts = (label: string): string[] => label.split(" / ").map((s) => s.trim());

const SEP = "|";

// Pivot labels into per-fit grids. Returns null when the labels aren't
// multi-dimensional (no " / ") - the caller should render its plain inline list.
// When `qtys` is omitted/null we run in PRESENCE mode: every variant counts as 1
// (used to show a size run with no order quantities yet).
export function parseSizeMatrix(
  labels: string[],
  qtys?: Record<string, number> | null,
): SizeMatrix | null {
  if (!labels || labels.length === 0) return null;
  const parts = labels.map(splitParts);
  const dims = Math.max(...parts.map((p) => p.length));
  if (dims < 2) return null; // 1-D (S/M/L) → inline list

  // Only pivot when most labels actually share the dimensional shape.
  const sameShape = parts.filter((p) => p.length === dims).length;
  if (sameShape < Math.ceil(labels.length * 0.6)) return null;

  const presence = qtys == null;
  const groupOf = (p: string[]) => (dims >= 3 ? p[0] : null);
  const rowOf = (p: string[]) => (dims >= 3 ? p[1] : p[0]);
  const colOf = (p: string[]) => (dims >= 3 ? p.slice(2).join(" / ") : p[1]);

  const order: (string | null)[] = [];
  const byGroup = new Map<string | null, { rows: Set<string>; cols: Set<string>; q: Map<string, number> }>();

  labels.forEach((label, i) => {
    const p = parts[i];
    if (p.length !== dims) return; // skip odd-shaped stragglers
    const qv = presence ? 1 : (qtys![label] || 0);
    if (!presence && qv <= 0) return; // qty mode: drop empty combos
    const g = groupOf(p);
    if (!byGroup.has(g)) {
      byGroup.set(g, { rows: new Set(), cols: new Set(), q: new Map() });
      order.push(g);
    }
    const bucket = byGroup.get(g)!;
    const r = rowOf(p), c = colOf(p);
    bucket.rows.add(r);
    bucket.cols.add(c);
    bucket.q.set(r + SEP + c, qv);
  });

  const groups: SizeMatrixGroup[] = [];
  for (const g of order) {
    const b = byGroup.get(g)!;
    if (b.rows.size === 0 || b.cols.size === 0) continue;
    const cols = Array.from(b.cols).sort(cmpSize);
    const rowLabels = Array.from(b.rows).sort(cmpSize);
    const colTotals = cols.map(() => 0);
    let grandTotal = 0;
    const rows = rowLabels.map((rl) => {
      const cells = cols.map((c, ci) => {
        const v = b.q.get(rl + SEP + c);
        if (v == null) return null;
        colTotals[ci] += v;
        grandTotal += v;
        return v;
      });
      const total = cells.reduce<number>((a, v) => a + (v || 0), 0);
      return { label: rl, cells, total };
    });
    groups.push({ name: g, cols, rows, colTotals, grandTotal });
  }
  if (groups.length === 0) return null;
  return { groups, presence };
}

// Split "30 (Short)" → ["30", "Short"] so a column header can stack the number
// over the small length name. Anything without parens returns [label, ""].
export function splitColHead(label: string): [string, string] {
  const m = label.match(/^(.*?)\s*\((.+)\)\s*$/);
  return m ? [m[1].trim(), m[2].trim()] : [label, ""];
}

// PO-PDF (Browserless HTML) renderer. Returns null when not dimensional so the
// route keeps its existing inline `sizeStr`. Styling matches the PO doc (small
// type, #f7f7f7 panels).
export function sizeMatrixHtml(
  labels: string[],
  qtys: Record<string, number>,
  opts?: { mono?: string },
): string | null {
  const matrix = parseSizeMatrix(labels, qtys);
  if (!matrix) return null;
  const mono = opts?.mono || "ui-monospace, monospace";

  // Match the host document: hairline rules (0.5px #e5e7eb), uppercase muted
  // labels, mono numerals — no filled cards or gray total fills. Reads as part
  // of the invoice/quote/PO, not a widget dropped onto it.
  const rule = "0.5px solid #e5e7eb";
  const label = "font-size:7.5px;font-weight:700;text-transform:uppercase;letter-spacing:0.1em;color:#aaa";
  const th = `padding:3px 7px;font-size:7px;font-weight:700;color:#aaa;text-align:center;text-transform:uppercase;letter-spacing:0.04em;border-bottom:${rule}`;
  const td = `padding:3px 7px;font-size:8.5px;text-align:center;font-family:${mono};color:#444`;
  const totCol = `padding:3px 7px;font-size:8.5px;text-align:center;font-family:${mono};font-weight:700;color:#1a1a1a`;
  const rowLabel = `padding:3px 10px 3px 2px;font-size:8.5px;font-weight:600;font-family:${mono};color:#555;text-align:left`;

  const groupHtml = matrix.groups.map((g) => {
    const head = g.cols.map((c) => {
      const [n, sub] = splitColHead(c);
      return `<th style="${th}">${n}${sub ? `<div style="font-size:6px;font-weight:600;color:#c4c4c4;letter-spacing:0">${sub}</div>` : ""}</th>`;
    }).join("");
    const body = g.rows.map((r) => {
      const cells = r.cells.map((v) => `<td style="${td}">${v == null ? '<span style="color:#d5d5d5">·</span>' : v}</td>`).join("");
      return `<tr><td style="${rowLabel}">${r.label}</td>${cells}<td style="${totCol};border-left:${rule}">${r.total}</td></tr>`;
    }).join("");
    const foot = g.colTotals.map((t) => `<td style="${totCol};border-top:${rule}">${t}</td>`).join("");
    return `<div>
      ${g.name ? `<div style="${label};color:#999;margin:0 0 3px">${g.name}</div>` : ""}
      <table style="border-collapse:collapse">
        <thead><tr><th style="${th};text-align:left;color:#bbb">Waist</th>${head}<th style="${th}">Total</th></tr></thead>
        <tbody>${body}</tbody>
        <tfoot><tr><td style="padding:3px 10px 3px 2px;font-size:7px;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;color:#aaa;border-top:${rule}">Total</td>${foot}<td style="${totCol};border-top:${rule};border-left:${rule}">${g.grandTotal}</td></tr></tfoot>
      </table>
    </div>`;
  }).join("");

  return `<div style="margin:4px 0 2px">
    <div style="${label};margin-bottom:5px">Sizes</div>
    <div style="display:flex;flex-wrap:wrap;gap:24px;align-items:flex-start">${groupHtml}</div>
  </div>`;
}
