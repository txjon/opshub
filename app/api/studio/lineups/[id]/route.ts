import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { dbNoStore } from "@/lib/db-nostore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The Lineup's internal controls.
// PATCH { send: true }                → sent_at + parent → with_client + marker
// PATCH { order: [optionId, …] }      → renumber (position = array order)
// DELETE                              → discard a DRAFT round (options cascade;
//                                       Drive files stay — shared-asset rule)
async function requireUser() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: profile } = await supabase.from("profiles").select("full_name").eq("id", user.id).single();
  return (profile as any)?.full_name || user.email || "HPD";
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const byName = await requireUser();
  if (!byName) return NextResponse.json({ error: "Sign in" }, { status: 401 });
  const db = dbNoStore();
  const { data: lineup } = await db.from("lineups").select("id, brief_id, sent_at, closed_at").eq("id", params.id).maybeSingle();
  if (!lineup) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if ((lineup as any).closed_at) return NextResponse.json({ error: "This round is closed" }, { status: 409 });
  const b = await req.json().catch(() => ({}));

  if (Array.isArray(b.order)) {
    for (let i = 0; i < b.order.length; i++) {
      await db.from("lineup_options").update({ position: i + 1 } as never).eq("id", b.order[i]).eq("lineup_id", params.id);
    }
    return NextResponse.json({ ok: true });
  }

  if (b.send) {
    if ((lineup as any).sent_at) return NextResponse.json({ ok: true, already: true });
    const { count } = await db.from("lineup_options").select("id", { count: "exact", head: true }).eq("lineup_id", params.id);
    if ((count || 0) < 2) return NextResponse.json({ error: "A lineup needs at least 2 options" }, { status: 400 });
    await db.from("lineups").update({ sent_at: new Date().toISOString() } as never).eq("id", params.id);
    await db.from("art_briefs").update({ state: "with_client", updated_at: new Date().toISOString() } as never).eq("id", (lineup as any).brief_id);
    await db.from("art_brief_messages").insert({
      brief_id: (lineup as any).brief_id, sender_role: "hpd", sender_name: byName,
      message: `✓ Sent a lineup — ${count} options to pick from.`, visibility: "client",
    } as never);
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "Nothing to do" }, { status: 400 });
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  if (!(await requireUser())) return NextResponse.json({ error: "Sign in" }, { status: 401 });
  const db = dbNoStore();
  const { data: lineup } = await db.from("lineups").select("id, sent_at").eq("id", params.id).maybeSingle();
  if (!lineup) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if ((lineup as any).sent_at) return NextResponse.json({ error: "Sent rounds are the record — they don't delete" }, { status: 409 });
  const { error } = await db.from("lineups").delete().eq("id", params.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
