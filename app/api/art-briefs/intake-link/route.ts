import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import crypto from "crypto";

// POST — generate/return intake + client portal tokens for a brief.
// Prefers the client-wide portal URL (covers every open brief for that client)
// but still returns the per-brief intake token as a fallback.
export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { brief_id } = await req.json();
    if (!brief_id) return NextResponse.json({ error: "brief_id required" }, { status: 400 });

    const { data: brief } = await supabase
      .from("art_briefs")
      .select("client_intake_token, client_id, clients(portal_token)")
      .eq("id", brief_id)
      .single();
    if (!brief) return NextResponse.json({ error: "Brief not found" }, { status: 404 });

    // Mint per-brief intake token if needed
    let token = (brief as any).client_intake_token;
    if (!token) {
      token = crypto.randomBytes(16).toString("hex");
      const { error } = await supabase.from("art_briefs").update({ client_intake_token: token }).eq("id", brief_id);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Mint client portal token if needed
    let clientPortalToken = (brief as any).clients?.portal_token as string | undefined;
    if (!clientPortalToken && (brief as any).client_id) {
      clientPortalToken = crypto.randomBytes(16).toString("hex");
      await supabase.from("clients").update({ portal_token: clientPortalToken }).eq("id", (brief as any).client_id);
    }

    return NextResponse.json({
      token,                        // per-brief intake token (/art-intake/[token])
      client_portal_token: clientPortalToken || null, // client hub token (/portal/client/[token])
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message || "Failed" }, { status: 500 });
  }
}
