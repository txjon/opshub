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

// ── Studio under dev (Jon, Jul 23 2026) ──────────────────────────────────────
// The Studio flow is being reworked in The Lab. While this is true, the studio
// is pulled from every NAV / entry point: the client-hub Studio tab + the guest-
// house studio section, and the main-app "Art Studio" + "Studio v2" menu items.
// This is NAV-HIDE ONLY — the pages stay reachable by direct URL and the access
// guard (canAccessPath) is untouched, so the team can keep checking them and
// contextual deep-links still work. Flip to false to bring the studio back.
export const STUDIO_UNDER_DEV = true;
// The main-app nav hrefs pulled while STUDIO_UNDER_DEV.
export const STUDIO_HIDDEN_HREFS = ["/art-studio", "/studio2"];
