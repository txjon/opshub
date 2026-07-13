// Receiving v2 — the receive write. Counting a box in appends receive movements
// to the ledger (the source of truth), stamps the box's lines received, flips the
// shipment when its last line lands, and handles pulls: production-declared pulls
// get FULFILLED and receiving can add its OWN pulls — both as ledger `pull`
// movements so the derivation drops them from what forwards downstream (pulls
// STACK, per H8). Runs client-side, like /production2 + the live /receiving.

import { recordReceive, appendMovement, recomputeItemFromLedger, cleanPositive } from "./inventory-ledger";
import { logJobActivity } from "@/components/JobActivityPanel";

type SizeQtys = Record<string, number>;
const sum = (q: SizeQtys) => Object.values(q || {}).reduce((a, n) => a + (Number(n) || 0), 0);
const addQtys = (a: SizeQtys, b: SizeQtys): SizeQtys => {
  const out: SizeQtys = { ...(a || {}) };
  for (const [s, n] of Object.entries(b || {})) out[s] = (out[s] || 0) + (Number(n) || 0);
  return out;
};

export type ReceiveItemInput = {
  itemId: string; jobId: string; itemName: string;
  cumReceived: SizeQtys;    // item's prior cumulative received across boxes
  deliveredQtys: SizeQtys;  // what actually arrived in THIS box
};
export type FulfillPullInput = { pullId: string; itemId: string; jobId: string; qtys: SizeQtys };
export type NewPullInput = { itemId: string; jobId: string; qtys: SizeQtys; kind: string; reason: string | null };

export async function receiveBox(sb: any, args: {
  shipmentId: string;
  note?: string | null;
  condition?: string;
  items: ReceiveItemInput[];
  fulfillPulls?: FulfillPullInput[];
  newPulls?: NewPullInput[];
}): Promise<{ ok: boolean; received: number; pulled: number; error?: string }> {
  try {
    const now = new Date().toISOString();
    const { data: { user } = { user: null } } = await sb.auth.getUser();
    const jobs = new Set<string>();
    let receivedTotal = 0, pulledTotal = 0;

    // 1) receive each line — ledger delta (target = prior cumulative + this box) + stamp the box line
    for (const it of args.items) {
      const delivered = cleanPositive(it.deliveredQtys);
      const tot = sum(delivered);
      if (tot === 0) continue;
      const target = addQtys(it.cumReceived || {}, delivered);
      await recordReceive(sb, {
        itemId: it.itemId, jobId: it.jobId, targetReceived: target,
        shipmentId: args.shipmentId, reason: args.note || null, description: it.itemName,
      });
      await sb.from("shipment_lines").update({
        received: true, received_at: now, received_qtys: delivered,
        condition: args.condition || "good", notes: (args.note || "").trim() || null,
      }).eq("shipment_id", args.shipmentId).eq("item_id", it.itemId);
      await sb.from("items").update({
        receiving_data: { condition: args.condition || "good", notes: args.note || "", received_by: user?.id || null, received_by_email: user?.email || null, received_at: now },
      }).eq("id", it.itemId);
      receivedTotal += tot; jobs.add(it.jobId);
    }

    // 2) flip the shipment to received once every line is in
    const { count } = await sb.from("shipment_lines").select("id", { count: "exact", head: true }).eq("shipment_id", args.shipmentId).eq("received", false);
    if ((count ?? 0) === 0) {
      await sb.from("shipments").update({ status: "received", received_at: now, received_by: user?.id || null }).eq("id", args.shipmentId);
    }

    // 3) fulfil production-declared pulls → ledger pull movement + close the request
    for (const p of args.fulfillPulls || []) {
      const q = cleanPositive(p.qtys); const t = sum(q);
      if (!t) continue;
      await appendMovement(sb, { itemId: p.itemId, jobId: p.jobId, type: "pull", qtys: q, shipmentId: args.shipmentId, reason: "Production pull fulfilled at receiving" });
      await sb.from("pull_requests").update({ status: "fulfilled", fulfilled_qtys: q, fulfilled_at: now, fulfilled_by: user?.id || null }).eq("id", p.pullId);
      await recomputeItemFromLedger(sb, p.itemId);
      pulledTotal += t; jobs.add(p.jobId);
    }

    // 4) receiving's own pulls → declare + fulfil at once, ledger pull movement (stacks)
    for (const p of args.newPulls || []) {
      const q = cleanPositive(p.qtys); const t = sum(q);
      if (!t) continue;
      await sb.from("pull_requests").insert({
        job_id: p.jobId, item_id: p.itemId, shipment_id: args.shipmentId, kind: p.kind, qtys: q,
        reason: p.reason || null, status: "fulfilled", fulfilled_qtys: q, fulfilled_at: now,
        requested_by: user?.id || null, requested_by_name: user?.email || null, fulfilled_by: user?.id || null,
      });
      await appendMovement(sb, { itemId: p.itemId, jobId: p.jobId, type: "pull", qtys: q, shipmentId: args.shipmentId, reason: `Receiving pull (${p.kind})` });
      await recomputeItemFromLedger(sb, p.itemId);
      pulledTotal += t; jobs.add(p.jobId);
    }

    if (receivedTotal === 0 && pulledTotal === 0) return { ok: false, received: 0, pulled: 0, error: "Nothing to receive." };
    for (const jobId of Array.from(jobs)) {
      const n = args.items.filter(i => i.jobId === jobId).length;
      logJobActivity(jobId, `Received ${n} item${n === 1 ? "" : "s"} at warehouse${pulledTotal ? ` · ${pulledTotal} pulled` : ""}`);
    }
    return { ok: true, received: receivedTotal, pulled: pulledTotal };
  } catch (e: any) {
    console.error("[receiving2] receiveBox", e);
    return { ok: false, received: 0, pulled: 0, error: e?.message || "Receive failed." };
  }
}
