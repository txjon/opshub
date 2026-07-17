// Shipping v2 — the forward write. Forwarding ship_through goods to the client
// creates OUR outbound shipment (the frozen client manifest) and appends a
// `forward` movement per item, which the derivation subtracts from
// availableToForward (received − pulled − forwarded). Runs client-side, like
// /production2 + /receiving2. Edit/Return mirror the receiving pattern.

import { appendMovement, recomputeItemFromLedger, cleanPositive } from "./inventory-ledger";
import { recalcJobPhase } from "./job-phase-recalc";
import { deleteShipmentIfEmpty } from "./handoff";
import { logJobActivity } from "@/components/JobActivityPanel";

type SizeQtys = Record<string, number>;
const sum = (q: SizeQtys) => Object.values(q || {}).reduce((a, n) => a + (Number(n) || 0), 0);
const normTrack = (t: string | null | undefined) => (t || "").trim().toUpperCase() || null;

export type ForwardItemInput = { itemId: string; jobId: string; itemName: string; qtys: SizeQtys };

// Forward a job's ready items to the client. Creates the outbound shipment first
// (so each forward movement carries its shipment_id → per-shipment reversal),
// then appends forward movements + freezes the manifest as shipment_lines.
export async function forwardToClient(sb: any, args: {
  jobId: string; items: ForwardItemInput[]; carrier: string | null; tracking: string | null;
}): Promise<{ ok: boolean; shipmentId?: string; forwarded: number; error?: string }> {
  try {
    const now = new Date().toISOString();
    const { data: { user } = { user: null } } = await sb.auth.getUser();
    const lines = args.items.map(it => ({ ...it, qtys: cleanPositive(it.qtys) })).filter(it => sum(it.qtys) > 0);
    if (!lines.length) return { ok: false, forwarded: 0, error: "Nothing to forward." };

    const tracking = normTrack(args.tracking);
    const groupKey = `forward::${args.jobId}::${tracking || "notrk"}::${Date.now()}`;
    const { data: ship, error: se } = await sb.from("shipments").insert({
      direction: "outbound", source: "decorator", decorator_id: null, group_key: groupKey,
      carrier: (args.carrier || "").trim() || null, tracking, pickup: false, status: "closed", created_by: user?.id || null,
    }).select("id").single();
    if (se || !ship?.id) return { ok: false, forwarded: 0, error: se?.message || "Could not create the outbound shipment." };

    let forwarded = 0;
    for (const it of lines) {
      await appendMovement(sb, { itemId: it.itemId, jobId: it.jobId, type: "forward", qtys: it.qtys, shipmentId: ship.id, tracking, description: it.itemName });
      await recomputeItemFromLedger(sb, it.itemId);
      await sb.from("shipment_lines").insert({ shipment_id: ship.id, item_id: it.itemId, job_id: it.jobId, description: it.itemName, ship_qtys: it.qtys });
      forwarded += sum(it.qtys);
    }
    await recalcJobPhase(sb, args.jobId);
    logJobActivity(args.jobId, `Forwarded ${lines.length} item${lines.length === 1 ? "" : "s"} to client · ${forwarded} units`);
    return { ok: true, shipmentId: ship.id, forwarded };
  } catch (e: any) { console.error("[shipping2] forwardToClient", e); return { ok: false, forwarded: 0, error: e?.message || "Forward failed." }; }
}

// Reverse this outbound shipment's forward movements for one item (append-only),
// drop its manifest line → the item returns to "received" (availableToForward
// restored). Spec: forwarded → received.
export async function returnForwardedLine(sb: any, args: { shipmentId: string; itemId: string; jobId: string; itemName: string }): Promise<{ ok: boolean; error?: string }> {
  try {
    const { data: rows } = await sb.from("movements")
      .select("*").eq("item_id", args.itemId).eq("type", "forward").eq("shipment_id", args.shipmentId)
      .order("created_at", { ascending: false });
    const all = (rows || []) as any[];
    const reversed = new Set(all.filter(m => m.reverses_id).map(m => m.reverses_id));
    for (const t of all.filter(m => !m.reverses_id && !reversed.has(m.id))) {
      const neg = Object.fromEntries(Object.entries(t.qtys || {}).map(([s, n]) => [s, -(Number(n) || 0)]));
      await appendMovement(sb, { itemId: args.itemId, jobId: t.job_id, type: "forward", qtys: neg, shipmentId: args.shipmentId, reason: "Returned to received", reversesId: t.id, description: t.description });
    }
    await sb.from("shipment_lines").delete().eq("shipment_id", args.shipmentId).eq("item_id", args.itemId);
    await deleteShipmentIfEmpty(sb, args.shipmentId); // last line out → no hollow box left behind
    const st = await recomputeItemFromLedger(sb, args.itemId);
    // Deliberate un-complete: forwarded_at/forward_tracking are advance-only in
    // recompute. Clear them only when NOTHING is forwarded anymore — if another
    // forward wave still covers the item, recompute keeps it done/stamped.
    if (!st || st.forwarded === 0) {
      await sb.from("items").update({ forwarded_at: null, forward_tracking: null }).eq("id", args.itemId);
    }
    await recalcJobPhase(sb, args.jobId);
    logJobActivity(args.jobId, `Returned ${args.itemName} to received`);
    return { ok: true };
  } catch (e: any) { console.error("[shipping2] returnForwardedLine", e); return { ok: false, error: e?.message || "Return failed." }; }
}

// Fix a forwarded count in place — reverse this shipment's forward for the item,
// re-append the corrected qty, update the frozen line (both stay on the ledger).
export async function editForwardedLine(sb: any, args: { shipmentId: string; itemId: string; jobId: string; itemName: string; newQtys: SizeQtys }): Promise<{ ok: boolean; error?: string }> {
  try {
    const corrected = cleanPositive(args.newQtys);
    const { data: rows } = await sb.from("movements")
      .select("*").eq("item_id", args.itemId).eq("type", "forward").eq("shipment_id", args.shipmentId)
      .order("created_at", { ascending: false });
    const all = (rows || []) as any[];
    const reversed = new Set(all.filter(m => m.reverses_id).map(m => m.reverses_id));
    for (const t of all.filter(m => !m.reverses_id && !reversed.has(m.id))) {
      const neg = Object.fromEntries(Object.entries(t.qtys || {}).map(([s, n]) => [s, -(Number(n) || 0)]));
      await appendMovement(sb, { itemId: args.itemId, jobId: t.job_id, type: "forward", qtys: neg, shipmentId: args.shipmentId, reason: "Corrected forwarded count", reversesId: t.id, description: t.description });
    }
    await appendMovement(sb, { itemId: args.itemId, jobId: args.jobId, type: "forward", qtys: corrected, shipmentId: args.shipmentId, reason: "Corrected forwarded count", description: args.itemName });
    await recomputeItemFromLedger(sb, args.itemId);
    await sb.from("shipment_lines").update({ ship_qtys: corrected }).eq("shipment_id", args.shipmentId).eq("item_id", args.itemId);
    await recalcJobPhase(sb, args.jobId);
    logJobActivity(args.jobId, `Corrected forwarded count for ${args.itemName} → ${sum(corrected)}`);
    return { ok: true };
  } catch (e: any) { console.error("[shipping2] editForwardedLine", e); return { ok: false, error: e?.message || "Edit failed." }; }
}
