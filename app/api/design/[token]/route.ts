import { NextRequest, NextResponse } from "next/server";
import { createClient as createAdmin } from "@supabase/supabase-js";

function admin() {
  return createAdmin(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
}

// GET — designer dashboard: their info + all their assigned briefs
export async function GET(_req: NextRequest, { params }: { params: { token: string } }) {
  try {
    const db = admin();
    const { data: designer } = await db.from("designers").select("id, name, active").eq("portal_token", params.token).single();
    if (!designer || !designer.active) return NextResponse.json({ error: "Invalid or inactive link" }, { status: 404 });

    // Update last_active timestamp (fire and forget)
    db.from("designers").update({ last_active_at: new Date().toISOString() }).eq("id", designer.id).then(() => {});

    // Load briefs assigned to this designer, only those that have been sent
    const { data: briefs } = await db.from("art_briefs")
      .select("id, title, state, deadline, concept, placement, colors, mood_words, sent_to_designer_at, updated_at, version_count, clients(name)")
      .eq("assigned_designer_id", designer.id)
      .not("sent_to_designer_at", "is", null)
      .order("updated_at", { ascending: false });

    return NextResponse.json({
      designer: { name: designer.name },
      briefs: briefs || [],
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message || "Failed" }, { status: 500 });
  }
}
