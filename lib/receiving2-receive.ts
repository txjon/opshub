// Receiving v2 — the receive write. Counting a box in appends receive movements
// to the ledger (the source of truth), stamps the box's lines received, flips the
// shipment when its last line lands, and handles pulls: production-declared pulls
// get FULFILLED and receiving can add its OWN pulls — both as ledger `pull`
// movements so the derivation drops them from what forwards downstream (pulls
// STACK, per H8). Runs client-side, like /production2 + the live /receiving.

import { recordReceive, appendMovement, recomputeItemFromLedger, cleanPositive, reverseReceiptForShipment } from "./inventory-ledger";
import { fulfillPullRequest, recordAdHocPull, resolvePulledInventory } from "./handoff";
import { logJobActivity } from "@/components/JobActivityPanel";

// Resolve a held pull. shipped_out / consumed = it's gone (leave the ledger pull
// in place). returned = it goes BACK to available downstream, so also reverse the
// ledger pull movement (negative) so the derivation restores it.
export async function resolvePull(sb: any, row: { id: string; itemId: string; jobId: string; qtys: Record<string, number> }, status: "shipped_out" | "returned" | "consumed"): Promise<{ ok: boolean; error?: string }> {
  try {
    await resolvePulledInventory(sb, { id: row.id, item_id: row.itemId, qtys: row.qtys }, status);
    if (status === "returned") {
      const neg = Object.fromEntries(Object.entries(row.qtys || {}).map(([s, n]) => [s, -(Number(n) || 0)]));
      await appendMovement(sb, { itemId: row.itemId, jobId: row.jobId, type: "pull", qtys: neg, reason: "Pull returned to stock" });
      await recomputeItemFromLedger(sb, row.itemId);
    }
    return { ok: true };
  } catch (e: any) { console.error("[receiving2] resolvePull", e); return { ok: false, error: e?.message || "Resolve failed." }; }
}

type SizeQtys = Record<string, number>;
const sum = (q: SizeQtys) => Object.values(q || {}).reduce((a, n) => a + (Number(n) || 0), 0);

// Return a received line back one stage — undoes THIS box's receipt for the item
// (append-only reversal, other boxes untouched), clears the line, and flips the
// shipment out of "received" so it re-appears in Incoming. Pulls are left as-is.
export async function returnReceivedLine(sb: any, args: { shipmentId: string; itemId: string; jobId: string; itemName: string }): Promise<{ ok: boolean; error?: string }> {
  try {
    const now = new Date().toISOString();
    await reverseReceiptForShipment(sb, args.itemId, args.shipmentId, "Returned to receiving");
    await sb.from("shipment_lines").update({ received: false, received_at: null, received_qtys: {} })
      .eq("shipment_id", args.shipmentId).eq("item_id", args.itemId);
    // any un-received line means the box is no longer fully received
    await sb.from("shipments").update({ status: "expected", received_at: null }).eq("id", args.shipmentId);
    logJobActivity(args.jobId, `Returned ${args.itemName} to receiving`);
    return { ok: true };
  } catch (e: any) { console.error("[receiving2] returnReceivedLine", e); return { ok: false, error: e?.message || "Return failed." }; }
}

// Return an INCOMING (not-yet-received) item back one stage to production
// (spec: receiving→production). Reverses this box's ship movement(s) for the
// item (append-only), clears the final flag, and drops the line from the box so
// the item's owed climbs back and it reappears on the production board.
export async function returnIncomingToProduction(sb: any, args: { shipmentId: string; itemId: string; jobId: string; itemName: string }): Promise<{ ok: boolean; error?: string }> {
  try {
    const { data: rows } = await sb.from("movements")
      .select("*").eq("item_id", args.itemId).eq("type", "ship").eq("shipment_id", args.shipmentId)
      .order("created_at", { ascending: false });
    const all = (rows || []) as any[];
    const reversed = new Set(all.filter(m => m.reverses_id).map(m => m.reverses_id));
    const targets = all.filter(m => !m.reverses_id && !reversed.has(m.id));
    for (const t of targets) {
      const neg = Object.fromEntries(Object.entries(t.qtys || {}).map(([s, n]) => [s, -(Number(n) || 0)]));
      await appendMovement(sb, { itemId: args.itemId, jobId: t.job_id, type: "ship", qtys: neg, shipmentId: args.shipmentId, reason: "Returned to production", reversesId: t.id, description: t.description });
    }
    await sb.from("items").update({ ship_final: false }).eq("id", args.itemId);
    await sb.from("shipment_lines").delete().eq("shipment_id", args.shipmentId).eq("item_id", args.itemId);
    await recomputeItemFromLedger(sb, args.itemId);
    logJobActivity(args.jobId, `Returned ${args.itemName} to production`);
    return { ok: true };
  } catch (e: any) { console.error("[receiving2] returnIncomingToProduction", e); return { ok: false, error: e?.message || "Return failed." }; }
}

// Edit an INCOMING line's SHIPPED count — correct what the vendor said they sent.
// Reverses this box's ship movement(s) for the item, re-appends the corrected
// shipped qty (both stay on the ledger), and updates the box line's ship_qtys.
export async function editShippedLine(sb: any, args: { shipmentId: string; itemId: string; jobId: string; itemName: string; newShipped: SizeQtys }): Promise<{ ok: boolean; error?: string }> {
  try {
    const corrected = cleanPositive(args.newShipped);
    const { data: rows } = await sb.from("movements")
      .select("*").eq("item_id", args.itemId).eq("type", "ship").eq("shipment_id", args.shipmentId)
      .order("created_at", { ascending: false });
    const all = (rows || []) as any[];
    const reversed = new Set(all.filter(m => m.reverses_id).map(m => m.reverses_id));
    const targets = all.filter(m => !m.reverses_id && !reversed.has(m.id));
    for (const t of targets) {
      const neg = Object.fromEntries(Object.entries(t.qtys || {}).map(([s, n]) => [s, -(Number(n) || 0)]));
      await appendMovement(sb, { itemId: args.itemId, jobId: t.job_id, type: "ship", qtys: neg, shipmentId: args.shipmentId, reason: "Corrected shipped count", reversesId: t.id, description: t.description });
    }
    await appendMovement(sb, { itemId: args.itemId, jobId: args.jobId, type: "ship", qtys: corrected, shipmentId: args.shipmentId, reason: "Corrected shipped count", description: args.itemName });
    await sb.from("shipment_lines").update({ ship_qtys: corrected }).eq("shipment_id", args.shipmentId).eq("item_id", args.itemId);
    await recomputeItemFromLedger(sb, args.itemId);
    logJobActivity(args.jobId, `Corrected shipped count for ${args.itemName} → ${sum(corrected)}`);
    return { ok: true };
  } catch (e: any) { console.error("[receiving2] editShippedLine", e); return { ok: false, error: e?.message || "Edit failed." }; }
}

// Edit a received line's count in place — reverse this box's receipt, then append
// the corrected quantity (both stay on the ledger). Keeps the line received.
export async function editReceivedLine(sb: any, args: { shipmentId: string; itemId: string; jobId: string; itemName: string; newReceived: SizeQtys }): Promise<{ ok: boolean; error?: string }> {
  try {
    const now = new Date().toISOString();
    const corrected = cleanPositive(args.newReceived);
    await reverseReceiptForShipment(sb, args.itemId, args.shipmentId, "Edit received count");
    await appendMovement(sb, { itemId: args.itemId, jobId: args.jobId, type: "receive", qtys: corrected, shipmentId: args.shipmentId, reason: "Corrected received count", description: args.itemName });
    await recomputeItemFromLedger(sb, args.itemId);
    await sb.from("shipment_lines").update({ received: true, received_at: now, received_qtys: corrected })
      .eq("shipment_id", args.shipmentId).eq("item_id", args.itemId);
    logJobActivity(args.jobId, `Corrected received count for ${args.itemName} → ${sum(corrected)}`);
    return { ok: true };
  } catch (e: any) { console.error("[receiving2] editReceivedLine", e); return { ok: false, error: e?.message || "Edit failed." }; }
}
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
export type FulfillPullInput = { pullId: string; itemId: string; jobId: string; itemName: string; qtys: SizeQtys };
export type NewPullInput = { itemId: string; jobId: string; itemName: string; qtys: SizeQtys; kind: string; reason: string | null };

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

    // load current sample_qtys for every item being pulled (fulfillPullRequest/
    // recordAdHocPull accumulate onto it)
    const pullItemIds = Array.from(new Set([...(args.fulfillPulls || []).map(p => p.itemId), ...(args.newPulls || []).map(p => p.itemId)]));
    const sampleMap = new Map<string, SizeQtys>();
    if (pullItemIds.length) {
      const { data } = await sb.from("items").select("id, sample_qtys").in("id", pullItemIds);
      for (const i of data || []) sampleMap.set(i.id, i.sample_qtys || {});
    }

    // 3) fulfil production-declared pulls — lands in pulled_inventory (the held
    //    bucket, action in notes) + sample_qtys, AND a ledger `pull` movement so
    //    the derivation drops them from what forwards.
    for (const p of args.fulfillPulls || []) {
      const q = cleanPositive(p.qtys); const t = sum(q);
      if (!t) continue;
      const { data: pr } = await sb.from("pull_requests").select("*").eq("id", p.pullId).single();
      if (!pr) continue;
      const next = await fulfillPullRequest(sb, pr as any, { fulfilledQtys: q, itemName: p.itemName, currentSampleQtys: sampleMap.get(p.itemId) || {} });
      sampleMap.set(p.itemId, next);
      await appendMovement(sb, { itemId: p.itemId, jobId: p.jobId, type: "pull", qtys: q, shipmentId: args.shipmentId, reason: [pr.kind, pr.reason].filter(Boolean).join(" — ") || "pull" });
      await recomputeItemFromLedger(sb, p.itemId);
      pulledTotal += t; jobs.add(p.jobId);
    }

    // 4) receiving's own pulls — same landing (declare + fulfil at once).
    for (const p of args.newPulls || []) {
      const q = cleanPositive(p.qtys); const t = sum(q);
      if (!t) continue;
      const next = await recordAdHocPull(sb, {
        job_id: p.jobId, item_id: p.itemId, item_name: p.itemName, kind: p.kind, qtys: q,
        reason: p.reason || null, currentSampleQtys: sampleMap.get(p.itemId) || {},
      });
      sampleMap.set(p.itemId, next);
      await appendMovement(sb, { itemId: p.itemId, jobId: p.jobId, type: "pull", qtys: q, shipmentId: args.shipmentId, reason: [p.kind, p.reason].filter(Boolean).join(" — ") || "pull" });
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
