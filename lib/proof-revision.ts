import { recalcJobPhase } from "./job-phase-recalc";

// A team member replaced an APPROVED proof with new content (upload or re-bake).
// The prior approval was for the now-superseded proof, so the item is no longer
// client-approved. Reset artwork_status — the exact move the client-side
// requestChanges path already makes (lib/portal/approval-actions.ts) — and
// recompute phase so the Blanks/PO gate re-closes, the client hub stops showing
// a false "Approved", and phase-derived boards update.
//
// The .eq("approved") guard makes this a no-op for items that weren't approved,
// and the whole thing is defensive: a file upload / proof bake must never fail
// because this follow-up hiccuped.
export async function reopenProofApproval(sb: any, itemId: string): Promise<void> {
  try {
    const { data: it } = await sb
      .from("items")
      .update({ artwork_status: "not_started" })
      .eq("id", itemId)
      .eq("artwork_status", "approved")
      .select("job_id")
      .maybeSingle();
    // Only recompute phase if we actually reopened an approved item.
    if (it?.job_id) await recalcJobPhase(sb, it.job_id);
  } catch (e) {
    console.error("[reopenProofApproval] failed:", (e as any)?.message);
  }
}
