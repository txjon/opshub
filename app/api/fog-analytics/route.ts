import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { FOG_DASHBOARD_HTML } from "./dashboard-html.generated";

// Serves the FOG God Mode dashboard (built by tools/fog-godmode) as a full
// HTML document for the /fog-analytics iframe. Internal only: gated by
// is_god OR an explicit /fog-analytics page grant, mirroring god-mode/page.tsx.
// The HTML ships as a generated TS string so it bundles without fs tracing.

export const dynamic = "force-dynamic";

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { data: gate } = await supabase.from("profiles").select("is_god, page_access").eq("id", user.id).single();
  const allowed = gate?.is_god === true || (((gate?.page_access as string[] | null) || []).includes("/fog-analytics"));
  if (!allowed) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  return new NextResponse(FOG_DASHBOARD_HTML, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "private, no-store",
    },
  });
}
