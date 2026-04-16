import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import crypto from "crypto";

// POST — generate or return an intake token for a brief
export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { brief_id } = await req.json();
    if (!brief_id) return NextResponse.json({ error: "brief_id required" }, { status: 400 });

    const { data: existing } = await supabase.from("art_briefs").select("client_intake_token").eq("id", brief_id).single();
    let token = existing?.client_intake_token;

    if (!token) {
      token = crypto.randomBytes(16).toString("hex");
      const { error } = await supabase.from("art_briefs").update({ client_intake_token: token }).eq("id", brief_id);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ token });
  } catch (e: any) {
    return NextResponse.json({ error: e.message || "Failed" }, { status: 500 });
  }
}
