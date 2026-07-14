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

export async function recalcJobPhase(sb: any, jobId: string): Promise<void> {
  const { data: jobData } = await sb.from("jobs").select("*, clients(name)").eq("id", jobId).single();
  if (!jobData || jobData.phase === "on_hold" || jobData.phase === "cancelled") return;
  const { data: jobItems } = await sb.from("items")
    .select("id, pipeline_stage, blanks_order_number, blanks_order_cost, ship_tracking, received_at_hpd, artwork_status, garment_type, shipping_route, webstore_entered_at, forwarded_at")
    .eq("job_id", jobId);
  const { data: payments } = await sb.from("payment_records").select("amount, status").eq("job_id", jobId);
  const { data: proofFiles } = await sb.from("item_files").select("item_id, approval")
    .eq("stage", "proof").is("superseded_at", null).in("item_id", (jobItems || []).map((it: any) => it.id));
  const proofStatus: Record<string, { allApproved: boolean }> = {};
  for (const it of (jobItems || [])) {
    const manualApproved = it.artwork_status === "approved";
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
      po_sent: poSentToItem({ printVendor: costProds.find(cp => cp.id === it.id)?.printVendor, poSentVendors }),
      blanks_order_number: it.blanks_order_number,
      blanks_order_cost: it.blanks_order_cost ?? null,
      ship_tracking: it.ship_tracking,
      received_at_hpd: it.received_at_hpd || false,
      artwork_status: it.artwork_status,
      garment_type: it.garment_type,
      shipping_route: it.shipping_route || null,
      webstore_entered_at: it.webstore_entered_at || null,
      forwarded_at: it.forwarded_at || null,
    })),
    payments: (payments || []).map((p: any) => ({ amount: p.amount, status: p.status })),
    proofStatus,
    poSentVendors,
    costingVendors: Array.from(new Set(costProds.map(cp => cp.printVendor).filter(Boolean))),
  });
  if (result.phase !== jobData.phase) {
    const timestamps = jobData.phase_timestamps || {};
    timestamps[result.phase] = new Date().toISOString();
    await sb.from("jobs").update({ phase: result.phase, phase_timestamps: timestamps }).eq("id", jobId);
  }
}
