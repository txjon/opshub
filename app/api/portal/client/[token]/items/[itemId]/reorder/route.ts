import { NextRequest, NextResponse } from "next/server";
import { createClient as createAdmin } from "@supabase/supabase-js";
import { logJobActivityServer } from "@/lib/notify-server";

export const dynamic = "force-dynamic";

function admin() {
  return createAdmin(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
}

// POST /api/portal/client/[token]/items/[itemId]/reorder
//
// Client-side "re-order" action. Creates a fresh art_brief pre-filled
// with context from the original item (name, design link, garment hint)
// so HPD can pick it up on the OpsHub side with full context. The brief
// lands as state=draft — nothing is auto-committed, HPD reviews and
// moves it forward like any other design request.

export async function POST(_req: NextRequest, { params }: { params: { token: string; itemId: string } }) {
  try {
    const db = admin();

    // Auth: resolve client from portal token + confirm the item belongs
    // to one of this client's jobs. Prevents a client from re-ordering
    // someone else's items via a guessed itemId.
    const { data: client } = await db
      .from("clients")
      .select("id, name")
      .eq("portal_token", params.token)
      .single();
    if (!client) return NextResponse.json({ error: "Invalid link" }, { status: 404 });

    const { data: item } = await db
      .from("items")
      .select("id, name, garment_type, mockup_color, design_id, job_id, jobs(client_id, job_number, title)")
      .eq("id", params.itemId)
      .single();
    if (!item || (item as any).jobs?.client_id !== client.id) {
      return NextResponse.json({ error: "Item not found" }, { status: 404 });
    }

    // Pre-fill the new brief with context pointing back at the original.
    const originJob = (item as any).jobs;
    const concept = [
      `Re-order of "${item.name}"`,
      originJob?.job_number ? `Original project: ${originJob.job_number}${originJob.title ? ` — ${originJob.title}` : ""}` : null,
      item.garment_type ? `Garment: ${item.garment_type}${item.mockup_color ? ` · ${item.mockup_color}` : ""}` : null,
    ].filter(Boolean).join("\n");

    // Link the new brief back to the original item via item_id so HPD can
    // see "re-order of X" in context. design_id lives on items, not on
    // art_briefs — the item_id hop preserves that relationship.
    const { data: brief, error } = await db
      .from("art_briefs")
      .insert({
        client_id: client.id,
        title: item.name,
        concept,
        state: "draft",
        source: "client",
        item_id: item.id,
      })
      .select("id")
      .single();
    if (error || !brief) {
      return NextResponse.json({ error: error?.message || "Couldn't create re-order" }, { status: 500 });
    }

    // Log on the originating job so HPD sees the re-order request in context.
    if (item.job_id) {
      await logJobActivityServer(item.job_id, `Client requested re-order of "${item.name}"`);
    }

    return NextResponse.json({ success: true, brief_id: brief.id });
  } catch (e: any) {
    return NextResponse.json({ error: e.message || "Failed" }, { status: 500 });
  }
}
