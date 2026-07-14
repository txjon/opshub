// Staging v2 — the "Enter into Shopify" write. A stage-route item, once received,
// is staged; entering it into Shopify appends a `stage` movement (the model's
// enter-into-Shopify signal — availableToEnter = received − pulled − entered).
// Entered = the END of OpsHub's road. Return reverses it back to received.
// Mirrors the shipping/receiving write pattern. Runs client-side.

import { appendMovement, recomputeItemFromLedger, cleanPositive } from "./inventory-ledger";
import { logJobActivity } from "@/components/JobActivityPanel";

type SizeQtys = Record<string, number>;
const sum = (q: SizeQtys) => Object.values(q || {}).reduce((a, n) => a + (Number(n) || 0), 0);

// Enter a staged item (or a portion) into Shopify — append a `stage` movement.
export async function enterIntoShopify(sb: any, args: { itemId: string; jobId: string; itemName: string; qtys: SizeQtys }): Promise<{ ok: boolean; entered: number; error?: string }> {
  try {
    const q = cleanPositive(args.qtys);
    if (sum(q) === 0) return { ok: false, entered: 0, error: "Nothing to enter." };
    await appendMovement(sb, { itemId: args.itemId, jobId: args.jobId, type: "stage", qtys: q, reason: "Entered into Shopify", description: args.itemName });
    await recomputeItemFromLedger(sb, args.itemId);
    logJobActivity(args.jobId, `Entered ${args.itemName} into Shopify · ${sum(q)} units`);
    return { ok: true, entered: sum(q) };
  } catch (e: any) { console.error("[staging] enterIntoShopify", e); return { ok: false, entered: 0, error: e?.message || "Enter failed." }; }
}

// Return an entered item back to received (reverse its `stage` movements).
export async function returnEntered(sb: any, args: { itemId: string; jobId: string; itemName: string }): Promise<{ ok: boolean; error?: string }> {
  try {
    const { data: rows } = await sb.from("movements")
      .select("*").eq("item_id", args.itemId).eq("type", "stage").order("created_at", { ascending: false });
    const all = (rows || []) as any[];
    const reversed = new Set(all.filter(m => m.reverses_id).map(m => m.reverses_id));
    for (const t of all.filter(m => !m.reverses_id && !reversed.has(m.id))) {
      const neg = Object.fromEntries(Object.entries(t.qtys || {}).map(([s, n]) => [s, -(Number(n) || 0)]));
      await appendMovement(sb, { itemId: args.itemId, jobId: t.job_id, type: "stage", qtys: neg, reason: "Returned from Shopify to received", reversesId: t.id, description: t.description });
    }
    const st = await recomputeItemFromLedger(sb, args.itemId);
    // Deliberate un-complete: webstore_entered_at is advance-only in recompute.
    // Clear it only when nothing is entered anymore (a partial return that still
    // leaves the item fully entered keeps its flag via recompute).
    if (!st || st.staged === 0) {
      await sb.from("items").update({ webstore_entered_at: null }).eq("id", args.itemId);
    }
    logJobActivity(args.jobId, `Returned ${args.itemName} from Shopify to received`);
    return { ok: true };
  } catch (e: any) { console.error("[staging] returnEntered", e); return { ok: false, error: e?.message || "Return failed." }; }
}

// Fix an entered count in place — reverse the item's `stage` movements, re-append
// the corrected qty (both stay on the ledger).
export async function editEntered(sb: any, args: { itemId: string; jobId: string; itemName: string; newQtys: SizeQtys }): Promise<{ ok: boolean; error?: string }> {
  try {
    const corrected = cleanPositive(args.newQtys);
    const { data: rows } = await sb.from("movements")
      .select("*").eq("item_id", args.itemId).eq("type", "stage").order("created_at", { ascending: false });
    const all = (rows || []) as any[];
    const reversed = new Set(all.filter(m => m.reverses_id).map(m => m.reverses_id));
    for (const t of all.filter(m => !m.reverses_id && !reversed.has(m.id))) {
      const neg = Object.fromEntries(Object.entries(t.qtys || {}).map(([s, n]) => [s, -(Number(n) || 0)]));
      await appendMovement(sb, { itemId: args.itemId, jobId: t.job_id, type: "stage", qtys: neg, reason: "Corrected entered count", reversesId: t.id, description: t.description });
    }
    await appendMovement(sb, { itemId: args.itemId, jobId: args.jobId, type: "stage", qtys: corrected, reason: "Corrected entered count", description: args.itemName });
    await recomputeItemFromLedger(sb, args.itemId);
    logJobActivity(args.jobId, `Corrected entered count for ${args.itemName} → ${sum(corrected)}`);
    return { ok: true };
  } catch (e: any) { console.error("[staging] editEntered", e); return { ok: false, error: e?.message || "Edit failed." }; }
}
