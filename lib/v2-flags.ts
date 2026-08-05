// ── V2 warehouse cutover switch ──────────────────────────────────────────
// The single master flag for the ship-from-production v2 surfaces
// (production2 / receiving2 / shipping2 / staging). While OFF, every write is
// limited to the test client/job so staff on the live legacy surfaces are never
// touched. The after-hours flip is ONE line: V2_WRITES_LIVE = true, then merge
// dev → main. Reversible the same way.
//
// There is NO server-side write gate — v2 writes run client-side through the
// ledger lib fns — so this flag (read by the Board components' isTest checks) is
// the whole gate. Keep it the sole source; do not reintroduce per-file constants.

export const V2_WRITES_LIVE = true;

// While not live, these are the only jobs/clients v2 writes are allowed on.
export const V2_TEST_CLIENTS = ["Playwright Test Co"];
export const V2_TEST_JOBS = ["HPD-2605-054", "HPD-2606-050"];

// Is a v2 write allowed for this job/client right now? Once V2_WRITES_LIVE is
// true this is always true; until then it's the test-only allowlist.
export function v2WriteAllowed(opts: { clientName?: string | null; jobNumber?: string | null }): boolean {
  if (V2_WRITES_LIVE) return true;
  if (opts.clientName && V2_TEST_CLIENTS.includes(opts.clientName)) return true;
  if (opts.jobNumber && V2_TEST_JOBS.includes(opts.jobNumber)) return true;
  return false;
}

// Is this an ACTUAL test client (the Playwright account), independent of the
// live flag? Use this for side effects that must stay sandboxed even after
// cutover — e.g. routing a warehouse-notify email to the caller instead of the
// real warehouse. (v2WriteAllowed is the wrong gate for that: it goes true for
// every real job once live, which would misroute real notifications.)
export function isV2TestClient(clientName?: string | null): boolean {
  return !!clientName && V2_TEST_CLIENTS.includes(clientName);
}

// ── Studio launch (Aug 5 2026) ───────────────────────────────────────────────
// The curtain is DOWN. The rebuilt studio (the Lab's UX on art_briefs) is live
// in the client hub, rolled out per-client via the portal_features 'studio'
// grant — Forward Observations Group is the launch client. Grant a client
// 'studio' in portal_features and their hub grows the tab; no flag flip
// needed ever again. (Jul 23–Aug 5 this was true while the Lab proved the
// rework and the replacement shipped.)
export const STUDIO_UNDER_DEV = false;
// Team-nav hides: none since Aug 4 2026 — /studio (the replacement) is live
// for the team; /art-studio + /studio2 are deleted. The flag above still
// hides the CLIENT-hub studio until the per-client rollout (Phase 3).
export const STUDIO_HIDDEN_HREFS: string[] = [];

// ── Drops hidden from the client hub (Jon, Jul 23 2026) ──────────────────────
// Pull the Drops surface from the client hub: the main-nav Drops tab (all three
// nav renders) + the home "The drops." section. NAV-HIDE ONLY — the /drops route
// still resolves by direct URL (its own hasStudio guard is untouched), so the
// team can keep using it and deep-links work. Flip to false to bring it back.
export const DROPS_UNDER_DEV = true;
