// Auto-finalize zero-variance invoices (Jon, Aug 25 2026): the reconcile
// step is a checkpoint, not a ritual — when a fully-shipped job's delivered
// quantities match the invoice EXACTLY (every item, every size, via the same
// lib/job/billable-qtys math the variance modal and QB push use), there is
// nothing to review. Stamp qb_variance_pushed_at (+ invoice_variance_auto)
// so the rail reads Final, WITHOUT touching QuickBooks or emailing anyone —
// the QB invoice is already right. Amber RECONCILE now always means a real
// discrepancy needs a human.
//
// Callers gate on the derive step: only call when step === "reconcile"
// (fully shipped, not yet stamped). Safe to call twice — the stamp check
// makes it idempotent.
import { billableQtysForItem, sumForwarded, type SizeMap } from "@/lib/job/billable-qtys";

export async function maybeAutoFinalizeInvoice(supabase: any, jobId: string): Promise<boolean> {
  const { data: job } = await supabase
    .from("jobs")
    .select("id, shipping_route, type_meta")
    .eq("id", jobId)
    .single();
  const tm = (job as any)?.type_meta || {};
  if (!job || !tm.qb_invoice_number || tm.qb_variance_pushed_at) return false;

  const [{ data: items }, { data: moves }] = await Promise.all([
    supabase.from("items")
      .select("id, shipping_route, ship_qtys, received_qtys, buy_sheet_lines(size, qty_ordered)")
      .eq("job_id", jobId),
    supabase.from("movements").select("item_id, type, qtys").eq("job_id", jobId).eq("type", "forward"),
  ]);
  if (!items || items.length === 0) return false;

  const movesByItem: Record<string, any[]> = {};
  for (const m of (moves || []) as any[]) (movesByItem[m.item_id] ||= []).push(m);

  for (const it of items as any[]) {
    const ordered: SizeMap = {};
    for (const l of it.buy_sheet_lines || []) ordered[l.size] = Number(l.qty_ordered) || 0;
    const { perSize } = billableQtysForItem({
      item: it, jobRoute: (job as any).shipping_route,
      forwardedMap: sumForwarded(movesByItem[it.id] || []),
    });
    const sizes = Array.from(new Set([...Object.keys(ordered), ...Object.keys(perSize)]));
    for (const sz of sizes) {
      if ((ordered[sz] || 0) !== (perSize[sz] || 0)) return false; // real variance — human's call
    }
  }

  const { error } = await supabase.from("jobs").update({
    type_meta: { ...tm, qb_variance_pushed_at: new Date().toISOString(), invoice_variance_auto: true },
  }).eq("id", jobId);
  if (error) return false;
  await supabase.from("job_activity").insert({
    job_id: jobId, user_id: null, type: "auto",
    message: "Invoice finalized automatically — delivered quantities match the invoice exactly",
    metadata: {},
  });
  return true;
}
