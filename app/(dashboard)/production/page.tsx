import { redirect } from "next/navigation";

// Legacy production board — retired 2026-07-16 (Jon). The v2 board
// (/production2, movement-ledger model) is THE production surface; the nav
// already pointed here-labeled links at v2 (AppShell swapV2Nav), this catches
// direct URLs/bookmarks. Access grants cover both via V2_TWIN_PAIRS in
// lib/access.ts. Full legacy page lives in git history (pre-2026-07-16).
export default function LegacyProductionRedirect() {
  redirect("/production2");
}
