// UPS inbound-freight reconciliation — parse a UPS billing CSV (10-col "Summary"
// or 32-col "Detail"), aggregate charges per shipment, match to a job by PO ref,
// and compute the calculated (estimated) inbound shipping per job. Shared by the
// import route + the Shipping view so parsing/matching can never disagree.
//
// This account is INBOUND production freight only (decorator -> HPD). Outbound
// from the distro warehouse is a separate UPS account / feed.
import { resolvePoRef, buildPoRefIndex, type JobLite, type PoRefIndex } from "@/lib/po-ref-match";
import { effectiveShipRate } from "@/lib/pricing";

export interface UpsCharge {
  invoiceNumber: string;   // UPS invoice # (dedup key) — column on 32-col, from filename on 10-col
  tracking: string;
  cost: number;            // net we pay (32-col Billed Charge / 10-col Net Charge)
  ref: string;             // best ref found (Ref2 preferred, then Ref1)
  sender: string;          // Sender Company = the decorator (32-col only)
  receiver: string;        // Receiver Company (32-col only)
  section: string;         // Type / Invoice Section (e.g. Inbound, Adjustments)
  date: string;            // pickup/transaction date
}

// All cost_entries.source values that are HPD carrier/freight costs (vs decorator
// PO bills) — reconciled in the Freight view, excluded from the PO-bill queue.
export const FREIGHT_SOURCES = ["ups_inbound", "ups_outbound", "manual_freight"];
export const isFreightSource = (s: string | null | undefined) => FREIGHT_SOURCES.includes(s || "");

const num = (x: any) => { const n = parseFloat(String(x ?? "").replace(/[$,]/g, "")); return isNaN(n) ? 0 : n; };

// minimal CSV parse (handles quoted fields w/ commas); strips BOM.
function parseRows(text: string): Record<string, string>[] {
  const lines = text.replace(/^﻿/, "").split(/\r?\n/).filter(l => l.length);
  if (!lines.length) return [];
  const split = (l: string) => {
    const out: string[] = []; let cur = "", q = false;
    for (const ch of l) {
      if (ch === '"') q = !q;
      else if (ch === "," && !q) { out.push(cur); cur = ""; }
      else cur += ch;
    }
    out.push(cur); return out;
  };
  const head = split(lines[0]).map(s => s.trim());
  return lines.slice(1).map(l => {
    const v = split(l); const r: Record<string, string> = {};
    head.forEach((k, i) => (r[k] = (v[i] || "").trim()));
    return r;
  });
}

const pick = (r: Record<string, string>, ...keys: string[]) => {
  for (const k of keys) { const v = (r[k] || "").trim(); if (v) return v; }
  return "";
};

// Parse one CSV file's text into normalized per-line charges. `fallbackInvoice`
// (from the filename, e.g. W28Y51176) is used for the 10-col format, which has
// no invoice-number column.
export function parseUpsCsv(text: string, fallbackInvoice = ""): UpsCharge[] {
  const rows = parseRows(text);
  if (!rows.length) return [];
  const is32 = "Billed Charge" in rows[0];
  const out: UpsCharge[] = [];
  for (const r of rows) {
    const tracking = pick(r, "Tracking Number");
    if (!tracking) continue; // skip invoice-header / blank rows
    out.push({
      invoiceNumber: pick(r, "Invoice Number") || fallbackInvoice,
      tracking,
      cost: is32 ? num(r["Billed Charge"]) : num(r["Net Charge"]),
      ref: pick(r, "Reference No.2", "Ref No 2", "Reference No.1", "Ref No 1", "Reference No.3"),
      sender: pick(r, "Sender Company Name"),
      receiver: pick(r, "Receiver Company Name"),
      section: pick(r, "Invoice Section", "Type"),
      date: pick(r, "Pickup Date", "Transaction Date", "Invoice Date"),
    });
  }
  return out;
}

export interface ShipmentCharge {
  invoiceNumber: string;
  tracking: string;
  cost: number;        // summed across this shipment's lines within the invoice
  ref: string;
  sender: string;
  receiver: string;
  sections: string[];  // all line sections seen (audit)
  date: string;
  lineCount: number;
}

// Collapse line-level charges to one record per (invoice # + tracking) — UPS
// often bills a base + adjustment line for the same shipment in one invoice.
// (Adjustments on a LATER invoice become a separate record, correctly.)
export function aggregateShipments(charges: UpsCharge[]): ShipmentCharge[] {
  const m = new Map<string, ShipmentCharge>();
  for (const c of charges) {
    const key = `${c.invoiceNumber}::${c.tracking}`;
    let s = m.get(key);
    if (!s) { s = { invoiceNumber: c.invoiceNumber, tracking: c.tracking, cost: 0, ref: "", sender: "", receiver: "", sections: [], date: "", lineCount: 0 }; m.set(key, s); }
    s.cost = Math.round((s.cost + c.cost) * 100) / 100;
    s.lineCount++;
    if (!s.ref && c.ref) s.ref = c.ref;
    if (!s.sender && c.sender) s.sender = c.sender;
    if (!s.receiver && c.receiver) s.receiver = c.receiver;
    if (!s.date && c.date) s.date = c.date;
    if (c.section && !s.sections.includes(c.section)) s.sections.push(c.section);
  }
  return [...m.values()];
}

export interface MatchedShipment extends ShipmentCharge {
  job: JobLite | null;
  matchMethod: "ref" | null;  // tracking-match added later in the route (needs item data)
}

// Match each shipment to a job via its PO ref (primary signal, ~90%).
export function matchShipments(shipments: ShipmentCharge[], jobs: JobLite[]): MatchedShipment[] {
  const idx: PoRefIndex = buildPoRefIndex(jobs);
  return shipments.map(s => {
    const job = resolvePoRef(s.ref, idx);
    return { ...s, job, matchMethod: job ? "ref" : null };
  });
}

// Net inbound-freight variance (actual UPS − calculated shipping), summed across
// jobs that have freight assigned. Positive = over plan (margin erosion). Feeds
// the global total variance alongside the decorator-bill variance.
export function shippingVarianceNet(
  freightEntries: { job_id: string | null; amount: number; not_job_specific?: boolean; status?: string }[],
  jobsById: Record<string, { costing_data: any } | undefined>,
): number {
  const actual: Record<string, number> = {};
  let pool = 0; // general weekly shipping cost (fees/adjustments) — real, unallocated → counts toward the total
  for (const e of freightEntries) {
    if (e.status === "ignored") continue; // truly ignored — excluded from everything
    if (e.not_job_specific) { pool += Number(e.amount || 0); continue; }
    if (!e.job_id) continue; // still in the needs-a-match queue → not counted yet
    actual[e.job_id] = (actual[e.job_id] || 0) + Number(e.amount || 0);
  }
  let net = pool;
  for (const [jid, act] of Object.entries(actual)) {
    const job = jobsById[jid];
    net += act - (job ? calculatedShipping(job.costing_data) : 0);
  }
  return Math.round(net * 100) / 100;
}

// Calculated (estimated) inbound shipping for a job = sum over costProds of the
// per-unit ship rate × qty (effectiveShipRate, the costing's freight buffer).
export function calculatedShipping(costingData: any): number {
  const cps = costingData?.costProds || [];
  let total = 0;
  for (const cp of cps) {
    const qty = cp.totalQty || Object.values(cp.qtys || {}).reduce((a: number, v: any) => a + (Number(v) || 0), 0);
    total += effectiveShipRate(cp) * qty;
  }
  return Math.round(total * 100) / 100;
}
