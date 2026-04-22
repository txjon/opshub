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
      .select("id, title, state, deadline, concept, placement, colors, mood_words, sent_to_designer_at, updated_at, version_count, job_id, item_id, clients(name)")
      .eq("assigned_designer_id", designer.id)
      .not("sent_to_designer_at", "is", null)
      .order("updated_at", { ascending: false });

    // Enrich with file counts + latest thumbnail per brief (for image-first UI)
    const briefIds = (briefs || []).map((b: any) => b.id);
    let filesByBrief: Record<string, any[]> = {};
    if (briefIds.length > 0) {
      const { data: files } = await db.from("art_brief_files")
        .select("brief_id, kind, version, drive_file_id, drive_link, created_at")
        .in("brief_id", briefIds)
        .order("created_at", { ascending: false });
      for (const f of (files || [])) {
        if (!filesByBrief[f.brief_id]) filesByBrief[f.brief_id] = [];
        filesByBrief[f.brief_id].push(f);
      }
    }

    const KIND_PRIORITY = ["final", "revision", "first_draft", "wip", "reference"];
    const enriched = (briefs || []).map((b: any) => {
      const files = filesByBrief[b.id] || [];
      // Latest non-reference thumb (most advanced work uploaded)
      let latest: any = null;
      for (const kind of KIND_PRIORITY) {
        const match = files.find(f => f.kind === kind);
        if (match) { latest = match; break; }
      }
      const counts = { wip: 0, first_draft: 0, revision: 0, final: 0, reference: 0 };
      for (const f of files) {
        if (counts[f.kind as keyof typeof counts] !== undefined) counts[f.kind as keyof typeof counts]++;
      }
      return {
        ...b,
        latest_thumb: latest ? { drive_file_id: latest.drive_file_id, drive_link: latest.drive_link, kind: latest.kind } : null,
        file_counts: counts,
      };
    });

    return NextResponse.json({
      designer: { name: designer.name },
      briefs: enriched,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message || "Failed" }, { status: 500 });
  }
}
