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

import { calculatePhase } from "./lifecycle";
import { poSentToItem } from "./item-status";
import { deriveItem } from "./item-derivation";
import { needsProof } from "./proof-gate";

export async function recalcJobPhase(sb: any, jobId: string, opts?: { commit?: boolean }): Promise<{ phase: string; stored: string; changed: boolean } | null> {
  const { data: jobData } = await sb.from("jobs").select("*, clients(name)").eq("id", jobId).single();
  if (!jobData || jobData.phase === "on_hold" || jobData.phase === "cancelled") return null;
  const { data: jobItems } = await sb.from("items")
    .select("id, pipeline_stage, blanks_order_number, blanks_order_cost, ship_tracking, received_at_hpd, artwork_status, garment_type, shipping_route, webstore_entered_at, forwarded_at, archived_at, decorator_assignments(decorators(name, short_code))")
    .eq("job_id", jobId);
  const { data: payments } = await sb.from("payment_records").select("amount, status").eq("job_id", jobId);
  // Ledger-derived open-wave signal per item (see lifecycle.ts ledger_open):
  // shipped something, not closed, units still owed at the decorator.
  const { data: allMoves } = await sb.from("movements")
    .select("item_id, type, qtys, reverses_id, id").in("item_id", (jobItems || []).map((it: any) => it.id));
  const { data: bsl } = await sb.from("buy_sheet_lines")
    .select("item_id, size, qty_ordered").in("item_id", (jobItems || []).map((it: any) => it.id));
  const { data: finals } = await sb.from("items").select("id, ship_final").in("id", (jobItems || []).map((it: any) => it.id));
  const finalById = new Map<string, boolean>((finals || []).map((f: any) => [f.id, !!f.ship_final]));
  const ledgerOpen: Record<string, boolean> = {};
  for (const it of (jobItems || [])) {
    const ordered: Record<string, number> = {};
    for (const l of (bsl || []).filter((b: any) => b.item_id === it.id)) ordered[l.size] = (ordered[l.size] || 0) + (Number(l.qty_ordered) || 0);
    const st = deriveItem({
      ordered,
      route: (it.shipping_route || jobData.shipping_route || "ship_through") as any,
      shipFinal: finalById.get(it.id) || false,
      movements: (allMoves || []).filter((m: any) => m.item_id === it.id).map((m: any) => ({ type: m.type, qtys: m.qtys || {}, reversesId: m.reverses_id, id: m.id })),
    });
    ledgerOpen[it.id] = st.shippedTotal > 0 && !st.closed && st.owedTotal > 0;
  }
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
    job: { job_type: jobData.job_type, shipping_route: jobData.shipping_route || "ship_through", payment_terms: jobData.payment_terms, quote_approved: jobData.quote_approved || false, phase: jobData.phase, fulfillment_status: jobData.fulfillment_status || null },
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
