// Recalculate the LEGACY jobs.phase after a v2 warehouse write.
//
// Why this exists: the v2 boards (loadReceivingBoard / loadShippingBoard /
// loadStagingBoard) and ~35 other consumers still key off jobs.phase. The legacy
// warehouse flow (use-warehouse.recalcJobPhase) advanced phase after every
// action; the v2 write libs (production2-ship / receiving2-receive /
// shipping2-forward / staging-enter) did not — so a job shipped via v2 would stay
// at "production" and vanish from the receiving/shipping boards (which filter by
// phase). This is the shared, server-capable recalc the v2 paths call.
//
// It reads the flat legacy item fields (pipeline_stage, ship_tracking,
// received_at_hpd, forwarded_at, webstore_entered_at) — which the ledger bridge
// (recomputeItemFromLedger) + production2-ship keep current — and runs the legacy
// calculatePhase engine, mirroring use-warehouse exactly so both flows agree.

import { calculatePhase, isClosedOut } from "./lifecycle";
import { poSentToItem } from "./item-status";
import { deriveItem } from "./item-derivation";
import { allRowsIn } from "./all-rows";
import { needsProof } from "./proof-gate";

// Ledger truth per item for calculatePhase. EVERY caller that stores a phase
// passes pulled_out from here, or the job page and the warehouse flip a job
// back after the recalc completes it. (ledger_open is still passed by
// recalcJobPhase only.) Throws on a failed read: callers skip the phase write
// rather than store a phase computed from partial data.
//  - ledgerOpen: shipped something, not closed, units still owed at the
//    decorator (an open partial wave; see lifecycle.ts ledger_open).
//  - pulledOut: every received unit was pulled (lib/item-derivation pulledOut).
export async function loadLedgerFlags(sb: any, items: { id: string; shipping_route?: string | null }[], jobRoute: string | null | undefined): Promise<{ ledgerOpen: Record<string, boolean>; pulledOut: Record<string, boolean> }> {
  const ledgerOpen: Record<string, boolean> = {};
  const pulledOut: Record<string, boolean> = {};
  const ids = items.map(it => it.id);
  if (!ids.length) return { ledgerOpen, pulledOut };
  // Paged (1,000-row cap): a truncated movements read could drop receives but
  // keep pulls and falsely mark an item pulled out, completing the job.
  const allMoves = await allRowsIn(ids, (c, f, t) => sb.from("movements")
    .select("item_id, type, qtys, reverses_id, id").in("item_id", c).order("id").range(f, t));
  const bsl = await allRowsIn(ids, (c, f, t) => sb.from("buy_sheet_lines")
    .select("id, item_id, size, qty_ordered").in("item_id", c).order("id").range(f, t));
  const finals = await allRowsIn(ids, (c, f, t) => sb.from("items").select("id, ship_final").in("id", c).order("id").range(f, t));
  const finalById = new Map<string, boolean>((finals || []).map((f: any) => [f.id, !!f.ship_final]));
  for (const it of items) {
    const ordered: Record<string, number> = {};
    for (const l of (bsl || []).filter((b: any) => b.item_id === it.id)) ordered[l.size] = (ordered[l.size] || 0) + (Number(l.qty_ordered) || 0);
    const st = deriveItem({
      ordered,
      route: (it.shipping_route || jobRoute || "ship_through") as any,
      shipFinal: finalById.get(it.id) || false,
      movements: (allMoves || []).filter((m: any) => m.item_id === it.id).map((m: any) => ({ type: m.type, qtys: m.qtys || {}, reversesId: m.reverses_id, id: m.id })),
    });
    ledgerOpen[it.id] = st.shippedTotal > 0 && !st.closed && st.owedTotal > 0;
    pulledOut[it.id] = st.pulledOut;
  }
  return { ledgerOpen, pulledOut };
}

export async function recalcJobPhase(sb: any, jobId: string, opts?: { commit?: boolean }): Promise<{ phase: string; stored: string; changed: boolean } | null> {
  const { data: jobData } = await sb.from("jobs").select("*, clients(name)").eq("id", jobId).single();
  if (!jobData || jobData.phase === "on_hold" || jobData.phase === "cancelled") return null;
  const { data: jobItems } = await sb.from("items")
    .select("id, pipeline_stage, blanks_order_number, blanks_order_cost, ship_tracking, received_at_hpd, artwork_status, garment_type, shipping_route, webstore_entered_at, forwarded_at, archived_at, decorator_assignments(decorators(name, short_code))")
    .eq("job_id", jobId);
  const { data: payments } = await sb.from("payment_records").select("amount, status").eq("job_id", jobId);
  // A failed ledger read skips the recalc (returns null) instead of throwing:
  // callers run this AFTER their own write is committed, and an error there
  // would tell staff a saved forward/entry failed, inviting a double retry.
  let flags: Awaited<ReturnType<typeof loadLedgerFlags>>;
  try { flags = await loadLedgerFlags(sb, jobItems || [], jobData.shipping_route); }
  catch (e) { console.error("[recalcJobPhase] ledger read failed, phase not recalculated:", jobId, e); return null; }
  const { ledgerOpen, pulledOut } = flags;
  const { data: proofFiles } = await sb.from("item_files").select("item_id, approval")
    .eq("stage", "proof").is("superseded_at", null).in("item_id", (jobItems || []).map((it: any) => it.id));
  const proofStatus: Record<string, { allApproved: boolean }> = {};
  for (const it of (jobItems || [])) {
    const manualApproved = !needsProof(it) || it.artwork_status === "approved";
    const proofs = (proofFiles || []).filter((f: any) => f.item_id === it.id);
    proofStatus[it.id] = { allApproved: manualApproved || (proofs.length > 0 && proofs.every((f: any) => f.approval === "approved")) };
  }
  const costProds = (jobData.costing_data?.costProds || []) as any[];
  const poSentVendors = (jobData.type_meta?.po_sent_vendors || []) as string[];
  const result = calculatePhase({
    job: { job_type: jobData.job_type, shipping_route: jobData.shipping_route || "ship_through", payment_terms: jobData.payment_terms, quote_approved: jobData.quote_approved || false, phase: jobData.phase, fulfillment_status: jobData.fulfillment_status || null, closed_out: isClosedOut(jobData) },
    items: (jobItems || []).map((it: any) => ({
      id: it.id,
      pipeline_stage: it.pipeline_stage,
      // match by costing label AND decorator name/short_code — the PO tab keys
      // po_sent_vendors by short code ("1 STOP"), costing may hold the long
      // name; matching on one alone silently missed items (Eagle Patch bug).
      po_sent: poSentToItem({
        printVendor: costProds.find(cp => cp.id === it.id)?.printVendor,
        decoratorName: it.decorator_assignments?.[0]?.decorators?.name || null,
        decoratorShortCode: it.decorator_assignments?.[0]?.decorators?.short_code || null,
        poSentVendors,
      }),
      blanks_order_number: it.blanks_order_number,
      blanks_order_cost: it.blanks_order_cost ?? null,
      ship_tracking: it.ship_tracking,
      received_at_hpd: it.received_at_hpd || false,
      artwork_status: it.artwork_status,
      garment_type: it.garment_type,
      shipping_route: it.shipping_route || null,
      webstore_entered_at: it.webstore_entered_at || null,
      forwarded_at: it.forwarded_at || null,
      ledger_open: ledgerOpen[it.id] || false,
      pulled_out: pulledOut[it.id] || false,
      archived_at: it.archived_at || null,
    })),
    payments: (payments || []).map((p: any) => ({ amount: p.amount, status: p.status })),
    proofStatus,
    poSentVendors,
    costingVendors: Array.from(new Set(costProds.map(cp => cp.printVendor).filter(Boolean))),
  });
  const changed = result.phase !== jobData.phase;
  // Dry-run (opts.commit === false) computes + returns WITHOUT writing — used by
  // the phase tripwire to detect drift. Default commits, exactly as every
  // existing caller expects.
  if (changed && opts?.commit !== false) {
    const timestamps = jobData.phase_timestamps || {};
    timestamps[result.phase] = new Date().toISOString();
    await sb.from("jobs").update({ phase: result.phase, phase_timestamps: timestamps }).eq("id", jobId);
  }
  return { phase: result.phase, stored: jobData.phase, changed };
}
