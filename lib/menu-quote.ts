// The Quick Quote spine — shared between the /intake builder, the token
// APIs, and the client quote view on /menu/[token].
//
// Doctrine: quote lines carry EXACT unitPrice (they become
// items.sell_per_unit on accept→job); punch 'sizes' payloads are
// per-colorway grids (they become buy_sheet_lines qty truth). The quote is
// where the single-source money spine starts, not where re-keying starts.

export type QuoteLine = {
  styleCode: string | null;   // null = custom line (setup fee, art services, shipping)
  label: string;
  qty: number;
  colors: string[];
  unitPrice: number | null;   // null = Taylor hasn't priced it yet (DTF small batch)
  note?: string;
};

export type PunchKind = "files" | "sizes" | "date" | "address" | "text" | "confirm";
export type PunchPoint = {
  key: string;
  label: string;
  desc: string;
  kind: PunchKind;
  required: boolean;
  status: "needed" | "done";
  payload?: unknown;          // files: {files:[{filename,path,url}]} · sizes: {grids:{[gridKey]:{[size]:qty}}} · date/address/text: {value} · confirm: {confirmed:true}
};

export type Quote = {
  lines: QuoteLine[];
  punch: PunchPoint[];
  validUntil: string;         // ISO date
  sentAt: string;
  acceptedAt?: string | null;
  total: number;              // sum(qty × unitPrice) over priced lines
};

export type SnapshotRow = { style_code: string; style_name: string; band_min: number; price_lo: number | null; price_hi: number | null };

// Same piecewise-linear interpolation the client's slider used — the
// prefill must be the midpoint of exactly what they were shown.
export function snapshotMid(snapshot: SnapshotRow[], styleCode: string, qty: number): number | null {
  const anchors = snapshot
    .filter((r) => r.style_code === styleCode && r.price_lo != null && r.price_hi != null)
    .sort((a, b) => a.band_min - b.band_min);
  if (!anchors.length) return null;
  const mid = (r: SnapshotRow) => (Number(r.price_lo) + Number(r.price_hi)) / 2;
  if (qty < anchors[0].band_min) return null; // DTF / below-minimum: no menu price
  let prev = anchors[0];
  for (const a of anchors) {
    if (qty <= a.band_min) {
      if (a.band_min === prev.band_min) return mid(a);
      const t = (qty - prev.band_min) / (a.band_min - prev.band_min);
      return mid(prev) + (mid(a) - mid(prev)) * t;
    }
    prev = a;
  }
  return mid(prev);
}

export const quoteTotal = (lines: QuoteLine[]) =>
  lines.reduce((s, l) => s + (l.unitPrice != null ? l.unitPrice * l.qty : 0), 0);

export const requiredDone = (q: Quote) =>
  q.punch.filter((p) => p.required && p.status !== "done").length === 0;

// The real HPD size curve (BuySheetTab DEFAULT_CURVE — derived from actual
// sell-through). "Use our standard curve" distributes a line's qty across
// sizes, remainder onto L.
export const SIZE_CURVE: Record<string, number> = { S: 5.13, M: 20.57, L: 38.14, XL: 25.9, "2XL": 7.69, "3XL": 2.56 };
export const SIZE_ORDER = ["S", "M", "L", "XL", "2XL", "3XL"];

export function distributeCurve(total: number): Record<string, number> {
  const sum = Object.values(SIZE_CURVE).reduce((a, b) => a + b, 0);
  const out: Record<string, number> = {};
  let used = 0;
  for (const s of SIZE_ORDER) {
    out[s] = Math.round((SIZE_CURVE[s] / sum) * total);
    used += out[s];
  }
  out.L += total - used; // remainder onto the biggest seller
  return out;
}

// Grid keys: one grid per line × colorway (an item per colorway is how
// HPD jobs model reality — these grids become buy_sheet_lines directly).
export const gridKey = (lineIdx: number, color: string | null) => `${lineIdx}|${color || "all"}`;

// Standard punch points, defaulted from what the lead already gave us.
export function defaultPunch(opts: {
  lines: QuoteLine[];
  hasArtFiles: boolean;
  artStatus: string | null;
  neededBy: string | null;
}): PunchPoint[] {
  const { lines, hasArtFiles, artStatus, neededBy } = opts;
  const anyColors = lines.some((l) => l.colors.length > 0);
  const punch: PunchPoint[] = [];
  punch.push({
    key: "art", kind: "files", required: true, status: "needed",
    label: "Print-ready artwork",
    desc: artStatus === "need_help"
      ? "You asked for design help. Our team will build the art with you; drop any references or logos here."
      : hasArtFiles
        ? "We have your mockups. Upload the print-ready versions when you have them (vector or 300dpi at print size)."
        : "Upload the final art for each placement (vector or 300dpi at print size).",
  });
  punch.push({
    key: "sizes", kind: "sizes", required: true, status: "needed",
    label: "Size breakdown",
    desc: "How many of each size, per colorway. Not sure? One tap uses our standard curve from real sell-through.",
  });
  punch.push({
    key: "ship", kind: "address", required: true, status: "needed",
    label: "Where it goes",
    desc: "Ship-to address, or tell us to hold it at House Party for fulfillment.",
  });
  punch.push({
    key: "date", kind: "date", required: true, status: neededBy ? "done" : "needed",
    label: "In-hand date",
    desc: neededBy ? `You said: ${neededBy}. Adjust if that has changed.` : "When do you need this in hand?",
    payload: neededBy ? { value: neededBy } : undefined,
  });
  if (anyColors) {
    punch.push({
      key: "colors", kind: "confirm", required: false, status: "needed",
      label: "Confirm garment colors",
      desc: `Locking in: ${lines.flatMap((l) => l.colors).join(", ")}.`,
    });
  }
  return punch;
}
