import { redirect } from "next/navigation";

// /services is retired (Sep 2026) — Jon: the page "says too much" for the
// exclusive positioning. The home page's ServiceGrid hits the points and
// /start does the heavy lifting. Old links and search results land here,
// so redirect instead of 404.
export default function ServicesRedirect() {
  redirect("/");
}
