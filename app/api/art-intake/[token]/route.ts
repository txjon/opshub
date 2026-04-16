import { NextRequest, NextResponse } from "next/server";
import { createClient as createAdmin } from "@supabase/supabase-js";

// Public endpoints — no auth required, token-based security
function admin() {
  return createAdmin(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
}

// GET — load brief for the intake form
export async function GET(_req: NextRequest, { params }: { params: { token: string } }) {
  try {
    const db = admin();
    const { data: brief } = await db.from("art_briefs")
      .select("id, title, purpose, audience, mood_words, no_gos, client_intake_submitted_at, clients(name)")
      .eq("client_intake_token", params.token)
      .single();

    if (!brief) return NextResponse.json({ error: "Invalid or expired link" }, { status: 404 });

    const { data: refs } = await db.from("art_brief_files")
      .select("id, file_name, drive_link, client_annotation")
      .eq("brief_id", brief.id)
      .eq("kind", "reference")
      .order("created_at");

    return NextResponse.json({ brief, references: refs || [] });
  } catch (e: any) {
    return NextResponse.json({ error: e.message || "Failed" }, { status: 500 });
  }
}

// POST — client submits their intake
export async function POST(req: NextRequest, { params }: { params: { token: string } }) {
  try {
    const db = admin();
    const { purpose, audience, mood_words, no_gos } = await req.json();

    const { data: brief } = await db.from("art_briefs").select("id").eq("client_intake_token", params.token).single();
    if (!brief) return NextResponse.json({ error: "Invalid link" }, { status: 404 });

    const { error } = await db.from("art_briefs").update({
      purpose: purpose || null,
      audience: audience || null,
      mood_words: mood_words || [],
      no_gos: no_gos || null,
      client_intake_submitted_at: new Date().toISOString(),
      state: "sent",
      updated_at: new Date().toISOString(),
    }).eq("id", brief.id);

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ success: true });
  } catch (e: any) {
    return NextResponse.json({ error: e.message || "Failed" }, { status: 500 });
  }
}

// PATCH — update a reference annotation (client writes per-image note)
export async function PATCH(req: NextRequest, { params }: { params: { token: string } }) {
  try {
    const db = admin();
    const { file_id, client_annotation } = await req.json();

    const { data: brief } = await db.from("art_briefs").select("id").eq("client_intake_token", params.token).single();
    if (!brief) return NextResponse.json({ error: "Invalid link" }, { status: 404 });

    const { error } = await db.from("art_brief_files")
      .update({ client_annotation })
      .eq("id", file_id)
      .eq("brief_id", brief.id);

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ success: true });
  } catch (e: any) {
    return NextResponse.json({ error: e.message || "Failed" }, { status: 500 });
  }
}
