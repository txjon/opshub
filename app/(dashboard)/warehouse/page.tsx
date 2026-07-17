import { redirect } from "next/navigation";

// Legacy warehouse page — retired 2026-07-17 (roadmap Tier 1). It escaped the
// 2026-07-16 retirement sweep that stubbed /production /receiving /shipping
// /fulfillment, was UNCATALOGUED (failed open past the permissions system),
// and still carried the pre-ledger receive/forward write path that could
// corrupt the movement-ledger model. Receiving lives on /receiving2,
// forwarding on /shipping2, fulfillment on /staging2. Full legacy page lives
// in git history (pre-2026-07-17).
export default function LegacyWarehouseRedirect() {
  redirect("/receiving2");
}
