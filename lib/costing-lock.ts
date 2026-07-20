// Costing lock is DERIVED from workflow state — NOT a manual "Lock In Pricing"
// flag anymore (Jon 2026-07-20: that daily click was ceremony; pricing already
// autosaves and sell_per_unit is the live source of truth).
//
// The rule: pricing is freely editable while you're building, and AUTO-LOCKS
// (read-only) the moment it's committed — the quote is sent or approved. That's
// the real "prices shouldn't silently change now" point. An explicit
// "Unlock to revise" (type_meta.costing_unlocked) reopens it; sending the quote
// clears that override so a revision re-locks on re-send.

export function isCostingCommitted(job: any): boolean {
  const tm = job?.type_meta || {};
  return !!(tm.quote_sent_at || job?.quote_approved);
}

export function isCostingLocked(job: any): boolean {
  if (!job) return false;
  // Complete / cancelled jobs are historic records — always read-only.
  if (job.phase === "complete" || job.phase === "cancelled") return true;
  // Explicit revise override reopens a committed job.
  if (job.type_meta?.costing_unlocked) return false;
  return isCostingCommitted(job);
}
