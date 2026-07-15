// Close a partially-shipped item SHORT — the operator saying "this is all that's
// coming." Sets ship_final so the derivation books the un-shipped balance as a
// SHORTAGE (not owed): the item closes, drops off the production board, and its
// shipped units flow downstream (receiving relabels it "short", not "partial").
//
// NO ledger movement — a shortage is a DERIVED state (ordered − shipped, once
// closed), not an inventory event; nothing physically moved for the short units.
// And no "reopen": if the missing units later turn up in the box, the receiver
// over-receives and it nets out (received > shipped = a green overage).
//
// pipeline_stage → "shipped" mirrors production2-ship's closed path, so the legacy
// calculatePhase reads the item as done-shipping. recompute refreshes the caches,
// recalcJobPhase advances the job (the closed item may be its last open one).

import { recomputeItemFromLedger } from "./inventory-ledger";
import { recalcJobPhase } from "./job-phase-recalc";
import { logJobActivity } from "@/components/JobActivityPanel";

export async function closeShort(sb: any, args: { itemId: string; jobId: string; itemName: string; shortUnits?: number }): Promise<{ ok: boolean; error?: string }> {
  try {
    const { data: cur } = await sb.from("items").select("decorator_assignments(id)").eq("id", args.itemId).single();
    await sb.from("items").update({ ship_final: true, pipeline_stage: "shipped" }).eq("id", args.itemId);
    const daId = cur?.decorator_assignments?.[0]?.id;
    if (daId) await sb.from("decorator_assignments").update({ pipeline_stage: "shipped" }).eq("id", daId);
    await recomputeItemFromLedger(sb, args.itemId);
    await recalcJobPhase(sb, args.jobId);
    logJobActivity(args.jobId, `Closed ${args.itemName} short${args.shortUnits ? ` — ${args.shortUnits} unit${args.shortUnits === 1 ? "" : "s"} booked as a shortage` : ""}`);
    return { ok: true };
  } catch (e: any) { console.error("[production2] closeShort", e); return { ok: false, error: e?.message || "Close failed." }; }
}
