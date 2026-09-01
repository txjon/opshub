// ShipStation Shipping Cost export parsing — ONE source for the fulfillment
// wizard and the bulk import (extracted Sep 1 2026; previously inline in the
// wizard). The raw export drops in as-is: columns are matched by NAME, so the
// extra columns (Store, Duties, Taxes, Import Fee, +/-) are simply ignored by
// consumers that don't want them. NOTE: duties/taxes never reach an invoice —
// a known gap if an international-heavy client ever appears.

export type ShipmentRow = {
  idx: number;
  ship_date: string;
  recipient: string;
  order_number: string;
  provider: string;
  service: string;
  package_type: string;
  items_count: number;
  zone: string;
  shipping_paid: number;
  shipping_cost: number;
  insurance_cost: number;
  weight: number;
  weight_unit: string;
  store: string;
};

// Money/number cells are often copy-pasted or currency-formatted — strip
// $, commas, whitespace before parseFloat (which returns NaN on any noise).
export function parseMoney(raw: unknown): number {
  if (raw == null) return 0;
  const cleaned = String(raw).replace(/[\$,\s]/g, "").trim();
  if (!cleaned) return 0;
  const n = parseFloat(cleaned);
  return isFinite(n) ? n : 0;
}

// Strip any time component off a ship date ("7/13/2026 12:00:00 AM" → "7/13/2026").
export function dateOnly(raw: string): string {
  if (!raw) return "";
  return raw.trim().split(/[\sT]/)[0];
}

// Tiny CSV parser. Handles quoted fields w/ embedded commas + the BOM prefix
// ShipStation adds. Not RFC 4180-strict but covers these exports.
export function parseCsv(text: string): string[][] {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else {
      if (c === '"') inQuotes = true;
      else if (c === ",") { row.push(field); field = ""; }
      else if (c === "\n" || c === "\r") {
        if (c === "\r" && text[i + 1] === "\n") i++;
        row.push(field); field = "";
        if (row.length > 1 || row[0] !== "") rows.push(row);
        row = [];
      } else field += c;
    }
  }
  if (field !== "" || row.length) { row.push(field); rows.push(row); }
  return rows;
}

// Match header by trying multiple aliases — ShipStation field names drift
// slightly between exports. Returns -1 if nothing matches.
export function findCol(header: string[], aliases: string[]): number {
  const h = header.map(s => s.trim().toLowerCase());
  for (const alias of aliases) {
    const i = h.indexOf(alias.toLowerCase());
    if (i >= 0) return i;
  }
  return -1;
}

// Normalize ShipStation's internal provider names to the clean carrier label
// clients see — hides the tooling and keeps the column from wrapping.
export function normalizeProvider(raw: string): string {
  const s = (raw || "").trim();
  if (!s) return "";
  const lower = s.toLowerCase();
  if (lower.startsWith("stamps.com") || lower === "stamps") return "USPS";
  if (lower.startsWith("ups by shipstation") || lower === "ups by ss") return "UPS";
  return s;
}

/** Parse a Shipping Cost / shipments export, Store column included. */
export function parseShipmentsCsv(text: string): ShipmentRow[] {
  const parsed = parseCsv(text);
  if (parsed.length < 2) throw new Error("CSV looks empty");
  const header = parsed[0];
  const col = {
    ship_date: findCol(header, ["ship date", "shipped date", "date", "ship_date"]),
    recipient: findCol(header, ["recipient", "buyer", "ship to", "customer"]),
    order_number: findCol(header, ["order #", "order number", "order", "order_number"]),
    provider: findCol(header, ["provider", "carrier"]),
    service: findCol(header, ["service", "ship service"]),
    package_type: findCol(header, ["package", "package type"]),
    items_count: findCol(header, ["items", "item count", "items count", "item qty", "qty"]),
    zone: findCol(header, ["zone"]),
    shipping_paid: findCol(header, ["shipping paid", "shipping collected", "paid", "postage paid"]),
    shipping_cost: findCol(header, ["shipping cost", "postage cost", "postage", "cost"]),
    insurance_cost: findCol(header, ["insurance cost", "insurance"]),
    weight: findCol(header, ["weight"]),
    weight_unit: findCol(header, ["weight unit", "unit"]),
    store: findCol(header, ["store", "store name"]),
  };
  if (col.shipping_cost < 0) throw new Error("CSV is missing a Shipping Cost column");
  const rows: ShipmentRow[] = [];
  for (let i = 1; i < parsed.length; i++) {
    const r = parsed[i];
    if (!r || r.every(c => !c || !c.trim())) continue;
    const pick = (idx: number) => (idx >= 0 ? (r[idx] || "").trim() : "");
    rows.push({
      idx: rows.length,
      ship_date: pick(col.ship_date),
      recipient: pick(col.recipient),
      order_number: pick(col.order_number),
      provider: normalizeProvider(pick(col.provider)),
      service: pick(col.service),
      package_type: pick(col.package_type),
      items_count: parseMoney(pick(col.items_count)),
      zone: pick(col.zone),
      shipping_paid: parseMoney(pick(col.shipping_paid)),
      shipping_cost: parseMoney(pick(col.shipping_cost)),
      insurance_cost: parseMoney(pick(col.insurance_cost)),
      weight: parseMoney(pick(col.weight)),
      weight_unit: pick(col.weight_unit),
      store: pick(col.store),
    });
  }
  if (rows.length === 0) throw new Error("No data rows found");
  return rows;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Build a per-shipment postage invoice from parsed rows + client rates.
 *  Mirrors the wizard's math exactly: per-line rounding first, totals as the
 *  SUM of rounded lines (so Excel SUMs match the eye). */
export function buildPostageInvoice(rows: ShipmentRow[], markupRate: number, perPackageFee: number) {
  const line_items = rows.map(r => {
    const cost_marked = round2(r.shipping_cost * (1 + markupRate));
    const insurance = round2(r.insurance_cost);
    return {
      ship_date: r.ship_date,
      recipient: r.recipient,
      order_number: r.order_number,
      provider: r.provider,
      service: r.service,
      package_type: r.package_type,
      items_count: r.items_count,
      zone: r.zone,
      shipping_paid: round2(r.shipping_paid),
      shipping_cost_raw: round2(r.shipping_cost),
      shipping_cost: cost_marked,
      insurance_cost: insurance,
      weight: r.weight,
      weight_unit: r.weight_unit,
      billed: round2(cost_marked + insurance),
    };
  });
  let shipments = 0, items = 0, paid = 0, cost_raw = 0, cost = 0, insurance = 0, billed = 0;
  for (const l of line_items) {
    shipments += 1;
    items += l.items_count || 0;
    paid += l.shipping_paid;
    cost_raw += l.shipping_cost_raw;
    cost += l.shipping_cost;
    insurance += l.insurance_cost;
    billed += l.billed;
  }
  const fulfillment = round2(perPackageFee * shipments);
  const totals = {
    shipments, items,
    paid: round2(paid), cost_raw: round2(cost_raw), cost: round2(cost),
    insurance: round2(insurance), billed: round2(billed),
    margin: round2(round2(paid) - round2(billed)),
    fulfillment,
    invoice_total: round2(round2(billed) + fulfillment),
  };
  return { line_items, totals };
}
