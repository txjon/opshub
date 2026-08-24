// Billing queue — the AP spine. Driven by COSTING + PO-SENT (not by logged
// invoices): every job × vendor we've sent a PO to shows what we EXPECT to be
// billed (costing poTotal), overlaid with what's actually been BILLED
// (cost_entries). The gap is OUTSTANDING; summed across the queue it's the
// OPEN PO COMMITMENT — committed cash still going out. See memory:
// opshub-cost-reconciliation.
import { calcCostProduct } from "./pricing";
import { overlayCostProds } from "./costing-summary";

const IN_HOUSE = new Set(["HP LABS"]); // in-house decoration → no external bill

export interface QueueVendor {
  apVendorId: string | null;
  name: string;
  expected: number;
  billed: number;
  outstanding: number; // max(0, expected - billed) — the open commitment (0 if marked complete)
  state: "awaiting" | "partial" | "billed" | "over" | "nobaseline" | "complete";
  complete: boolean;   // manually marked fully billed
  reason: string | null; // disposition when marked (matches/under/overbill/qb_addition/…)
  // per-PO breakdown of the expected total (so the assistant knows exactly what
  // POs make up the vendor's bill). letter = item position in the job (A,B,C…);
  // poRef = `{QB invoice #}-{letter}` (e.g. 3682-C), matching the PO PDF.
  items: { letter: string; poRef: string; name: string; expected: number }[];
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
  marks?: { job_id: string; vendor_id: string; reason: string | null }[]; // manually marked cost-complete
  // Per-job live items (id, name, sort_order, blank_costs, buy_sheet_lines).
  // When present, lines letter over the item-sorted OVERLAID list — final
  // form, matching the PO PDF. Without it, falls back to the raw stored
  // array (creation-ordered on rearranged jobs — 4345 lettered its recon
  // differently than Icon's paper until this).
  itemsByJob?: Record<string, any[]>;
}): BillingQueue {
  const { jobs, printers, apVendors, entries } = opts;
  const markBy: Record<string, string | null> = {};
  for (const m of (opts.marks || [])) markBy[`${m.job_id}::${m.vendor_id}`] = m.reason;
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
    const qbRef = job.type_meta?.qb_invoice_number || job.job_number;
    // letter = item position (A,B,C…) matching the PO PDF: the item-sorted
    // OVERLAID list when live items are supplied (final form — the stored
    // array is creation-ordered on rearranged jobs and lies), else the raw
    // stored array as before. Overlay also fixes projections to live qtys.
    const jobItems = opts.itemsByJob?.[job.id];
    const base: any[] = jobItems?.length ? overlayCostProds(cps, jobItems) : cps;
    const nameById = new Map((jobItems || []).map((it: any) => [it.id, it.name]));
    // THE SENT PO WINS (Aug 24 2026 — wiring the Tier-2 capture's consumer).
    // type_meta.po_cost_snapshots[vendor] froze each item's poTotal at PO
    // send; expected reads the snapshot so later rate-card edits stop
    // re-pricing history (Elevate 4358: sent at $1.00/unit, list dropped to
    // $0.75 → queue claimed $165 against a real $215 PO). Per-item by id;
    // items added after the send (revised-PO adds) fall back to live calc.
    const snapPoTotalById = new Map<string, number>();
    for (const snap of Object.values((job.type_meta?.po_cost_snapshots || {}) as Record<string, any>)) {
      for (const si of (snap?.items || [])) {
        if (si?.id != null && si?.poTotal != null) snapPoTotalById.set(String(si.id), r2(Number(si.poTotal) || 0));
      }
    }
    const lines = base.map((c: any, i: number) => {
      const snapped = snapPoTotalById.get(String(c.id));
      const calc = snapped === undefined ? calcCostProduct(c, margin, false, false, base, printers) : null;
      const expected = snapped !== undefined ? snapped : (calc ? r2(calc.poTotal || 0) : 0);
      return { letter: String.fromCharCode(65 + i), pv: (c.printVendor || "").toUpperCase(), name: nameById.get(c.id) || c.name || "", expected, ok: snapped !== undefined || !!calc };
    });

    // ap_vendors that have a PO sent on this job
    const apIds = new Set<string>();
    for (const k of poSent) { const ap = keyToAp[k]; if (ap) apIds.add(ap.id); }

    const vendors: QueueVendor[] = [];
    for (const apId of apIds) {
      const ap = apVendors.find(v => v.id === apId)!;
      const keys = apKeys[apId];
      const vLines = lines.filter(l => l.ok && keys.has(l.pv));
      const expected = r2(vLines.reduce((s, l) => s + l.expected, 0));
      const hit = vLines.length > 0;
      const items = vLines.map(l => ({ letter: l.letter, poRef: `${qbRef}-${l.letter}`, name: l.name, expected: l.expected }));
      const b = r2(billed[`${job.id}::${apId}`] || 0);
      const markKey = `${job.id}::${apId}`;
      const isMarked = markKey in markBy;
      // Asymmetric tolerance: billing UNDER projection is low-risk (savings or a damage/
      // short credit) so we accept up to 10%; billing OVER is an overcharge to catch, so
      // it's flagged past 3%. $50 floor so small jobs don't flag on cents. Beyond the band:
      // over (overcharged) or partial (materially under → still chase the remainder).
      const tolOver = Math.max(50, expected * 0.03);
      const tolUnder = Math.max(50, expected * 0.10);
      const diff = r2(b - expected); // billed − projected
      let state: QueueVendor["state"];
      if (isMarked) state = "complete";
      else if (!hit && b === 0) state = "nobaseline";
      else if (b <= 0.01) state = "awaiting";
      else if (diff > tolOver) state = "over";
      else if (-diff > tolUnder) state = "partial";
      else state = "billed";
      // Open commitment = genuinely unbilled work only. Billed-within-tolerance, over, and
      // marked-complete vendors have no residual to chase → outstanding 0. Only awaiting
      // (nothing billed) and partial (materially under) carry an open commitment.
      const outstanding = (state === "awaiting" || state === "partial") ? Math.max(0, r2(expected - b)) : 0;
      openPO += outstanding;
      if (!isMarked) {
        if (state === "awaiting") awaitingV++;
        else if (state === "partial") partialV++;
        else if (state === "over") overV++;
      }
      vendors.push({ apVendorId: apId, name: ap.name, expected, billed: b, outstanding, state, items, complete: isMarked, reason: isMarked ? markBy[markKey] : null });
    }
    if (!vendors.length) continue;
    vendors.sort((a, b) => b.outstanding - a.outstanding || b.expected - a.expected);

    const jExp = r2(vendors.reduce((s, v) => s + v.expected, 0));
    const jBilled = r2(vendors.reduce((s, v) => s + v.billed, 0));
    const jOut = r2(vendors.reduce((s, v) => s + v.outstanding, 0));
    const costComplete = vendors.every(v => v.state === "billed" || v.state === "over" || v.state === "complete");
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
      // Billed KPI caps an accepted overage (reason "over_accept" — a non-production
      // pass-through we've dispositioned) at its projection, so it can't push Billed
      // above Expected. The full amount still lives on the vendor row + cost_entries.
      billed: r2(outJobs.reduce((s, j) => s + j.vendors.reduce((vs, v) =>
        vs + (v.complete && v.reason === "over_accept" && v.billed > v.expected ? v.expected : v.billed), 0), 0)),
      outstanding: r2(openPO),
      awaitingVendors: awaitingV, partialVendors: partialV, overVendors: overV,
    },
  };
}
