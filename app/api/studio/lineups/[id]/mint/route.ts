import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { dbNoStore } from "@/lib/db-nostore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// "Make these real" — process the client's picks. TWO SPECIES by the parent
// design's state (Continuum Phase 3, Aug 24 2026):
//
//   parent WORKING  → design lineup: picks mint CHILD designs (the original
//     flow below — a pick is a greenlight to DEVELOP; each child earns its
//     own approval). Body: { children: [{ title, optionIds }] }.
//
//   parent APPROVED → comp lineup (post-"Mock it up on ___"): the design is
//     locked and the options are PRODUCT mockups — picks FILE INTO THE
//     CATALOG as un-produced products (mig 137; idempotent on brief+line
//     key; mockup image riding in spec). A product is a mockup with a name
//     until job setup. Body: { products: [{ optionId, title? }] }.
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

  const { data: opts } = await db.from("lineup_options").select("*").eq("lineup_id", params.id);
  const optById = new Map(((opts || []) as any[]).map(o => [o.id, o]));

  // ── COMP LINEUP → CATALOG (approved parent) ──
  if (Array.isArray(b.products)) {
    const { data: parentFull } = await db.from("art_briefs").select("id, state, title, client_id").eq("id", parent.id).single();
    if ((parentFull as any)?.state !== "approved") {
      return NextResponse.json({ error: "Catalog filing is for locked designs — this one is still in the works" }, { status: 409 });
    }
    const filed: { id: string; title: string }[] = [];
    for (const pr of b.products as { optionId?: string; title?: string }[]) {
      const o = optById.get(String(pr.optionId || ""));
      if (!o) continue;
      const title = String(pr.title || "").trim().slice(0, 140)
        || `${parent.title || "Design"}${o.label ? ` ${o.label}` : ` — ${String(o.position).padStart(2, "0")}`}`;
      // Idempotent birth: unique (brief_id, line_id).
      const { data: prod, error } = await db.from("products").upsert({
        client_id: parent.client_id,
        brief_id: parent.id,
        line_id: `lineup:${o.id}`,
        title,
        format: o.label || null,
        model: "not_sure",
        state: "ready",
        spec: { mockup_drive_file_id: o.preview_drive_file_id || o.drive_file_id || null, from_lineup_id: params.id },
      } as never, { onConflict: "brief_id,line_id" } as any).select("id, title").single();
      if (error || !prod) return NextResponse.json({ error: error?.message || "Filing failed" }, { status: 500 });
      filed.push({ id: (prod as any).id, title: (prod as any).title });
    }
    if (!filed.length) return NextResponse.json({ error: "Nothing to file — no valid picks" }, { status: 400 });
    await db.from("lineups").update({ closed_at: new Date().toISOString() } as never).eq("id", params.id);
    await db.from("art_brief_messages").insert({
      brief_id: parent.id, sender_role: "hpd", sender_name: byName,
      message: `✓ ${filed.length === 1 ? "1 pick is" : filed.length + " picks are"} in your catalog: ${filed.map(x => x.title).join(" · ")}. Order or add to a release from there.`,
      visibility: "client",
    } as never);
    return NextResponse.json({ ok: true, products: filed });
  }

  const children: { title?: string; optionIds?: string[] }[] = Array.isArray(b.children) ? b.children : [];
  if (!children.length) return NextResponse.json({ error: "Pick at least one child to mint" }, { status: 400 });

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
