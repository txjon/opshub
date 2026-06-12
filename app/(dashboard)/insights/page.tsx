import { redirect } from "next/navigation";

// Insights has been merged into God Mode ("Overview"). Its unique operational
// sections (AR Aging, Production Health, Payment Attention) now live there as
// the "Operations" chip group, on the same ShipStation-aware data. Anyone who
// lands here goes to God Mode; non-owners are bounced to /dashboard by it.
export default function InsightsRedirect() {
  redirect("/god-mode");
}
