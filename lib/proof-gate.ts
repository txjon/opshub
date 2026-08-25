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

// ── Reorders carry approval with the art (Jon 2026-08-25: "always carries").
// The copy stamps proof_spec.carriedFrom; with artwork_status still "approved"
// the item is DONE, not "ready · not sent": Send proofs skips it (no
// proof_sent_at stamp, no send-time bake) and the Art tab shows provenance.
export type CarriedFrom = { jobNumber: string | null; ref: string | null; itemId: string | null; at: string };
// ref = the PO/purchasing reference the decorator knows the source by: invoice # (else job #) + letter, e.g. "4345-I".

export const carriedFrom = (it: any): CarriedFrom | null => it?.proof_spec?.carriedFrom || null;
export const carriedApproved = (it: any): boolean => it?.artwork_status === "approved" && !!carriedFrom(it);

// What a copy should write. artwork_status: approved / n_a carry, everything
// else starts over. proof_spec: carried whole, stamped with where it came from.
export function carryProofFields(src: any, srcJobNumber: string | null, srcRef: string | null = null, now = new Date().toISOString()): { artwork_status: string; proof_spec: any } {
  const st = src?.artwork_status;
  const artwork_status = st === "approved" || st === "n_a" ? st : "not_started";
  const proof_spec = src?.proof_spec
    ? { ...src.proof_spec, carriedFrom: { jobNumber: srcJobNumber, ref: srcRef, itemId: src.id || null, at: now } as CarriedFrom }
    : null;
  return { artwork_status, proof_spec };
}
