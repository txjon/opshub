import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { dbNoStore } from "@/lib/db-nostore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// "Make these real" — mint CHILD designs from the client's picks. Body:
//   { children: [{ title, optionIds: [uuid, …] }, …] }
// Each child = a new art_brief with parent_brief_id lineage, state 'working'
// (a pick is a greenlight to DEVELOP, not the artwork sign-off — each child
// earns its own bank), landing in the client's "In the works". The option's
// file rides onto the child BY REFERENCE (shared-asset rule, never copied);
// merged picks attach every option's file, first one as the face. Closes the
// round.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in" }, { status: 401 });
  const { data: profile } = await supabase.from("profiles").select("full_name").eq("id", user.id).single();
  const byName = (profile as any)?.full_name || user.email || "HPD";

  const db = dbNoStore();
  const { data: lineup } = await db.from("lineups")
    .select("id, brief_id, sent_at, picks_at, closed_at, art_briefs!lineups_brief_id_fkey(id, title, client_id)")
    .eq("id", params.id).maybeSingle();
  if (!lineup) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if ((lineup as any).closed_at) return NextResponse.json({ error: "Already minted" }, { status: 409 });
  const parent = (lineup as any).art_briefs;

  const b = await req.json().catch(() => ({}));
  const children: { title?: string; optionIds?: string[] }[] = Array.isArray(b.children) ? b.children : [];
  if (!children.length) return NextResponse.json({ error: "Pick at least one child to mint" }, { status: 400 });

  const { data: opts } = await db.from("lineup_options").select("*").eq("lineup_id", params.id);
  const optById = new Map(((opts || []) as any[]).map(o => [o.id, o]));

  const born: { id: string; title: string }[] = [];
  for (const child of children) {
    const ids = (child.optionIds || []).filter(id => optById.has(id));
    if (!ids.length) continue;
    const first = optById.get(ids[0]);
    const title = String(child.title || "").trim().slice(0, 140)
      || `${parent.title || "Design"} — ${String(first.position).padStart(2, "0")}${first.label ? ` ${first.label}` : ""}`;
    const { data: brief, error } = await db.from("art_briefs").insert({
      client_id: parent.client_id,
      parent_brief_id: parent.id,
      title,
      state: "working",
      source: "hpd",
    } as never).select("id").single();
    if (error || !brief) return NextResponse.json({ error: error?.message || "Mint failed" }, { status: 500 });
    for (let i = 0; i < ids.length; i++) {
      const o = optById.get(ids[i]);
      await db.from("art_brief_files").insert({
        brief_id: (brief as any).id,
        file_name: `${String(o.position).padStart(2, "0")}${o.label ? ` ${o.label}` : ""}.png`,
        drive_file_id: o.drive_file_id,
        preview_drive_file_id: o.preview_drive_file_id,
        drive_link: o.drive_link,
        mime_type: o.mime_type,
        file_size: o.file_size,
        kind: "wip",
        uploader_role: "hpd",
        shared_with_client_at: new Date().toISOString(),
      } as never);
    }
    born.push({ id: (brief as any).id, title });
  }
  if (!born.length) return NextResponse.json({ error: "Nothing minted — no valid options" }, { status: 400 });

  await db.from("lineups").update({ closed_at: new Date().toISOString() } as never).eq("id", params.id);
  await db.from("art_brief_messages").insert({
    brief_id: parent.id, sender_role: "hpd", sender_name: byName,
    message: `✓ Made ${born.length} of your picks real: ${born.map(x => x.title).join(" · ")}. Each is its own design now.`,
    visibility: "client",
  } as never);
  return NextResponse.json({ ok: true, children: born });
}
