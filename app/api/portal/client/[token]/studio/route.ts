import { NextRequest, NextResponse } from "next/server";
import { dbNoStore } from "@/lib/db-nostore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// THE CLIENT STUDIO feed (Phase 3 preview, Aug 4) — the Lab's client
// experience on real briefs, token-scoped. The wall is absolute: only
// client-visible art fronts cards, internal-only briefs never appear, and
// shelved/killed designs have left their view (working / with_client /
// approved are the whole client world).
const admin = dbNoStore;

export async function GET(_req: NextRequest, { params }: { params: { token: string } }) {
  const db = admin();
  const { data: client } = await db.from("clients").select("id, name").eq("portal_token", params.token).single();
  if (!client) return NextResponse.json({ error: "Invalid link" }, { status: 404 });

  const { data: briefs } = await db.from("art_briefs")
    .select("id, title, state, source, created_at, updated_at")
    .eq("client_id", (client as any).id)
    .eq("internal_only", false)
    .is("client_aborted_at", null)
    .in("state", ["working", "with_client", "approved"])
    .order("updated_at", { ascending: false });
  const list = (briefs || []) as any[];

  // A design surfaces to the client once there's a reason to: they started it,
  // it's their move or banked, or we've shared something client-visible.
  const ids = list.map(b => b.id);
  const hasShared = new Set<string>();
  const artByBrief: Record<string, string> = {};
  if (ids.length) {
    const { data: files } = await db.from("art_brief_files")
      .select("brief_id, drive_file_id, preview_drive_file_id, uploader_role, shared_with_client_at, reaction, created_at")
      .in("brief_id", ids).not("drive_file_id", "is", null)
      .order("created_at", { ascending: false });
    for (const f of (files || []) as any[]) {
      const visible = f.shared_with_client_at || f.uploader_role === "client";
      if (!visible) continue;
      hasShared.add(f.brief_id);
      if (!artByBrief[f.brief_id] && f.reaction !== "down") artByBrief[f.brief_id] = f.preview_drive_file_id || f.drive_file_id;
    }
    const { data: cm } = await db.from("art_brief_messages")
      .select("brief_id").in("brief_id", ids).eq("visibility", "client");
    for (const m of (cm || []) as any[]) hasShared.add(m.brief_id);
  }
  const visible = list.filter(b => b.source === "client" || b.state === "with_client" || b.state === "approved" || hasShared.has(b.id));

  return NextResponse.json({
    client: { name: (client as any).name },
    briefs: visible.map(b => ({ id: b.id, title: b.title, state: b.state, _art: artByBrief[b.id] || null })),
  });
}
