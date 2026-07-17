import { redirect } from "next/navigation";

// Legacy receiving page — retired 2026-07-16 (Jon). /receiving2 (box-centric,
// movement-ledger) is THE receiving surface. Grants cover both via
// V2_TWIN_PAIRS; nav auto-swaps; this catches direct URLs/bookmarks.
// Full legacy page lives in git history (pre-2026-07-16).
export default function LegacyReceivingRedirect() {
  redirect("/receiving2");
}
