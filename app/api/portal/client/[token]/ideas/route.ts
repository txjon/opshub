import { NextRequest, NextResponse } from "next/server";
import { createClient as createAdmin } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/portal/client/[token]/ideas — the Studio's casual idea drop.
// Body: { title, notes? }
//
// Lands as an art_briefs row (state 'draft', source 'client') — the same
// table the internal studio machinery reads, so the team picks it up with
// existing tooling. 'studio' feature grant required (mig 132).

function admin() {
  return createAdmin(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
}

export async function POST(req: NextRequest, { params }: { params: { token: string } }) {
  try {
    const db = admin();
    const body = await req.json().catch(() => ({}));
    const title = String(body.title || "").trim().slice(0, 140);
    const notes = String(body.notes || "").trim().slice(0, 4000);
    if (!title) return NextResponse.json({ error: "Give it a name" }, { status: 400 });
    if (!notes) return NextResponse.json({ error: "Tell us a little more first" }, { status: 400 });

    const { data: client } = await db
      .from("clients").select("id, name, portal_features").eq("portal_token", params.token).single();
    if (!client) return NextResponse.json({ error: "Invalid link" }, { status: 404 });
    if (!Array.isArray((client as any).portal_features) || !(client as any).portal_features.includes("studio")) {
      return NextResponse.json({ error: "Not available" }, { status: 403 });
    }

    const { data: brief, error } = await db
      .from("art_briefs")
      .insert({
        client_id: client.id,
        title,
        concept: notes || null,
        state: "draft",
        source: "client",
      })
      .select("id")
      .single();
    if (error || !brief) return NextResponse.json({ error: error?.message || "Couldn't save the idea" }, { status: 500 });

    try {
      const { sendInternalMail } = await import("@/lib/internal-mail");
      await sendInternalMail({ kind: "new_idea", client: (client as any).name, title, notes });
    } catch {}

    return NextResponse.json({ success: true, briefId: (brief as any).id });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Failed" }, { status: 500 });
  }
}
