import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import crypto from "crypto";

// POST — return (and mint if needed) the client's portal token for the
// brief's client. The intake form is gone from the UI, so this only
// mints client_portal_token now. Route name kept for backward compat
// with the existing HPD button; could be renamed to /portal-link later.
export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { brief_id } = await req.json();
    if (!brief_id) return NextResponse.json({ error: "brief_id required" }, { status: 400 });

    const { data: brief } = await supabase
      .from("art_briefs")
      .select("client_id, clients(portal_token)")
      .eq("id", brief_id)
      .single();
    if (!brief) return NextResponse.json({ error: "Brief not found" }, { status: 404 });

    let clientPortalToken = (brief as any).clients?.portal_token as string | undefined;
    if (!clientPortalToken && (brief as any).client_id) {
      clientPortalToken = crypto.randomBytes(16).toString("hex");
      await supabase.from("clients").update({ portal_token: clientPortalToken }).eq("id", (brief as any).client_id);
    }

    return NextResponse.json({
      client_portal_token: clientPortalToken || null,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message || "Failed" }, { status: 500 });
  }
}
