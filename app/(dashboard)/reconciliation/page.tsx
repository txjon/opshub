import { redirect } from "next/navigation";

// Merged into Bills (Financial V2 Phase 2, Aug 25 2026) — one surface,
// capability-derived. The route stays for bookmarks + grants (twin pair).
export default function ReconciliationRedirect() {
  redirect("/billing");
}
