import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

// FOG God Mode — internal drop analytics for Forward Observations Group,
// built from their full order-export history (tools/fog-godmode pipeline).
// The dashboard itself is a self-contained page served by /api/fog-analytics;
// this route just frames it inside the app shell. Gated by is_god OR an
// explicit /fog-analytics grant (middleware enforces the same; this is
// defense-in-depth at the page, mirroring god-mode/page.tsx).

export const dynamic = "force-dynamic";

export default async function FogAnalyticsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { data: gate } = await supabase.from("profiles").select("is_god, page_access").eq("id", user.id).single();
  const allowed = gate?.is_god === true || (((gate?.page_access as string[] | null) || []).includes("/fog-analytics"));
  if (!allowed) redirect("/dashboard");

  return (
    <iframe
      src="/api/fog-analytics"
      title="FOG God Mode"
      style={{ display: "block", width: "100%", height: "calc(100vh - 0px)", border: 0, background: "#101109" }}
    />
  );
}
