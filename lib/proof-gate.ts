// ── THE proof gate — one source of truth for "is this item's art signed off?"
//
// items.artwork_status:
//   "approved"     signed off (client in the hub, or internally — verbal / PO)
//   "n_a"          no proof needed for this item — never gates, never counted
//   anything else  needs a proof (not_started / in_progress / null)
//
// ps = the caller's per-item file-level proof status ({ allApproved }) when it
// has one; omit when it doesn't (the V2 job page keys off artwork_status only).
//
// Before 2026-08-25 this disjunction was copy-pasted in seven places with
// `items.length` as every denominator; a no-proof item could only pass the
// gate by lying ("approved"). Every reader goes through here now.

export type ProofPs = { allApproved?: boolean } | undefined;

export const needsProof = (it: any): boolean => (it?.artwork_status || "not_started") !== "n_a";

export const proofSatisfied = (it: any, ps?: ProofPs): boolean =>
  !needsProof(it) || it?.artwork_status === "approved" || !!ps?.allApproved;

// Counts over the items that actually need a proof. noProof = the n_a ones.
export function proofCounts(items: any[], ps?: Record<string, ProofPs>): { approved: number; total: number; noProof: number } {
  const gated = (items || []).filter(needsProof);
  return {
    approved: gated.filter(it => proofSatisfied(it, ps?.[it.id])).length,
    total: gated.length,
    noProof: (items || []).length - gated.length,
  };
}

// Job-level gate: at least one item, every item satisfied (n_a items pass).
export const allProofsSatisfied = (items: any[], ps?: Record<string, ProofPs>): boolean =>
  (items || []).length > 0 && (items || []).every(it => proofSatisfied(it, ps?.[it.id]));

// Bake nudge ("N proof PDFs not in Drive"): only proofs the client has SEEN
// (sent) or that are SIGNED OFF need a PDF in Drive. Drafts bake at Send —
// nudging them asks for the thing the send flow deliberately stopped doing.
// A never-stamped spec (legacy / carried in on a reorder) with a proof PDF
// already on file is fine; a stamped-but-outdated version still re-bakes so
// renderer bumps keep working.
export function proofPdfMissing(it: any, hasProofFile: boolean, rendererVersion: number): boolean {
  if (!it?.proof_spec || !needsProof(it)) return false;
  const engaged = !!it.proof_sent_at || it.artwork_status === "approved";
  if (!engaged) return false;
  const v = it.proof_spec.bakedRendererVersion;
  if (v == null) return !hasProofFile;
  return v < rendererVersion;
}
