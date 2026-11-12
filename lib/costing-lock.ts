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
  // Cancelled jobs are dead records: always read-only.
  if (job.phase === "cancelled") return true;
  // Explicit revise override reopens a committed job, and a complete one too
  // (Nov 2026: a closed, unpaid sample job needed a price fix before the
  // invoice was re-pushed; the button flipped the flag but nothing unlocked).
  if (job.type_meta?.costing_unlocked) return false;
  if (job.phase === "complete") return true;
  return isCostingCommitted(job);
}
