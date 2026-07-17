import { redirect } from "next/navigation";

// Legacy shipping page — retired 2026-07-16 (Jon). /shipping2 (forward-from-
// received, movement-ledger) is THE shipping surface. Middleware already
// redirects when V2_WRITES_LIVE; this stub retires the dead page code and
// covers the flag-off path. Grants cover both via V2_TWIN_PAIRS. Full legacy
// page lives in git history (pre-2026-07-16).
export default function LegacyShippingRedirect() {
  redirect("/shipping2");
}
