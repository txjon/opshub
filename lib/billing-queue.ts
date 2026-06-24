// Billing queue — the AP spine. Driven by COSTING + PO-SENT (not by logged
// invoices): every job × vendor we've sent a PO to shows what we EXPECT to be
// billed (costing poTotal), overlaid with what's actually been BILLED
// (cost_entries). The gap is OUTSTANDING; summed across the queue it's the
// OPEN PO COMMITMENT — committed cash still going out. See memory:
// opshub-cost-reconciliation.
import { calcCostProduct } from "./pricing";

const IN_HOUSE = new Set(["HP LABS"]); // in-house decoration → no external bill

export interface QueueVendor {
  apVendorId: string | null;
  name: string;
  expected: number;
  billed: number;
  outstanding: number; // max(0, expected - billed) — the open commitment
  state: "awaiting" | "partial" | "billed" | "over" | "nobaseline";
}
export interface QueueJob {
  id: string;
  job_number: string;
  qb_invoice_number: string | null; // the PO/invoice # vendors reference (e.g. 4304) — primary id
  client_name: string | null;
  phase: string | null;
  vendors: QueueVendor[];
  expected: number;
  billed: number;
  outstanding: number;
  costComplete: boolean;
  billedPct: number;
}
export interface BillingQueue {
  jobs: QueueJob[];
  openPO: number;
  stats: {
    jobs: number; costComplete: number; openJobs: number;
    expected: number; billed: number; outstanding: number;
    awaitingVendors: number; partialVendors: number; overVendors: number;
  };
}

const r2 = (n: number) => Math.round(n * 100) / 100;

export function computeBillingQueue(opts: {
  jobs: any[];
  printers: Record<string, any>;
  apVendors: { id: string; name: string; match_keys?: string[] | null; decorator_id?: string | null }[];
  entries: { job_id: string | null; vendor_id: string | null; amount: number }[];
}): BillingQueue {
  const { jobs, printers, apVendors, entries } = opts;
  // printVendor key (upper) → ap_vendor
  const keyToAp: Record<string, any> = {};
  const apKeys: Record<string, Set<string>> = {};
  for (const v of apVendors) {
    const keys = (v.match_keys || []).map(k => (k || "").toUpperCase());
    apKeys[v.id] = new Set(keys);
    for (const k of keys) keyToAp[k] = v;
  }
  // billed by job::vendor
  const billed: Record<string, number> = {};
  for (const e of entries) {
    if (!e.job_id) continue;
    const k = `${e.job_id}::${e.vendor_id}`;
    billed[k] = (billed[k] || 0) + Number(e.amount || 0);
  }

  const outJobs: QueueJob[] = [];
  let openPO = 0;
  let awaitingV = 0, partialV = 0, overV = 0;

  for (const job of jobs) {
    const poSent: string[] = (job.type_meta?.po_sent_vendors || [])
      .map((s: any) => String(s).toUpperCase())
      .filter((k: string) => !IN_HOUSE.has(k));
    if (!poSent.length) continue;

    const cps = job.costing_data?.costProds || [];
    const margin = String(job.costing_data?.margin ?? 0);

    // ap_vendors that have a PO sent on this job
    const apIds = new Set<string>();
    for (const k of poSent) { const ap = keyToAp[k]; if (ap) apIds.add(ap.id); }

    const vendors: QueueVendor[] = [];
    for (const apId of apIds) {
      const ap = apVendors.find(v => v.id === apId)!;
      const keys = apKeys[apId];
      let expected = 0, hit = false;
      for (const c of cps) {
        if (!keys.has((c.printVendor || "").toUpperCase())) continue;
        const calc = calcCostProduct(c, margin, false, false, cps, printers);
        if (calc) { expected += calc.poTotal || 0; hit = true; }
      }
      expected = hit ? r2(expected) : 0;
      const b = r2(billed[`${job.id}::${apId}`] || 0);
      const tol = Math.max(5, expected * 0.01);
      const state: QueueVendor["state"] =
        !hit && b === 0 ? "nobaseline"
        : Math.abs(b - expected) <= tol ? "billed"
        : b > expected ? "over"
        : b <= 0.01 ? "awaiting"
        : "partial";
      const outstanding = Math.max(0, r2(expected - b));
      openPO += outstanding;
      if (state === "awaiting") awaitingV++;
      else if (state === "partial") partialV++;
      else if (state === "over") overV++;
      vendors.push({ apVendorId: apId, name: ap.name, expected, billed: b, outstanding, state });
    }
    if (!vendors.length) continue;
    vendors.sort((a, b) => b.outstanding - a.outstanding || b.expected - a.expected);

    const jExp = r2(vendors.reduce((s, v) => s + v.expected, 0));
    const jBilled = r2(vendors.reduce((s, v) => s + v.billed, 0));
    const jOut = r2(vendors.reduce((s, v) => s + v.outstanding, 0));
    const costComplete = vendors.every(v => v.state === "billed" || v.state === "over");
    const billedPct = jExp > 0 ? Math.min(100, Math.round((100 * jBilled) / jExp)) : (jBilled > 0 ? 100 : 0);
    outJobs.push({
      id: job.id, job_number: job.job_number, qb_invoice_number: job.type_meta?.qb_invoice_number || null,
      client_name: job.clients?.name || null,
      phase: job.phase || null, vendors, expected: jExp, billed: jBilled, outstanding: jOut,
      costComplete, billedPct,
    });
  }

  // open (outstanding) first, then newest job number
  outJobs.sort((a, b) => b.outstanding - a.outstanding || (a.job_number < b.job_number ? 1 : -1));

  return {
    jobs: outJobs,
    openPO: r2(openPO),
    stats: {
      jobs: outJobs.length,
      costComplete: outJobs.filter(j => j.costComplete).length,
      openJobs: outJobs.filter(j => !j.costComplete).length,
      expected: r2(outJobs.reduce((s, j) => s + j.expected, 0)),
      billed: r2(outJobs.reduce((s, j) => s + j.billed, 0)),
      outstanding: r2(openPO),
      awaitingVendors: awaitingV, partialVendors: partialV, overVendors: overV,
    },
  };
}
